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

  async function fetchRecord(spaceId: string, known?: RemoteRecord): Promise<RemoteRecord | null> {
    const url = `${urlOf(spaceId)}${opts.branch ? `?ref=${encodeURIComponent(opts.branch)}` : ""}`;
    const reqHeaders = headers({
      accept: "application/vnd.github.object+json",
      ...(known?.etag ? { "if-none-match": known.etag } : {}),
    });
    const res = await fetch(url, { headers: reqHeaders });
    if (res.status === 404) {
      return null;
    }
    if (res.status === 304) {
      if (!known?.etag) throw new Error("GitHub 返回了无法使用的 304 响应");
      return known;
    }
    if (!res.ok) throw new Error(`GitHub 取不到数据（HTTP ${res.status}）`);
    const data = (await res.json()) as { content?: string; sha?: string; encoding?: string };
    if (!data.sha) throw new Error("GitHub 返回的同步文件缺少版本标识");

    let json: string;
    if (data.content) {
      json = decodeBase64(data.content);
    } else if (data.encoding === "none") {
      // 按内容哈希读取，分支在两次 GET 之间变化也不会读串版本。
      const raw = await fetch(`${API}/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(data.sha)}`, {
        headers: headers({ accept: "application/vnd.github.raw+json" }),
      });
      if (!raw.ok) throw new Error(`GitHub 取不到同步文件内容（HTTP ${raw.status}）`);
      json = await raw.text();
    } else {
      throw new Error("GitHub 返回的同步文件缺少内容");
    }
    const blob = JSON.parse(json) as EncryptedBlob;
    return { blob, rev: data.sha, etag: res.headers.get("etag") ?? undefined, updatedAt: Date.now() };
  }

  return {
    fetch: fetchRecord,

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
        const current = await fetchRecord(spaceId);
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
}
