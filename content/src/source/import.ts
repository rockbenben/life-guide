/**
 * 快照导入：从 blog 仓库的某个 commit 取正文与图片，写进 content/source 与
 * content/media，并生成两份 lock。
 *
 * 这是整个项目唯一联网的地方。导入之后，045 运行时与 CI 都不再访问
 * blog 仓库，也不访问 img.newzone.top（见 AGENTS.md §4.1）。
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { parseMarkdown } from "./parse.ts";

export interface SourceLock {
  repo: string;
  commit: string;
  date: string;
  importedAt: string;
  files: Record<string, string>;
}

export interface MediaLock {
  [originalUrl: string]: {
    file: string;
    sha256: string;
    bytes: number;
    fetchedAt: string;
  };
}

export interface ImportOptions {
  /** blog 仓库本地路径 */
  blogDir: string;
  /** 要导入的 commit；默认 HEAD */
  commit?: string;
  /** content/ 目录 */
  contentDir: string;
  /** 手册子目录，相对 blog/src */
  manualRelPath?: string;
  /** 干跑：只算不写 */
  dryRun?: boolean;
  /** 图片下载并发 */
  concurrency?: number;
}

export interface ImportReport {
  commit: string;
  date: string;
  articles: number;
  imagesFound: number;
  imagesDownloaded: number;
  imagesFailed: { url: string; reason: string }[];
  totalImageBytes: number;
  written: { source: number; media: number };
}

/** 手册里所有图片 URL 出现的顺序（去重）。 */
export function collectImageUrls(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  // markdown 图片 ![alt](url)
  for (const m of text.matchAll(/!\[[^\]]*\]\(([^)\s]+)/g)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  // html <img src="...">
  for (const m of text.matchAll(/<img[^>]+src=["']([^"']+)["']/gi)) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function extensionOf(url: string): string {
  const clean = url.split(/[?#]/)[0];
  const m = clean.match(/\.([A-Za-z0-9]{1,5})$/);
  return m ? m[1].toLowerCase() : "bin";
}

/** 从 git 取出某个 commit 的指定目录文件，返回 Map<相对路径, 内容>。 */
function readTreeAtCommit(
  blogDir: string,
  commit: string,
  relPath: string,
): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  const listing = run("git", ["ls-tree", "-r", "--name-only", commit, "--", relPath], blogDir);
  for (const line of listing.split("\n")) {
    const p = line.trim();
    if (!p || !p.endsWith(".md")) continue;
    const buf = run("git", ["show", `${commit}:${p}`], blogDir);
    files.set(p, Buffer.from(buf, "utf8"));
  }
  return files;
}

async function downloadImage(
  url: string,
): Promise<{ data: Buffer } | { error: string }> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "life-guide/0.1 (content import)" },
      redirect: "follow",
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const ab = await res.arrayBuffer();
    return { data: Buffer.from(ab) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export async function runImport(opts: ImportOptions): Promise<ImportReport> {
  const {
    blogDir,
    contentDir,
    manualRelPath = "src/the-savvy-life-manual",
    dryRun = false,
    concurrency = 6,
  } = opts;

  const commit = opts.commit ?? run("git", ["rev-parse", "HEAD"], blogDir).trim();
  const date = run("git", ["log", "-1", "--format=%cI", commit], blogDir).trim();
  const repoUrl = (() => {
    try {
      return run("git", ["config", "--get", "remote.origin.url"], blogDir).trim();
    } catch {
      return "";
    }
  })();

  const tree = readTreeAtCommit(blogDir, commit, manualRelPath);
  if (tree.size === 0) {
    throw new Error(`commit ${commit} 下没有找到 ${manualRelPath} 下的 md 文件`);
  }

  const sourceDir = path.join(contentDir, "source");
  const mediaDir = path.join(contentDir, "media");

  // ---- 正文 ----
  const sourceLock: SourceLock = {
    repo: repoUrl,
    commit,
    date,
    importedAt: new Date().toISOString(),
    files: {},
  };
  const allText: string[] = [];
  for (const [rel, buf] of tree) {
    const text = buf.toString("utf8");
    allText.push(text);
    // 快照内相对路径保留手册子目录结构，去掉顶层 src/
    const relInSource = rel.replace(/^src\//, "");
    sourceLock.files[relInSource] = sha256(buf);
    if (!dryRun) {
      const dest = path.join(sourceDir, relInSource);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
    }
  }

  // ---- 图片 ----
  const urls = collectImageUrls(allText.join("\n"));
  const mediaLock: MediaLock = {};
  const failed: { url: string; reason: string }[] = [];
  let totalBytes = 0;

  // 并发下载，但控制在固定并发数
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= urls.length) return;
      const url = urls[i];
      const res = await downloadImage(url);
      if ("error" in res) {
        failed.push({ url, reason: res.error });
        continue;
      }
      const h = sha256(res.data);
      const file = `${h}.${extensionOf(url)}`;
      mediaLock[url] = {
        file,
        sha256: h,
        bytes: res.data.length,
        fetchedAt: new Date().toISOString(),
      };
      totalBytes += res.data.length;
      if (!dryRun) {
        fs.mkdirSync(mediaDir, { recursive: true });
        fs.writeFileSync(path.join(mediaDir, file), res.data);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));

  if (!dryRun) {
    fs.writeFileSync(
      path.join(sourceDir, "SOURCE.lock"),
      JSON.stringify(sourceLock, null, 2) + "\n",
      "utf8",
    );
    fs.writeFileSync(
      path.join(mediaDir, "media.lock"),
      JSON.stringify(mediaLock, null, 2) + "\n",
      "utf8",
    );
    const errata = path.join(sourceDir, "ERRATA.md");
    if (!fs.existsSync(errata)) {
      fs.writeFileSync(
        errata,
        [
          "# 勘误记录",
          "",
          "快照（`content/source/`）与 blog 上游的差异都记在这里。",
          "校验器 R13 会比对 `SOURCE.lock` 的 sha256：改了快照文件却没有对应记录 → error。",
          "",
          "每条记录一条：",
          "",
          "```yaml",
          "- file: <相对 content/source 的路径>",
          "  before: <改动前>",
          "  after: <改动后>",
          "  reason: <为什么改>",
          "  upstream: fixed | pending | n/a   # blog 那边是否也改了",
          "```",
          "",
        ].join("\n"),
        "utf8",
      );
    }
  }

  return {
    commit,
    date,
    articles: tree.size,
    imagesFound: urls.length,
    imagesDownloaded: Object.keys(mediaLock).length,
    imagesFailed: failed,
    totalImageBytes: totalBytes,
    written: {
      source: tree.size,
      media: Object.keys(mediaLock).length,
    },
  };
}
