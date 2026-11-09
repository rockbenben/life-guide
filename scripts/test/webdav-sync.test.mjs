import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import http from "node:http";
import { davRequest } from "../../desktop/lib/dav-client.mjs";
import { webdavTransport } from "../../app/src/data/sync-webdav.ts";
import {
  deriveSecret,
  decryptPayload,
  encryptPayload,
} from "../../app/src/data/sync-crypto.ts";

let server, url, snapshot, rev, requests, fault, gate;
const passphrase = "webdav-acceptance-only";
beforeEach(async () => {
  snapshot = null;
  rev = 0;
  requests = [];
  fault = "";
  gate = null;
  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    requests.push({ method: req.method, headers: req.headers });
    if (
      req.headers.authorization !==
      "Basic " + Buffer.from("u:p").toString("base64")
    ) {
      res.writeHead(401).end();
      return;
    }
    if (fault === req.method + "-before") {
      fault = "";
      req.socket.destroy();
      return;
    }
    const etag = `"${rev}"`;
    if (req.method === "GET") {
      const body = snapshot;
      const respond = () => {
        if (body === null) res.writeHead(404).end();
        else if (req.headers["if-none-match"] === etag)
          res.writeHead(304, { etag }).end();
        else
          res
            .writeHead(200, { etag, "content-type": "application/json" })
            .end(body);
      };
      if (gate) {
        gate.push(respond);
        if (gate.length === 2) {
          const ready = gate;
          gate = null;
          ready.forEach((fn) => fn());
        }
      } else respond();
      return;
    }
    if (fault === "PUT-conflict") {
      rev++;
      res.writeHead(412).end();
      return;
    }
    if (req.method !== "PUT") {
      res.writeHead(405).end();
      return;
    }
    if (
      (req.headers["if-none-match"] === "*" && snapshot !== null) ||
      (req.headers["if-match"] &&
        (snapshot === null || req.headers["if-match"] !== etag))
    ) {
      res.writeHead(412).end();
      return;
    }
    // 检查条件与写入之间没有 await，模拟服务器原子的条件 PUT。
    snapshot = Buffer.concat(chunks).toString();
    rev++;
    if (fault === "PUT-after") {
      fault = "";
      req.socket.destroy();
      return;
    }
    res.writeHead(204, { etag: `"${rev}"` }).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}/dav/`;
  vi.stubGlobal("lifeGuide", { isDesktop: true, davRequest });
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  vi.unstubAllGlobals();
});
async function client() {
  // 不同 IDBFactory + 模块实例，保证两端的数据库、时钟与同步锁相互隔离。
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const db = await import("../../app/src/data/db.ts");
  await db.replaceUserData({
    events: [],
    custom: [],
    tombstones: [],
    settings: {},
  });
  const { syncNow } = await import("../../app/src/data/sync.ts");
  const transport = webdavTransport({ url, user: "u", password: "p" });
  const cfg = {
    enabled: true,
    kind: "webdav",
    serverUrl: url,
    user: "u",
    password: "p",
    token: "",
    passphrase,
  };
  return { db, run: () => syncNow(transport, cfg) };
}
const add = (c) =>
  c.db.addEvent({
    date: "2026-11-09",
    cardId: "card",
    variant: "normal",
    ts: Date.now(),
  });
async function remote() {
  const { key } = await deriveSecret(passphrase);
  return decryptPayload(key, JSON.parse(snapshot));
}

describe("实际 HTTP WebDAV、加密与两端数据库", () => {
  it.each(["首次创建", "同版本更新"])(
    "%s 并发冲突后，两端事件、设置与删除收敛",
    async (phase) => {
      const a = await client();
      const b = await client();
      let old;
      if (phase === "同版本更新") {
        old = await add(a);
        expect((await a.run()).ok).toBe(true);
        expect((await b.run()).ok).toBe(true);
      }
      const aId = await add(a),
        bId = await add(b);
      expect((await a.db.allEvents()).some((e) => e.eventId === bId)).toBe(
        false,
      );
      const settingTime = Date.now();
      await a.db.setSettingAt("mode", "busy", settingTime);
      await b.db.setSettingAt("mode", "travel", settingTime + 1);
      if (old) await b.db.removeEvent(old);
      gate = [];
      const results = await Promise.all([a.run(), b.run()]);
      expect(results.map((x) => x.ok)).toEqual([true, true]);
      // 初始两次 PUT 必须基于同一版本，故实际产生 412，再由 syncNow 合并重试。
      const writes = requests.filter((x) => x.method === "PUT");
      expect(writes.length).toBeGreaterThanOrEqual(3);
      expect((await a.run()).ok).toBe(true);
      expect((await b.run()).ok).toBe(true);
      const final = await remote();
      expect(final.events.map((e) => e.eventId).sort()).toEqual(
        [aId, bId].sort(),
      );
      expect(final.settings.find((s) => s.key === "mode").value).toBe("travel");
      if (old) expect(final.tombstones.some((t) => t.id === old)).toBe(true);
      for (const c of [a, b])
        expect((await c.db.allEvents()).map((e) => e.eventId).sort()).toEqual(
          [aId, bId].sort(),
        );
    },
  );
  it.each(["GET-before", "PUT-before", "PUT-after"])(
    "%s 断线后不误报成功；重试保留所有记录",
    async (failAt) => {
      const a = await client();
      const b = await client();
      const bId = await add(b);
      expect((await b.run()).ok).toBe(true);
      const aId = await add(a);
      fault = failAt;
      expect((await a.run()).ok).toBe(false);
      expect(await a.db.getSetting("syncLastAt", null)).toBeNull();
      expect((await a.db.allEvents()).some((e) => e.eventId === aId)).toBe(
        true,
      );
      expect((await a.run()).ok).toBe(true);
      expect((await remote()).events.map((e) => e.eventId).sort()).toEqual(
        [aId, bId].sort(),
      );
    },
  );
  it("解密失败后的 304 不能误报成功或覆盖远端", async () => {
    const a = await client();
    await add(a);
    expect((await a.run()).ok).toBe(true);
    const priorAt = await a.db.getSetting("syncLastAt", null);
    const data = await remote();
    const wrong = await deriveSecret("different-key-only-for-test");
    snapshot = JSON.stringify(await encryptPayload(wrong.key, data));
    rev++;
    const beforeWrites = requests.filter((x) => x.method === "PUT").length;
    expect((await a.run()).ok).toBe(false);
    expect((await a.run()).ok).toBe(false);
    expect(requests.at(-1).headers["if-none-match"]).toBe('"' + rev + '"');
    expect(requests.filter((x) => x.method === "PUT")).toHaveLength(
      beforeWrites,
    );
    expect(await a.db.getSetting("syncLastAt", null)).toBe(priorAt);
  });
  it("连续两次冲突明确失败，保留本地合并结果，下轮可恢复", async () => {
    const a = await client(),
      b = await client();
    const bId = await add(b);
    expect((await b.run()).ok).toBe(true);
    const aId = await add(a);
    fault = "PUT-conflict";
    const report = await a.run();
    expect(report.ok).toBe(false);
    expect(report.message).toContain("冲突");
    expect(await a.db.getSetting("syncLastAt", null)).toBeNull();
    expect((await a.db.allEvents()).map((e) => e.eventId).sort()).toEqual(
      [aId, bId].sort(),
    );
    fault = "";
    expect((await a.run()).ok).toBe(true);
    expect((await remote()).events.map((e) => e.eventId).sort()).toEqual(
      [aId, bId].sort(),
    );
  });
});
