/**
 * 落点之一：网盘（WebDAV）。
 *
 * **为什么有它**：坚果云、Nextcloud、群晖 NAS 都自带 WebDAV ——
 * 用户**不用自己搭任何服务端**，也不用到我的那个 Worker 上注册账号。
 * 文件落在用户自己的网盘里，客户端加密照旧（网盘只看到密文）。
 *
 * **它做不到的一件事**：浏览器里用不了。
 * 实测坚果云的 WebDAV 端点**不发 CORS 头**（`access-control-allow-origin` 缺席），
 * 浏览器会直接拦掉 —— 所以这个落点只给桌面端与手机端，浏览器那条路走不通。
 * 想在浏览器里同步就用 GitHub 那个落点。
 *
 * **它怎么当"同一位置"**：网盘里的一个文件，文件名是空间 id（口令派生）。
 *
 * **代价**：网盘的 API 有频率限制；账号密码（坚果云给的是"应用密码"）
 * 要存在本机；有些服务器不给 ETag —— 那就没有版本号，冲突判不出来
 * （写的时候按"最后写的那份为准"处理）。
 */
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

export function webdavTransport(opts: WebdavOptions): SyncTransport {
  const base = opts.url.trim().replace(/\/+$/, "");
  if (!base) throw new Error("还没填网盘地址");
  const auth = "Basic " + btoa(`${opts.user}:${opts.password}`);
  const urlOf = (spaceId: string) => `${base}/${encodeURIComponent(spaceId)}.json`;

  /**
   * 每个空间"上次读到的是哪一版"的情况。
   *
   * **为什么要记**：WebDAV 的条件头有三档，得知道远端给的是哪一种才能写对 ——
   * 强 ETag 用 `If-Match`；只有弱 ETag（`W/"…"`）时它不能用（弱比较永远不匹配，
   * 会一直 412），退到 `If-Unmodified-Since` + `Last-Modified`；
   * 连时间戳都没有就只写不判（最后一次写赢）。
   */
  const seen = new Map<string, { etag: string; strong: boolean; lastModified?: string }>();

  const transport: SyncTransport = {
    async fetch(spaceId: string): Promise<RemoteRecord | null> {
      const res = await fetch(urlOf(spaceId), {
        headers: { authorization: auth, accept: "application/json" },
      });
      // 404 = 网盘里还没有这一份（第一次同步，不是错）
      if (res.status === 404) {
        seen.delete(spaceId);
        return null;
      }
      if (!res.ok) throw new Error(`网盘取不到数据（HTTP ${res.status}）`);
      const text = await res.text();
      if (!text.trim()) return null;

      const etag = res.headers.get("etag") ?? "";
      const lastModified = res.headers.get("last-modified") ?? undefined;
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

      const res = await fetch(urlOf(spaceId), {
        method: "PUT",
        headers,
        body: JSON.stringify(blob),
      });
      if (res.ok || res.status === 201) {
        // 记下这一版 —— 不记的话，下一次推送还会拿着旧 ETag，
        // 白白撞一次 412（再 GET 一次、再合一次）。
        const etag = res.headers.get("etag") ?? m?.etag ?? "";
        const strong = Boolean(etag) && !etag.startsWith("W/");
        seen.set(spaceId, {
          etag,
          strong,
          lastModified: res.headers.get("last-modified") ?? m?.lastModified,
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
