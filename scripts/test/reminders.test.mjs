import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { ipc, displayed } = vi.hoisted(() => ({
  ipc: new Map(),
  displayed: [],
}));
vi.mock("electron", () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: {
    on: (name, callback) => ipc.set(name, callback),
    off: (name) => ipc.delete(name),
  },
  Notification: class {
    static isSupported() {
      return true;
    }
    constructor(options) {
      this.options = options;
    }
    on() {}
    show() {
      displayed.push(this.options.title);
    }
  },
}));

import { installReminderBridge } from "../../desktop/lib/reminders.mjs";

let bridge;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-09T07:59:59Z"));
  displayed.length = 0;
  ipc.clear();
});
afterEach(() => {
  bridge?.dispose();
  vi.useRealTimers();
});

it("同刻的时段提醒和卡提醒各发一次，备用队列继续排到次日", async () => {
  const onDue = vi.fn();
  bridge = installReminderBridge({ onDue, isTrusted: () => true });
  ipc.get("life-guide:set-reminders")(
    {},
    ["时段", "卡片"].map((id) => ({
      id,
      title: id,
      body: id,
      at: "2026-11-09T08:00:00Z",
      after: ["2026-11-10T08:00:00Z"],
    })),
  );
  await vi.advanceTimersByTimeAsync(1000);
  expect(displayed).toEqual(["时段", "卡片"]);
  expect(onDue.mock.calls.map(([id]) => id)).toEqual(["时段", "卡片"]);
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(displayed).toEqual(["时段", "卡片", "时段", "卡片"]);
  expect(vi.getTimerCount()).toBe(0);
});

it("定时器晚醒时处理全部到期提醒，跳过备用队列里已错过的日期", async () => {
  bridge = installReminderBridge({ onDue: vi.fn(), isTrusted: () => true });
  ipc.get("life-guide:set-reminders")({}, [
    {
      id: "a",
      title: "a",
      at: "2026-11-09T08:00:00Z",
      after: ["2026-11-10T08:00:00Z", "2026-11-12T08:00:00Z"],
    },
    { id: "b", title: "b", at: "2026-11-09T08:01:00Z" },
  ]);
  vi.setSystemTime(new Date("2026-11-11T08:00:00Z"));
  await vi.advanceTimersByTimeAsync(1000);
  expect(displayed).toEqual(["a", "b"]);
  expect(vi.getTimerCount()).toBe(1);
});
