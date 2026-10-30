/**
 * 两个「不用自己搭服务端」的落点：GitHub 私有仓库 与 网盘 WebDAV。
 *
 * 用假 fetch 测（不联网）：验的是**协议**——请求打对了吗、版本对不上时
 * 会不会退回来让客户端合一次、404 是不是当成"还没有"而不是错。
 *
 * **WebDAV 那条走的是平台层**（platform/http.ts）——在浏览器里它落到 fetch，
 * 所以这里的假 fetch 照样能截住它。桌面端与手机端走的是别的通道，
 * 那两条路由在 app/test/platform/http.test.ts 里钉着。
 */
import { afterEach, describe, expect, it } from "vitest";

import { githubTransport } from "../../src/data/sync-github.ts";
import { webdavTransport } from "../../src/data/sync-webdav.ts";
import type { EncryptedBlob } from "../../src/data/sync-crypto.ts";

const BLOB: EncryptedBlob = { v: 1, iv: "aXY=", ciphertext: "Y2lwaGVy" };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** 装一个假 fetch，按 URL 规则应答。 */
function fakeFetch(
  handler: (call: Call) => { status: number; body?: string; headers?: Record<string, string> },
) {
  const calls: Call[] = [];
  const fn = async (input: RequestInfo | URL, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}),
      ),
      body: typeof init?.body === "string" ? init.body : undefined,
    };
    calls.push(call);
    const res = handler(call);
    // 204/205 不能带 body —— Response 构造器会直接抛
    const nullBody = res.status === 204 || res.status === 205;
    return new Response(nullBody ? null : (res.body ?? ""), {
      status: res.status,
      headers: res.headers ?? { "content-type": "application/json" },
    });
  };
  return { fn, calls };
}

// 假 fetch 要真的装到全局上 —— 只造出来不装，等于还在联网。
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function useFakeFetch(
  handler: (call: Call) => { status: number; body?: string; headers?: Record<string, string> },
) {
  const fake = fakeFetch(handler);
  globalThis.fetch = fake.fn as unknown as typeof fetch;
  return fake;
}

describe("GitHub 落点", () => {
  it("仓库里还没有这一份 → null（第一次同步，不是错）", async () => {
    const { calls } = useFakeFetch(() => ({ status: 404 }));
    const t = githubTransport({ repo: "o/r", token: "tkn" });
    expect(await t.fetch("space1")).toBeNull();
    expect(calls[0].url).toContain("/repos/o/r/contents/life-guide-space1.json");
    expect(calls[0].headers.authorization).toBe("Bearer tkn");
  });

  it("读回来的密文能解，版本号就是 blob 的 sha", async () => {
    const content = Buffer.from(JSON.stringify(BLOB), "utf8").toString("base64");
    useFakeFetch(() => ({
      status: 200,
      body: JSON.stringify({ content, sha: "abc123" }),
    }));
    const t = githubTransport({ repo: "o/r", token: "tkn" });
    const rec = await t.fetch("space1");
    expect(rec?.blob.ciphertext).toBe("Y2lwaGVy");
    expect(rec?.rev).toBe("abc123");
  });

  it("推的时候带上 sha（= 告诉 GitHub「我读的是这一版」）", async () => {
    const { calls } = useFakeFetch(() => ({ status: 200, body: "{}" }));
    const t = githubTransport({ repo: "o/r", token: "tkn", dir: "life-guide" });
    const res = await t.push("space1", BLOB, "sha-old");
    expect(res.ok).toBe(true);
    const body = JSON.parse(calls[0].body!);
    expect(body.sha).toBe("sha-old");
    expect(calls[0].url).toContain("/repos/o/r/contents/life-guide/life-guide-space1.json");
    expect(Buffer.from(body.content, "base64").toString("utf8")).toBe(JSON.stringify(BLOB));
  });

  it("版本对不上（409）→ 退回来当前那份，让客户端合一次再推", async () => {
    const content = Buffer.from(JSON.stringify(BLOB), "utf8").toString("base64");
    let n = 0;
    useFakeFetch(() => {
      n++;
      if (n === 1) return { status: 409, body: "{}" };
      return { status: 200, body: JSON.stringify({ content, sha: "theirs" }) };
    });
    const t = githubTransport({ repo: "o/r", token: "tkn" });
    const res = await t.push("space1", BLOB, "stale");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.conflict.rev).toBe("theirs");
  });
});

describe("网盘（WebDAV）落点", () => {
  it("网盘里还没有这一份 → null", async () => {
    const { calls } = useFakeFetch(() => ({ status: 404 }));
    const t = webdavTransport({ url: "https://dav.example/dav/", user: "u", password: "p" });
    expect(await t.fetch("space1")).toBeNull();
    expect(calls[0].url).toBe("https://dav.example/dav/life-guide-space1.json");
    // Basic 认证：用户名与密码拼 base64
    expect(calls[0].headers.authorization).toBe("Basic " + btoa("u:p"));
  });

  it("账号密码里有中文也不炸（btoa 只认 Latin1）", async () => {
    // 自建/NAS 的本地账号密码带中文很常见 ——
    // btoa 遇到非 Latin1 直接抛 InvalidCharacterError，连传输层都造不出来。
    const { calls } = useFakeFetch(() => ({ status: 404 }));
    const t = webdavTransport({
      url: "https://dav.example/dav",
      user: "小明",
      password: "密码123",
    });
    await t.fetch("space1");
    const auth = calls[0].headers.authorization as string;
    const raw = atob(auth.slice("Basic ".length));
    const decoded = new TextDecoder().decode(
      Uint8Array.from(raw, (c) => c.charCodeAt(0)),
    );
    expect(decoded).toBe("小明:密码123");
  });

  it("读回来的密文能解，版本号就是 ETag", async () => {
    useFakeFetch(() => ({
      status: 200,
      body: JSON.stringify(BLOB),
      headers: { "content-type": "application/json", etag: '"v1"' },
    }));
    const t = webdavTransport({ url: "https://dav.example/dav", user: "u", password: "p" });
    const rec = await t.fetch("space1");
    expect(rec?.blob.iv).toBe("aXY=");
    expect(rec?.rev).toBe('"v1"');
  });

  it("推的时候带上 If-Match（只在还是这一版时才改）", async () => {
    const { calls } = useFakeFetch(() => ({ status: 204 }));
    const t = webdavTransport({ url: "https://dav.example/dav", user: "u", password: "p" });
    const res = await t.push("space1", BLOB, '"v1"');
    expect(res.ok).toBe(true);
    expect(calls[0].method).toBe("PUT");
    expect(calls[0].headers["if-match"]).toBe('"v1"');
  });

  it("第一次推用 If-None-Match（别把别人刚写的那份盖掉）", async () => {
    const { calls } = useFakeFetch(() => ({ status: 201 }));
    const t = webdavTransport({ url: "https://dav.example/dav", user: "u", password: "p" });
    await t.push("space1", BLOB, null);
    expect(calls[0].headers["if-none-match"]).toBe("*");
    expect(calls[0].headers["if-match"]).toBeUndefined();
  });

  it("弱 ETag 不能当 If-Match 用 —— 改用 Last-Modified", async () => {
    // 弱 ETag 用强比较永远不匹配 → 一直 412 → 每次同步都"冲突"。
    const { calls } = useFakeFetch(() => ({
      status: 200,
      body: JSON.stringify(BLOB),
      headers: {
        "content-type": "application/json",
        etag: 'W/"weak-1"',
        "last-modified": "Wed, 29 Oct 2026 12:00:00 GMT",
      },
    }));
    const t = webdavTransport({ url: "https://dav.example/dav", user: "u", password: "p" });
    const rec = await t.fetch("space1");
    // 弱 ETag 当不了版本号
    expect(rec?.rev).toBe("");

    await t.push("space1", BLOB, rec!.rev);
    expect(calls[1].headers["if-match"]).toBeUndefined();
    expect(calls[1].headers["if-unmodified-since"]).toBe(
      "Wed, 29 Oct 2026 12:00:00 GMT",
    );
  });

  it("推成功之后记下新的一版（下次推送不会再白撞一次 412）", async () => {
    const { calls } = useFakeFetch(() => ({
      status: 200,
      body: JSON.stringify(BLOB),
      headers: { "content-type": "application/json", etag: '"v1"' },
    }));
    const t = webdavTransport({ url: "https://dav.example/dav", user: "u", password: "p" });
    const rec = await t.fetch("space1");
    expect(rec?.rev).toBe('"v1"');

    // 第一次推：带 If-Match
    await t.push("space1", BLOB, rec!.rev);
    expect(calls[1].headers["if-match"]).toBe('"v1"');

    // 第二次推（没有重新 fetch）：该用"刚才写完的那一版"，而不是旧的那版
    await t.push("space1", BLOB, rec!.rev);
    expect(calls[2].headers["if-match"]).toBe('"v1"');
    expect(calls[2].headers["if-none-match"]).toBeUndefined();
  });

  it("既没有 ETag 也没有 Last-Modified → 不带条件头（最后一次写赢）", async () => {
    const { calls } = useFakeFetch(() => ({
      status: 200,
      body: JSON.stringify(BLOB),
      headers: { "content-type": "application/json" },
    }));
    const t = webdavTransport({ url: "https://dav.example/dav", user: "u", password: "p" });
    const rec = await t.fetch("space1");
    expect(rec?.rev).toBe("");
    await t.push("space1", BLOB, rec!.rev);
    expect(calls[1].headers["if-match"]).toBeUndefined();
    expect(calls[1].headers["if-unmodified-since"]).toBeUndefined();
    expect(calls[1].headers["if-none-match"]).toBeUndefined();
  });

  it("远端已经变了（412）→ 退回来当前那份", async () => {
    let n = 0;
    useFakeFetch(() => {
      n++;
      if (n === 1) return { status: 412 };
      return {
        status: 200,
        body: JSON.stringify(BLOB),
        headers: { "content-type": "application/json", etag: '"theirs"' },
      };
    });
    const t = webdavTransport({ url: "https://dav.example/dav", user: "u", password: "p" });
    const res = await t.push("space1", BLOB, '"v1"');
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.conflict.rev).toBe('"theirs"');
  });
});
