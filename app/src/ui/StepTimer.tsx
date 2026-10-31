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
import { useEffect, useRef, useState } from "preact/hooks";

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
export function StepTimer({ steps, title, cardId, now }: StepTimerProps) {
  const timings: StepTiming[] = stepTimings(steps);
  const [state, setState] = useState<StepTimerState>(STEP_TIMER_IDLE);
  const [, setTick] = useState(0);
  // 每一步到点时要说一次；用 ref 记住「说过了」
  const announced = useRef(false);

  const at = now ?? Date.now();
  const current = timings[state.at];
  const derived = timingsDerived(timings);

  useEffect(() => {
    if (!state.running) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [state.running]);

  // 这一步到点了：说一声，然后接着下一步
  useEffect(() => {
    if (!state.running) return;
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
    setState(nextStep(state, timings, at));
  }, [state, at, current, timings, derived, title, cardId]);

  // 重新开始时把「说过了」清掉
  useEffect(() => {
    if (!state.running) announced.current = false;
  }, [state.running]);

  if (!timings.length) return null;

  function toggle() {
    setState((s) => {
      if (s.running) return stepPause(s, at, current);
      announced.current = false;
      return stepStart(s, at, timings);
    });
  }

  function reset() {
    setState({ ...STEP_TIMER_IDLE });
    announced.current = false;
  }

  const shown = stepDisplay(state, at, current);
  const running = state.running;
  // 做完了：at 落在步数上（nextStep 把 at 推到 timings.length）
  const done = !running && state.at >= timings.length;
  // 形态说明：正计时的那一步要说清「要等多久」——
  // 它的读数只显示「已经过了多久」，起手 00:00 看着像坏了（实测踩过）。
  const kind = stepTimerKind(current);
  const label = stepTimerLabel(current);

  return (
    <div class="lg-steptimer" data-running={running ? "true" : "false"} data-kind={kind}>
      <div class="lg-steptimer-head">
        <button
          class="lg-steptimer-btn"
          onClick={toggle}
          aria-label={running ? "暂停计时" : "开始计时"}
          title={label}
        >
          <span class="lg-steptimer-num tabular">{done ? "完成" : shown}</span>
        </button>
        <div class="lg-steptimer-meta">
          <span class="lg-steptimer-at">
            {done ? "这一组做完了" : `第 ${state.at + 1} / ${timings.length} 步`}
          </span>
          {current ? (
            <span class="lg-steptimer-what">{current.text}</span>
          ) : null}
          {/* 正计时的那一步把「要等多久」摆出来 —— 读数只有「已经过了多久」 */}
          {kind === "countup" && current?.sec != null ? (
            <span class="lg-steptimer-wait">{label}</span>
          ) : null}
        </div>
        {/* 重置键：跑着、暂停着（frozen 里有数）、或做完了，都该能重置 */}
        {running || state.frozen != null || done ? (
          <button class="lg-timer-reset" onClick={reset} aria-label="重置计时">
            重置
          </button>
        ) : null}
      </div>
    </div>
  );
}
