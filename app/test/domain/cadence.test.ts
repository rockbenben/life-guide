import { describe, expect, it } from "vitest";

import {
  defaultCadenceOf,
  doneInPeriod,
  periodKeyOf,
} from "../../src/domain/cadence.ts";

describe("多久做一次", () => {
  it("只认提醒语里明确写出的每周/每月", () => {
    expect(defaultCadenceOf({ remind: { text: "每周累计 60 分钟" } })).toBe("weekly");
    expect(defaultCadenceOf({ remind: { text: "每月一次清洗" } })).toBe("monthly");
    expect(defaultCadenceOf({ remind: { text: "每天 30 分钟" } })).toBe("daily");
    expect(defaultCadenceOf({ remind: { text: "每周最少 3 天" } })).toBe("weekly");
  });

  it("周周期从周一开始，月和天各用自己的键", () => {
    // 2026-10-24 是周六，所在周从 10-19（周一）开始
    expect(periodKeyOf("2026-10-24", "weekly")).toBe("2026-10-19");
    expect(periodKeyOf("2026-10-25", "weekly")).toBe("2026-10-19");
    expect(periodKeyOf("2026-10-26", "weekly")).toBe("2026-10-26");
    expect(periodKeyOf("2026-10-24", "monthly")).toBe("2026-10");
    expect(periodKeyOf("2026-10-24", "daily")).toBe("2026-10-24");
  });

  it("周期完成按周期判断：上周的周卡不算本周做过", () => {
    const events = [
      { date: "2026-10-18", cardId: "walk" },
      { date: "2026-09-30", cardId: "clean" },
    ];
    expect(doneInPeriod(events, "walk", "2026-10-24", "weekly")).toBe(false);
    expect(doneInPeriod(events, "clean", "2026-10-24", "monthly")).toBe(false);
    expect(
      doneInPeriod([{ date: "2026-10-20", cardId: "walk" }], "walk", "2026-10-24", "weekly"),
    ).toBe(true);
    expect(
      doneInPeriod(
        [{ date: "2026-10-01", cardId: "clean" }],
        "clean",
        "2026-10-24",
        "monthly",
      ),
    ).toBe(true);
  });

  it("周期标记：true 算完成，false 算撤销；旧事件仍兼容", () => {
    expect(
      doneInPeriod(
        [{ date: "2026-10-20", cardId: "walk", periodDone: true }],
        "walk",
        "2026-10-24",
        "weekly",
      ),
    ).toBe(true);
    expect(
      doneInPeriod(
        [{ date: "2026-10-20", cardId: "walk", periodDone: false }],
        "walk",
        "2026-10-24",
        "weekly",
      ),
    ).toBe(false);
    expect(
      doneInPeriod(
        [{ date: "2026-10-20", cardId: "walk" }],
        "walk",
        "2026-10-24",
        "weekly",
      ),
    ).toBe(true);
  });

  it("周期标记带频率：周的完成不能冒充月，改频率后旧标记不生效", () => {
    const weekly = {
      date: "2026-10-20",
      cardId: "walk",
      periodDone: true as const,
      periodCadence: "weekly" as const,
    };
    expect(doneInPeriod([weekly], "walk", "2026-10-24", "weekly")).toBe(true);
    expect(doneInPeriod([weekly], "walk", "2026-10-24", "monthly")).toBe(false);
    expect(
      doneInPeriod(
        [{ ...weekly, periodDone: false }],
        "walk",
        "2026-10-24",
        "weekly",
      ),
    ).toBe(false);
  });
});
