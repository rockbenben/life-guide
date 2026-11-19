/**
 * 走 HTTP 的传输层：远端就是一个「按空间 id 存取密文」的地方。
 *
 * 协议只有两个动作：
 *   · GET  {base}/blob/{spaceId} →  { iv, ciphertext, rev, updatedAt }，没有就是 404
 *   · PUT  {base}/blob/{spaceId}  带 { iv, ciphertext, baseRev }
 *
 * `baseRev` 是"我读到的是第几版"：服务端发现版本对不上就回 409 并把当前那份
 * 退回来，客户端合完再推（见 data/sync.ts）。
 *
 * **不缓存 GET**：中间层缓存会把旧的一份返回来，合并就会把旧数据当新的
 * （明明别人刚同步过，这台设备还在用上一版）。
 */
import type { EncryptedBlob } from "./sync-crypto.ts";
import type { RemoteRecord, SyncTransport } from "./sync.ts";

/** 服务端存的一条记录（线上格式）。 */
interface WireRecord {
  iv: string;
  ciphertext: string;
  rev?: number;
  updatedAt?: number;
}

function toRecord(data: WireRecord): RemoteRecord {
  const blob: EncryptedBlob = { v: 1, iv: data.iv, ciphertext: data.ciphertext };
  return { blob, rev: String(data.rev ?? 0), updatedAt: data.updatedAt ?? 0 };
}

/** 地址去掉结尾的斜杠（免得拼出 `//blob/…`）。 */
export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** 建一个走 HTTP 的传输层。 */
export function httpTransport(serverUrl: string, writeToken: string): SyncTransport {
  const base = normalizeServerUrl(serverUrl);
  const url = (spaceId: string) => `${base}/blob/${encodeURIComponent(spaceId)}`;
  return {
    async fetch(spaceId, known): Promise<RemoteRecord | null> {
      // 问一句「还是那一版吗」——没变就只回 304，不发 body（省流量）
      const res = await fetch(url(spaceId), {
        method: "GET",
        headers: {
          accept: "application/json",
          ...(known ? { "if-none-match": known.rev } : {}),
        },
        cache: "no-store",
      });
      // 远端还没有这一份 —— 不是错，是"第一次同步"
      if (res.status === 404) {
        return null;
      }
      // 304 = 没变
      if (res.status === 304) {
        if (!known) throw new Error("同步服务返回了无法使用的 304 响应");
        return known;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return toRecord((await res.json()) as WireRecord);
    },

    async push(spaceId, blob: EncryptedBlob, baseRev: string | null) {
      const res = await fetch(url(spaceId), {
        method: "PUT",
        headers: {
          authorization: `Bearer ${writeToken}`,
          "content-type": "application/json",
        },
        redirect: "error",
        body: JSON.stringify({
          iv: blob.iv,
          ciphertext: blob.ciphertext,
          baseRev: baseRev === null ? null : Number(baseRev),
        }),
      });
      if (res.status === 409) {
        const data = (await res.json()) as WireRecord;
        return { ok: false, conflict: toRecord(data) };
      }
      if (res.status === 401) throw new Error("请检查同步服务的写入令牌");
      if (res.status === 413) throw new Error("同步请求超过 4 MiB");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return { ok: true };
    },
  };
}
