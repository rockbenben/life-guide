import { beforeEach, describe, expect, it } from "vitest";
import { spaceIdFromPath, type StoredBlob } from "../src/worker.ts";
import { testServer } from "./server.ts";

const server = testServer();
let space: string;
beforeEach(() => {
  space = crypto.randomUUID();
});

const get = (headers: Record<string, string> = {}) =>
  server.fetch(`/blob/${space}`, { headers });
const put = (body: unknown) =>
  server.fetch(`/blob/${space}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const blob = async (response: Awaited<ReturnType<typeof get>>) =>
  (await response.json()) as StoredBlob;

describe("空间 id", () => {
  it("只认 /blob/<id> 这种形状", () => {
    expect(spaceIdFromPath(`/blob/${space}`)).toBe(space);
    expect(spaceIdFromPath("/blob/short")).toBeNull();
    expect(spaceIdFromPath("/other/abcdefgh12345678")).toBeNull();
    expect(spaceIdFromPath(`/blob/${space}/extra`)).toBeNull();
  });
});

describe("实际 Worker 与 Durable Object", () => {
  it("未创建时读取为 404", async () => {
    expect((await get()).status).toBe(404);
  });

  it("写入后读回相同密文，条件读取返回 304", async () => {
    expect(
      (await put({ iv: "iv1", ciphertext: "ct1", baseRev: null })).status,
    ).toBe(200);
    expect(await blob(await get())).toMatchObject({
      iv: "iv1",
      ciphertext: "ct1",
      rev: 1,
    });
    const response = await get({ "if-none-match": "1" });
    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("精确版本才能更新，过期版本和再次创建均返回当前快照", async () => {
    await put({ iv: "iv1", ciphertext: "ct1", baseRev: null });
    expect(
      (await put({ iv: "iv2", ciphertext: "ct2", baseRev: 1 })).status,
    ).toBe(200);
    for (const baseRev of [1, null]) {
      const response = await put({ iv: "bad", ciphertext: "bad", baseRev });
      expect(response.status).toBe(409);
      expect(await blob(response)).toMatchObject({ rev: 2, ciphertext: "ct2" });
    }
    expect(await blob(await get())).toMatchObject({
      rev: 2,
      ciphertext: "ct2",
    });
  });

  it("不存在的空间携带更新版本时拒绝创建", async () => {
    expect((await put({ iv: "iv", ciphertext: "ct", baseRev: 1 })).status).toBe(
      404,
    );
    expect((await get()).status).toBe(404);
  });

  it.each([undefined, -1, 0, 1.5, "1", true])(
    "拒绝无效 baseRev %s，保持快照不变",
    async (baseRev) => {
      await put({ iv: "iv", ciphertext: "ct", baseRev: null });
      expect(
        (await put({ iv: "bad", ciphertext: "bad", baseRev })).status,
      ).toBe(400);
      expect(await blob(await get())).toMatchObject({
        rev: 1,
        ciphertext: "ct",
      });
    },
  );

  it.each([null, [], {}, { iv: "only" }])(
    "拒绝格式错误的请求体 %j",
    async (body) => {
      expect((await put(body)).status).toBe(400);
      expect((await get()).status).toBe(404);
    },
  );

  it("拒绝非 JSON、错误路径和未支持的方法", async () => {
    expect(
      (
        await server.fetch(`/blob/${space}`, {
          method: "PUT",
          body: "bad json",
        })
      ).status,
    ).toBe(400);
    expect((await server.fetch("/nope")).status).toBe(404);
    expect(
      (await server.fetch(`/blob/${space}`, { method: "DELETE" })).status,
    ).toBe(405);
  });

  it("浏览器预检允许条件读取，白名单来源有放行头", async () => {
    const headers = { origin: "https://life.newzone.top" };
    const response = await server.fetch(`/blob/${space}`, {
      method: "OPTIONS",
      headers,
    });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-headers")).toContain(
      "if-none-match",
    );
    expect(response.headers.get("access-control-allow-origin")).toBe(
      headers.origin,
    );
    expect(
      (await get({ origin: "https://unlisted.example" })).headers.get(
        "access-control-allow-origin",
      ),
    ).toBeNull();
    expect(
      (await get(headers)).headers.get("access-control-allow-origin"),
    ).toBe(headers.origin);
  });

  it.each([2, 24])("%i 个同时首次创建请求恰有一个成功", async (count) => {
    // 每个请求返回时立即读完自己的响应流；请求仍在 Promise.all 内并发发送。
    const replies = await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        const response = await put({
          iv: `iv-${i}`, ciphertext: `ct-${i}`, baseRev: null,
        });
        return { status: response.status, body: (await response.json()) as unknown };
      }),
    );
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(replies.filter((r) => r.status === 409)).toHaveLength(count - 1);
    const winner = await blob(await get());
    expect(winner.rev).toBe(1);
    for (const response of replies.filter((r) => r.status === 409)) {
      expect(response.body).toEqual(winner);
    }
  });

  it("同版本的并发更新恰有一个成功，其他请求拿到赢家密文", async () => {
    await put({ iv: "initial", ciphertext: "initial", baseRev: null });
    const replies = await Promise.all(
      Array.from({ length: 16 }, async (_, i) => {
        const response = await put({ iv: `iv-${i}`, ciphertext: `ct-${i}`, baseRev: 1 });
        return { status: response.status, body: (await response.json()) as unknown };
      }),
    );
    expect(replies.filter((r) => r.status === 200)).toHaveLength(1);
    expect(replies.filter((r) => r.status === 409)).toHaveLength(15);
    const winner = await blob(await get());
    expect(winner.rev).toBe(2);
    for (const response of replies.filter((r) => r.status === 409)) {
      expect(response.body).toEqual(winner);
    }
  });

  it("不同空间独立创建，实例重建后保留已提交的数据", async () => {
    await put({ iv: "a", ciphertext: "a", baseRev: null });
    const worker = server.getWorker();
    await worker.evictDurableObject("SyncSpace", { name: space });
    expect(await blob(await get())).toMatchObject({ rev: 1, ciphertext: "a" });
    expect(
      (
        await server.fetch(`/blob/${crypto.randomUUID()}`, {
          method: "PUT",
          body: JSON.stringify({ iv: "b", ciphertext: "b", baseRev: null }),
        })
      ).status,
    ).toBe(200);
    expect(await blob(await get())).toMatchObject({ rev: 1, ciphertext: "a" });
  });

  it("SQLite 写入失败时，密文与版本一起回滚", async () => {
    await put({ iv: "good", ciphertext: "good", baseRev: null });
    const sql = await server
      .getWorker()
      .getDurableObjectStorage("SyncSpace", { name: space });
    await sql.exec(
      "CREATE TRIGGER reject_write BEFORE INSERT ON snapshot WHEN NEW.ciphertext = 'reject' BEGIN SELECT RAISE(ABORT, 'test write failure'); END",
    );
    expect(
      (await put({ iv: "bad", ciphertext: "reject", baseRev: 1 })).status,
    ).toBe(503);
    expect(await blob(await get())).toMatchObject({
      iv: "good",
      ciphertext: "good",
      rev: 1,
    });
    expect(
      (await put({ iv: "next", ciphertext: "next", baseRev: 1 })).status,
    ).toBe(200);
    expect(await blob(await get())).toMatchObject({
      rev: 2,
      ciphertext: "next",
    });
  });
});
