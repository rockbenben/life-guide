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
 * **要求**：服务器提供强 ETag 并原子执行 If-Match / If-None-Match。
 * 不使用秒级时间戳或无条件覆盖作为降级。
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

  // 304 只省下载：仍返回完整密文供调用方解密与合并，不假定本地已应用。
  const seen = new Map<string, RemoteRecord>();

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
  }): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }> {
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
      if (known) headers["if-none-match"] = known.rev;

      const res = await send({ url: urlOf(spaceId), headers });
      // 404 = 网盘里还没有这一份（第一次同步，不是错）
      if (res.status === 404) {
        seen.delete(spaceId);
        return null;
      }
      // 304 = 没变（条件头对上了）
      if (res.status === 304) {
        if (!known)
          throw new Error("网盘返回了无法使用的 304 响应，请重新同步");
        return structuredClone(known);
      }
      if (res.status < 200 || res.status >= 300) {
        throw new Error(`网盘取不到数据（HTTP ${res.status}）`);
      }
      const text = res.body;
      if (!text.trim())
        throw new Error("网盘文件为空，未覆盖任何数据，请检查远端文件");

      const etag = res.headers["etag"] ?? "";
      const strong = /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(etag);
      if (!strong)
        throw new Error(
          "网盘未提供强 ETag，无法安全处理多端同步；请使用支持强 ETag 和条件写入的 WebDAV 服务",
        );
      const record: RemoteRecord = {
        blob: JSON.parse(text) as EncryptedBlob,
        // 原样退回强 ETag，供 If-Match 原子比较。
        rev: etag,
        updatedAt: Date.now(),
      };
      seen.set(spaceId, structuredClone(record));
      return record;
    },

    async push(spaceId, blob, baseRev) {
      const headers: Record<string, string> = {
        authorization: auth,
        "content-type": "application/json",
      };
      if (baseRev !== null) {
        if (!/^"[\x21\x23-\x7e\x80-\xff]*"$/.test(baseRev))
          throw new Error("缺少有效的强 ETag，拒绝覆盖网盘数据");
        // 强 ETag：只在远端还是这一版时才改
        headers["if-match"] = baseRev;
      } else {
        // 从来没见过这个文件：只在它不存在时创建（别把别人的盖掉）
        headers["if-none-match"] = "*";
      }

      // 也覆盖“服务端已写入、响应却断线”的情况：重试必须先重新读取。
      seen.delete(spaceId);
      const res = await send({
        url: urlOf(spaceId),
        method: "PUT",
        headers,
        body: JSON.stringify(blob),
      });
      if (res.status >= 200 && res.status < 300) {
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
