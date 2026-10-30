/**
 * 落点之一：GitHub 私有仓库。
 *
 * **为什么是它**：不用自己搭任何服务端 —— 账号现成、API 现成、浏览器里也能用
 * （api.github.com 发 `access-control-allow-origin: *`，实测过）。
 * 数据在客户端加密后才上传，仓库里只有一串看不出内容的密文。
 *
 * **它怎么当"同一位置"**：仓库里的一个文件，文件名是**空间 id**
 * （由同步口令派生，见 sync-crypto.ts）—— 同一个口令在哪儿都指向同一个文件。
 *
 * **代价**：要一个 Personal Access Token（只给 `repo` 权限即可）；
 * GitHub 的 API 有频率限制（个人版 5000 次/小时，一天同步几十次够用）；
 * 它不是为这个设计的，冲突要靠 blob 的 sha 自己判（下面就是）。
 */
import type { EncryptedBlob } from "./sync-crypto.ts";
import type { RemoteRecord, SyncTransport } from "./sync.ts";

export interface GithubOptions {
  /** `owner/repo`，例如 `rockbenben/life-guide` */
  repo: string;
  /** 仓库里的目录（可空 → 放仓库根下） */
  dir?: string;
  /** 分支（可空 → 默认分支） */
  branch?: string;
  /** Personal Access Token */
  token: string;
}

const API = "https://api.github.com";

/** 路径里的每一段都要转义（目录名里可能有空格）。 */
function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function decodeBase64(text: string): string {
  const bin = atob(text.replace(/\s+/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function githubTransport(opts: GithubOptions): SyncTransport {
  const [owner, repo] = opts.repo.split("/").map((s) => s.trim());
  if (!owner || !repo) throw new Error("仓库要写成 owner/repo");

  const fileOf = (spaceId: string) =>
    // 文件名带前缀是为了**给人看的**：空间 id 是一串随机字符，
    // 在仓库的文件列表里根本认不出来（要删、要备份、要看它多大）。
    [opts.dir, `life-guide-${spaceId}.json`].filter(Boolean).join("/");
  const urlOf = (spaceId: string) => `${API}/repos/${owner}/${repo}/contents/${encodePath(fileOf(spaceId))}`;

  const headers = (extra: Record<string, string> = {}) => ({
    accept: "application/vnd.github+json",
    authorization: `Bearer ${opts.token}`,
    "x-github-api-version": "2022-11-28",
    ...extra,
  });

  /** 每个空间上次看到的 blob sha（用来问「还是那一版吗」）。 */
  const shas = new Map<string, string>();

  const transport: SyncTransport = {
    async fetch(spaceId: string): Promise<RemoteRecord | null> {
      const url = `${urlOf(spaceId)}${opts.branch ? `?ref=${encodeURIComponent(opts.branch)}` : ""}`;
      const known = shas.get(spaceId);
      const reqHeaders: Record<string, string> = headers();
      // 问一句「还是那一版吗」——没变就只回 304，不发 body（省流量）
      if (known) reqHeaders["if-none-match"] = known;
      const res = await fetch(url, { headers: reqHeaders });
      // 404 = 仓库里还没有这一份（第一次同步，不是错）
      if (res.status === 404) {
        shas.delete(spaceId);
        return null;
      }
      // 304 = 没变
      if (res.status === 304) {
        return {
          blob: { v: 1, iv: "", ciphertext: "" },
          rev: known ?? "",
          updatedAt: Date.now(),
          unchanged: true,
        };
      }
      if (!res.ok) throw new Error(`GitHub 取不到数据（HTTP ${res.status}）`);
      const data = (await res.json()) as {
        content?: string;
        sha?: string;
        encoding?: string;
      };
      if (!data.content) return null;
      if (data.sha) shas.set(spaceId, data.sha);
      const blob = JSON.parse(decodeBase64(data.content)) as EncryptedBlob;
      return {
        blob,
        // blob 的 sha 就是这一版的标识 —— 推的时候原样退回去，GitHub 自己判对不对
        rev: data.sha ?? "",
        updatedAt: Date.now(),
      };
    },

    async push(spaceId, blob, baseRev) {
      const body: Record<string, unknown> = {
        message: "生活指南 · 同步数据",
        content: encodeBase64(JSON.stringify(blob)),
      };
      if (opts.branch) body.branch = opts.branch;
      // 带 sha 才是"更新"；不带 sha 是"新建"，文件已存在会报 422
      if (baseRev) body.sha = baseRev;

      const res = await fetch(urlOf(spaceId), {
        method: "PUT",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify(body),
      });
      if (res.ok) return { ok: true };

      // 409/422 = sha 对不上（别人刚写过）或文件已经存在
      if (res.status === 409 || res.status === 422) {
        const current = await transport.fetch(spaceId);
        if (current) return { ok: false, conflict: current };
        // 文件被删了 → 当作没有冲突，重来一次（不带 sha）
        const retry = await fetch(urlOf(spaceId), {
          method: "PUT",
          headers: headers({ "content-type": "application/json" }),
          body: JSON.stringify({
            message: body.message,
            content: body.content,
            ...(opts.branch ? { branch: opts.branch } : {}),
          }),
        });
        if (retry.ok) return { ok: true };
        throw new Error(`GitHub 写不进去（HTTP ${retry.status}）`);
      }
      throw new Error(`GitHub 写不进去（HTTP ${res.status}）`);
    },
  };

  return transport;
}
