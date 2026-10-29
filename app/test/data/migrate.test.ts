import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
  addEvent,
  allEvents,
  getSetting,
  setSetting,
} from "../../src/data/db.ts";
import { migrateUserData } from "../../src/data/migrate.ts";

/** 内容层合并过：old-a 与 old-b 并成 merged。 */
const CARDS = [{ id: "merged", formerIds: ["old-a", "old-b"] }];

describe("旧 id 迁移", () => {
  it("盖章记录认领回新卡（历史不断）", async () => {
    await addEvent({ date: "2026-10-29", cardId: "old-a", variant: "normal", ts: 1001 });
    await addEvent({ date: "2026-10-28", cardId: "old-b", variant: "normal", ts: 1002 });

    const moved = await migrateUserData(CARDS);
    expect(moved.events).toBe(2);
    const events = await allEvents();
    expect(events.every((e) => e.cardId === "merged")).toBe(true);
    // ts 不动（那是记录的身份）
    expect(events.map((e) => e.ts).sort()).toEqual([1001, 1002]);
  });

  it("日常清单换 id 并去掉重复（合并后两张卡变成一张）", async () => {
    await setSetting("myRoutine", ["old-a", "x", "old-b"]);
    const moved = await migrateUserData(CARDS);
    expect(moved.routine).toBe(2);
    expect(await getSetting("myRoutine", [])).toEqual(["merged", "x"]);
  });

  it("频率覆盖与「今天不做」的键也跟着换", async () => {
    await setSetting("cadence", { "old-a": "weekly" });
    await setSetting("skipToday", { "old-b": "2026-10-29" });
    const moved = await migrateUserData(CARDS);
    expect(moved.cadence).toBe(1);
    expect(moved.skipToday).toBe(1);
    expect(await getSetting("cadence", {})).toEqual({ merged: "weekly" });
    expect(await getSetting("skipToday", {})).toEqual({ merged: "2026-10-29" });
  });

  it("没有旧 id 时不动任何东西", async () => {
    await setSetting("myRoutine", ["a", "b"]);
    const moved = await migrateUserData([{ id: "c" }]);
    expect(moved).toEqual({ events: 0, routine: 0, cadence: 0, skipToday: 0 });
    expect(await getSetting("myRoutine", [])).toEqual(["a", "b"]);
  });

  it("迁移不刷新记录的 updatedAt（机械迁移不是用户改了什么）", async () => {
    await addEvent({
      date: "2026-10-29",
      cardId: "old-a",
      variant: "normal",
      ts: 2001,
      updatedAt: 12345,
    });
    await migrateUserData(CARDS);
    const events = await allEvents();
    expect(events.find((e) => e.ts === 2001)?.updatedAt).toBe(12345);
  });
});
