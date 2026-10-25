/**
 * 手机端排程的形状（platform/notify.ts 的 nativeNotifications）。
 *
 * 这一层单元测试验不了「系统真的响了」—— 那要真机。但**排出来的东西对不对**
 * 可以在这里钉住：Android 模拟器上实测出过两个问题，都是这里能看出来的：
 *
 *   1. 通知 id 撞了 —— 系统按 id 存通知，后一条把前一条顶掉
 *      （早晨一周五条占了 id 1–5，晚间那条每日提醒占了 id 2，早晨周二那条就没了）；
 *   2. 不给 second，系统把「排程那一刻的秒数」带进去 —— 07:00 的提醒变成 07:00:46。
 */
import { describe, expect, it } from "vitest";

import { nativeNotifications, schedule } from "../../src/platform/notify.ts";
import type { Reminder, ReminderSpec } from "../../src/domain/reminders.ts";

function spec(rule: Partial<Reminder>, index = 0): ReminderSpec {
  const r: Reminder = {
    id: "r",
    cardId: null,
    label: "早晨",
    mode: "daily",
    time: "07:00",
    slot: "morning",
    on: true,
    ...rule,
  };
  return {
    id: r.id,
    at: new Date("2026-10-22T07:00:00").toISOString(),
    title: "生活指南 · 早晨",
    body: "该做 3 件",
    rule: r,
    after: [],
  };
}

describe("手机端的排程形状", () => {
  it("每天：一条，时刻到秒，重复", () => {
    const list = nativeNotifications(spec({ mode: "daily", time: "07:00" }), 0);
    expect(list).toHaveLength(1);
    expect(list[0].schedule).toEqual({
      on: { hour: 7, minute: 0, second: 0 },
      repeats: true,
    });
  });

  it("每周：一天一条，系统的星期从周日开始数", () => {
    const list = nativeNotifications(spec({ mode: "weekly", days: [0, 2, 5], time: "21:00" }), 0);
    expect(list).toHaveLength(3);
    expect(list.map((n) => n.schedule.on?.weekday)).toEqual([1, 3, 6]);
    expect(list.every((n) => n.schedule.repeats === true)).toBe(true);
  });

  it("每隔 N 天：系统没有这种规则，排成一条条的一次性通知", () => {
    const list = nativeNotifications(
      spec({ mode: "interval", everyDays: 2, date: "2026-10-22", time: "08:00" }),
      0,
    );
    expect(list.length).toBeGreaterThan(1);
    expect(list.every((n) => n.schedule.at instanceof Date)).toBe(true);
    expect(list.every((n) => n.schedule.repeats !== true)).toBe(true);
  });

  it("就一次：一条，带准确时刻", () => {
    const list = nativeNotifications(
      spec({ mode: "once", date: "2026-12-01", time: "09:30" }),
      0,
    );
    expect(list).toHaveLength(1);
    const at = list[0].schedule.at as Date;
    expect(at.getFullYear()).toBe(2026);
    expect(at.getMonth()).toBe(11);
    expect(at.getDate()).toBe(1);
    expect(at.getHours()).toBe(9);
    expect(at.getMinutes()).toBe(30);
    expect(at.getSeconds()).toBe(0);
  });

  it("通知 id 互不重叠（撞了就是后一条把前一条顶掉）", () => {
    // 早晨：一周五条；晚间：每天一条；卡上那条：每天一条
    const all = [
      ...nativeNotifications(spec({ mode: "weekly", days: [1, 2, 3, 4, 5] }), 0),
      ...nativeNotifications(spec({ id: "e", label: "晚间", time: "21:00" }), 1),
      ...nativeNotifications(spec({ id: "c", cardId: "a", label: "光照建议" }), 2),
    ];
    const ids = all.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all).toHaveLength(7);
  });
});

/**
 * 手机端：没允许通知就不排程。
 *
 * 插件的 `schedule()` 自己会弹系统的通知授权页（LocalNotificationsPlugin.kt：
 * `if (shouldRequestNotificationPermission()) requestPermissionForAlias(...)`）——
 * App 一启动就排程的话，用户还没看见界面就被那张系统对话框盖住。
 * 授权页只能由用户自己点的入口去跳，所以没允许就不排。
 */
describe("手机端排程：通知权限", () => {
  function mockNative(display: string) {
    const calls = { schedule: 0, exact: undefined as boolean | undefined };
    (globalThis as unknown as { window: unknown }).window = {
      Capacitor: {
        isNativePlatform: () => true,
        Plugins: {
          LocalNotifications: {
            checkPermissions: async () => ({ display }),
            requestPermissions: async () => ({ display: "granted" }),
            getPending: async () => ({ notifications: [] }),
            cancel: async () => {},
            schedule: async (opts: { notifications: { isExactNotification?: boolean }[] }) => {
              calls.schedule++;
              calls.exact = opts.notifications[0]?.isExactNotification;
            },
            checkExactNotificationSetting: async () => ({ exact_alarm: "denied" }),
          },
        },
      },
    };
    return calls;
  }

  it("没允许通知：一次都不排（免得插件替我们弹那张系统授权页）", async () => {
    const calls = mockNative("prompt");
    await schedule([spec({})]);
    expect(calls.schedule).toBe(0);
  });

  it("允许了才排，而且精确与否仍由用户有没有允许精确闹钟决定", async () => {
    const calls = mockNative("granted");
    await schedule([spec({})]);
    expect(calls.schedule).toBe(1);
    // 没给精确闹钟授权 → 按不精确排（提醒照样响，只是可能晚几分钟）
    expect(calls.exact).toBe(false);
  });
});
