import "fake-indexeddb/auto";

import { describe, expect, it } from "vitest";

import {
  allCustomHabits,
  allEvents,
  allTombstones,
  deleteCustomHabit,
  getEvent,
  getSetting,
  getSettingMeta,
  putCustomHabit,
  removeEvent,
  setSetting,
} from "../../src/data/db.ts";
import {
  applyPayload,
  buildLocalPayload,
  networkErrorText,
  readSyncConfig,
  saveSyncConfig,
  syncConfigProblem,
  syncNow,
  type RemoteRecord,
  type SyncConfig,
  type SyncTransport,
} from "../../src/data/sync.ts";
import {
  decryptPayload,
  deriveSecret,
  encryptPayload,
} from "../../src/data/sync-crypto.ts";
import {
  mergePayloads,
  SYNC_PAYLOAD_VERSION,
  type SyncPayload,
} from "../../src/domain/sync.ts";

/** 一个「远端」：内存里的一个格子。 */
function memoryTransport(store: Map<string, RemoteRecord> = new Map()): SyncTransport {
  return {
    async fetch(spaceId) {
      return store.get(spaceId) ?? null;
    },
    async push(spaceId, blob, baseRev) {
      const cur = store.get(spaceId);
      if (cur && baseRev !== null && baseRev !== cur.rev) {
        return { ok: false, conflict: cur };
      }
      const rev = String(Number(cur?.rev ?? 0) + 1);
      store.set(spaceId, { blob, rev, updatedAt: Date.now() });
      return { ok: true };
    },
  };
}

const PASS = "一句不会忘的话-2026";

/** 造一份载荷（测试用）。 */
function payloadOf(
  deviceId: string,
  over: Partial<SyncPayload> = {},
): SyncPayload {
  return {
    v: SYNC_PAYLOAD_VERSION,
    deviceId,
    updatedAt: 1,
    events: [],
    tombstones: [],
    settings: [],
    custom: [],
    ...over,
  };
}

/** 同步配置：把新加的落点字段补齐，测试里只写关心的那几项。 */
function cfg(over: Partial<SyncConfig> = {}): SyncConfig {
  return {
    enabled: false,
    // 默认用「自建中转服务」这个落点：它只缺地址与口令，
    // 另两个落点还要账号 / Token —— 那些各有各的测试。
    kind: "http",
    serverUrl: "",
    user: "",
    password: "",
    token: "",
    path: "",
    passphrase: PASS,
    ...over,
  };
}

describe("加密", () => {
  it("同一个口令在哪儿都算出同一个空间 id（换设备只填口令就够）", async () => {
    const a = await deriveSecret(PASS);
    const b = await deriveSecret(PASS);
    expect(a.spaceId).toBe(b.spaceId);
    const c = await deriveSecret("另一句口令-2026");
    expect(c.spaceId).not.toBe(a.spaceId);
  });

  it("加密 → 解密能还原", async () => {
    const { key } = await deriveSecret(PASS);
    const payload: SyncPayload = {
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-a",
      updatedAt: 1,
      events: [],
      tombstones: [],
      settings: [{ key: "mode", value: "busy", updatedAt: 2 }],
      custom: [],
    };
    const blob = await encryptPayload(key, payload);
    const back = await decryptPayload(key, blob);
    expect(back).toEqual(payload);
  });

  it("口令不对时说人话，不甩技术报错", async () => {
    const a = await deriveSecret(PASS);
    const b = await deriveSecret("另一句口令-2026");
    const blob = await encryptPayload(a.key, {
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-a",
      updatedAt: 1,
      events: [],
      tombstones: [],
      settings: [],
      custom: [],
    });
    await expect(decryptPayload(b.key, blob)).rejects.toThrow("口令不对");
  });
});

describe("同步设置", () => {
  it("没开 / 没地址 / 没口令 / 口令太短，各有各的说法", async () => {
    expect(syncConfigProblem(cfg({ enabled: false }))).toBe("同步没开");
    expect(syncConfigProblem(cfg({ enabled: true, serverUrl: "" }))).toContain("还没填");
    expect(
      syncConfigProblem(cfg({ enabled: true, serverUrl: "https://x.dev", passphrase: "" })),
    ).toContain("口令");
    expect(
      syncConfigProblem(cfg({ enabled: true, serverUrl: "https://x.dev", passphrase: "短" })),
    ).toContain("至少");
    expect(syncConfigProblem(cfg({ enabled: true, serverUrl: "https://x.dev" }))).toBeNull();
  });

  it("GitHub 落点没填 Token → 说清楚缺什么", () => {
    expect(
      syncConfigProblem(cfg({ enabled: true, kind: "github", serverUrl: "o/r", token: "" })),
    ).toContain("Token");
  });

  it("网盘落点没填账号 → 说清楚缺什么", () => {
    expect(
      syncConfigProblem(
        cfg({ enabled: true, kind: "webdav", serverUrl: "https://dav.example/", user: "" }),
      ),
    ).toContain("网盘账号");
  });

  it("默认是关着的（不上传是默认状态）", async () => {
    const conf = await readSyncConfig();
    expect(conf.enabled).toBe(false);
  });
});

describe("网络报错的说法", () => {
  it("浏览器的英文报错换成中文，不甩给用户", () => {
    expect(networkErrorText(new Error("Failed to fetch"))).toContain("网络通不通");
    expect(networkErrorText(new TypeError("NetworkError when attempting to fetch"))).toContain(
      "地址",
    );
    expect(networkErrorText(new Error("ECONNREFUSED"))).toContain("网络通不通");
  });

  it("认不出来的报错原样留着（不瞎猜）", () => {
    expect(networkErrorText(new Error("HTTP 500"))).toBe("HTTP 500");
  });
});

describe("本地 ↔ 载荷", () => {
  it("只带走白名单里的设置项（同步口令、服务器地址不能跟着走）", async () => {
    await setSetting("myRoutine", ["a"]);
    await setSetting("syncPassphrase", PASS);
    await setSetting("syncServer", "https://x.dev");
    const payload = await buildLocalPayload("dev-a");
    expect(payload.settings.map((s) => s.key)).toEqual(["myRoutine"]);
  });

  it("旧日志没有 updatedAt 时，用它自己的创建时刻顶上", async () => {
    await setSetting("myRoutine", ["a"]);
    const payload = await buildLocalPayload("dev-a");
    expect(payload.events.every((e) => typeof e.updatedAt === "number")).toBe(true);
  });
});

describe("一轮同步", () => {
  it("远端有本地没有的记录 → 收下来，并写回本地", async () => {
    const { key, spaceId } = await deriveSecret(PASS);
    const store = new Map<string, RemoteRecord>();

    // 假装另一台设备先传了一份过来（它写的时刻比本地那份新）
    const theirUpdatedAt = Date.now() + 1000;
    const theirPayload: SyncPayload = {
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-b",
      updatedAt: theirUpdatedAt,
      events: [
        {
          date: "2026-10-28",
          cardId: "card-x",
          variant: "normal",
          ts: 500,
          updatedAt: theirUpdatedAt,
        },
      ],
      tombstones: [],
      settings: [{ key: "myRoutine", value: ["card-x"], updatedAt: theirUpdatedAt }],
      custom: [],
    };
    store.set(spaceId, {
      blob: await encryptPayload(key, theirPayload),
      rev: "1",
      updatedAt: theirUpdatedAt,
    });

    await setSetting("myRoutine", ["card-y"]);
    const report = await syncNow(memoryTransport(store), cfg({ enabled: true, serverUrl: "https://x.dev" }));

    expect(report.ok).toBe(true);
    expect(report.added).toBe(1);
    // 收下来了
    const events = await allEvents();
    expect(events.map((e) => e.cardId)).toContain("card-x");
    // 远端那份设置更新（写得晚）→ 清单被换成远端那份
    expect(await getSetting("myRoutine", [])).toEqual(["card-x"]);
    // 推上去了：远端现在是合并后的那份
    const pushed = await decryptPayload(key, store.get(spaceId)!.blob);
    expect(pushed.settings.find((s) => s.key === "myRoutine")?.value).toEqual(["card-x"]);
    expect(pushed.events.length).toBe(1);
  });

  it("别人刚写过的（版本对不上）→ 拿回那份合完再推", async () => {
    const { key, spaceId } = await deriveSecret(PASS);
    const store = new Map<string, RemoteRecord>();

    const inner = memoryTransport(store);
    let conflicts = 0;
    const transport: SyncTransport = {
      fetch: (id) => inner.fetch(id),
      async push(id, blob, baseRev) {
        const cur = store.get(id);
        // 第一次推：装作别人刚写过（版本对不上）
        if (cur && baseRev !== cur.rev) {
          conflicts++;
          return { ok: false, conflict: cur };
        }
        return inner.push(id, blob, baseRev);
      },
    };

    const theirPayload: SyncPayload = {
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-b",
      updatedAt: Date.now() + 1000,
      events: [
        {
          date: "2026-10-28",
          cardId: "card-y",
          variant: "normal",
          ts: 600,
          updatedAt: Date.now() + 1000,
        },
      ],
      tombstones: [],
      settings: [],
      custom: [],
    };
    store.set(spaceId, {
      blob: await encryptPayload(key, theirPayload),
      rev: "3",
      updatedAt: Date.now() + 1000,
    });

    const report = await syncNow(
      transport,
      cfg({ enabled: true, serverUrl: "https://x.dev" }),
    );
    expect(report.ok).toBe(true);
    expect(report.pushed).toBe(true);
    // 对面那条记录没被盖掉
    const pushed = await decryptPayload(key, store.get(spaceId)!.blob);
    expect(pushed.events.map((e) => e.cardId)).toContain("card-y");
  });

  it("本地删掉的记录，删除标记跟着走 —— 对面不会把它带回来", async () => {
    const { key, spaceId } = await deriveSecret(PASS);
    const store = new Map<string, RemoteRecord>();

    // 本地有一条记录，删掉它
    await applyPayload({
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-a",
      updatedAt: 1,
      events: [{ date: "2026-10-29", cardId: "card-z", variant: "normal", ts: 900, updatedAt: 1 }],
      tombstones: [],
      settings: [],
      custom: [],
    });
    expect(await getEvent(900)).toBeTruthy();
    await removeEvent(900);
    expect(await getEvent(900)).toBeUndefined();
    expect(await allTombstones()).toHaveLength(1);

    await syncNow(memoryTransport(store), cfg({ enabled: true, serverUrl: "https://x.dev" }));

    const pushed = await decryptPayload(key, store.get(spaceId)!.blob);
    // 被删掉的那条不在里面了（别的记录还在 —— 那是别的测试留下的）
    expect(pushed.events.map((e) => e.ts)).not.toContain(900);
    expect(pushed.tombstones.some((t) => t.id === "900")).toBe(true);
  });

  it("远端没变（304）→ 只花一次「问一句」的流量，不拉全量", async () => {
    const store = new Map<string, RemoteRecord>();
    let pushes = 0;
    let fetches = 0;
    const transport: SyncTransport = {
      async fetch(id) {
        fetches++;
        // 远端说"还是那一版吗" → 没变
        return {
          blob: { v: 1, iv: "", ciphertext: "" },
          rev: "1",
          updatedAt: Date.now(),
          unchanged: true,
        };
      },
      async push(id, blob) {
        pushes++;
        store.set(id, { blob, rev: "2", updatedAt: Date.now() });
        return { ok: true };
      },
    };

    const conf = cfg({ enabled: true, serverUrl: "https://x.dev" });
    const first = await syncNow(transport, conf);
    expect(first.ok).toBe(true);
    // 本地没改 → 什么都不用做（连 PUT 都省了）
    expect(pushes).toBe(0);
    expect(first.message).toContain("没有要传的改动");

    // 本地改了 → 只推本地那份（远端没变，合起来就是本地这份）
    await setSetting("cadence", { "card-x": "weekly" });
    const second = await syncNow(transport, conf);
    expect(second.ok).toBe(true);
    expect(pushes).toBe(1);
    expect(fetches).toBe(2);
  });

  it("本地没改就不重传（网盘按流量算钱，没必要每次开 App 都传一遍）", async () => {
    const { key, spaceId } = await deriveSecret(PASS);
    const store = new Map<string, RemoteRecord>();
    let pushes = 0;
    const transport: SyncTransport = {
      async fetch(id) {
        return store.get(id) ?? null;
      },
      async push(id, blob, baseRev) {
        pushes++;
        const cur = store.get(id);
        if (cur && baseRev !== null && baseRev !== cur.rev) {
          return { ok: false, conflict: cur };
        }
        const rev = String(Number(cur?.rev ?? 0) + 1);
        store.set(id, { blob, rev, updatedAt: Date.now() });
        return { ok: true };
      },
    };

    const conf = cfg({ enabled: true, serverUrl: "https://x.dev" });
    const first = await syncNow(transport, conf);
    expect(first.ok).toBe(true);
    expect(pushes).toBe(1);

    // 什么都没改 → 不用再传
    const second = await syncNow(transport, conf);
    expect(second.ok).toBe(true);
    expect(pushes).toBe(1);
    expect(second.message).toContain("没有要传的改动");

    // 改了点东西 → 该传
    // 用 cadence 这个键：前面那个测试往共享库里写过一个"未来 1 秒"的
    // myRoutine（模拟"远端更新"），用它会被那份一直压着。
    await setSetting("cadence", { "card-x": "weekly" });
    const third = await syncNow(transport, conf);
    expect(third.ok).toBe(true);
    expect(pushes).toBe(2);
  });

  it("远端那份没了 → 一定要把本地的传上去（不然本地这份永远上不去）", async () => {
    const store = new Map<string, RemoteRecord>();
    let pushes = 0;
    const transport: SyncTransport = {
      async fetch(id) {
        return store.get(id) ?? null;
      },
      async push(id, blob) {
        pushes++;
        store.set(id, { blob, rev: "1", updatedAt: Date.now() });
        return { ok: true };
      },
    };
    const conf = cfg({ enabled: true, serverUrl: "https://x.dev" });
    await syncNow(transport, conf);
    expect(pushes).toBe(1);

    // 远端被删了（404）→ 还得再传一份
    store.clear();
    const again = await syncNow(transport, conf);
    expect(again.ok).toBe(true);
    expect(pushes).toBe(2);
  });

  it("冲突后重合并要用「已应用的那份」，不能把第一轮从远端收到的记录挤掉", async () => {
    const { key, spaceId } = await deriveSecret(PASS);
    const pushed: SyncPayload[] = [];
    const remoteA: SyncPayload = {
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-b",
      updatedAt: 10,
      events: [
        { date: "2026-10-29", cardId: "from-remote-A", variant: "normal", ts: 111, updatedAt: 10 },
      ],
      tombstones: [],
      settings: [],
      custom: [],
    };
    const remoteC: SyncPayload = {
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-c",
      updatedAt: 20,
      events: [
        { date: "2026-10-29", cardId: "from-remote-C", variant: "normal", ts: 222, updatedAt: 20 },
      ],
      tombstones: [],
      settings: [],
      custom: [],
    };

    const transport: SyncTransport = {
      async fetch() {
        return {
          blob: await encryptPayload(key, remoteA),
          rev: "1",
          updatedAt: 10,
        };
      },
      async push(_id, blob) {
        pushed.push(JSON.parse(JSON.stringify(await decryptPayload(key, blob))));
        // 第一次推就撞上：对方刚写的是另一份（只有 C，没有 A）
        return {
          ok: false,
          conflict: {
            blob: await encryptPayload(key, remoteC),
            rev: "2",
            updatedAt: 20,
          },
        };
      },
    };

    const report = await syncNow(transport, cfg({ enabled: true, serverUrl: "https://x.dev" }));
    expect(report.ok).toBe(true);
    expect(pushed.length).toBe(2);
    // 第二份（重推的）必须同时有 A 与 C —— A 是第一轮收到的，不能丢
    const ids = pushed[1].events.map((e) => e.cardId);
    expect(ids).toContain("from-remote-A");
    expect(ids).toContain("from-remote-C");
  });

  it("老版本的设置行没有时间戳 → 补一个（本地优先，不然远端会一直赢）", async () => {
    // 造一行没有 updatedAt 的设置（升级前的老数据）
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open("life-guide");
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("settings", "readwrite");
        tx.objectStore("settings").put({ key: "myRoutine", value: ["旧的"] });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const payload = await buildLocalPayload("dev-a");
    const routine = payload.settings.find((s) => s.key === "myRoutine");
    expect(routine?.value).toEqual(["旧的"]);
    // 不是 0（0 会被远端一直压着）
    expect(routine!.updatedAt).toBeGreaterThan(0);
  });

  it("口令填错 → 落到一个空位置 → 提醒一句（否则两台设备永远碰不到同一份）", async () => {
    const store = new Map<string, RemoteRecord>();
    const transport: SyncTransport = {
      async fetch(id) {
        return store.get(id) ?? null;
      },
      async push(id, blob) {
        store.set(id, { blob, rev: "1", updatedAt: Date.now() });
        return { ok: true };
      },
    };
    const conf = cfg({ enabled: true, serverUrl: "https://x.dev" });

    // 第一次：在"位置 A"同步过
    await syncNow(transport, conf);
    const first = await syncNow(transport, conf);
    expect(first.message).not.toContain("新的位置");

    // 换了个口令 → 空间 id 变了 → 那边是空的
    const other = cfg({
      enabled: true,
      serverUrl: "https://x.dev",
      passphrase: "另一句口令-2026-09",
    });
    const second = await syncNow(transport, other);
    expect(second.ok).toBe(true);
    expect(second.message).toContain("新的位置");
    expect(second.message).toContain("口令或地址填错");
  });

  it("对方的时钟快 → 本机之后的改动照样赢（吸收远端时间戳）", async () => {
    const { key, spaceId } = await deriveSecret(PASS);
    const store = new Map<string, RemoteRecord>();
    // 远端那份的时间戳在"未来"（另一台设备的时钟快了）
    const future = Date.now() + 60_000;
    const theirPayload: SyncPayload = {
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-fast",
      updatedAt: future,
      events: [],
      tombstones: [],
      settings: [{ key: "myRoutine", value: ["远端那份"], updatedAt: future }],
      custom: [],
    };
    const transport: SyncTransport = {
      async fetch(id) {
        return store.get(id) ?? { blob: await encryptPayload(key, theirPayload), rev: "1", updatedAt: future };
      },
      async push(id, blob) {
        store.set(id, { blob, rev: "2", updatedAt: Date.now() });
        return { ok: true };
      },
    };

    await syncNow(transport, cfg({ enabled: true, serverUrl: "https://x.dev" }));

    // 本机之后的改动必须排在那个"未来"的时间戳后面
    await setSetting("cadence", { "card-x": "weekly" });
    const local = await getSettingMeta<Record<string, string>>("cadence");
    expect(local.updatedAt).toBeGreaterThan(future);
  });

  it("两台设备同时改不同的东西（一台盖章、一台排序）→ 互不踩", async () => {
    // 设备 A 刚盖了一个章；设备 B 刚把清单换了次序。两边几乎同时同步。
    const a = payloadOf("dev-a", {
      events: [
        { date: "2026-10-29", cardId: "stamped", variant: "normal", ts: 501, updatedAt: 100 },
      ],
      settings: [{ key: "myRoutine", value: ["a", "b"], updatedAt: 100 }],
    });
    const b = payloadOf("dev-b", {
      events: [],
      settings: [{ key: "myRoutine", value: ["b", "a"], updatedAt: 200 }],
    });

    const merged = mergePayloads(a, b);
    // 盖章保住了（记录按条合，不会被清单的改动挤掉）
    expect(merged.payload.events.map((e) => e.cardId)).toEqual(["stamped"]);
    // 清单是一个整体，按"谁新谁赢"：B 的次序更新 → 赢
    expect(merged.payload.settings.find((s) => s.key === "myRoutine")?.value).toEqual(["b", "a"]);
  });

  it("同步设置存进去再读出来是一样的", async () => {    await saveSyncConfig({
      enabled: true,
      serverUrl: "https://sync.example.dev/",
      passphrase: PASS,
    });
    const cfg = await readSyncConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.serverUrl).toBe("https://sync.example.dev/");
    expect(cfg.passphrase).toBe(PASS);
  });
});

describe("applyPayload", () => {
  it("墓碑比记录新 → 记录被删掉", async () => {
    await applyPayload({
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-b",
      updatedAt: 10,
      events: [{ date: "2026-10-29", cardId: "card-q", variant: "normal", ts: 700, updatedAt: 10 }],
      tombstones: [],
      settings: [],
      custom: [],
    });
    expect(await getEvent(700)).toBeTruthy();

    await applyPayload({
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-b",
      updatedAt: 20,
      events: [],
      tombstones: [{ kind: "event", id: "700", updatedAt: 20 }],
      settings: [],
      custom: [],
    });
    expect(await getEvent(700)).toBeUndefined();
  });

  it("记录比墓碑新 → 记录留着", async () => {
    await applyPayload({
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-b",
      updatedAt: 30,
      events: [{ date: "2026-10-29", cardId: "card-r", variant: "normal", ts: 701, updatedAt: 30 }],
      tombstones: [{ kind: "event", id: "701", updatedAt: 20 }],
      settings: [],
      custom: [],
    });
    expect(await getEvent(701)).toBeTruthy();
  });

  it("习惯删掉了（墓碑）→ 本地的也删掉", async () => {
    await putCustomHabit({
      id: "my-1",
      name: "冥想",
      text: "",
      slot: "morning",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: 5,
    });
    expect(await allCustomHabits()).toHaveLength(1);
    await applyPayload({
      v: SYNC_PAYLOAD_VERSION,
      deviceId: "dev-b",
      updatedAt: 40,
      events: [],
      tombstones: [{ kind: "custom", id: "my-1", updatedAt: 40 }],
      settings: [],
      custom: [],
    });
    expect(await allCustomHabits()).toHaveLength(0);
  });

  it("本地删掉习惯时也会留下墓碑", async () => {
    await putCustomHabit({
      id: "my-2",
      name: "拉伸",
      text: "",
      slot: "evening",
      createdAt: "2026-10-01T00:00:00.000Z",
      updatedAt: 5,
    });
    await deleteCustomHabit("my-2");
    const tombs = await allTombstones();
    expect(tombs.some((t) => t.kind === "custom" && t.id === "my-2")).toBe(true);
  });
});
