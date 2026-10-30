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
 * **分步计时**（2026-10-30 加）：卡级 duration 是**整张卡的总时长**，
 * 而「每个动作 30 秒」这种原文说的是**每一步**（血管拉伸那张卡记的是
 * 420 秒 = 5 个动作 × 2 回 × 30 秒 + 4 次休息 × 30 秒）。只看总数，
 * 30 秒一组的节奏就丢了。所以每一步可以带自己的时长，计时器按步走：
 * 这一步归零就跳下一步。
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

/* ------------------------------------------------------------------ 分步 */

/**
 * 分步计时的一步。
 *
 * **为什么每步可以有自己的时长**：原文说的是「每个动作 30 秒」时，
 * 那个 30 秒是**每一步**的时长，不是整张卡的。卡级 duration 记的是总和
 * （血管拉伸：420 秒 = 5 个动作 × 2 回 × 30 秒 + 4 次休息 × 30 秒）——
 * 只看总数，节奏就丢了。
 *
 * **没写 duration 的那一步怎么办**：它不是「0 秒」，是**不知道这一步多久**
 * （D7）。那一步照样显示、照样能走，只是不带读数 —— 界面上它就是一个
 * 普通的步骤，不假装自己有时长。
 */
export interface StepTiming {
  /** 这一步在卡里的序号（0 起） */
  index: number;
  /** 文本（界面上要显示的） */
  text: string;
  /** 这一步的时长（秒）；null = 原文没给 */
  sec: number | null;
  /** 这个数是推算来的 */
  derived: boolean;
}

/**
 * 把一张卡的步骤排成「分步计时」的一串。
 *
 * **只有带时长的步骤才排进来**（`sec != null`）——
 * 没有时长的那几步不参与计时，它们在界面上还是照常显示的步骤，
 * 只是没有读数。这样排出来的一串就是「要数的那几步」，
 * 中间跳过不计时的那几步。
 */
export function stepTimings(
  steps: { text: string; duration?: { sec?: number; basis?: string } | null }[],
): StepTiming[] {
  const out: StepTiming[] = [];
  for (const [index, s] of steps.entries()) {
    const sec = s.duration?.sec;
    if (sec == null || !Number.isFinite(sec) || sec <= 0) continue;
    out.push({
      index,
      text: s.text,
      sec: Math.round(sec),
      derived: s.duration?.basis === "derived",
    });
  }
  return out;
}

/**
 * 这一步该倒计时还是正计时。
 *
 * **上限跟卡级同一条线**（`TIMER_MAX_SEC`，一小时）：
 * 步级时长里也有「冷藏 5 小时」「冷冻 1 小时」这类 —— 那是**等待**，
 * 不是「做一件事要多久」。倒计时 5 小时没有意义，那种走正计时。
 */
export function stepTimerKind(timing: StepTiming | undefined): TimerKind {
  if (!timing || timing.sec == null) return "countup";
  return timing.sec <= TIMER_MAX_SEC ? "countdown" : "countup";
}

/** 这一串里有没有推算来的数。 */
export function timingsDerived(timings: StepTiming[]): boolean {
  return timings.some((t) => t.derived);
}

/**
 * 分步计时的状态：现在在第几步、那步从什么时候开始。
 *
 * **与单步计时器的区别**：单步的是「起点 + 累计」，
 * 分步的是「第几步 + 这一步的起点」—— 每步归零就往前挪一格，
 * 上一格的时间不再累计（它已经过去了）。
 *
 * `at` 等于步数时表示**整组做完了**（没有下一步可去了）。
 */
export interface StepTimerState {
  /** 现在在第几步（`timings` 的下标，不是步骤的下标）；等于步数 = 做完了 */
  at: number;
  /** 这一步的起点（毫秒时间戳）；还没开始是 null */
  since: number | null;
  /**
   * 暂停时冻结的剩余秒数。
   *
   * **为什么要有它**：暂停只是「别再往下数」，那一步剩下的时间不能继续掉 ——
   * 光把 `since` 留着的话，读数会接着往下走，暂停等于没暂停。
   * 跑着的时候它是 null（那时看 `since` 算）。
   */
  frozen: number | null;
  /** 跑着吗 */
  running: boolean;
}

/** 分步计时的初始状态。 */
export const STEP_TIMER_IDLE: StepTimerState = {
  at: 0,
  since: null,
  frozen: null,
  running: false,
};

/**
 * 这一步还剩多少秒（倒计时）；null = 这一步没有目标数（正计时）。
 */
export function stepRemaining(
  state: StepTimerState,
  now: number,
  timing: StepTiming | undefined,
): number | null {
  if (!timing) return null;
  if (timing.sec == null) return null;
  // 超过上限的步走正计时（跟卡级同一条线）
  if (stepTimerKind(timing) === "countup") return null;
  if (!state.running) {
    // 暂停着：剩下多少就还是多少（没开始过就是全部）
    if (state.frozen != null) return state.frozen;
    if (state.since == null) return timing.sec;
  }
  const elapsed = state.since == null ? 0 : Math.max(0, now - state.since);
  return Math.max(0, timing.sec - Math.floor(elapsed / 1000));
}

/**
 * 这一步该显示什么。
 *
 * **倒计时**：这一步还剩多少秒（归零就是 0）。
 * **正计时**：这一步已经过了多少秒。
 */
export function stepDisplay(
  state: StepTimerState,
  now: number,
  timing: StepTiming | undefined,
): string {
  if (!timing) return "";
  const remaining = stepRemaining(state, now, timing);
  if (remaining != null) return formatElapsed(remaining);
  // 正计时：这一步已经过了多少秒
  const elapsed = state.since == null ? 0 : Math.max(0, now - state.since);
  return formatElapsed(Math.floor(elapsed / 1000));
}

/**
 * 这一步到点了没有（倒计时归零）。
 *
 * **只在跑着的时候算**：暂停着停在某个数上，那个数是 0 就是 0，
 * 但它没在跑，不该这时候报「到点了」。
 */
export function stepFinished(
  state: StepTimerState,
  now: number,
  timing: StepTiming | undefined,
): boolean {
  if (!timing || timing.sec == null) return false;
  // 正计时的步没有「到点」
  if (stepTimerKind(timing) === "countup") return false;
  if (!state.running || state.since == null) return false;
  return Math.floor((now - state.since) / 1000) >= timing.sec;
}

/**
 * 暂停：把剩下多少秒冻住。
 *
 * **为什么要冻**：只把 `running` 改 false 的话，读数会接着往下掉 ——
 * 暂停等于没暂停。
 */
export function stepPause(
  state: StepTimerState,
  now: number,
  timing: StepTiming | undefined,
): StepTimerState {
  const remaining = stepRemaining(state, now, timing);
  return {
    ...state,
    running: false,
    since: null,
    frozen: remaining,
  };
}

/**
 * 开始 / 接着跑：从这一刻起数。
 */
export function stepStart(
  state: StepTimerState,
  now: number,
  timings: StepTiming[],
): StepTimerState {
  // 已经做完了 → 从头开始；否则接着当前那一步跑
  const at = state.at >= timings.length ? 0 : state.at;
  return { at, since: now, frozen: null, running: true };
}

/**
 * 这一步做完了 → 进下一步。
 *
 * **进下一步时接着跑**（`since` 换成这一刻）：一串动作是要连着做的 ——
 * 每一步归零就停一下再让人手动点一下，等于把节奏又交回给用户了。
 *
 * **每一格的时间不累计**：每一步是各自的一段，把它们加在一起就成了
 * 「整张卡的总时长」—— 那是卡级 duration 的活，计时器不重复算。
 *
 * **最后一步做完就停**：`at` 落在步数上（= 做完了），`since` 清空 ——
 * 不这样表示的话，「做完了」这个状态就没有地方放（at 永远指着一
 * 已经做完的那一步，界面显示不出「整组做完了」）。
 */
export function nextStep(
  state: StepTimerState,
  timings: StepTiming[],
  now: number,
): StepTimerState {
  const next = state.at + 1;
  if (next >= timings.length) {
    return { at: timings.length, since: null, frozen: null, running: false };
  }
  return { at: next, since: now, frozen: null, running: true };
}
