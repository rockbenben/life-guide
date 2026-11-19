import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import {
  addEvent,
  allEvents,
  allTombstones,
  clearEvents,
  getSetting,
  replaceUserData,
  setSetting,
  updateEvent,
  getEvent,
  putCustomHabit,
  putEvents,
  getCustomHabit,
  deleteCustomHabit,
  nowTick,
} from "../../src/data/db.ts";
import { buildBackup, parseBackup, restoreBackup } from "../../src/data/backup.ts";
import { mergePayloads, emptyPayload } from "../../src/domain/sync.ts";
import {
  applyPayload, buildLocalPayload,
  syncNow,
  type SyncConfig,
  type SyncTransport,
  type RemoteRecord,
} from "../../src/data/sync.ts";
import {
  deriveSecret,
  encryptPayload,
  decryptPayload,
} from "../../src/data/sync-crypto.ts";

const config: SyncConfig = {
  enabled: true,
  kind: "http",
  serverUrl: "https://sync.example",
  passphrase: "transaction-test-only",
  user: "",
  password: "",
  token: "fixture-write-token",
};

beforeEach(async () => {
  await replaceUserData({
    events: [],
    custom: [],
    tombstones: [],
    settings: {},
  });
  const d = await openDB("life-guide-v2");
  await d.clear("tombstones");
  d.close();
});

describe("同步提交", () => {
  it("等待网络时发生的撤销、改名和设置更改参与最终合并", async () => {
    const id = await addEvent({
      date: "2026-11-09",
      cardId: "a",
      ts: 1,
      variant: "normal",
      periodDone: true,
    });
    await putCustomHabit({
      id: "my-a",
      name: "原名",
      text: "",
      slot: "anytime",
      createdAt: new Date().toISOString(),
    });
    await setSetting("mode", "normal");
    const remote = await buildLocalPayload("other");
    const { key } = await deriveSecret(config.passphrase);
    let uploaded = emptyPayload("empty");
    const report = await syncNow(
      {
        fetch: async () => {
          await updateEvent({ ...(await getEvent(id))!, periodDone: false });
          await putCustomHabit({
            ...(await getCustomHabit("my-a"))!,
            name: "新名",
            updatedAt: nowTick(),
          });
          await setSetting("mode", "busy");
          return {
            rev: "1",
            updatedAt: 1,
            blob: await encryptPayload(key, remote),
          };
        },
        push: async (_id, blob) => {
          uploaded = await decryptPayload(key, blob);
          return { ok: true };
        },
      },
      config,
    );
    expect(report.ok).toBe(true);
    expect((await getEvent(id))?.periodDone).toBe(false);
    expect(uploaded.events[0].periodDone).toBe(false);
    expect(uploaded.custom[0].name).toBe("新名");
    expect(uploaded.settings.find((s) => s.key === "mode")?.value).toBe("busy");
  });

  it("等待网络期间删除的习惯不会复活", async () => {
    await putCustomHabit({
      id: "my-a",
      name: "原名",
      text: "",
      slot: "anytime",
      createdAt: new Date().toISOString(),
    });
    const remote = await buildLocalPayload("other");
    const { key } = await deriveSecret(config.passphrase);
    const report = await syncNow(
      {
        fetch: async () => {
          await deleteCustomHabit("my-a");
          return {
            rev: "1",
            updatedAt: 1,
            blob: await encryptPayload(key, remote),
          };
        },
        push: async () => ({ ok: true }),
      },
      config,
    );
    expect(report.ok).toBe(true);
    expect(await getCustomHabit("my-a")).toBeUndefined();
  });

  it("两台设备清空后往返两轮都保持删除", async () => {
    let record: RemoteRecord | null = null;
    const transport: SyncTransport = {
      fetch: async () => record,
      push: async (_id, blob) => {
        record = {
          blob,
          rev: String(Number(record?.rev ?? 0) + 1),
          updatedAt: 1,
        };
        return { ok: true };
      },
    };
    await addEvent({
      date: "2026-11-09",
      cardId: "a",
      ts: 1,
      variant: "normal",
    });
    const deviceB = await allEvents();
    await syncNow(transport, config);
    await clearEvents();
    await syncNow(transport, config);
    // 换到仍持有旧记录的设备，保留旧时间戳且没有本机删除标记。
    const d = await openDB("life-guide-v2");
    await d.clear("tombstones");
    d.close();
    await putEvents(deviceB);
    expect((await syncNow(transport, config)).ok).toBe(true);
    expect(await allEvents()).toEqual([]);
    expect((await syncNow(transport, config)).ok).toBe(true);
    expect(await allEvents()).toEqual([]);
  });

  it("重试两次仍冲突时返回失败且保留原成功时间", async () => {
    await setSetting("syncLastAt", 123);
    const { key } = await deriveSecret(config.passphrase);
    const conflict = {
      rev: "2",
      updatedAt: 1,
      blob: await encryptPayload(key, emptyPayload("other")),
    };
    let attempts = 0;
    const report = await syncNow(
      {
        fetch: async () => null,
        push: async () => {
          attempts++;
          return { ok: false, conflict };
        },
      },
      config,
    );
    expect(attempts).toBe(2);
    expect(report.ok).toBe(false);
    expect(report.message).toContain("冲突");
    expect(await getSetting("syncLastAt", 0)).toBe(123);
  });

  it("仅习惯变更也包含在刷新统计内", async () => {
    const { key } = await deriveSecret(config.passphrase);
    const remote = {
      ...emptyPayload("other"),
      custom: [
        {
          id: "my-new",
          name: "新习惯",
          text: "",
          slot: "anytime" as const,
          createdAt: new Date().toISOString(),
          updatedAt: nowTick(),
        },
      ],
    };
    const report = await syncNow(
      {
        fetch: async () => ({
          rev: "2",
          updatedAt: 1,
          blob: await encryptPayload(key, remote),
        }),
        push: async () => ({ ok: true }),
      },
      config,
    );
    expect(report.ok).toBe(true);
    expect(report.added).toBe(1);
    expect((await getCustomHabit("my-new"))?.name).toBe("新习惯");
  });
});

describe("事件身份和事务", () => {
  it("同一毫秒并发盖章保留全部事件，跨设备合并也不碰撞", async () => {
    await Promise.all(
      ["a", "b"].map((cardId) =>
        addEvent({
          date: "2026-11-09",
          cardId,
          ts: 1,
          variant: "normal",
        }),
      ),
    );
    const events = await allEvents();
    expect(events).toHaveLength(2);
    expect(new Set(events.map((e) => e.eventId)).size).toBe(2);
    const a = {
      ...emptyPayload("a"),
      events: [{ ...events[0], updatedAt: 1 }],
    };
    const b = {
      ...emptyPayload("b"),
      events: [{ ...events[1], updatedAt: 1 }],
    };
    expect(mergePayloads(a, b).payload.events).toHaveLength(2);
  });

  it("损坏的备份在删除任何记录前拒绝", async () => {
    await addEvent({
      date: "2026-11-09",
      cardId: "a",
      ts: 1,
      variant: "normal",
    });
    const before = await buildBackup();
    await expect(
      restoreBackup({ ...before, events: [null] } as never),
    ).rejects.toThrow();
    expect(await buildBackup()).toEqual({
      ...before,
      exportedAt: expect.any(String),
    });
  });

  it("恢复写到一半失败时，四张表和本机凭据都回滚", async () => {
    await addEvent({
      date: "2026-11-09",
      cardId: "a",
      ts: 1,
      variant: "normal",
    });
    await setSetting("syncToken", "local-only");
    const d = await openDB("life-guide-v2");
    const read = async () =>
      Promise.all(
        ["events", "custom", "settings", "tombstones"].map((s) => d.getAll(s)),
      );
    const before = await read();
    const e = (await allEvents())[0];
    await expect(
      replaceUserData({
        events: [e, e],
        custom: [],
        tombstones: [],
        settings: { mode: "busy" },
      }),
    ).rejects.toThrow();
    expect(await read()).toEqual(before);
    expect(await getSetting("syncToken", "")).toBe("local-only");
    d.close();
  });

  it("清空历史为每条事件留下同事务墓碑", async () => {
    const id = await addEvent({
      date: "2026-11-09",
      cardId: "a",
      ts: 1,
      variant: "normal",
    });
    await clearEvents();
    expect(await allEvents()).toEqual([]);
    expect(await allTombstones()).toMatchObject([{ id, kind: "event" }]);
  });

  it("清空历史已同步后，恢复的记录能通过下一轮加密同步", async () => {
    const event = { date: "2026-11-09", cardId: "a", ts: 123, variant: "normal" };
    const eventId = await addEvent(event);
    const backup = parseBackup(JSON.stringify(await buildBackup()));
    await clearEvents();
    const deleted = await buildLocalPayload("other-device");
    const { key } = await deriveSecret(config.passphrase);
    let remote = await encryptPayload(key, deleted);
    const transport: SyncTransport = {
      async fetch() { return { blob: remote, rev: "1", updatedAt: 1 }; },
      async push(_space, blob) { remote = blob; return { ok: true }; },
    };
    await restoreBackup(backup);
    expect(await syncNow(transport, config)).toMatchObject({ ok: true, pushed: true });
    expect(await getEvent(eventId)).toMatchObject({ ...event, eventId });
    expect((await decryptPayload(key, remote)).events).toMatchObject([{ ...event, eventId }]);
  });

  it("最后一个星期被取消后，备份与同步仍能接收这条提醒", async () => {
    const reminder = { id: "morning", cardId: null, label: "早晨", time: "07:00", on: true, mode: "weekly", days: [] };
    await setSetting("reminders", [reminder]);
    const backup = parseBackup(JSON.stringify(await buildBackup()));
    expect(backup.reminders).toMatchObject([reminder]);
    await expect(applyPayload(await buildLocalPayload("other-device"))).resolves.toMatchObject({
      settings: expect.arrayContaining([
        expect.objectContaining({ key: "reminders", value: [reminder] }),
      ]),
    });
  });

  it("默认提醒和用户主动清空的提醒分别往返", async () => {
    const d = await openDB("life-guide-v2");
    await d.delete("settings", "reminders");
    expect((await buildBackup()).reminders).toHaveLength(2);
    await restoreBackup(await buildBackup());
    expect(await getSetting("reminders", [])).toHaveLength(2);
    await setSetting("reminders", []);
    await restoreBackup(await buildBackup());
    expect(await getSetting("reminders", undefined)).toEqual([]);
    d.close();
  });

  it("本机提醒载荷坏掉时不会上传，修复后可重试", async () => {
    await setSetting("reminders", [null]);
    const push = vi.fn<SyncTransport["push"]>(async () => ({ ok: true }));
    const transport: SyncTransport = { async fetch() { return null; }, push };
    expect(await syncNow(transport, config)).toMatchObject({ ok: false, pushed: false });
    expect(push).not.toHaveBeenCalled();
    await setSetting("reminders", []);
    expect(await syncNow(transport, config)).toMatchObject({ ok: true, pushed: true });
    expect(push).toHaveBeenCalledTimes(1);
  });
});
