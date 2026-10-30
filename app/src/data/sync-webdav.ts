/**
 * 落点之一：网盘（WebDAV）。
 *
 * **为什么有它**：坚果云、Nextcloud、群晖 NAS 都自带 WebDAV，
 * 用户**不用自己搭任何服务端**，也不用到我的那个 Worker 上注册账号。
 * 文件落在用户自己的网盘里，客户端加密照旧（网盘只看到密文）。
 * **自建的那台也行** —— 局域网里的 NAS / 软路由 / 电脑，填它自己的地址就是。
 *
 * **它做不到的一件事**：浏览器里用不了。
 * 实测坚果云的 WebDAV 端点**不发 CORS 头**（`access-control-allow-origin` 缺席），
 * 浏览器会直接拦掉 —— 所以这个落点只给桌面端与 Android 手机，浏览器那条路走不通。
 * 想在浏览器里同步就用 GitHub 那个落点。
 *
 * **桌面端与手机端为什么能连上**：请求不直接用 fetch。
 * 渲染层（`app://` 与 `https://localhost`）跨源请求要过 CORS，
 * 而自建 WebDAV 默认不发那个头 —— 实测 Electron 45 直接 "blocked by CORS policy"。
 * 所以桌面端交给主进程（Node 的 http）、手机端走原生 HTTP，
 * 那两条路都不受同源策略管。见 `app/src/platform/http.ts`。
 *
 * **它怎么当"同一位置"**：网盘里的一个文件，文件名是 `life-guide-` + 空间 id（口令派生）。
 *
 * **代价**：网盘的 API 有频率限制；账号密码（坚果云给的是"应用密码"）
 * 要存在本机；有些服务器不给 ETag —— 那就没有版本号，冲突判不出来
 * （写的时候按"最后写的那份为准"处理）。
 */
import { httpRequest } from "../platform/http.ts";
import type { EncryptedBlob } from "./sync-crypto.ts";
import type { RemoteRecord, SyncTransport } from "./sync.ts";

export interface WebdavOptions {
  /** WebDAV 根地址，例如 `https://dav.jianguoyun.com/dav/` */
  url: string;
  /** 账号（坚果云是邮箱） */
  user: string;
  /** 应用密码 */
  password: string;
}

/**
 * Basic 认证的头。
 *
 * **要按 UTF-8 编**：btoa 只认 Latin1 —— 账号或密码里有中文/符号时它直接抛
 * `InvalidCharacterError`，传输层都构造不出来（自建/NAS 的本地账号密码带中文很常见）。
 * RFC 7617 没规定字符集 nowadays 的事实标准是 UTF-8，服务器多半也这么解。
 */
function basicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "Basic " + btoa(bin);
}

export function webdavTransport(opts: WebdavOptions): SyncTransport {
  const base = opts.url.trim().replace(/\/+$/, "");
  if (!base) throw new Error("还没填网盘地址");
  const auth = basicAuth(opts.user, opts.password);
  /**
   * 文件名：前缀 + 空间 id。
   *
   * **前缀是给人看的** —— 空间 id 是一串随机字符，在网盘里根本认不出来；
   * 加上 life-guide 就能一眼找到（要删、要备份、要看它多大）。
   */
  const urlOf = (spaceId: string) =>
    `${base}/${encodeURIComponent(`life-guide-${spaceId}`)}.json`;

  /**
   * 每个空间"上次读到的是哪一版"的情况。
   *
   * **为什么要记**：WebDAV 的条件头有三档，得知道远端给的是哪一种才能写对 ——
   * 强 ETag 用 `If-Match`；只有弱 ETag（`W/"…"`）时它不能用（弱比较永远不匹配，
   * 会一直 412），退到 `If-Unmodified-Since` + `Last-Modified`；
   * 连时间戳都没有就只写不判（最后一次写赢）。
   */
  const seen = new Map<string, { etag: string; strong: boolean; lastModified?: string }>();

  /**
   * 发一次请求；连不上的时候说人话。
   *
   * 原始错误有 "ECONNREFUSED 192.168.1.10:5006" 这种，也有浏览器那句
   * "Failed to fetch" —— 用户看不出是地址填错了还是服务器没开。
   */
  async function send(req: {
    url: string;
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    try {
      return await httpRequest(req);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`连不上网盘（${msg}）`);
    }
  }

  const transport: SyncTransport = {
    async fetch(spaceId: string): Promise<RemoteRecord | null> {
      const known = seen.get(spaceId);
      const headers: Record<string, string> = {
        authorization: auth,
        accept: "application/json",
      };
      // 问一句「还是那一版吗」——没变就只回 304，body 都不发。
      // 这一句是省下载流量的关键：每次同步都拉全量，一天几十次就是几十 MB。
      if (known?.strong && known.etag) headers["if-none-match"] = known.etag;

      const res = await send({ url: urlOf(spaceId), headers });
      // 404 = 网盘里还没有这一份（第一次同步，不是错）
      if (res.status === 404) {
        seen.delete(spaceId);
        return null;
      }
      // 304 = 没变（条件头对上了）
      if (res.status === 304) {
        return {
          blob: { v: 1, iv: "", ciphertext: "" },
          rev: known?.etag ?? "",
          updatedAt: Date.now(),
          unchanged: true,
        };
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`网盘取不到数据（HTTP ${res.status}）`);
      }
      const text = res.body;
      if (!text.trim()) return null;

      const etag = res.headers["etag"] ?? "";
      const lastModified = res.headers["last-modified"] ?? undefined;
      // 弱 ETag 不能当 If-Match 用（弱比较永远不匹配 → 一直冲突）
      const strong = Boolean(etag) && !etag.startsWith("W/");
      seen.set(spaceId, { etag, strong, lastModified });

      return {
        blob: JSON.parse(text) as EncryptedBlob,
        // 强 ETag 才当版本号；弱的那个另作打算
        rev: strong ? etag : "",
        updatedAt: Date.now(),
      };
    },

    async push(spaceId, blob, baseRev) {
      const headers: Record<string, string> = {
        authorization: auth,
        "content-type": "application/json",
      };
      const m = seen.get(spaceId);
      if (baseRev) {
        // 强 ETag：只在远端还是这一版时才改
        headers["if-match"] = baseRev;
      } else if (m?.lastModified) {
        // 只有弱 ETag：退到时间戳（服务器给了 Last-Modified 才行）
        headers["if-unmodified-since"] = m.lastModified;
      } else if (!m) {
        // 从来没见过这个文件：只在它不存在时创建（别把别人的盖掉）
        headers["if-none-match"] = "*";
      }

      const res = await send({
        url: urlOf(spaceId),
        method: "PUT",
        headers,
        body: JSON.stringify(blob),
      });
      if (res.status >= 200 && res.status < 300) {
        // 记下这一版 —— 不记的话，下一次推送还会拿着旧 ETag，
        // 白白撞一次 412（再 GET 一次、再合一次）。
        const etag = res.headers["etag"] ?? m?.etag ?? "";
        const strong = Boolean(etag) && !etag.startsWith("W/");
        seen.set(spaceId, {
          etag,
          strong,
          lastModified: res.headers["last-modified"] ?? m?.lastModified,
        });
        return { ok: true };
      }
      // 412 = 远端已经变了（条件头没对上）
      if (res.status === 412) {
        const current = await transport.fetch(spaceId);
        if (current) return { ok: false, conflict: current };
        throw new Error("网盘那份被删了，请再同步一次");
      }
      throw new Error(`网盘写不进去（HTTP ${res.status}）`);
    },
  };

  return transport;
}
