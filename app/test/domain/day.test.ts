/**
 * 日期口径的单测。
 *
 * localDate 是**日历上那一天**：提醒的默认日期用它。
 * 不能用 toISOString()（那是 UTC）—— 东八区的凌晨 8 小时里会算成前一天。
 */
import { describe, expect, it } from "vitest";

import { dayOf, localDate, nextDay, slotOf } from "../../src/domain/day.ts";

describe("localDate", () => {
  it("给的是本地日历日期", () => {
    const d = new Date(2026, 9, 23, 0, 30, 0); // 2026-10-23 00:30 本地
    expect(localDate(d.getTime())).toBe("2026-10-23");
  });

  it("跨月也不串", () => {
    const d = new Date(2026, 10, 1, 0, 30, 0); // 11-01 00:30 本地
    expect(localDate(d.getTime())).toBe("2026-11-01");
  });

  it("凌晨 0 点还算当天（不是前一天）", () => {
    const d = new Date(2026, 9, 23, 0, 0, 0);
    expect(localDate(d.getTime())).toBe("2026-10-23");
  });
});

describe("04:00 日界线", () => {
  it("00:43 属于前一天", () => {
    expect(dayOf(new Date(2026, 9, 25, 0, 43, 0).getTime())).toBe("2026-10-24");
  });

  it("04:00 起算新一天", () => {
    expect(dayOf(new Date(2026, 9, 25, 4, 0, 0).getTime())).toBe("2026-10-25");
  });

  it("00:43 与 03:59 仍算晚间，04:00 起算早晨", () => {
    expect(slotOf(new Date(2026, 9, 25, 0, 43, 0).getTime())).toBe("evening");
    expect(slotOf(new Date(2026, 9, 25, 3, 59, 0).getTime())).toBe("evening");
    expect(slotOf(new Date(2026, 9, 25, 4, 0, 0).getTime())).toBe("morning");
  });

  it("逻辑上的明天：00:43 的下一天是 10-25，不是日历的 10-26", () => {
    expect(nextDay(dayOf(new Date(2026, 9, 25, 0, 43, 0).getTime()))).toBe("2026-10-25");
    expect(nextDay("2026-10-25")).toBe("2026-10-26");
  });
});
