/**
 * 分步计时：一张卡的「怎么做」那串步骤旁边的计时器。
 *
 * **为什么分步**（2026-10-30）：卡级的 duration 是**整张卡的总时长**，
 * 而「每个动作 30 秒」这种原文说的是**每一步**（血管拉伸那张卡记的是
 * 420 秒 = 5 个动作 × 2 回 × 30 秒 + 4 次休息 × 30 秒）。只看总数，
 * 30 秒一组的节奏就丢了 —— 而节奏正是这类动作要照着做的部分。
 *
 * **怎么走**：这一步归零就跳下一步，自动接着数。中间没有时长的那几步
 * 不参与计时（它们在列表里照常显示，只是没有读数）—— 跳的时候从它们
 * 上面越过去。
 *
 * **每一步的数从哪儿来**：内容层从原文抽（`duration` 字段，带引文）。
 * 原文没给每步多长时间的卡，这里就摆不出来 —— **不替原文编数**（D7）。
 *
 * 逻辑全在 domain/timer.ts（纯函数，可单测）；这里只管画与点。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import {
  STEP_TIMER_IDLE,
  nextStep,
  stepDisplay,
  stepFinished,
  stepPause,
  stepStart,
  stepTimerKind,
  stepTimerLabel,
  stepTimings,
  timingsDerived,
  type StepTimerState,
  type StepTiming,
} from "../domain/timer.ts";
import { showNow } from "../platform/notify.ts";

/** 走一格多久（毫秒）。 */
const TICK_MS = 250;

export interface StepTimerProps {
  /** 这张卡的步骤（带各自的 duration） */
  steps: { text: string; duration?: { sec?: number; basis?: string } | null }[];
  /** 通知标题（到点时说的那句） */
  title: string;
  /** 这张卡的 id —— 用来给通知分段号 */
  cardId?: string;
  /** 这一刻（毫秒）—— 传进来是为了能测 */
  now?: number;
  /** 正在计时的那一步在完整列表里的下标。暂停时保留，结束或重置时清除。 */
  onActiveStepChange?: (index: number | null, scroll?: boolean) => void;
  /** 本轮自然计时到点的步骤，使用完整列表的下标。 */
  onCompletedStepsChange?: (indices: ReadonlySet<number>, makeup: boolean) => void;
  /** 列表点选请求，index 对应完整步骤列表。每次点击都发出新的请求。 */
  selection?: { index: number } | null;
}

/**
 * 通知的分段号：从卡 id 算一个稳定的号。
 *
 * **为什么不能都用同一个**：原生端按 id 存通知，撞了就是后一条把前一条
 * 顶掉（AGENTS.md §4.2 记过这个坑）。「今天」和「手册」可以各有一个
 * 计时器在跑，一个 id 会让其中一个没声音。
 */
function notifyIdFor(cardId: string | undefined): number {
  if (!cardId) return 999;
  let h = 0;
  for (const ch of cardId) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  return 0x7000 + (h % 0x1000);
}

/**
 * 分步计时器。
 *
 * **只在一张卡上摆一个**（不是每步一个按钮）：计时是「一串动作」的节奏，
 * 一步一步地走；每步各摆一颗键的话，界面上是一排读数在同时跑，
 * 反而看不出该做哪一步。
 */
const EMPTY_COMPLETED_STEPS: ReadonlySet<number> = new Set<number>();

export function StepTimer({
  steps, title, cardId, now, onActiveStepChange, onCompletedStepsChange, selection,
}: StepTimerProps) {
  const timings: StepTiming[] = useMemo(() => stepTimings(steps), [steps]);
  const [{ timer: state, completed, makeup }, setSession] = useState({
    timer: STEP_TIMER_IDLE as StepTimerState,
    completed: EMPTY_COMPLETED_STEPS,
    makeup: false,
  });
  const [, setTick] = useState(0);
  // 每一步到点时要说一次；用 ref 记住「说过了」
  const announced = useRef(false);
  const manualScroll = useRef(false);
  const handledSelection = useRef(selection);
  const timerButtonRef = useRef<HTMLButtonElement>(null);

  const at = now ?? Date.now();
  const current = timings[state.at];
  const derived = timingsDerived(timings);
  const activeIndex = state === STEP_TIMER_IDLE ? null : current?.index ?? null;
  const selectedTiming = selection ? timings.findIndex((timing) => timing.index === selection.index) : -1;
  const previous = makeup
    ? timings.findLastIndex(({ index }, i) => i < state.at && !completed.has(index))
    : state.at - 1;
  const next = makeup
    ? timings.findIndex(({ index }, i) => i > state.at && !completed.has(index))
    : state.at + 1;

  const selectStep = useCallback((index: number, options: {
    restart?: boolean;
    clearIndex?: number;
    makeup?: boolean;
  } = {}) => {
    manualScroll.current = true;
    announced.current = false;
    const selectedAt = now ?? Date.now();
    setSession((session) => {
      const { timer, completed } = session;
      const { restart = true, clearIndex } = options;
      if (session.makeup && clearIndex == null && completed.has(timings[index]?.index)) return session;
      let nextCompleted = completed;
      if (clearIndex != null && completed.has(clearIndex)) {
        const remaining = new Set(completed);
        remaining.delete(clearIndex);
        nextCompleted = remaining;
      }
      // 点选当前步骤只重新定位，重做按钮才把它的读数恢复到起点。
      if (!restart && timer.at === index && timer !== STEP_TIMER_IDLE) {
        return { ...session, timer: { ...timer } };
      }
      return {
        timer: {
          at: index,
          since: timer.running ? selectedAt : null,
          frozen: null,
          running: timer.running,
        },
        completed: nextCompleted,
        makeup: options.makeup ?? session.makeup,
      };
    });
  }, [now, timings]);

  useEffect(() => {
    onActiveStepChange?.(activeIndex, manualScroll.current);
    manualScroll.current = false;
  }, [activeIndex, state, onActiveStepChange]);

  useEffect(() => () => onActiveStepChange?.(null), [onActiveStepChange]);

  useEffect(() => {
    onCompletedStepsChange?.(completed, makeup);
  }, [completed, makeup, onCompletedStepsChange]);

  useEffect(() => () => onCompletedStepsChange?.(EMPTY_COMPLETED_STEPS, false), [onCompletedStepsChange]);

  useEffect(() => {
    if (selection === handledSelection.current) return;
    handledSelection.current = selection;
    if (selectedTiming >= 0) selectStep(selectedTiming, { restart: false });
  }, [selection, selectedTiming, selectStep]);

  useEffect(() => {
    if (!state.running) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [state.running]);

  // 这一步到点了：说一声，然后接着下一步
  useEffect(() => {
    if (!state.running || !current) return;
    if (!stepFinished(state, at, current)) return;
    if (!announced.current) {
      announced.current = true;
      void showNow(
        title,
        derived ? "按推算的时长到了" : "时间到",
        notifyIdFor(cardId),
      );
    }
    // 接着下一步（最后一步做完就是「做完了」）
    setSession((latest) => {
      if (latest.timer !== state) return latest;
      const timer = nextStep(state, timings, at, next < 0 ? timings.length : next);
      return {
        timer,
        completed: new Set([...latest.completed, current.index]),
        makeup: latest.makeup && timer.running,
      };
    });
  }, [state, at, current, timings, derived, title, cardId, next]);

  // 重新开始时把「说过了」清掉
  useEffect(() => {
    if (!state.running) announced.current = false;
  }, [state.running]);

  if (!timings.length) return null;

  function toggle() {
    if (!state.running) announced.current = false;
    setSession(({ timer, completed, makeup }) => ({
      timer: timer.running ? stepPause(timer, at, current) : stepStart(timer, at, timings),
      completed: timer.at >= timings.length ? EMPTY_COMPLETED_STEPS : completed,
      makeup,
    }));
  }

  function reset() {
    setSession({ timer: STEP_TIMER_IDLE, completed: EMPTY_COMPLETED_STEPS, makeup: false });
    announced.current = false;
  }

  function exitMakeup() {
    const pausedAt = now ?? Date.now();
    setSession((session) => {
      const { timer } = session;
      return {
        ...session,
        timer: timer.running ? stepPause(timer, pausedAt, timings[timer.at]) : timer,
        makeup: false,
      };
    });
    timerButtonRef.current?.focus({ preventScroll: true });
  }

  function redo() {
    const index = Math.min(state.at, timings.length - 1);
    selectStep(index, { clearIndex: timings[index].index });
  }

  const shown = stepDisplay(state, at, current);
  const running = state.running;
  // 做完了：at 落在步数上（nextStep 把 at 推到 timings.length）
  const done = !running && state.at >= timings.length;
  const remaining = timings.length - completed.size;
  const firstIncomplete = done ? timings.findIndex(({ index }) => !completed.has(index)) : -1;
  // 形态说明：正计时的那一步要说清「要等多久」——
  // 它的读数只显示「已经过了多久」，起手 00:00 看着像坏了（实测踩过）。
  const kind = stepTimerKind(current);
  const label = stepTimerLabel(current);

  return (
    <div class="lg-steptimer" data-running={running ? "true" : "false"} data-kind={kind}>
      <div class="lg-steptimer-head">
        <button
          ref={timerButtonRef}
          class="lg-steptimer-btn"
          onClick={toggle}
          aria-label={running ? "暂停计时" : "开始计时"}
          title={label}
        >
          <span class="lg-steptimer-num tabular">{done ? (remaining ? "结束" : "完成") : shown}</span>
        </button>
        <div class="lg-steptimer-meta">
          <div class="lg-steptimer-summary">
            <span class="lg-steptimer-at">
              {done
                ? remaining === 0 ? "这一组做完了" : "这一轮计时结束"
                : `${makeup ? "补做 · " : ""}第 ${state.at + 1} / ${timings.length} 步`}
            </span>
            <span class="lg-steptimer-progress" aria-live="polite" aria-atomic="true">
              {`已完成 ${completed.size}/${timings.length} 步`}
            </span>
          </div>
          {current ? (
            <span class="lg-steptimer-what">{current.text}</span>
          ) : null}
          {/* 正计时的那一步把「要等多久」摆出来 —— 读数只有「已经过了多久」 */}
          {kind === "countup" && current?.sec != null ? (
            <span class="lg-steptimer-wait">{label}</span>
          ) : null}
          <progress
            class="lg-steptimer-progress-bar"
            aria-label="计时步骤完成进度"
            value={completed.size}
            max={timings.length}
          />
        </div>
        {/* 重置键：跑着、暂停着（frozen 里有数）、或做完了，都该能重置 */}
        {activeIndex != null || done ? (
          <button class="lg-timer-reset" onClick={reset} aria-label="重置计时">
            重置
          </button>
        ) : null}
      </div>
      <div class="lg-steptimer-actions" role="group" aria-label="分步计时操作">
        <button type="button" class="lg-btn lg-btn-ghost" disabled={previous < 0}
          onClick={() => selectStep(previous)}>
          上一步
        </button>
        <button type="button" class="lg-btn lg-btn-ghost" disabled={next < 0 || next >= timings.length}
          onClick={() => selectStep(next)}>
          下一步
        </button>
        <button type="button" class="lg-btn lg-btn-ghost"
          onClick={redo}>
          重做这一步
        </button>
        {firstIncomplete >= 0 ? (
          <button
            type="button"
            class="lg-btn lg-steptimer-makeup"
            onClick={() => {
              selectStep(firstIncomplete, { makeup: true });
              timerButtonRef.current?.focus({ preventScroll: true });
            }}
          >
            补做未完成（还剩 {remaining} 步）
          </button>
        ) : null}
        {makeup ? (
          <button type="button" class="lg-btn lg-btn-ghost lg-steptimer-makeup" onClick={exitMakeup}>
            退出补做
          </button>
        ) : null}
      </div>
    </div>
  );
}
