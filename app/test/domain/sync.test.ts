import { describe, expect, it } from "vitest";

import {
  emptyPayload,
  mergePayloads,
  payloadVersionIssue,
  pickNewer,
  stableStringify,
  SYNC_PAYLOAD_VERSION,
  type SyncCustom,
  type SyncEvent,
  type SyncPayload,
  type SyncSetting,
} from "../../src/domain/sync.ts";

function ev(ts: number, over: Partial<SyncEvent> = {}): SyncEvent {
  return {
    date: "2026-10-29",
    cardId: "card-a",
    variant: "normal",
    ts,
    updatedAt: ts,
    ...over,
  };
}

function habit(id: string, over: Partial<SyncCustom> = {}): SyncCustom {
  return {
    id,
    name: "冥想",
    text: "",
    slot: "morning",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: 1,
    ...over,
  };
}

function setting(key: string, value: unknown, updatedAt: number): SyncSetting {
  return { key, value, updatedAt };
}

function payload(over: Partial<SyncPayload> = {}): SyncPayload {
  return { ...emptyPayload("dev-a", 1000), ...over };
}

describe("mergePayloads", () => {
  it("两边的记录都留着（并集），不互相覆盖", () => {
    const local = payload({ events: [ev(1)] });
    const remote = payload({ deviceId: "dev-b", events: [ev(2)] });
    const { payload: merged, stats } = mergePayloads(local, remote);
    expect(merged.events.map((e) => e.ts)).toEqual([1, 2]);
    expect(stats.eventsAdded).toBe(1);
    expect(stats.eventsUpdated).toBe(0);
  });

  it("同一条记录：改过的（updatedAt 大的）赢", () => {
    const local = payload({ events: [ev(1, { periodDone: true, updatedAt: 100 })] });
    const remote = payload({ deviceId: "dev-b", events: [ev(1, { periodDone: false, updatedAt: 200 })] });
    const { payload: merged } = mergePayloads(local, remote);
    expect(merged.events).toHaveLength(1);
    expect(merged.events[0].periodDone).toBe(false);
  });

  it("撤销周期完成（periodDone 变 false）传得出去", () => {
    // A 设备盖了章，B 设备撤销了 —— B 的版本更新时该以 B 为准
    const stamped = payload({ events: [ev(1, { periodDone: true, updatedAt: 100 })] });
    const undone = payload({ deviceId: "dev-b", events: [ev(1, { periodDone: false, updatedAt: 300 })] });
    expect(mergePayloads(stamped, undone).payload.events[0].periodDone).toBe(false);
    expect(mergePayloads(undone, stamped).payload.events[0].periodDone).toBe(false);
  });

  it("幂等：同一对输入合并几次都一样", () => {
    const local = payload({ events: [ev(1, { updatedAt: 5 })], settings: [setting("mode", "busy", 7)] });
    const remote = payload({
      deviceId: "dev-b",
      events: [ev(1, { updatedAt: 9 }), ev(2, { updatedAt: 3 })],
      settings: [setting("mode", "normal", 2)],
    });
    const once = mergePayloads(local, remote).payload;
    const twice = mergePayloads(once, remote).payload;
    expect(stableStringify(twice)).toBe(stableStringify(once));
  });

  it("与顺序无关：谁在左边都一样（两台设备才不会分叉）", () => {
    const local = payload({
      events: [ev(1, { updatedAt: 100 })],
      settings: [setting("myRoutine", ["a"], 10)],
      custom: [habit("my-1", { updatedAt: 4 })],
    });
    const remote = payload({
      deviceId: "dev-b",
      events: [ev(1, { updatedAt: 100, variant: "busy" })],
      settings: [setting("myRoutine", ["b"], 20)],
      custom: [habit("my-1", { updatedAt: 4, name: "冥想五分钟" })],
    });
    // 比的是**数据**：deviceId 是"谁上传的"，本来就该跟着左边那台走
    const data = (p: SyncPayload) =>
      stableStringify({
        events: p.events,
        settings: p.settings,
        custom: p.custom,
        tombstones: p.tombstones,
      });
    expect(data(mergePayloads(local, remote).payload)).toBe(
      data(mergePayloads(remote, local).payload),
    );
  });

  it("删除标记比记录新 → 记录被删掉（另一台设备不会把它带回来）", () => {
    const local = payload({ events: [ev(1, { updatedAt: 100 })] });
    const remote = payload({
      deviceId: "dev-b",
      events: [],
      tombstones: [{ kind: "event", id: "1", updatedAt: 200 }],
    });
    const { payload: merged, stats } = mergePayloads(local, remote);
    expect(merged.events).toHaveLength(0);
    expect(stats.eventsRemoved).toBe(1);
  });

  it("删除标记比记录旧 → 记录留着（后写的记录不该被旧删除抹掉）", () => {
    const local = payload({
      events: [ev(1, { updatedAt: 300 })],
      tombstones: [{ kind: "event", id: "1", updatedAt: 100 }],
    });
    const remote = payload({ deviceId: "dev-b" });
    expect(mergePayloads(local, remote).payload.events).toHaveLength(1);
  });

  it("同一毫秒改的两份，按内容逐字比大小（不能看谁在左边）", () => {
    const a = ev(1, { updatedAt: 500, variant: "busy" });
    const b = ev(1, { updatedAt: 500, variant: "sick" });
    expect(stableStringify(pickNewer(a, b))).toBe(stableStringify(pickNewer(b, a)));
  });

  it("设置逐项后写为准：远端更新的那一项覆盖本地", () => {
    const local = payload({
      settings: [setting("myRoutine", ["a", "b"], 10), setting("mode", "normal", 10)],
    });
    const remote = payload({
      deviceId: "dev-b",
      settings: [setting("myRoutine", ["c"], 20)],
    });
    const { payload: merged, stats } = mergePayloads(local, remote);
    const routine = merged.settings.find((s) => s.key === "myRoutine");
    expect(routine?.value).toEqual(["c"]);
    // 远端没有的设置项保持本地那份
    expect(merged.settings.find((s) => s.key === "mode")?.value).toBe("normal");
    expect(stats.settingsChanged).toBe(1);
  });

  it("习惯：并集 + 删除标记", () => {
    const local = payload({ custom: [habit("my-1"), habit("my-2")] });
    const remote = payload({
      deviceId: "dev-b",
      custom: [habit("my-2", { name: "改名了", updatedAt: 50 })],
      tombstones: [{ kind: "custom", id: "my-1", updatedAt: 60 }],
    });
    const { payload: merged, stats } = mergePayloads(local, remote);
    expect(merged.custom.map((c) => c.id)).toEqual(["my-2"]);
    expect(merged.custom[0].name).toBe("改名了");
    expect(stats.customRemoved).toBe(1);
    expect(stats.customUpdated).toBe(1);
  });

  it("上传方是合并后那份载荷的设备", () => {
    const local = payload({ deviceId: "dev-a" });
    const remote = payload({ deviceId: "dev-b" });
    expect(mergePayloads(local, remote).payload.deviceId).toBe("dev-a");
    expect(mergePayloads(local, remote, "dev-c").payload.deviceId).toBe("dev-c");
  });
});

describe("payloadVersionIssue", () => {
  it("对方版本更高时如实说出来（不能硬合）", () => {
    const remote = payload({ v: SYNC_PAYLOAD_VERSION + 1 });
    expect(payloadVersionIssue(remote)).toContain("只认到");
  });

  it("版本一样或更旧 → 没有问题", () => {
    expect(payloadVersionIssue(payload())).toBeNull();
    expect(payloadVersionIssue(payload({ v: 1 }))).toBeNull();
  });

  it("没有版本号 → 如实说出来", () => {
    expect(payloadVersionIssue({ ...payload(), v: undefined as unknown as number })).toContain(
      "没有版本号",
    );
  });
});
