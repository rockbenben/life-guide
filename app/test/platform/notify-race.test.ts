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
