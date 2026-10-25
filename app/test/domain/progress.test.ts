/**
 * 原型 verify.js 的状态逻辑用例迁到这里（AGENTS.md/ARCHITECTURE.md §6）。
 *
 * 这里是 P0 唯一迁过来的那 2 项：勾选可切换、再点一次取消。
 * 剩下的 20 项是数据形状与图片校验，落在 content/test/rules/。
 */
import { describe, expect, it } from "vitest";

import { dayOf, slotOf } from "../../src/domain/day.ts";
import {
  daysDone,
  recentActivity,
  slotsWithRecords,
  totalActiveDays,
} from "../../src/domain/progress.ts";

describe("勾选状态机", () => {
  it("勾选可切换", () => {
    const done = new Set<string>();
    const id = "heel-raise";
    done.has(id) ? done.delete(id) : done.add(id);
    expect(done.has(id)).toBe(true);
  });

  it("再点一次取消", () => {
    const done = new Set<string>();
    const id = "heel-raise";
    done.has(id) ? done.delete(id) : done.add(id);
    done.has(id) ? done.delete(id) : done.add(id);
    expect(done.has(id)).toBe(false);
  });
});

describe("日界线", () => {
  /**
   * 时间戳一律用**本地时间**构造（月份从 0 起，9 = 十月）。
   *
   * 为什么不能写死 "+08:00"：日界线按**使用者所在时区**的凌晨 4 点算
   * （app/src/domain/day.ts 用的是 getHours），所以测它就得给本地时间。
   * 写死 +08:00 的话，在 UTC 的 CI 上 05:00+08:00 会变成前一天 21:00 ——
   * 本地过、CI 挂（2026-10-22 实测：CI 上正是这条红了）。
   */
  const local = (h: number, m = 0) => new Date(2026, 9, 19, h, m, 0).getTime();

  it("凌晨 3 点算前一天", () => {
    expect(dayOf(local(3))).toBe("2026-10-18");
  });

  it("凌晨 5 点算当天", () => {
    expect(dayOf(local(5))).toBe("2026-10-19");
  });

  it("晚上 11 点还是当天", () => {
    expect(dayOf(local(23))).toBe("2026-10-19");
  });
});

describe("累计天数", () => {
  it("同一天多次只算一天", () => {
    const events = [
      { date: "2026-10-19", cardId: "a", variant: "normal", ts: 1 },
      { date: "2026-10-19", cardId: "a", variant: "normal", ts: 2 },
    ];
    expect(daysDone(events, "a")).toBe(1);
  });

  it("不同天分开算", () => {
    const events = [
      { date: "2026-10-18", cardId: "a", variant: "normal", ts: 1 },
      { date: "2026-10-19", cardId: "a", variant: "normal", ts: 2 },
    ];
    expect(daysDone(events, "a")).toBe(2);
    expect(totalActiveDays(events)).toBe(2);
  });

  it("时段从事件时间戳推", () => {
    // 本地时间构造（原因见上面「日界线」那段）
    const events = [
      { date: "2026-10-19", cardId: "a", variant: "normal", ts: new Date(2026, 9, 19, 8, 0, 0).getTime() },
      { date: "2026-10-19", cardId: "b", variant: "normal", ts: new Date(2026, 9, 19, 21, 0, 0).getTime() },
    ];
    const slots = slotsWithRecords(events, slotOf);
    expect(slots.has("morning")).toBe(true);
    expect(slots.has("evening")).toBe(true);
  });

  it("凌晨 0:43 的盖章仍算前一晚的晚间", () => {
    const events = [
      { date: "2026-10-24", cardId: "a", variant: "normal", ts: new Date(2026, 9, 25, 0, 43, 0).getTime() },
    ];
    const slots = slotsWithRecords(events, slotOf);
    expect(slots.has("evening")).toBe(true);
    expect(slots.has("morning")).toBe(false);
  });

  it("撤销过的周期完成不再算进可见累计与印迹", () => {
    const events = [
      { date: "2026-10-24", cardId: "walk", variant: "normal", ts: 1, periodDone: false },
      { date: "2026-10-23", cardId: "walk", variant: "normal", ts: 2 },
    ];
    expect(daysDone(events, "walk")).toBe(1);
    expect(totalActiveDays(events)).toBe(1);
    const slots = slotsWithRecords(events, slotOf);
    expect(slots.size).toBe(1);
    const dots = recentActivity(events, 2, new Date(2026, 9, 24, 12).getTime(), dayOf);
    expect(dots).toEqual([true, false]); // 10-23 有记录；10-24 被撤销
  });
});
