/**
 * 端到端：真的 HTTP + 真的 Worker 处理逻辑 + 真的加密与合并。
 *
 * 前面那些单测各自验一块；这一条把它们串起来跑一遍 ——
 * 协议写错了、CORS 头漏了、密文拼错了，在这里才会露出来。
 *
 * 起的服务器把请求原样交给 `handleRequest`（Worker 的真身），
 * 客户端走的是 App 里那个 `httpTransport`（真身，不是假的）。
 */
import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { httpTransport } from "../../app/src/data/sync-http.ts";
import { decryptPayload, deriveSecret, encryptPayload } from "../../app/src/data/sync-crypto.ts";
import { mergePayloads, SYNC_PAYLOAD_VERSION, type SyncPayload } from "../../app/src/domain/sync.ts";
import { handleRequest, type KvStore } from "../src/worker.ts";

const PASS = "一句不会忘的话-2026";

function kv(): KvStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    async get(key) {
      return map.get(key) ?? null;
    },
    async put(key, value) {
      map.set(key, value);
    },
  };
}

function payload(over: Partial<SyncPayload>): SyncPayload {
  return {
    v: SYNC_PAYLOAD_VERSION,
    deviceId: "dev-a",
    updatedAt: 1,
    events: [],
    tombstones: [],
    settings: [],
    custom: [],
    ...over,
  };
}

let server: Server;
let base = "";
const store = kv();

beforeAll(async () => {
  server = createServer((req, res) => {
    void (async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const body = Buffer.concat(chunks).toString("utf8");
      const request = new Request(`https://sync.test${req.url ?? "/"}`, {
        method: req.method,
        headers: { "content-type": "application/json" },
        ...(req.method === "PUT" && body ? { body } : {}),
      });
      const out = await handleRequest(request, store);
      const headers: Record<string, string> = {};
      out.headers.forEach((value, key) => {
        headers[key] = value;
      });
      res.writeHead(out.status, headers);
      res.end(await out.text());
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("端到端", () => {
  it("两台设备通过服务端把数据合到一处", async () => {
    const { key, spaceId } = await deriveSecret(PASS);
    const transport = httpTransport(base);

    // A 设备先写：一条记录 + 一个清单
    const a = payload({
      deviceId: "dev-a",
      updatedAt: 100,
      events: [
        { date: "2026-10-29", cardId: "card-a", variant: "normal", ts: 1001, updatedAt: 100 },
      ],
      settings: [{ key: "myRoutine", value: ["card-a"], updatedAt: 100 }],
    });
    const putA = await transport.push(spaceId, await encryptPayload(key, a), null);
    expect(putA.ok).toBe(true);

    // B 设备来拉：拉到 A 的那份
    const got = await transport.fetch(spaceId);
    expect(got).not.toBeNull();
    const remote = await decryptPayload(key, got!.blob);
    expect(remote.events).toHaveLength(1);
    expect(remote.events[0].cardId).toBe("card-a");

    // B 设备自己也有东西 → 合起来推回去
    const b = payload({
      deviceId: "dev-b",
      updatedAt: 200,
      events: [
        { date: "2026-10-29", cardId: "card-b", variant: "normal", ts: 1002, updatedAt: 200 },
      ],
      settings: [{ key: "myRoutine", value: ["card-b"], updatedAt: 200 }],
    });
    const merged = mergePayloads(b, remote, "dev-b");
    expect(merged.payload.events).toHaveLength(2);
    // 设置：B 写得晚 → B 的那份赢
    expect(merged.payload.settings.find((s) => s.key === "myRoutine")?.value).toEqual(["card-b"]);

    const putB = await transport.push(spaceId, await encryptPayload(key, merged.payload), got!.rev);
    expect(putB.ok).toBe(true);

    // A 再来拉：两条记录都在
    const again = await transport.fetch(spaceId);
    const final = await decryptPayload(key, again!.blob);
    expect(final.events.map((e) => e.cardId).sort()).toEqual(["card-a", "card-b"]);
  });

  it("两台设备同时推 → 后推的那个被告知冲突，并拿到当前那份", async () => {
    const { key, spaceId } = await deriveSecret(PASS);
    const transport = httpTransport(base);

    // 先有一份
    await transport.push(
      spaceId,
      await encryptPayload(
        key,
        payload({ updatedAt: 10, events: [] }),
      ),
      null,
    );
    const base1 = (await transport.fetch(spaceId))!.rev;

    // 两台设备都读到第 1 版
    const mine = payload({
      deviceId: "dev-c",
      updatedAt: 20,
      events: [
        { date: "2026-10-29", cardId: "card-c", variant: "normal", ts: 2001, updatedAt: 20 },
      ],
    });
    const theirs = payload({
      deviceId: "dev-d",
      updatedAt: 30,
      events: [
        { date: "2026-10-29", cardId: "card-d", variant: "normal", ts: 2002, updatedAt: 30 },
      ],
    });

    // C 先推成功
    const pushC = await transport.push(spaceId, await encryptPayload(key, mine), base1);
    expect(pushC.ok).toBe(true);

    // D 用的是过期的版本号 → 冲突，服务端把当前那份退回来
    const pushD = await transport.push(spaceId, await encryptPayload(key, theirs), base1);
    expect(pushD.ok).toBe(false);
    if (pushD.ok) return;
    const current = await decryptPayload(key, pushD.conflict.blob);
    expect(current.events.map((e) => e.cardId)).toEqual(["card-c"]);

    // D 拿回那份合一次再推 → 两边都在
    const merged = mergePayloads(theirs, current, "dev-d");
    const pushD2 = await transport.push(
      spaceId,
      await encryptPayload(key, merged.payload),
      pushD.conflict.rev,
    );
    expect(pushD2.ok).toBe(true);
    const final = await decryptPayload(key, (await transport.fetch(spaceId))!.blob);
    expect(final.events.map((e) => e.cardId).sort()).toEqual(["card-c", "card-d"]);
  });

  it("口令不对 → 解不开，且说人话", async () => {
    const { key, spaceId } = await deriveSecret(PASS);
    const transport = httpTransport(base);
    await transport.push(spaceId, await encryptPayload(key, payload({})), null);

    const other = await deriveSecret("另一句口令-2026");
    const got = await transport.fetch(spaceId);
    await expect(decryptPayload(other.key, got!.blob)).rejects.toThrow("口令不对");
  });

  it("服务端存的是密文：翻一遍 KV，里面没有明文", async () => {
    const { key, spaceId } = await deriveSecret(PASS);
    const transport = httpTransport(base);
    await transport.push(
      spaceId,
      await encryptPayload(
        key,
        payload({
          events: [
            { date: "2026-10-29", cardId: "card-secret", variant: "normal", ts: 3001, updatedAt: 1 },
          ],
          settings: [{ key: "myRoutine", value: ["card-secret"], updatedAt: 1 }],
        }),
      ),
      null,
    );
    const raw = [...store.map.values()].join("\n");
    expect(raw).not.toContain("card-secret");
    expect(raw).not.toContain("myRoutine");
  });
});
