import { afterEach, expect, it, vi } from "vitest";
import { schedule } from "../../src/platform/notify.ts";
import type { ReminderSpec } from "../../src/domain/reminders.ts";

function spec(time: string): ReminderSpec {
  return {
    id: "card:a",
    title: time,
    body: time,
    at: "2026-11-10T01:00:00Z",
    after: [],
    rule: {
      id: "card:a",
      cardId: "a",
      label: "a",
      mode: "daily",
      time,
      on: true,
    },
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

it.each(["09:00", null])("旧排程延迟返回时，最终系统列表跟随最后配置 %s", async (finalTime) => {
  const started = deferred();
  const release = deferred();
  const pending = new Map<number, string>();
  const submitted: string[] = [];
  const plugin = {
    getPending: async () => ({
      notifications: [...pending.keys()].map((id) => ({ id })),
    }),
    cancel: async ({ notifications }: { notifications: { id: number }[] }) => {
      for (const n of notifications) pending.delete(n.id);
    },
    checkPermissions: async () => ({ display: "granted" }),
    schedule: async ({
      notifications,
    }: {
      notifications: { id: number; title: string }[];
    }) => {
      if (notifications[0].title === "07:00") {
        started.resolve();
        await release.promise;
      }
      for (const n of notifications) pending.set(n.id, n.title);
      submitted.push(notifications[0].title);
    },
  };
  vi.stubGlobal("window", {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { LocalNotifications: plugin },
    },
  });
  const old = schedule([spec("07:00")]);
  await started.promise;
  const newer = schedule([spec("09:00")]);
  const final = schedule(finalTime ? [spec(finalTime)] : []);
  release.resolve();
  await Promise.all([old, newer, final]);
  expect([...pending.values()]).toEqual(finalTime ? [finalTime] : []);
  expect(submitted).toEqual(finalTime ? ["07:00", finalTime] : ["07:00"]);

  await schedule([spec("10:00")]);
  expect([...pending.values()]).toEqual(["10:00"]);
});

it("上一轮插件调用失败后，后续排程仍能执行", async () => {
  const plugin = {
    getPending: vi
      .fn()
      .mockRejectedValueOnce(new Error("系统暂时不可用"))
      .mockResolvedValue({ notifications: [] }),
    cancel: vi.fn(),
    checkPermissions: async () => ({ display: "granted" }),
    schedule: vi.fn().mockResolvedValue(undefined),
  };
  vi.stubGlobal("window", {
    Capacitor: {
      isNativePlatform: () => true,
      Plugins: { LocalNotifications: plugin },
    },
  });
  await schedule([spec("07:00")]);
  await schedule([spec("09:00")]);
  expect(plugin.schedule).toHaveBeenCalledTimes(1);
  expect(plugin.schedule.mock.calls[0][0].notifications[0].title).toBe("09:00");
});

it.each(["reject", "incomplete"])("系统未提交完整新排程时保留原提醒，重试后才取消（%s）", async (failure) => {
  type Pending = { id: number; title: string; extra?: { lifeGuideReminder: string } };
  const pending = new Map<number, Pending>([
    [100, { id: 100, title: "07:00" }],
    [200, { id: 200, title: "原晚间提醒" }],
    [999, { id: 999, title: "计时器" }],
  ]);
  const cancelled: Pending[] = [];
  let fail = true;
  const plugin = {
    getPending: async () => ({ notifications: [...pending.values(), ...cancelled] }),
    getAll: async ({ state }: { state: string }) => {
      expect(state).toBe("SCHEDULED");
      return { notifications: [...pending.values()] };
    },
    cancel: async ({ notifications }: { notifications: { id: number }[] }) => {
      for (const { id } of notifications) pending.delete(id);
    },
    checkPermissions: async () => ({ display: "granted" }),
    schedule: vi.fn(async ({ notifications }: { notifications: Pending[] }) => {
      for (const n of fail ? notifications.slice(0, 1) : notifications) pending.set(n.id, n);
      if (fail && failure === "reject") throw new Error("系统暂时不可用");
    }),
  };
  vi.stubGlobal("window", {
    Capacitor: { isNativePlatform: () => true, Plugins: { LocalNotifications: plugin } },
  });
  const morning = spec("09:00");
  const evening = spec("21:00");
  evening.id = evening.rule.id = "card:b";
  expect(await schedule([morning, evening])).toBe(false);
  expect([...pending.keys()]).toEqual([100, 200, 999]);
  fail = false;
  expect(await schedule([morning, evening])).toBe(true);
  expect([...pending.values()].map((n) => n.title)).toEqual(["计时器", "09:00", "21:00"]);
  expect(await schedule([evening])).toBe(true);
  expect(plugin.schedule).toHaveBeenCalledTimes(2);
  expect([...pending.values()].map((n) => n.title)).toEqual(["计时器", "21:00"]);

  const delivered = [...pending.values()].find((n) => n.title === "21:00")!;
  await schedule([]);
  cancelled.push(delivered);
  expect(await schedule([evening])).toBe(true);
  expect([...pending.values()].map((n) => n.title)).toEqual(["计时器", "21:00"]);
  expect(pending.has(delivered.id)).toBe(false);
});
