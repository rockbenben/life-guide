import { describe, expect, it } from "vitest";

import { handleRequest, spaceIdFromPath, type KvStore } from "../src/worker.ts";

/** 用 Map 顶掉 KV。 */
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

const SPACE = "abcdefgh12345678";
const base = "https://sync.example.dev";

function putReq(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${base}/blob/${SPACE}`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("空间 id", () => {
  it("只认 /blob/<id> 这种形状", () => {
    expect(spaceIdFromPath(`/blob/${SPACE}`)).toBe(SPACE);
    expect(spaceIdFromPath("/blob/short")).toBeNull();
    expect(spaceIdFromPath("/other/abcdefgh12345678")).toBeNull();
    expect(spaceIdFromPath(`/blob/${SPACE}/extra`)).toBeNull();
  });
});

describe("同步服务", () => {
  it("还没有这一份时 GET 给 404（不是错，是第一次同步）", async () => {
    const res = await handleRequest(new Request(`${base}/blob/${SPACE}`), kv());
    expect(res.status).toBe(404);
  });

  it("写进去再读出来是同一份密文", async () => {    const store = kv();
    const w = await handleRequest(
      putReq({ iv: "iv1", ciphertext: "ct1", baseRev: null }),
      store,
    );
    expect(w.status).toBe(200);
    expect((await w.json()).rev).toBe(1);

    const r = await handleRequest(new Request(`${base}/blob/${SPACE}`), store);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.iv).toBe("iv1");
    expect(body.ciphertext).toBe("ct1");
    expect(body.rev).toBe(1);
  });

  it("条件请求：还是那一版吗 → 304，body 都不发（省下载流量）", async () => {
    const store = kv();
    await handleRequest(
      new Request(`${base}/blob/${SPACE}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ iv: "iv1", ciphertext: "ct1", baseRev: null }),
      }),
      store,
    );
    // 问「还是第 1 版吗」
    const res = await handleRequest(
      new Request(`${base}/blob/${SPACE}`, { headers: { "if-none-match": "1" } }),
      store,
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
  });

  it("版本对不上（别人刚写过）→ 409 + 当前那份，让客户端合完再推", async () => {
    const store = kv();
    await handleRequest(putReq({ iv: "iv1", ciphertext: "ct1", baseRev: null }), store);
    // 客户端读到的还是第 0 版（其实已经有第 1 版了）
    const conflict = await handleRequest(
      putReq({ iv: "iv2", ciphertext: "ct2", baseRev: 0 }),
      store,
    );
    expect(conflict.status).toBe(409);
    const body = await conflict.json();
    expect(body.rev).toBe(1);
    expect(body.ciphertext).toBe("ct1");
  });

  it("版本对得上 → 写进去，版本 +1", async () => {
    const store = kv();
    await handleRequest(putReq({ iv: "iv1", ciphertext: "ct1", baseRev: null }), store);
    const ok = await handleRequest(putReq({ iv: "iv2", ciphertext: "ct2", baseRev: 1 }), store);
    expect(ok.status).toBe(200);
    expect((await ok.json()).rev).toBe(2);
    const r = await handleRequest(new Request(`${base}/blob/${SPACE}`), store);
    expect((await r.json()).ciphertext).toBe("ct2");
  });

  it("缺 iv 或 ciphertext → 400，不该写进去", async () => {
    const store = kv();
    const res = await handleRequest(putReq({ iv: "only" }), store);
    expect(res.status).toBe(400);
    expect(store.map.size).toBe(0);
  });

  it("地址不对 / 方法不对 → 404 / 405", async () => {
    const store = kv();
    expect((await handleRequest(new Request(`${base}/nope`), store)).status).toBe(404);
    expect(
      (await handleRequest(new Request(`${base}/blob/${SPACE}`, { method: "DELETE" }), store)).status,
    ).toBe(405);
  });

  it("预检请求给 204", async () => {
    const res = await handleRequest(
      new Request(`${base}/blob/${SPACE}`, { method: "OPTIONS" }),
      kv(),
    );
    expect(res.status).toBe(204);
  });

  it("来源不在白名单里 → 不给放行头（浏览器会挡住）", async () => {
    const store = kv();
    const res = await handleRequest(
      new Request(`${base}/blob/${SPACE}`, { headers: { origin: "https://evil.example" } }),
      store,
      { allowedOrigins: ["https://life.newzone.top"] },
    );
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("来源在白名单里 → 放行", async () => {
    const res = await handleRequest(
      new Request(`${base}/blob/${SPACE}`, { headers: { origin: "https://life.newzone.top" } }),
      kv(),
      { allowedOrigins: ["https://life.newzone.top"] },
    );
    expect(res.headers.get("access-control-allow-origin")).toBe("https://life.newzone.top");
  });
});
