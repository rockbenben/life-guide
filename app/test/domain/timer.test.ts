/**
 * 计时器的逻辑。
 *
 * 这些是「数得对不对」的判据 —— 计时器读错数，用户就会按错的数停手
 * （比如以为泡够 10 分钟，其实只过了 3 分钟）。
 */
import { describe, expect, it } from "vitest";

import {
  TIMER_IDLE,
  elapsedMs,
  formatDuration,
  formatElapsed,
  remainingSec,
  stepDisplay,
  stepFinished,
  stepTimings,
  timerDisplay,
  timerDoneText,
  timerExhausted,
  timerFinished,
  timerPause,
  timerPlan,
  timerReset,
  timerStart,
  timingsDerived,
  nextStep,
  stepPause,
  stepStart,
  STEP_TIMER_IDLE,
} from "../../src/domain/timer.ts";

const T0 = 1_700_000_000_000;

describe("timerPlan：形态由卡自己的时长决定", () => {
  it("知道时长 → 倒计时", () => {
    const p = timerPlan({ sec: 600 });
    expect(p.kind).toBe("countdown");
    expect(p.targetSec).toBe(600);
    expect(p.derived).toBe(false);
  });

  it("推算来的时长也算知道（但要标出来）", () => {
    const p = timerPlan({ sec: 900, derived: true });
    expect(p.kind).toBe("countdown");
    expect(p.targetSec).toBe(900);
    expect(p.derived).toBe(true);
  });

  it("不知道时长 → 正计时", () => {
    expect(timerPlan({ sec: null }).kind).toBe("countup");
    expect(timerPlan(null).kind).toBe("countup");
    expect(timerPlan(undefined).kind).toBe("countup");
  });

  it("超过一小时的当疗程，不倒计时（2 周倒计时没有意义）", () => {
    // 实测数据里有「持续 2 周」「4 周运动控制训练」这类
    expect(timerPlan({ sec: 1209600 }).kind).toBe("countup");
    expect(timerPlan({ sec: 3601 }).kind).toBe("countup");
  });

  it("一小时的仍然倒计时（边界含在里头）", () => {
    expect(timerPlan({ sec: 3600 }).kind).toBe("countdown");
  });

  it("0 与负数不算时长", () => {
    expect(timerPlan({ sec: 0 }).kind).toBe("countup");
    expect(timerPlan({ sec: -5 }).kind).toBe("countup");
  });
});

describe("formatDuration", () => {
  it("秒 / 分 / 时", () => {
    expect(formatDuration(3)).toBe("3 秒");
    expect(formatDuration(60)).toBe("1 分钟");
    expect(formatDuration(90)).toBe("1 分 30 秒");
    expect(formatDuration(600)).toBe("10 分钟");
  });

  it("满一小时说小时（不说「60 分钟」—— 那是换算，不是读数）", () => {
    expect(formatDuration(3600)).toBe("1 小时 0 分");
    expect(formatDuration(3660)).toBe("1 小时 1 分");
  });
});

describe("formatElapsed", () => {
  it("分:秒，两位数", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(5)).toBe("00:05");
    expect(formatElapsed(65)).toBe("01:05");
    expect(formatElapsed(599)).toBe("09:59");
  });

  it("过一小时才带小时", () => {
    expect(formatElapsed(3600)).toBe("1:00:00");
    expect(formatElapsed(3661)).toBe("1:01:01");
  });
});

describe("elapsedMs：用墙钟算，不累加", () => {
  it("跑着的时候按 now 减起点", () => {
    const s = timerStart(TIMER_IDLE, T0);
    expect(elapsedMs(s, T0 + 5000)).toBe(5000);
  });

  it("暂停后停住", () => {
    const s = timerPause(timerStart(TIMER_IDLE, T0), T0 + 5000);
    expect(elapsedMs(s, T0 + 60_000)).toBe(5000);
  });

  it("暂停的那 5 秒算在里面（暂停不等于回到原点）", () => {
    const paused = timerPause(timerStart(TIMER_IDLE, T0), T0 + 5000);
    const resumed = timerStart(paused, T0 + 60_000);
    expect(elapsedMs(resumed, T0 + 63_000)).toBe(8000);
  });

  it("没开始过是 0", () => {
    expect(elapsedMs(TIMER_IDLE, T0)).toBe(0);
  });

  it("往回走的时间不算（系统时钟被改时不会算出负的时长）", () => {
    const s = timerStart(TIMER_IDLE, T0);
    expect(elapsedMs(s, T0 - 10_000)).toBe(0);
  });
});

describe("timerPause / timerReset", () => {
  it("暂停把跑掉的时间存进累计", () => {
    const paused = timerPause(timerStart(TIMER_IDLE, T0), T0 + 3000);
    expect(paused.running).toBe(false);
    expect(paused.accumulatedMs).toBe(3000);
    expect(paused.startedAt).toBeNull();
  });

  it("重置归零", () => {
    const paused = timerPause(timerStart(TIMER_IDLE, T0), T0 + 3000);
    const reset = timerReset();
    expect(reset).toEqual(TIMER_IDLE);
    expect(reset.accumulatedMs).toBe(0);
    expect(reset.accumulatedMs).not.toBe(paused.accumulatedMs);
  });
});

describe("remainingSec", () => {
  it("倒计时：越走越少", () => {
    const s = timerStart(TIMER_IDLE, T0);
    expect(remainingSec(s, T0, 600)).toBe(600);
    expect(remainingSec(s, T0 + 60_000, 600)).toBe(540);
  });

  it("到点了就是 0（不报负数）", () => {
    const s = timerStart(TIMER_IDLE, T0);
    expect(remainingSec(s, T0 + 700_000, 600)).toBe(0);
  });

  it("正计时没有「剩」", () => {
    expect(remainingSec(timerStart(TIMER_IDLE, T0), T0 + 5000, null)).toBeNull();
  });
});

describe("timerFinished", () => {
  it("倒计时到了才算", () => {
    const s = timerStart(TIMER_IDLE, T0);
    expect(timerFinished(s, T0 + 599_000, 600)).toBe(false);
    expect(timerFinished(s, T0 + 600_000, 600)).toBe(true);
  });

  it("暂停着不算到点（没在跑）", () => {
    const paused = timerPause(timerStart(TIMER_IDLE, T0), T0 + 700_000);
    expect(timerFinished(paused, T0 + 700_000, 600)).toBe(false);
  });

  it("正计时没有目标，不会到点", () => {
    const s = timerStart(TIMER_IDLE, T0);
    expect(timerFinished(s, T0 + 999_999, null)).toBe(false);
  });
});

describe("timerDisplay", () => {
  it("倒计时显示剩下的", () => {
    const s = timerStart(TIMER_IDLE, T0);
    expect(timerDisplay(s, T0, 600)).toBe("10:00");
    expect(timerDisplay(s, T0 + 65_000, 600)).toBe("08:55");
  });

  it("正计时显示已经过的", () => {
    const s = timerStart(TIMER_IDLE, T0);
    expect(timerDisplay(s, T0 + 65_000, null)).toBe("01:05");
  });

  it("归零显示 00:00（结束由状态说，不混进显示里）", () => {
    const s = timerStart(TIMER_IDLE, T0);
    expect(timerDisplay(s, T0 + 700_000, 600)).toBe("00:00");
  });
});

describe("timerDoneText", () => {
  it("原文给的时长就说「时间到」", () => {
    expect(timerDoneText(false)).toBe("时间到");
  });

  it("推算的时长要说出来（别让它冒充原文的数）", () => {
    expect(timerDoneText(true)).toBe("按推算的时长到了");
  });
});

describe("timerExhausted：到点后停着也算走完了", () => {
  it("停着的倒计时，时间已经用完 → 算走完", () => {
    // 到点那一刻组件用 timerPause 停：running=false，但累计时间到了。
    // 只改 running 的话读数会跳回起始值（10:00），用户以为重置了。
    const paused = timerPause(timerStart(TIMER_IDLE, T0), T0 + 600_000);
    expect(paused.running).toBe(false);
    expect(timerExhausted(paused, T0 + 600_000, 600)).toBe(true);
    expect(timerDisplay(paused, T0 + 600_000, 600)).toBe("00:00");
  });

  it("没走完的不算", () => {
    const paused = timerPause(timerStart(TIMER_IDLE, T0), T0 + 300_000);
    expect(timerExhausted(paused, T0 + 300_000, 600)).toBe(false);
  });

  it("正计时没有目标，不会走完", () => {
    const s = timerStart(TIMER_IDLE, T0);
    expect(timerExhausted(s, T0 + 999_999, null)).toBe(false);
  });
});

describe("stepTimings：每一步自己的时长", () => {
  const steps = [
    { text: "压上去", duration: { sec: 30, basis: "quote" } },
    { text: "换边", duration: { sec: 30, basis: "quote" } },
    { text: "中间歇一下", duration: { sec: 30, basis: "quote" } },
  ];

  it("带时长的步骤排成一串", () => {
    const t = stepTimings(steps);
    expect(t).toHaveLength(3);
    expect(t[0]).toEqual({ index: 0, text: "压上去", sec: 30, derived: false });
  });

  it("没写时长的那一步不参与计时（它不是 0 秒，是不知道）", () => {
    const t = stepTimings([
      { text: "有数的", duration: { sec: 30, basis: "quote" } },
      { text: "没数的" },
      { text: "也有数的", duration: { sec: 10, basis: "quote" } },
    ]);
    expect(t).toHaveLength(2);
    // 下标是**卡里的**序号，不是排出来的序号 —— 界面上要指得出是哪一步
    expect(t[1].index).toBe(2);
  });

  it("0 秒与负数不算时长", () => {
    expect(stepTimings([{ text: "x", duration: { sec: 0, basis: "quote" } }])).toHaveLength(0);
    expect(stepTimings([{ text: "x", duration: { sec: -5, basis: "quote" } }])).toHaveLength(0);
  });

  it("推算来的那步要标出来", () => {
    const t = stepTimings([
      { text: "推的", duration: { sec: 30, basis: "derived" } },
      { text: "原的", duration: { sec: 30, basis: "quote" } },
    ]);
    expect(timingsDerived(t)).toBe(true);
    expect(timingsDerived([t[1]])).toBe(false);
  });
});

describe("stepDisplay / stepFinished：这一步的读数", () => {
  const timing = { index: 0, text: "压上去", sec: 30, derived: false };
  const running = { at: 0, since: T0, frozen: null, running: true };

  it("倒计时：数着这一步的秒数走", () => {
    expect(stepDisplay(running, T0, timing)).toBe("00:30");
    expect(stepDisplay(running, T0 + 10_000, timing)).toBe("00:20");
  });

  it("归零后停在 00:00", () => {
    expect(stepDisplay(running, T0 + 30_000, timing)).toBe("00:00");
  });

  it("到点了没有", () => {
    expect(stepFinished(running, T0 + 29_000, timing)).toBe(false);
    expect(stepFinished(running, T0 + 30_000, timing)).toBe(true);
  });

  it("暂停着不算到点", () => {
    const paused = { at: 0, since: null, frozen: 0, running: false };
    expect(stepFinished(paused, T0 + 60_000, timing)).toBe(false);
  });

  it("没开始时读数是那一步的完整秒数", () => {
    expect(stepDisplay(STEP_TIMER_IDLE, T0, timing)).toBe("00:30");
  });

  it("暂停后读数冻住（不再往下掉）", () => {
    // 只把 running 改 false 的话，读数会接着往下走 —— 暂停等于没暂停
    const paused = stepPause(running, T0 + 10_000, timing);
    expect(paused.frozen).toBe(20);
    expect(paused.running).toBe(false);
    expect(stepDisplay(paused, T0 + 60_000, timing)).toBe("00:20");
  });
});

describe("stepStart：开始或接着跑", () => {
  const timings = [
    { index: 0, text: "一", sec: 30, derived: false },
    { index: 1, text: "二", sec: 30, derived: false },
  ];

  it("从头开始", () => {
    const s = stepStart(STEP_TIMER_IDLE, T0, timings);
    expect(s.at).toBe(0);
    expect(s.running).toBe(true);
    expect(s.since).toBe(T0);
  });

  it("做完了再点开始 → 回到第一步", () => {
    const s = stepStart({ at: 2, since: null, frozen: null, running: false }, T0, timings);
    expect(s.at).toBe(0);
    expect(s.running).toBe(true);
  });
});

describe("nextStep：这一步做完就进下一步", () => {
  const timings = [
    { index: 0, text: "一", sec: 30, derived: false },
    { index: 1, text: "二", sec: 30, derived: false },
  ];

  it("进下一步，那一格的时间不累计，但接着跑", () => {
    // 一串动作是要连着做的 —— 每步归零就停一下再让人点一下，
    // 等于把节奏又交回给用户了。
    const next = nextStep({ at: 0, since: T0, frozen: null, running: true }, timings, T0 + 30_000);
    expect(next.at).toBe(1);
    expect(next.since).toBe(T0 + 30_000);
    expect(next.running).toBe(true);
  });

  it("最后一步做完 → at 落在步数上（做完了这个状态得有地方放）", () => {
    // 早先的写法是返回 null，于是 at 永远指着一已经做完的那一步，
    // 界面显示不出「整组做完了」。
    const next = nextStep({ at: 1, since: T0, frozen: null, running: true }, timings, T0 + 30_000);
    expect(next.at).toBe(2);
    expect(next.running).toBe(false);
    expect(next.since).toBeNull();
  });
});
