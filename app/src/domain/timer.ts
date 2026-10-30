/**
 * 计时：一张卡旁边那个「做多久」的组件的逻辑。
 *
 * **形态由卡自己的时长决定，不给用户选**：
 *   · 知道时长 → 倒计时（数着原文给的那个数走，归零就是做完了）
 *   · 不知道时长 → 正计时（从零往上数，做多久算多久）
 *
 * 为什么这样分：
 *   原文给了时长的那些（泡澡 10 分钟、按压 3 秒），用户要的是
 *   「到点了没有」—— 倒计时直接回答。正计时数的是「我做了多久」，
 *   与原文那个数无关，两件事不能混在一个显示里。
 *   时长未知的卡（14 张）倒计时不出来 —— 那不是没数，是**不知道该数到几**，
 *   正计时才是那里唯一说得通的形态。
 *
 * **推算出来的时长也算「知道」**（45 张 derived）：那个数有算式、界面上标着
 * 「推算」，倒计时照着用，但要在界面上把「推算」这层意思留着 ——
 * 倒计时归零时说的「做完了」是按推算的数算的，别让它冒充原文的数。
 *
 * 这一层是纯逻辑，不碰平台 API —— 界面怎么摆、到点要不要响是 ui/ 与 platform/ 的事。
 */

/** 一张卡的时长够不够拿来倒计时。 */
export interface DurationInfo {
  /** 原文或推算给出的秒数；null = 不知道 */
  sec: number | null;
  /** 这个数是推算来的（界面要标出来） */
  derived?: boolean;
}

export type TimerKind = "countdown" | "countup";

/** 计时器的形态与它要显示的字。 */
export interface TimerPlan {
  kind: TimerKind;
  /** 倒计时：目标秒数。正计时：null */
  targetSec: number | null;
  /** 界面上该怎么称呼它（按钮上的字） */
  label: string;
  /** 这个数是推算来的吗（倒计时归零时要照实说） */
  derived: boolean;
}

/**
 * 倒计时的上限：一小时以上不算「做一件事要多久」，那是「持续多久」的疗程。
 *
 * 与 lines.ts 的 DUR_SUSPICIOUS_SEC 同一条线 —— 那里是「不显示」，
 * 这里是「不倒计时」：一个 2 周的疗程倒计时没有意义。
 */
export const TIMER_MAX_SEC = 3600;

/**
 * 这张卡该用哪种形态。
 *
 * **推算的也算知道**（见文件头的说明），但 derived 会被传出去，
 * 好让界面在归零时照实说「按推算的时长到了」。
 */
export function timerPlan(duration: DurationInfo | null | undefined): TimerPlan {
  const sec = duration?.sec;
  if (sec != null && Number.isFinite(sec) && sec > 0 && sec <= TIMER_MAX_SEC) {
    return {
      kind: "countdown",
      targetSec: Math.round(sec),
      label: `倒计时 ${formatDuration(Math.round(sec))}`,
      derived: duration?.derived === true,
    };
  }
  return { kind: "countup", targetSec: null, label: "正计时", derived: false };
}

/** 秒 → 「10 分钟」「3 秒」「1 分 30 秒」。 */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return `${s} 秒`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m} 分 ${rest} 秒` : `${m} 分钟`;
  const h = Math.floor(m / 60);
  return `${h} 小时 ${m % 60} 分`;
}

/**
 * 计时器显示的字：分:秒（超过一小时才带小时）。
 *
 * **归零显示「00:00」而不是「已结束」** —— 结束这件事由状态说（见 timerFinished），
 * 显示层只管报数；两件事混在一处，暂停后接着跑就会显示错。
 */
export function formatElapsed(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(r).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** 计时器的状态。 */
export interface TimerState {
  /** 跑起来了吗 */
  running: boolean;
  /** 起点（毫秒时间戳）；没跑过是 null */
  startedAt: number | null;
  /** 已经累计的毫秒（暂停时冻结的那些也算在内） */
  accumulatedMs: number;
}

/** 还没开始。 */
export const TIMER_IDLE: TimerState = { running: false, startedAt: null, accumulatedMs: 0 };

/**
 * 这一刻已经过去多少毫秒。
 *
 * **用墙钟算，不用累加**：累加会漂（每 tick 少几毫秒，一天下来差一分钟），
 * 而且页面被浏览器节流时（后台标签页）根本没有 tick 累加 —— 回到前台会显示
 * 「才过了 3 秒」，而实际过了 20 分钟。
 */
export function elapsedMs(state: TimerState, now: number): number {
  const running = state.running && state.startedAt != null ? now - state.startedAt : 0;
  return state.accumulatedMs + Math.max(0, running);
}

/** 开始（或从暂停处接着跑）。 */
export function timerStart(state: TimerState, now: number): TimerState {
  return { running: true, startedAt: now, accumulatedMs: state.accumulatedMs };
}

/**
 * 暂停。
 *
 * **把跑掉的时间存进 accumulated**：不存的话，暂停等于「回到原点」——
 * 接着跑的时候那段时间不算，用户会以为计时器坏了。
 */
export function timerPause(state: TimerState, now: number): TimerState {
  return { running: false, startedAt: null, accumulatedMs: elapsedMs(state, now) };
}

/** 归零重来。 */
export function timerReset(): TimerState {
  return { ...TIMER_IDLE };
}

/** 倒计时还剩多少秒（正计时没有「剩」，返回 null）。 */
export function remainingSec(state: TimerState, now: number, targetSec: number | null): number | null {
  if (targetSec == null) return null;
  return Math.max(0, targetSec - Math.floor(elapsedMs(state, now) / 1000));
}

/**
 * 到点了没有（倒计时归零）。
 *
 * **只在「正在跑」时才算到点**：暂停着的倒计时停在某个数上，
 * 那个数是 0 就是 0 —— 但它没在跑，不该这时候报「做完了」。
 */
export function timerFinished(state: TimerState, now: number, targetSec: number | null): boolean {
  if (targetSec == null) return false;
  if (!state.running) return false;
  return Math.floor(elapsedMs(state, now) / 1000) >= targetSec;
}

/**
 * 这条倒计时已经走完了没有（不管现在跑不跑）。
 *
 * **为什么单独一条**：到点之后计时器是停着的（running = false），
 * 但「时间已经用完了」这件事仍然成立 —— 读数停在 00:00 就是这个意思。
 * 「再点一次开始」时靠它判断是**接着跑**（还没到点）还是**重新计时**
 * （已经到点，接着跑会立刻又判一次到点、再响一次）。
 */
export function timerExhausted(
  state: TimerState,
  now: number,
  targetSec: number | null,
): boolean {
  if (targetSec == null) return false;
  return Math.floor(elapsedMs(state, now) / 1000) >= targetSec;
}

/**
 * 计时器该显示什么。
 *
 * 倒计时：剩下的秒数（归零就是 0）。
 * 正计时：已经过去的秒数。
 */
export function timerDisplay(state: TimerState, now: number, targetSec: number | null): string {
  const remaining = remainingSec(state, now, targetSec);
  const shown = remaining == null ? Math.floor(elapsedMs(state, now) / 1000) : remaining;
  return formatElapsed(shown);
}

/**
 * 到点时该说什么。
 *
 * **推算的时长要说出来**：按推算的数归零，不等于原文说的那个数到了 ——
 * 把「按推算的时长到了」说成「做完了」，等于替原文背书（D7）。
 */
export function timerDoneText(derived: boolean): string {
  return derived ? "按推算的时长到了" : "时间到";
}
