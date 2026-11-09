import { describe, it, expect, afterEach, vi } from "vitest";
import { webdavTransport } from "../../src/data/sync-webdav.ts";
const blob = { v: 1 as const, iv: "iv", ciphertext: "ciphertext" };
const options = { url: "https://dav.example/dav/", user: "u", password: "p" };
afterEach(() => vi.unstubAllGlobals());
describe("WebDAV 安全写入回归", () => {
  it.each([
    {},
    { etag: 'W/"weak"', "last-modified": "Mon, 09 Nov 2026 10:00:00 GMT" },
    { etag: "unquoted" },
  ])("不接受无法原子比较的版本 %j", async (headers) => {
    const request = vi.fn(
      async () =>
        new Response(JSON.stringify(blob), {
          status: 200,
          headers: headers as Record<string, string>,
        }),
    );
    vi.stubGlobal("fetch", request);
    const t = webdavTransport(options);
    await expect(t.fetch("space")).rejects.toThrow(/强 ETag/);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("baseRev=null 始终表示仅创建，即使传输层曾读过该文件", async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      requests.push(init);
      return new Response(JSON.stringify(blob), {
        status: 200,
        headers: { etag: '"v1"' },
      });
    });
    const t = webdavTransport(options);
    await t.fetch("space");
    await t.push("space", blob, null);
    expect(requests[1].headers).toHaveProperty("if-none-match", "*");
  });
});

describe("WebDAV 条件读取与重试回归", () => {
  it("304 仍交回上次读到的完整密文，不能假定它已成功合入本地", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () =>
      ++calls === 1
        ? new Response(JSON.stringify(blob), { headers: { etag: '"v1"' } })
        : new Response(null, { status: 304 }),
    );
    const t = webdavTransport(options);
    const first = await t.fetch("space");
    const cached = await t.fetch("space");
    expect(cached?.blob).toEqual(first?.blob);
    expect(cached?.unchanged).not.toBe(true);
  });
  it("PUT 成功但没有新 ETag 时，下次重新取完整文件而非沿用旧缓存", async () => {
    const requests: RequestInit[] = [];
    vi.stubGlobal("fetch", async (_url: unknown, init: RequestInit) => {
      requests.push(init);
      return init.method === "PUT"
        ? new Response(null, { status: 204 })
        : new Response(JSON.stringify(blob), { headers: { etag: '"v1"' } });
    });
    const t = webdavTransport(options);
    await t.fetch("space");
    await t.push("space", blob, '"v1"');
    await t.fetch("space");
    expect(requests[2].headers).not.toHaveProperty("if-none-match");
  });
  it("空的 200 不是文件不存在，不得当作首次创建", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response("", { headers: { etag: '"v1"' } }),
    );
    await expect(webdavTransport(options).fetch("space")).rejects.toThrow();
  });
});
