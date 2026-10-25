/**
 * 合并审阅状态：新跑出来的（有分类）优先，跑过头的部分用备份里的补上。
 *
 * 为什么要这个：一次全量语义审阅要一个多小时，凭据还可能中途过期。
 * 中断之后，已经分类好的那几篇比「全部未分类」更有用，
 * 但也不能因此丢掉没跑到的那几篇 —— 合起来才是完整的。
 *
 * 用法：node scripts/merge-audit-state.mjs
 */
import fs from "node:fs";
import path from "node:path";

import { renderReport } from "../content/src/audit/report.ts";

const contentDir = path.resolve("content");
const statePath = path.join(contentDir, "audit-state.json");
const backupPath = path.join(contentDir, "audit-state.backup.json");

function read(p) {
  if (!fs.existsSync(p)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return Array.isArray(data.articles) ? data.articles : [];
  } catch {
    return [];
  }
}

const fresh = read(statePath);
const backup = read(backupPath);
if (!fresh.length && !backup.length) {
  console.log("没有可合并的状态");
  process.exit(0);
}

const byArticle = new Map();
for (const a of backup) byArticle.set(a.article, a);
let fromBackup = 0;
for (const a of fresh) {
  const old = byArticle.get(a.article);
  // 同一篇有两份时取版本新的那份（版本号大 = 用更新的判据审的）
  if (!old || (a.version ?? 0) >= (old.version ?? 0)) {
    if (old && (old.version ?? 0) > (a.version ?? 0)) continue;
    byArticle.set(a.article, a);
    if (old) fromBackup++;
  }
}
const articles = [...byArticle.values()].sort((a, b) => a.article.localeCompare(b.article));

const stats = { cards: 0, ok: 0, suspect: 0, narrow: 0, duplicate: 0 };
for (const a of articles) {
  for (const c of a.cards) {
    stats.cards++;
    if (!c.issues.length) stats.ok++;
    else if (c.issues.some((i) => i.verdict === "suspect")) stats.suspect++;
    else if (c.issues.some((i) => i.verdict === "narrow")) stats.narrow++;
    else stats.duplicate++;
  }
}

fs.writeFileSync(statePath, JSON.stringify({ articles }, null, 2) + "\n", "utf8");
fs.writeFileSync(
  path.join(contentDir, "audit-report.md"),
  renderReport({ articles, stats }, new Date().toISOString()),
  "utf8",
);

console.log(`合并完成：${articles.length} 篇（新的 ${fresh.length} 篇，旧备份补了 ${fromBackup} 篇）`);
console.log(
  `共 ${stats.cards} 张卡 · 没发现问题 ${stats.ok} · 意思不对 ${stats.suspect} · 引文没覆盖全 ${stats.narrow} · 重复 ${stats.duplicate}`,
);
