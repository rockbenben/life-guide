import "fake-indexeddb/auto";

import { describe, expect, it, vi } from "vitest";

import {
  addEvent,
  allEvents,
  getSetting,
  setSetting,
} from "../../src/data/db.ts";
import { migrateUserData } from "../../src/data/migrate.ts";
import { buildSpecs, cardReminderId, type Reminder } from "../../src/domain/reminders.ts";

/** 内容层合并过：old-a 与 old-b 并成 merged。 */
const CARDS = [{ id: "merged", formerIds: ["old-a", "old-b"] }];

describe("旧 id 迁移", () => {
  it("盖章记录认领回新卡（历史不断）", async () => {
    await addEvent({ date: "2026-10-29", cardId: "old-a", variant: "normal", eventId: "event-1001", ts: 1001 });
    await addEvent({ date: "2026-10-28", cardId: "old-b", variant: "normal", eventId: "event-1002", ts: 1002 });

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
    expect(moved).toEqual({ events: 0, routine: 0, cadence: 0, skipToday: 0, reminders: 0 });
    expect(await getSetting("myRoutine", [])).toEqual(["a", "b"]);
  });

  it("迁移不刷新记录的 updatedAt（机械迁移不是用户改了什么）", async () => {
    await addEvent({
      date: "2026-10-29",
      cardId: "old-a",
      variant: "normal",
      eventId: "event-2001", ts: 2001,
      updatedAt: 12345,
    });
    await migrateUserData(CARDS);
    const events = await allEvents();
    expect(events.find((e) => e.ts === 2001)?.updatedAt).toBe(12345);
  });

  it.each([false, true])("合并卡片后仍能排程，已有新卡提醒优先（%s）", async (hasCurrent) => {
    const reminder = (cardId: string, time: string): Reminder => ({
      id: cardReminderId(cardId), cardId, time, mode: "daily", label: cardId, on: true,
    });
    await setSetting("reminders", [
      reminder("old-a", "09:00"),
      reminder("old-b", "10:00"),
      ...(hasCurrent ? [reminder("merged", "11:00")] : []),
    ]);
    const card = {
      ...CARDS[0], status: "reviewed", source: { anchor: "合并卡" },
      remind: { text: "合并卡" }, steps: [],
    };
    expect((await migrateUserData([card])).reminders).toBe(2);
    const reminders = await getSetting<Reminder[]>("reminders", []);
    expect(reminders).toMatchObject([{
      id: "card:merged", cardId: "merged", time: hasCurrent ? "11:00" : "09:00",
    }]);
    expect(buildSpecs([card], [], reminders, new Date("2026-11-19T08:00:00"))).toMatchObject([
      { id: "card:merged", title: "合并卡" },
    ]);
    expect((await migrateUserData([card])).reminders).toBe(0);
  });

  it("在迁移读到旧提醒时保存新时刻，迁移不会覆盖这次编辑", async () => {
    const old: Reminder = {
      id: "card:old-a", cardId: "old-a", time: "08:00", mode: "daily", label: "旧卡", on: true,
    };
    await setSetting("reminders", [old]);
    const originalGet = IDBObjectStore.prototype.get;
    let edit: Promise<void> | undefined;
    const get = vi.spyOn(IDBObjectStore.prototype, "get").mockImplementation(function (
      this: IDBObjectStore, key,
    ) {
      const request = originalGet.call(this, key);
      if (this.name === "settings" && key === "reminders" && !edit) {
        request.addEventListener("success", () => {
          edit = setSetting("reminders", [{ ...old, id: "card:merged", cardId: "merged", time: "09:00" }]);
        }, { once: true });
      }
      return request;
    });
    try {
      expect((await migrateUserData(CARDS)).reminders).toBe(1);
      expect(edit).toBeDefined();
      await edit;
      expect(await getSetting("reminders", [])).toMatchObject([
        { id: "card:merged", cardId: "merged", time: "09:00" },
      ]);
    } finally {
      get.mockRestore();
    }
  });
});
