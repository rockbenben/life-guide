/**
 * R13：快照完整性。
 *
 * 快照（`content/source/`）是 045 的权威版本（AGENTS.md §4.1）。改快照是允许的，
 * 但必须留下记录：ERRATA.md 一条对应一次改动。
 *
 * 为什么这条规则值钱：快照之后两边长期分叉，blog 的修订不会自动进来，
 * 045 的勘误也不会自动回去。「我们改过哪里」这件事如果只存在于某次改动的记忆里，
 * 三个月后就没人说得清了 —— 所以把它变成机器可查的。
 *
 * 查三件事：
 *   1. `content/source/` 下每个文件的 sha256 是否还与 SOURCE.lock 一致；
 *   2. 不一致时，ERRATA.md 里有没有对应记录（有记录 = 合法改动，没记录 = 静默漂移）；
 *   3. `content/media/` 里的图片副本是否还在，字节是否与 media.lock 一致。
 *
 * 卡片引用的图片「在不在 media.lock」由 R4 报（那张卡自己负责），
 * 这里不再重复报一遍 —— 同一个问题报两次，只会让报告变长，不会更清楚。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import type { Finding } from "../rules/index.ts";

export interface ErrataRecord {
  /** 相对 content/source 的路径 */
  file: string;
  before?: string;
  after?: string;
  reason?: string;
  /** blog 那边是否也改了：fixed | pending | n/a */
  upstream?: string;
}

const YAML_FENCE = /```ya?ml[ \t]*\r?\n([\s\S]*?)```/g;

/** 路径归一：统一分隔符，去掉 ./ 与 content/source/ 前缀。 */
function normalizeRel(p: string): string {
  return p
    .replace(/\\/g, "/")
    .trim()
    .replace(/^\.\//, "")
    .replace(/^content\/source\//, "")
    .replace(/^\/+/, "");
}

function sha256(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * 解析 ERRATA.md 里的记录。
 *
 * 只认 ```yaml 代码块里的列表项；模板占位符（`<相对 content/source 的路径>`）
 * 不是记录，跳过。
 */
export function parseErrata(markdown: string): ErrataRecord[] {
  const out: ErrataRecord[] = [];
  for (const m of markdown.matchAll(YAML_FENCE)) {
    let doc: unknown;
    try {
      doc = parseYaml(m[1]);
    } catch {
      // 写坏的代码块不直接抛错：下面的「缺记录」检查会把它报出来，
      // 那条报错比这里的解析异常更贴近问题本身。
      continue;
    }
    const items = Array.isArray(doc) ? doc : [doc];
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const rec = item as Record<string, unknown>;
      if (typeof rec.file !== "string") continue;
      if (/[<>]/.test(rec.file)) continue; // 模板占位符
      out.push({
        file: normalizeRel(rec.file),
        before: typeof rec.before === "string" ? rec.before : undefined,
        after: typeof rec.after === "string" ? rec.after : undefined,
        reason: typeof rec.reason === "string" ? rec.reason : undefined,
        upstream: typeof rec.upstream === "string" ? rec.upstream : undefined,
      });
    }
  }
  return out;
}

export interface IntegrityOptions {
  /** content/ 目录 */
  contentDir: string;
}

/**
 * 快照目录下的所有文章（相对 source 的路径，用 / 分隔）。
 *
 * ERRATA.md 是「改过什么的记录」，不是快照文章，不算。
 */
function listSnapshotArticles(sourceDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!e.name.endsWith(".md") || e.name === "ERRATA.md") continue;
      out.push(path.relative(sourceDir, abs).replace(/\\/g, "/"));
    }
  };
  walk(sourceDir);
  return out;
}

/** R13：快照与媒体文件是否还对得上。 */
export function checkSnapshotIntegrity(opts: IntegrityOptions): Finding[] {
  const out: Finding[] = [];
  const sourceDir = path.join(opts.contentDir, "source");
  const mediaDir = path.join(opts.contentDir, "media");

  const lockPath = path.join(sourceDir, "SOURCE.lock");
  // 快照整个缺失是另一条检查（SNAPSHOT）的事，这里不重复报。
  if (!fs.existsSync(lockPath)) return out;

  const lock = JSON.parse(fs.readFileSync(lockPath, "utf8")) as {
    files?: Record<string, string>;
  };
  const files = lock.files ?? {};

  const errataPath = path.join(sourceDir, "ERRATA.md");
  const errata = fs.existsSync(errataPath)
    ? parseErrata(fs.readFileSync(errataPath, "utf8"))
    : [];
  const errataFiles = new Set(errata.map((r) => r.file));

  // ---- 正文：锁里登记过、盘上却变了或没了（上面那段） ----
  for (const [rel, expected] of Object.entries(files)) {
    const abs = path.join(sourceDir, rel);
    if (!fs.existsSync(abs)) {
      out.push({
        rule: "R13",
        level: "error",
        file: `content/source/${rel}`,
        message: "快照文件不在了（SOURCE.lock 里登记过）",
      });
      continue;
    }
    const actual = sha256(fs.readFileSync(abs));
    if (actual === expected) continue;
    if (errataFiles.has(rel)) continue; // 改了，而且记了 —— 合法改动
    out.push({
      rule: "R13",
      level: "error",
      file: `content/source/${rel}`,
      message: "快照文件被改过，但 ERRATA.md 里没有对应记录",
    });
  }

  // ---- 正文：盘上有、锁里没登记的文件 ----
  // 重新导入只写不删，旧文章会留在盘上成为锁外的孤儿：
  // 快照里就有记录 commit 之外的内容了，校验器得说出来。
  const registered = new Set(Object.keys(files));
  for (const rel of listSnapshotArticles(sourceDir)) {
    if (registered.has(rel)) continue;
    out.push({
      rule: "R13",
      level: "error",
      file: `content/source/${rel}`,
      message: "快照里有这个文件，但 SOURCE.lock 里没有登记（重新导入留下的旧文章？）",
    });
  }

  // ---- 图片 ----
  const mediaLockPath = path.join(mediaDir, "media.lock");
  if (fs.existsSync(mediaLockPath)) {
    const media = JSON.parse(fs.readFileSync(mediaLockPath, "utf8")) as Record<
      string,
      { file?: string; sha256?: string }
    >;
    for (const [url, v] of Object.entries(media)) {
      if (!v?.file) {
        out.push({
          rule: "R13",
          level: "error",
          file: "content/media/media.lock",
          message: `media.lock 条目没有 file：${url}`,
        });
        continue;
      }
      const abs = path.join(mediaDir, v.file);
      if (!fs.existsSync(abs)) {
        out.push({
          rule: "R13",
          level: "error",
          file: `content/media/${v.file}`,
          message: "media.lock 里的图片副本不存在",
        });
        continue;
      }
      if (!v.sha256) continue;
      const actual = sha256(fs.readFileSync(abs));
      if (actual !== v.sha256) {
        out.push({
          rule: "R13",
          level: "error",
          file: `content/media/${v.file}`,
          message: "图片内容与 media.lock 记录的不符（文件被换过或损坏）",
        });
      }
    }
  }

  return out;
}
