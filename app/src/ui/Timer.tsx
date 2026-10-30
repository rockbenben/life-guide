/**
 * 计时器：卡旁边那个「做多久」的组件。
 *
 * **两种形态由卡自己的时长决定，用户不用选**（见 domain/timer.ts）：
 *   · 知道时长 → 倒计时，归零就是做完了
 *   · 不知道时长 → 正计时，从零往上数
 *
 * **放在展开态的「耗时」那一行旁边**（作者定的位置）：收起态是
 * 「现在做什么」的一行摘要，有三行契约（名 / 做什么 / 剂量），
 * 挤一个计时器进去会破掉它 —— 而计时器是「做这一件时」才用得上的东西，
 * 展开看剂量时顺手用正合适。
 *
 * **状态不存**：切走就没了（作者定的）。计时是「此刻在做这一件」的临时状态，
 * 存进库里还要处理「同步到对面设备上的一个正在跑的秒表」这种没人想遇到的事。
 *
 * 逻辑全在 domain/timer.ts（纯函数，可单测）；这里只管画与点。
 */
import { useEffect, useRef, useState } from "preact/hooks";

import {
  TIMER_IDLE,
  elapsedMs,
  timerDisplay,
  timerDoneText,
  timerExhausted,
  timerFinished,
  timerPause,
  timerPlan,
  timerReset,
  timerStart,
  type TimerPlan,
  type TimerState,
} from "../domain/timer.ts";
import { showNow } from "../platform/notify.ts";

/** 走一格多久（毫秒）。一格一整秒够读数，再密只是多烧点电。 */
const TICK_MS = 250;

export interface TimerProps {
  /** 这张卡的时长（秒）与它是不是推算来的 */
  duration: { sec: number | null; derived?: boolean } | null | undefined;
  /** 通知标题（到点时说的那句） */
  title: string;
  /** 这张卡的 id —— 用来给通知分段号，避免两张卡的计时器互相顶掉 */
  cardId?: string;
  /** 这一刻（毫秒）—— 传进来是为了能测 */
  now?: number;
}

/**
 * 通知的分段号：从卡 id 算一个稳定的号。
 *
 * **为什么不能都用同一个**：原生端按 id 存通知，撞了就是后一条把前一条顶掉
 * （AGENTS.md §4.2 记过这个坑）。「今天」和「手册」可以各有一个计时器在跑，
 * 两个都用 999 的话先到的那条就没了。
 *
 * 取一段高位（0x7000 起），跟提醒用的那些号（每条占 100 的段）不撞。
 */
function notifyIdFor(cardId: string | undefined): number {
  if (!cardId) return 999;
  let h = 0;
  for (const ch of cardId) h = (h * 31 + ch.charCodeAt(0)) & 0xffff;
  return 0x7000 + (h % 0x1000);
}

/**
 * 计时器。
 *
 * **只在展开态摆**（由 Card.tsx 决定要不要挂这个组件），
 * 所以这里不用管「收起时要不要藏起来」。
 */
export function Timer({ duration, title, cardId, now }: TimerProps) {
  const plan: TimerPlan = timerPlan(duration);
  const [state, setState] = useState<TimerState>(TIMER_IDLE);
  // 归零那一刻要发一次通知；用 ref 记住「说过了」，免得每 tick 说一遍
  const announced = useRef(false);
  // 时钟：跑着的时候才走，停了就不走（省电，也免得空转）
  const [, setTick] = useState(0);

  const at = now ?? Date.now();

  useEffect(() => {
    if (!state.running) return;
    const id = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(id);
  }, [state.running]);

  // 到点了：说一次，并停在那儿
  useEffect(() => {
    if (!state.running) return;
    if (!timerFinished(state, at, plan.targetSec)) return;
    // **用 timerPause 停，不是只把 running 改 false**：
    // 只改 running 的话，accumulatedMs 还是 0，elapsedMs 一下归零，
    // 读数会从 00:00 跳回起始值（10:00）—— 用户会以为计时器重置了。
    setState((s) => timerPause(s, at));
    if (announced.current) return;
    announced.current = true;
    void showNow(title, timerDoneText(plan.derived), notifyIdFor(cardId));
  }, [state, at, plan.targetSec, plan.derived, title, cardId]);

  // 重新开始时把「说过了」清掉
  useEffect(() => {
    if (!state.running) announced.current = false;
  }, [state.running]);

  const shown = timerDisplay(state, at, plan.targetSec);
  const running = state.running;
  const elapsedSec = Math.floor(elapsedMs(state, at) / 1000);

  function toggle() {
    setState((s) => {
      if (s.running) return timerPause(s, Date.now());
      announced.current = false;
      // **已经走完的倒计时，再点开始是重新计时**，不是接着跑 ——
      // 接着跑的话累计时间已经到点了，一按就又判一次到点、又响一次。
      if (timerExhausted(s, Date.now(), plan.targetSec)) return timerStart(timerReset(), Date.now());
      return timerStart(s, Date.now());
    });
  }

  function reset() {
    setState(timerReset());
    announced.current = false;
  }

  return (
    <span class="lg-timer" data-kind={plan.kind} data-running={running ? "true" : "false"}>
      <button
        class="lg-timer-btn"
        onClick={toggle}
        aria-label={running ? "暂停计时" : plan.kind === "countdown" ? "开始倒计时" : "开始正计时"}
        title={plan.label}
      >
        <span class="lg-timer-num tabular">{shown}</span>
      </button>
      {running || elapsedSec > 0 ? (
        <button class="lg-timer-reset" onClick={reset} aria-label="重置计时">
          重置
        </button>
      ) : null}
    </span>
  );
}
