#!/usr/bin/env node
/**
 * 内容管线 CLI。
 *
 *   content import --blog <path> [--commit <sha>] [--dry-run]
 *   content check
 *   content build
 *   content review <cardId> --by <name>
 *   content review --list <清单.md> --by <name>
 *   content signing-list
 *   content draft <article> [--all] [--dry-run]
 *   content audit [--article <path>] [--no-llm] [--report-only] [--resume]
 *   content slot-check
 *   content approx-check
 *   content repair-quotes
 *
 * CI 只跑 check 与 build，两者都只读不写（见 AGENTS.md §4.3）。
 */
import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";

import { loadAllCards, type ArticleCards, type Card } from "./cards/load.ts";
import { fingerprint } from "./cards/fingerprint.ts";
import { checkBusyBudget, checkReviewSignature, type BusyBudget } from "./budget.ts";
import { ALL_RULES, type Finding } from "./rules/index.ts";
import { runImport } from "./source/import.ts";
import { parseMarkdown } from "./source/parse.ts";
import { approximationAttached } from "./source/normalize.ts";
import { checkSnapshotIntegrity } from "./source/errata.ts";
import { checkDefaultRoutine } from "./default-routine.ts";
import { r12Check } from "./review.ts";
import { buildBundle, buildManual, collectManualMediaFiles, collectMediaFiles } from "./build.ts";
import { optimizeMediaFiles } from "./media-optimize.ts";
import { createLlmClient, loadLlmConfig, type LlmClient } from "./extract/llm.ts";
import { draftArticle, listArticles, resolveArticle, targetFor } from "./extract/draft.ts";
import { runAudit } from "./audit/run.ts";
import { extendQuote } from "./repair-quotes.ts";
import {
  cardTakesStepTiming,
  durationForStep,
  writeStepDuration,
} from "./step-duration.ts";
import {
  SIGNING_LIST_FILE,
  buildSigningList,
  parseTickedIds,
  renderSigningList,
} from "./signing-list.ts";
import { mergeAudits, renderReport, summarize } from "./audit/report.ts";
import { readAuditState, writeAuditState, AUDIT_VERSION } from "./audit/state.ts";
import { enrichIssues } from "./audit/enrich.ts";
import { judgeCard, SLOT_LABELS, type Slot } from "./slot.ts";
import type { ArticleAudit } from "./audit/index.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONTENT = path.join(ROOT, "content");
const CARDS_DIR = path.join(CONTENT, "cards");
const SOURCE_DIR = path.join(CONTENT, "source");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  return process.argv[i + 1];
}
const has = (name: string) => process.argv.includes(`--${name}`);

/**
 * 本地日期（YYYY-MM-DD）。
 *
 * 不能用 toISOString()：那是 UTC —— 在东八区的凌晨 0 点到 8 点签字，
 * 日期会记成前一天，审计链上一天有三分之一是错的。
 */
function localDate(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 并发数：参数写错就报错，别静默变成 0。
 *
 * Number("abc") 是 NaN，NaN 传进 Array.from({length}) 会得到空数组 ——
 * 一个 worker 都不起，命令却报「成功 0 篇」并以 0 退出。
 */
function parseConcurrency(fallback = 4): number | null {
  const raw = arg("concurrency");
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

function fmtBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

// ------------------------------------------------------------------ import

async function cmdImport(): Promise<number> {
  const blog = arg("blog");
  if (!blog) {
    console.error("用法：content import --blog <blog 仓库路径> [--commit <sha>] [--dry-run]");
    return 2;
  }
  const report = await runImport({
    blogDir: path.resolve(blog),
    contentDir: CONTENT,
    commit: arg("commit"),
    dryRun: has("dry-run"),
  });

  console.log(`\n快照导入${has("dry-run") ? "（试运行，未写入）" : ""}`);
  console.log(`  commit   ${report.commit}`);
  console.log(`  日期     ${report.date}`);
  console.log(`  正文     ${report.articles} 篇`);
  console.log(
    `  图片     ${report.imagesDownloaded}/${report.imagesFound} 张，合计 ${fmtBytes(report.totalImageBytes)}`,
  );
  if (report.imagesFailed.length) {
    console.log(`  ❌ 下载失败 ${report.imagesFailed.length} 张：`);
    for (const f of report.imagesFailed.slice(0, 20)) {
      console.log(`     ${f.reason}  ${f.url}`);
    }
  }
  console.log(
    `\n  写盘：source ${report.written.source} 个文件，media ${report.written.media} 个文件`,
  );
  return report.imagesFailed.length ? 1 : 0;
}

// ------------------------------------------------------------------- check

function loadBusyBudget(): BusyBudget | null {
  const p = path.join(CONTENT, "busy-budget.yaml");
  if (!fs.existsSync(p)) return null;
  return parseYaml(fs.readFileSync(p, "utf8")) as BusyBudget;
}

function cmdCheck(): number {
  const findings: Finding[] = [];

  // 快照本身要先在，否则「0 篇 0 卡 0 错」是空跑绿——正是这个项目要避免的假绿。
  const sourceLockPath = path.join(SOURCE_DIR, "SOURCE.lock");
  if (!fs.existsSync(sourceLockPath)) {
    findings.push({
      rule: "SNAPSHOT",
      level: "error",
      file: "content/source/SOURCE.lock",
      message: "快照不存在，先跑一次 content import",
    });
  } else {
    const lock = JSON.parse(fs.readFileSync(sourceLockPath, "utf8"));
    const n = Object.keys(lock.files ?? {}).length;
    if (n === 0) {
      findings.push({
        rule: "SNAPSHOT",
        level: "error",
        file: "content/source/SOURCE.lock",
        message: "快照里没有文章",
      });
    } else {
      console.log(`  快照 ${lock.commit?.slice(0, 8) ?? "?"} · ${n} 篇 · ${lock.date ?? ""}`);
    }
  }

  // R13 快照完整性：快照被改过却没有勘误记录 → 静默漂移
  findings.push(...checkSnapshotIntegrity({ contentDir: CONTENT }));

  const loaded = loadAllCards(CARDS_DIR);
  const all = loaded.map((l) => l.data);

  // R15 默认清单：App 首启要放的那几张，都得在、都得已签字
  findings.push(...checkDefaultRoutine(CONTENT, all));

  // 结构层面（schema）
  for (const l of loaded) {
    for (const e of l.schemaErrors) {
      findings.push({
        rule: "SCHEMA",
        level: "error",
        file: l.file,
        message: e,
      });
    }
  }

  // 规则层面
  for (const l of loaded) {
    // 结构不合法的文件：规则层会直接崩（remind.quote 之类），
    // 而结构错上面已经报过了 —— 这一轮跳过，别让它盖掉真正的错。
    if (l.schemaErrors.length) continue;
    const articlePath = path.join(SOURCE_DIR, l.data.article);
    if (!fs.existsSync(articlePath)) {
      findings.push({
        rule: "R8",
        level: "error",
        file: l.file,
        message: `快照里没有这篇文章：${l.data.article}`,
      });
      continue;
    }
    const source = parseMarkdown(fs.readFileSync(articlePath, "utf8"));
    const ctx = {
      article: l.data,
      source,
      all,
      contentDir: CONTENT,
      file: l.file,
    };
    for (const { rule } of ALL_RULES) findings.push(...rule(ctx));
  }

  // R12 审阅签字
  for (const l of loaded) {
    for (const card of l.data.cards) {
      const r = checkReviewSignature(card);
      if (!r.ok) {
        findings.push({
          rule: "R12",
          level: "error",
          file: l.file,
          cardId: card.id,
          path: "review",
          message: r.reason ?? "",
        });
      }
    }
  }

  // R7 忙档预算（跨篇）
  const busy = checkBusyBudget(loadBusyBudget(), all);
  if (!busy.ok) {
    findings.push({
      rule: "R7",
      level: "error",
      file: "busy-budget.yaml",
      message: busy.reason ?? "",
    });
  }

  // 报告
  const errors = findings.filter((f) => f.level === "error");
  const warnings = findings.filter((f) => f.level === "warning");
  const reportMd = [
    `# 内容校验报告`,
    ``,
    `生成时间：${new Date().toISOString()}`,
    ``,
    `文章 ${loaded.length} 篇 · 卡片 ${all.reduce((n, a) => n + a.cards.length, 0)} 张`,
    `错误 ${errors.length} · 警告 ${warnings.length}`,
    ``,
    ...(errors.length ? ["## 错误", "", ...errors.map(fmtFinding), ""] : []),
    ...(warnings.length ? ["## 警告", "", ...warnings.map(fmtFinding), ""] : []),
  ].join("\n");
  fs.writeFileSync(path.join(CONTENT, "report.md"), reportMd, "utf8");
  fs.writeFileSync(
    path.join(CONTENT, "report.json"),
    JSON.stringify({ findings, errorCount: errors.length, warningCount: warnings.length }, null, 2) + "\n",
    "utf8",
  );

  console.log(`\n内容校验`);
  console.log(`  文章 ${loaded.length} 篇 · 卡片 ${all.reduce((n, a) => n + a.cards.length, 0)} 张`);
  console.log(`  错误 ${errors.length} · 警告 ${warnings.length}`);
  for (const f of errors.slice(0, 30)) console.log("  " + fmtFinding(f));
  if (errors.length > 30) console.log(`  …… 其余 ${errors.length - 30} 条见 content/report.md`);
  for (const f of warnings.slice(0, 10)) console.log("  " + fmtFinding(f));
  if (warnings.length > 10) console.log(`  …… 其余 ${warnings.length - 10} 条警告见 content/report.md`);

  return errors.length ? 1 : 0;
}

function fmtFinding(f: Finding): string {
  const mark = f.level === "error" ? "❌" : "⚠";
  const where = [f.file, f.cardId, f.path].filter(Boolean).join(" · ");
  return `${mark} [${f.rule}] ${where}  ${f.message}`;
}

// ------------------------------------------------------------------- build

async function cmdBuild(): Promise<number> {
  const loaded = loadAllCards(CARDS_DIR);
  // 有文件读不出来（yaml 坏掉 / 结构不合法）：**别写产物** ——
  // 写出来的 cards.json 少了那篇的卡，而上一版的产物还躺在盘上看着像新的。
  const broken = loaded.filter((l) => l.schemaErrors.length);
  if (broken.length) {
    console.error(`有 ${broken.length} 个卡片文件读不出来，先改好再构建：`);
    for (const l of broken) {
      console.error(`  ${path.relative(ROOT, l.file).replace(/\\/g, "/")}  ${l.schemaErrors[0]}`);
    }
    return 1;
  }
  const all = loaded.map((l) => l.data);
  // 手册全文先建：cards.json 要带一份轻量目录（path/title/kind），
  // 手册列表才能不取 800 KB 全文就先画出来。
  const manual = buildManual(all, CONTENT);
  const bundle = buildBundle(
    all,
    CONTENT,
    manual.articles.map(({ path, title, kind }) => ({ path, title, kind })),
  );
  const outDir = path.join(ROOT, "app", "public");
  fs.mkdirSync(outDir, { recursive: true });
  // **紧凑输出，不缩进**：这两个文件是给机器读的（卡片文件每次启动都要取）。
  // 2 空格缩进会让 cards.json 从 534 KB 涨到 750 KB、manual.json 从 811 KB 涨到 844 KB ——
  // 缩进是给人看的，这里没有人看；卡片文件每次启动会白传两百多 KB。
  fs.writeFileSync(path.join(outDir, "cards.json"), JSON.stringify(bundle) + "\n", "utf8");

  // 手册全文：给「手册浏览」用。与 cards.json 分开是因为两者更新频率不同 ——
  // 手册全文跟着快照走，卡片跟着审阅走。
  fs.writeFileSync(path.join(outDir, "manual.json"), JSON.stringify(manual) + "\n", "utf8");

  // 把用到的图片拷进 app/public/media/。图片与 App 同源才能被 Service Worker
  // 正常预缓存——跨域图片只能存不透明响应，配额占用还大，离线就不可用。
  const mediaDir = path.join(outDir, "media");
  fs.mkdirSync(mediaDir, { recursive: true });
  const used = new Set([
    ...collectMediaFiles(all, CONTENT),
    ...collectManualMediaFiles(CONTENT),
  ]);
  let copied = 0;
  for (const file of used) {
    const src = path.join(CONTENT, "media", file);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(mediaDir, file));
    copied++;
  }

  console.log(`\n构建 cards.json：${bundle.cards.length} 张卡（只含签字有效的 reviewed）`);
  console.log(`  手册 ${manual.articles.length} 篇 → manual.json`);
  console.log(`  图片 ${copied}/${used.size} 个已拷入 app/public/media/`);
  if (has("optimize-media")) {
    const opt = await optimizeMediaFiles(mediaDir);
    const saved = opt.before - opt.after;
    const pct = opt.before ? Math.round((saved / opt.before) * 100) : 0;
    console.log(
      `  图片优化：${opt.changed}/${opt.files} 张重编码，${(opt.before / 1024).toFixed(0)} → ${(opt.after / 1024).toFixed(0)} KB（省 ${pct}%）`,
    );
    if (opt.failed) console.log(`  ⚠ ${opt.failed} 张读不出来，保持原样：${opt.firstError}`);
  }
  // 构建时间**不进产物**：产物每多一个随时间变的字段，Service Worker 的
  // 预缓存 revision 就跟着变一次 —— 内容没变，用户却要重下 1.3 MB。
  console.log(`  构建于 ${new Date().toISOString()}`);
  return 0;
}

// ------------------------------------------------------------------ review

function cmdReview(): number {
  const by = arg("by");
  const all = has("all");
  const resign = has("resign");
  const dryRun = has("dry-run");
  const cardId = process.argv[3];
  const listFile = arg("list");
  if (!by || (!all && !cardId && !listFile)) {
    console.error("用法：content review <cardId> --by <名字>");
    console.error("      content review --all --by <名字>   # 签所有 draft 卡");
    console.error("      content review --list <清单.md> --by <名字>   # 签清单里勾上的那些");
    console.error("      content review <cardId> --by <名字> --resign   # 改过之后重新签");
    console.error("      任何一条都可以加 --dry-run：只说要签哪几张，不写盘");
    return 2;
  }
  // 清单：勾上的 `- [x] <id>` 行就是要签的那些
  let wanted: string[] | null = null;
  if (listFile) {
    const p = path.isAbsolute(listFile) ? listFile : path.join(ROOT, listFile);
    if (!fs.existsSync(p)) {
      console.error(`找不到清单文件：${listFile}`);
      return 2;
    }
    wanted = parseTickedIds(fs.readFileSync(p, "utf8"));
    if (!wanted.length) {
      console.error("清单里没有勾上的卡（把 `- [ ]` 改成 `- [x]` 再来）");
      return 1;
    }
  }
  const loaded = loadAllCards(CARDS_DIR);
  let signed = 0;
  let skipped = 0;

  /** 同一个 id 出现在几张卡上：签它等于签了不止一张。 */
  const idCount = new Map<string, number>();
  for (const l of loaded) {
    for (const c of l.data.cards) idCount.set(c.id, (idCount.get(c.id) ?? 0) + 1);
  }

  for (const l of loaded) {
    // 结构不合法的文件不能签：签了以后 content build 会在剥引文时崩，
    // 崩在写 cards.json 之前 —— 产物还留在上一版，看着却像新的。
    if (l.schemaErrors.length) {
      for (const c of l.data.cards) {
        if (!all && !wanted && c.id !== cardId) continue;
        if (wanted && !wanted.includes(c.id)) continue;
        console.error(
          `跳过 ${c.id}：${l.file} 的结构不合法（${l.schemaErrors[0]}）—— 先把结构改对再签`,
        );
        skipped++;
      }
      continue;
    }
    for (let idx = 0; idx < l.data.cards.length; idx++) {
      const card = l.data.cards[idx];
      if (!all && !wanted && card.id !== cardId) continue;
      if (wanted && !wanted.includes(card.id)) continue;
      // 同一个 id 有好几张卡：别把它们一起签了（签字是「这张卡被人看过」的保证）
      if ((idCount.get(card.id) ?? 0) > 1) {
        console.error(
          `跳过 ${card.id}：这个 id 有 ${idCount.get(card.id)} 张卡，签字会一起签掉 —— 先把 id 改开`,
        );
        skipped++;
        continue;
      }
      // 已签字的卡要重签必须明说（--resign）：R12 存在的意义就是
      // 「卡被改过而没人再确认」，一声不吭地重签正好把它废掉。
      if (card.status === "reviewed" && card.review && !resign) {
        skipped++;
        continue;
      }

      // 用 Document API 而不是 parse + stringify：后者会把文件里的注释全部丢掉。
      // 注释在卡片文件里不是装饰——ignore 清单里「为什么不抽这条」的理由，
      // 全靠它记录，签字时冲掉就等于把判断依据也冲掉了。
      const doc = parseDocument(fs.readFileSync(l.file, "utf8"));
      card.status = "reviewed";
      card.review = {
        by,
        date: localDate(),
        hash: fingerprint(card),
      };
      if (dryRun) {
        console.log(`将要签字：${card.id}  by ${by}  hash ${card.review.hash}`);
        signed++;
        continue;
      }
      doc.setIn(["cards", idx, "status"], "reviewed");
      doc.setIn(["cards", idx, "review"], card.review);
      fs.writeFileSync(l.file, doc.toString({ lineWidth: 0 }), "utf8");
      console.log(`已签字：${card.id}  by ${by}  hash ${card.review.hash}`);
      signed++;
    }
  }

  if (!signed) {
    console.error(
      all
        ? "没有需要签字的 draft 卡"
        : wanted
          ? "清单里勾上的卡都签过了（要重签加 --resign）"
          : `找不到卡片：${cardId}`,
    );
    return 1;
  }
  console.log(dryRun ? `将要签 ${signed} 张（没写盘）` : `共签 ${signed} 张`);
  if (skipped) console.log(`跳过 ${skipped} 张（已签字；要重签加 --resign）`);
  return 0;
}

// -------------------------------------------------------------- signing-list

/**
 * 生成待签字清单。
 *
 * 把审阅报告里「没发现问题」的卡按篇排成一份能逐条勾的单子 ——
 * 签字是逐条过的事，报告是给机器读的。
 */
function cmdSigningList(): number {
  const loaded = loadAllCards(CARDS_DIR);
  const state = readAuditState(CONTENT);
  const okIds = new Set<string>();
  for (const [, a] of state) {
    for (const c of a.cards) {
      if (!c.issues?.length) okIds.add(c.cardId);
    }
  }
  if (!okIds.size) {
    console.error("审阅状态里没有「没发现问题」的卡 —— 先跑一次 content audit");
    return 1;
  }
  const { entries, articles } = buildSigningList(loaded, okIds, CONTENT);
  const out = path.join(CONTENT, SIGNING_LIST_FILE);
  fs.writeFileSync(out, renderSigningList(entries), "utf8");
  console.log(
    `待签字清单：${entries.length} 张 · ${articles} 篇 → ${path.relative(ROOT, out).replace(/\\/g, "/")}`,
  );
  console.log(
    "勾上 `- [x]` 之后：npm run content:review -- --list content/signing-list.md --by 你的名字",
  );
  return 0;
}

// ------------------------------------------------------------------- draft

/**
 * 起草：LLM 出草稿 → 机器自检 → 写 status: draft 的卡片文件。
 *
 * 起草工具只写 draft：签字是人的事（`content review`）。
 * 试运行（--dry-run）不联网、不写盘，只报计划。
 */
async function cmdDraft(): Promise<number> {
  const all = has("all");
  const dryRun = has("dry-run");
  const arg3 = process.argv[3];
  const articleArg = arg3 && !arg3.startsWith("--") ? arg3 : undefined;

  if (!all && !articleArg) {
    console.error("用法：content draft <文章路径> [--dry-run] [--concurrency N]");
    console.error("      content draft --all [--dry-run]   # 起草所有还没有卡文件的文章");
    return 2;
  }

  let articles: string[];
  if (all) {
    articles = listArticles(SOURCE_DIR).filter(
      (rel) => !fs.existsSync(targetFor(CARDS_DIR, rel)),
    );
  } else {
    let rel: string | null;
    try {
      rel = resolveArticle(articleArg!, SOURCE_DIR);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      return 2;
    }
    if (!rel) {
      console.error(`快照里找不到这篇文章：${articleArg}`);
      return 2;
    }
    articles = [rel];
  }

  console.log(`\n起草卡片${dryRun ? "（试运行，未联网、未写盘）" : ""}`);
  console.log(`  待处理 ${articles.length} 篇`);
  if (!articles.length) {
    console.log("  没有待起草的文章");
    return 0;
  }

  // 凭据：试运行不联网，因此不需要
  let client: LlmClient;
  if (dryRun) {
    client = {
      complete: async () => {
        throw new Error("试运行不调用 LLM");
      },
    };
  } else {
    const { config, missing } = loadLlmConfig(CONTENT);
    if (!config) {
      console.error("缺少 LLM 凭据：");
      for (const m of missing) console.error(`  · ${m}`);
      console.error("");
      console.error("任选一种设置方式：");
      console.error("  1. 环境变量 LLM_BASE_URL / LLM_API_KEY / LLM_MODEL");
      console.error('  2. content/llm.local.json：{ "baseUrl": "...", "apiKey": "...", "model": "..." }');
      return 2;
    }
    client = createLlmClient(config);
  }

  let ok = 0;
  let failed = 0;
  let skipped = 0;
  let cardCount = 0;

  // 一篇要 100～200 秒，上百篇串行是几小时 —— 太慢，没人会等。
  // 并发跑：worker + cursor，与 import.ts 里下载图片同一个写法。
  const concurrency = parseConcurrency();
  if (concurrency === null) {
    console.error(`--concurrency 要是一个正整数（收到「${arg("concurrency")}」）`);
    return 2;
  }
  if (all && !dryRun) console.log(`  并发 ${concurrency}`);

  function report(outcome: Awaited<ReturnType<typeof draftArticle>>): void {
    const target = path.relative(ROOT, outcome.target).replace(/\\/g, "/");
    const errors = outcome.findings.filter((f) => f.level === "error");
    const warnings = outcome.findings.filter((f) => f.level === "warning");

    if (outcome.action === "failed") {
      failed++;
      console.log(`  ❌ ${outcome.article}：${outcome.error ?? "失败"}`);
      for (const f of errors.slice(0, 8)) {
        console.log(`     [${f.rule}] ${[f.cardId, f.path].filter(Boolean).join(" · ")}  ${f.message}`);
      }
      if (errors.length > 8) console.log(`     …… 其余 ${errors.length - 8} 条错误见上`);
      return;
    }
    if (outcome.action === "skip") {
      skipped++;
      console.log(`  ⏭ ${outcome.article}：${outcome.error ?? "跳过"}`);
      return;
    }

    ok++;
    cardCount += outcome.cards;
    const verb = outcome.dryRun
      ? "将写入"
      : outcome.action === "append"
        ? "已追加"
        : "已写入";
    console.log(`  ✅ ${outcome.article}：${verb} ${outcome.cards} 张 draft 卡 → ${target}`);
    for (const f of warnings.slice(0, 5)) {
      console.log(`     ⚠ [${f.rule}] ${[f.cardId, f.path].filter(Boolean).join(" · ")}  ${f.message}`);
    }
  }

  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= articles.length) return;
      const rel = articles[i];
      try {
        const outcome = await draftArticle(rel, {
          contentDir: CONTENT,
          cardsDir: CARDS_DIR,
          sourceDir: SOURCE_DIR,
          client,
          dryRun,
        });
        report(outcome);
      } catch (err) {
        // 单篇出错不该让整批停下：记下来，继续下一篇
        failed++;
        console.log(`  ❌ ${rel}：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, articles.length) }, worker),
  );

  console.log(`\n  成功 ${ok} 篇（${cardCount} 张卡）· 失败 ${failed} 篇 · 跳过 ${skipped} 篇`);
  if (ok && !dryRun) console.log("  卡片是草稿：审阅后用 content review <cardId> --by <名字> 签字");
  return failed ? 1 : 0;
}

// -------------------------------------------------------------------- audit

/**
 * 审阅辅助：把「该人看的」挑出来，其余的让审阅者快速扫过。
 *
 * 它**不签字**（签字是人的判断，AGENTS.md §4.3），只出报告。
 */
async function cmdAudit(): Promise<number> {
  const only = arg("article");
  const noLlm = has("no-llm");
  const loaded = loadAllCards(CARDS_DIR);

  let articles = loaded.map((l) => l.data);
  if (only) {
    const rel = resolveArticle(only, SOURCE_DIR);
    if (!rel) {
      console.error(`快照里找不到这篇文章：${only}`);
      return 2;
    }
    articles = articles.filter((a) => a.article === rel);
  }
  // 已签字的卡不用再审
  articles = articles
    .map((a) => ({ ...a, cards: a.cards.filter((c) => c.status !== "reviewed") }))
    .filter((a) => a.cards.length);

  if (!articles.length) {
    console.log("\n没有待审的草稿卡。");
    return 0;
  }

  const sources = new Map<string, ReturnType<typeof parseMarkdown>>();
  for (const a of articles) {
    const p = path.join(SOURCE_DIR, a.article);
    if (fs.existsSync(p)) sources.set(a.article, parseMarkdown(fs.readFileSync(p, "utf8")));
  }

  // 全部卡片（不只是这次要审的）：补引文与卡片文字时要用，
  // 早先审过的篇也得能补上。
  const allCards = new Map<string, Card>();
  for (const l of loadAllCards(CARDS_DIR)) {
    for (const c of l.data.cards) allCards.set(c.id, c);
  }

  // 续跑：语义检查要几十分钟，凭据还可能中途过期。已审过的篇跳过，
  // 换一份凭据再跑一次就补齐了 —— 跟抽取流水线一个道理。
  const resume = has("resume");
  const previous = readAuditState(CONTENT);
  if (resume && previous.size) {
    // 语义检查失败的篇不算「审过」：凭据过期时它们是空跑，得重来。
    // 工具版本对不上的也要重审：老版本是按老标准判的。
    const failed = (a: ArticleAudit) =>
      a.cards.some((c) => c.cardId === "(语义检查失败)");
    const before = articles.length;
    articles = articles.filter((a) => {
      const done = previous.get(a.article);
      if (!done) return true;
      if (failed(done)) return true;
      return done.version !== AUDIT_VERSION;
    });
    console.log(`  续跑：跳过已审的 ${before - articles.length} 篇`);
    if (!articles.length) {
      console.log("  没有待审的篇。");
      return 0;
    }
  }

  let client: LlmClient | undefined;
  if (!noLlm) {
    const { config, missing } = loadLlmConfig(CONTENT);
    if (!config) {
      console.error("缺少 LLM 凭据，语义检查做不了（机械检查照跑）：");
      for (const m of missing) console.error(`  · ${m}`);
    } else {
      client = createLlmClient(config);
    }
  }

  console.log(`\n审阅辅助：${articles.length} 篇 · ${client ? "机械 + 语义" : "仅机械"}`);
  const reportPath = path.join(CONTENT, "audit-report.md");
  const writeReport = (r: Parameters<typeof renderReport>[0]) =>
    fs.writeFileSync(reportPath, renderReport(r, new Date().toISOString()), "utf8");

  // 只重排报告，不重审：进度里已有的结论原样保留，只补上引文与卡片文字。
  // （用 --no-llm 重跑会把语义结论冲掉 —— 机械检查不知道语义。）
  if (has("report-only")) {
    const previousOnly = mergeAudits(
      [...previous.values()],
      [],
    );
    const enrichedOnly = enrichIssues(previousOnly.articles, allCards);
    const report = { ...previousOnly, articles: enrichedOnly };
    writeReport(report);
    writeAuditState(CONTENT, enrichedOnly);
    console.log("");
    for (const line of summarize(report)) console.log(line);
    console.log(
      `\n共 ${report.stats.cards} 张卡 · 没发现问题 ${report.stats.ok} · 意思不对 ${report.stats.suspect} · 引文没覆盖全 ${report.stats.narrow} · 重复 ${report.stats.duplicate}`,
    );
    console.log(`报告：${path.relative(ROOT, reportPath).replace(/\\/g, "/")}`);
    return 0;
  }

  const auditConcurrency = parseConcurrency();
  if (auditConcurrency === null) {
    console.error(`--concurrency 要是一个正整数（收到「${arg("concurrency")}」）`);
    return 2;
  }

  const result = await runAudit({
    articles,
    sources,
    client,
    concurrency: auditConcurrency,
    onProgress: (done, total) => {
      if (done === total || done % 10 === 0) console.log(`  … ${done}/${total} 篇`);
    },
    // 语义检查要跑几十分钟，报告与进度都边跑边写 —— 中途断了也不丢已审的部分。
    // 合并后再写：续跑时之前审过的篇也在报告里，中途停了也不缺篇。
    onPartial: (partial) => {
      const soFar = mergeAudits([...previous.values()], partial.articles);
      const withText = enrichIssues(soFar.articles, allCards);
      writeReport({ ...soFar, articles: withText });
      writeAuditState(CONTENT, withText);
    },
  });

  // 续跑时把之前审过的结论并回来：报告要回答「全部审出了什么」，
  // 不是「这次审了什么」。
  //
  // 合并后统一补上引文与卡片文字：这些是卡片里的既有内容，不用再问模型，
  // 早先审过的篇也能立刻变成能一眼看完的样子。
  const merged = mergeAudits([...previous.values()], result.articles);
  const enriched = enrichIssues(merged.articles, allCards);
  const final = { ...merged, articles: enriched };
  writeReport(final);
  writeAuditState(CONTENT, enriched);

  console.log("");
  for (const line of summarize(final)) console.log(line);
  console.log(
    `\n共 ${final.stats.cards} 张卡 · 没发现问题 ${final.stats.ok} · 意思不对 ${final.stats.suspect} · 引文没覆盖全 ${final.stats.narrow} · 重复 ${final.stats.duplicate}`,
  );
  console.log(`报告：${path.relative(ROOT, reportPath).replace(/\\/g, "/")}`);
  console.log("签字是人的判断：npm run content:review -- <cardId> --by <名字>");
  return 0;
}

// ---------------------------------------------------------------- 补引文

/**
 * 把审阅报告里「引文没覆盖全」的卡的引文补齐。
 *
 * 那些卡的意思没错，只是引文引窄了（多半漏了「起始姿势」那一段）。
 * 这里不改卡片的话 —— 那是内容判断 —— 只把原文里那一段也引进去。
 * 补完重跑一次审阅就知道有没有补对。
 *
 * 只动 draft 卡：reviewed 的是人工成果，改了得重签，不在这里碰。
 */
function cmdRepairQuotes(): number {
  const state = readAuditState(CONTENT);
  const loaded = loadAllCards(CARDS_DIR);

  // 报告里挑出「引文没覆盖全」的问题
  const jobs: { cardId: string; field: string; text: string }[] = [];
  for (const [, a] of state) {
    for (const c of a.cards) {
      for (const i of c.issues) {
        if (i.verdict !== "narrow") continue;
        if (!i.path?.endsWith(".text") || !i.text) continue;
        jobs.push({ cardId: c.cardId, field: i.path.replace(/\.text$/, ""), text: i.text });
      }
    }
  }
  if (!jobs.length) {
    console.log("没有待补的引文。");
    return 0;
  }

  // 按卡片文件分组（一个文件一次读写，注释才不丢）
  const byFile = new Map<string, { l: (typeof loaded)[number]; jobs: typeof jobs }>();
  for (const l of loaded) {
    const fileJobs = jobs.filter((j) => l.data.cards.some((c) => c.id === j.cardId));
    if (fileJobs.length) byFile.set(l.file, { l, jobs: fileJobs });
  }

  let fixed = 0;
  let missed = 0;
  for (const [, { l, jobs: fileJobs }] of byFile) {
    const srcPath = path.join(SOURCE_DIR, l.data.article);
    if (!fs.existsSync(srcPath)) {
      console.error(`快照里找不到原文：${l.data.article}`);
      continue;
    }
    const source = parseMarkdown(fs.readFileSync(srcPath, "utf8"))
      .sections.map((s) => s.text)
      .join("\n");

    // 用 Document API 而不是 parse + stringify：后者会把文件里的注释全部丢掉，
    // 而 ignore 清单里「为什么不抽这条」的理由正是靠注释记录着的。
    const doc = parseDocument(fs.readFileSync(l.file, "utf8"));
    let touched = false;

    for (const j of fileJobs) {
      const idx = l.data.cards.findIndex((c) => c.id === j.cardId);
      if (idx < 0) continue;
      const card = l.data.cards[idx];
      if (card.status === "reviewed") continue; // 人工成果不碰

      const next = extendQuote(card, j.field, j.text, source);
      if (!next) {
        console.log(`  找不到能覆盖的原文：${j.cardId} · ${j.field}`);
        missed++;
        continue;
      }
      if (j.field === "remind") {
        doc.setIn(["cards", idx, "remind", "quote"], next);
      } else if (j.field.startsWith("steps.")) {
        const stepId = j.field.slice("steps.".length);
        const stepIdx = (card.steps ?? []).findIndex((s) => s.id === stepId);
        if (stepIdx < 0) continue;
        doc.setIn(["cards", idx, "steps", stepIdx, "quote"], next);
      } else {
        continue;
      }
      console.log(`  补了引文：${j.cardId} · ${j.field} ← ${next[next.length - 1]}`);
      fixed++;
      touched = true;
    }

    if (touched) fs.writeFileSync(l.file, doc.toString({ lineWidth: 0 }), "utf8");
  }

  console.log(`\n补了 ${fixed} 处引文，${missed} 处没找到能覆盖的原文`);
  console.log("重跑一次审阅确认：npm run content:audit -- --resume");
  return 0;
}

// ---------------------------------------------------------------- 时段检查

/**
 * 逐篇检查每张卡的时段标注。
 *
 * slot 是策展，但依据在原文里。这个命令把卡的引文定位回原文小节，
 * 只在小节范围内找时间线索，把「线索句」原样摆出来 ——
 * 判断留给人，机器只负责把证据摆齐、别让人漏看。
 *
 * 报告：content/slot-report.md（按篇排，每篇一张表）。
 */
function cmdSlotCheck(): number {
  const loaded = loadAllCards(CARDS_DIR);
  const out: string[] = [
    "# 时段检查报告",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
  ];
  let total = 0;
  let diff = 0;
  const diffs: string[] = [];

  for (const l of loaded) {
    // 疾病类不许有 slot（R10），不查
    if (l.data.kind === "condition") continue;
    const srcPath = path.join(SOURCE_DIR, l.data.article);
    if (!fs.existsSync(srcPath)) continue;
    const source = parseMarkdown(fs.readFileSync(srcPath, "utf8"));

    const rows = l.data.cards.map((c) => judgeCard(c, l.data, source));
    if (!rows.length) continue;
    total += rows.length;

    out.push(`## ${l.data.article}`);
    out.push("");
    out.push("| 卡 | 现状 | 建议 | 依据 |");
    out.push("| --- | --- | --- | --- |");
    for (const r of rows) {
      const mark = r.current === r.proposed ? "" : " ⚠";
      out.push(
        `| \`${r.cardId}\` | ${SLOT_LABELS[r.current]} | ${SLOT_LABELS[r.proposed]}${mark} | ${r.reason} |`,
      );
      for (const e of r.evidence) out.push(`| | | | ↳ ${e.slice(0, 60)} |`);
      if (r.current !== r.proposed) {
        diff++;
        diffs.push(
          `${l.data.article} · ${r.cardId}：${SLOT_LABELS[r.current]} → ${SLOT_LABELS[r.proposed]}（${r.reason}）`,
        );
      }
    }
    out.push("");
  }

  const reportPath = path.join(CONTENT, "slot-report.md");
  fs.writeFileSync(reportPath, out.join("\n") + "\n", "utf8");

  const bySlot: Record<string, number> = {};
  for (const l of loaded) {
    for (const c of l.data.cards) {
      if (l.data.kind === "condition") continue;
      const k = c.slot ?? "anytime";
      bySlot[k] = (bySlot[k] ?? 0) + 1;
    }
  }
  console.log(`\n时段检查：${total} 张卡`);
  console.log(
    `  现状：${Object.entries(bySlot).map(([k, v]) => `${SLOT_LABELS[k as Slot] ?? k} ${v}`).join(" · ")}`,
  );
  console.log(`  建议与现状不同：${diff} 张`);
  console.log(`报告：${path.relative(ROOT, reportPath).replace(/\\/g, "/")}`);
  return 0;
}

// ---------------------------------------------------------------- 近似检查

/**
 * 把「原文写了约、卡上没标」的剂量行列成待办。
 *
 * 原文写「来回轻柔地洗**约** 5 次」，屏上写「5 次」—— 把近似说成定值，
 * 是内容层最要紧的一类失真（实测 39 张卡、56 行剂量这样，其中一张是服药周期；
 * 2026-10-28 已全部标上 `approximate: true` 并重签，这条命令现在是 0 行）。
 *
 * App 判不出来：它手里只有剂量行与那句提醒，而提醒与剂量引文往往不是同一句话
 * （实测 56 处里只有 7 处能从提醒里看出那个「约」）。所以要内容层把这件事记下来：
 * 剂量行加 `approximate: true`，屏上就显示「约」。
 *
 * 这个命令只列待办，不改卡 —— 改卡要重签（R12），签字是人的活。
 * 报告：content/approx-report.md。
 */
function cmdApproxCheck(): number {
  const loaded = loadAllCards(CARDS_DIR);
  const out: string[] = [
    "# 近似值检查报告",
    "",
    `生成时间：${new Date().toISOString()}`,
    "",
    "原文写「约 / 大约 / 左右」而卡上没标 `approximate` 的剂量行。",
    "屏上现在把近似说成定值 —— 在那行 dose 上加 `approximate: true` 即可。",
    "",
  ];
  let rows = 0;
  let cards = 0;

  for (const l of loaded) {
    for (const c of l.data.cards) {
      // 每张卡一张自己的表：lines 必须开在卡片循环里面 ——
      // 放在外面的话，后面那张卡的表里会混进前面那张卡的行
      // （实测：同一篇里第二张卡会列出第一张卡的剂量行，看着像它自己也有那些行）。
      const lines: string[] = [];
      let hit = 0;
      for (const [i, d] of (c.dose ?? []).entries()) {
        const quotes = Array.isArray(d.quote) ? d.quote : [d.quote];
        const has = quotes.some((q) => approximationAttached(q, d.value, d.valueMax));
        if (!has || d.approximate) continue;
        // what 里已经带了近似词 —— 屏上已经是对的了，不进待办
        if (/约|大约|左右|上下|前后|差不多/.test(d.what)) continue;
        hit++;
        rows++;
        lines.push(
          `| \`dose[${i}]\` | ${d.value}${d.valueMax !== undefined ? "～" + d.valueMax : ""} ${d.unit} | ${d.what} | ${quotes.join(" / ")} |`,
        );
      }
      if (!hit) continue;
      cards++;
      out.push(`## ${c.id}`);
      out.push("");
      out.push(
        `卡文件：\`${path.relative(ROOT, l.file).replace(/\\/g, "/")}\`（改动后要重签：\`npm run content:review ${c.id} --by <名字> --resign\`）`,
      );
      out.push("");
      out.push("| 位置 | 屏上现在显示 | 这一行是什么 | 原文引文 |");
      out.push("| --- | --- | --- | --- |");
      out.push(...lines);
      out.push("");
    }
  }

  const reportPath = path.join(CONTENT, "approx-report.md");
  fs.writeFileSync(reportPath, out.join("\n") + "\n", "utf8");
  console.log(`\n近似值检查：${cards} 张卡 · ${rows} 行剂量`);
  console.log("  那些行在屏上把「约」说成了定值；加 approximate: true 即可（改完要重签）。");
  console.log(`报告：${path.relative(ROOT, reportPath).replace(/\\/g, "/")}`);
  return 0;
}

// -------------------------------------------------------------------- 步级时长

/**
 * 步级时长：列出（或写入）每一步该做多久。
 *
 * 默认只列不改 —— 认定时长是**内容判断**，机器只能给候选。
 * `--apply` 才会写盘，且只写 confidence=sure 的那些（机器拿不准的留给��看）。
 * 写完要重签：改过已签字的卡，R12 的指纹就失效了。
 */
function cmdStepDuration(): number {
  const apply = has("apply");
  const only = arg("card");
  // --overwrite：改裁定后重写已有的值。默认不动已有的 ——
  // 那样「先写盘、后改裁定」这条路走不通，得手工去 YAML 里删。
  const overwrite = has("overwrite");
  const loaded = loadAllCards(CARDS_DIR);

  let sure = 0;
  let unsure = 0;
  const touchedFiles = new Set<string>();

  for (const l of loaded) {
    for (const c of l.data.cards) {
      if (only && c.id !== only) continue;
      const steps = c.steps ?? [];
      if (!cardTakesStepTiming(steps, l.data.kind)) continue;
      for (const s of steps) {
        if (s.duration && !overwrite) continue;
        const quotes = Array.isArray(s.quote) ? s.quote : s.quote ? [s.quote] : [];
        const pick = durationForStep(s.text, quotes, c.id, s.id);
        if (!pick) continue;
        if (pick.confidence === "unsure") {
          unsure++;
          continue;
        }
        sure++;
        if (!apply) continue;
        if (writeStepDuration(l.file, c.id, s.id, pick)) {
          touchedFiles.add(l.file);
          console.log(`  ${c.id}/${s.id}  ${pick.sec} 秒${pick.approximate ? "（约）" : ""}`);
        }
      }
    }
  }

  if (apply) {
    console.log(`\n已写入 ${sure} 步，涉及 ${touchedFiles.size} 个卡文件。`);
    console.log("改过的卡要重签：npm run content:review <cardId> --by <名字> --resign");
  } else {
    console.log(`\n步级时长候选：确定 ${sure} 步 · 待人工核对 ${unsure} 步`);
    console.log("（只列不改。要写盘加 --apply —— 写完要重签。）");
  }
  return 0;
}

// -------------------------------------------------------------------- main

const cmd = process.argv[2];
let code = 0;
switch (cmd) {
  case "import":
    code = await cmdImport();
    break;
  case "check":
    code = cmdCheck();
    break;
  case "build":
    code = await cmdBuild();
    break;
  case "review":
    code = cmdReview();
    break;
  case "signing-list":
    code = cmdSigningList();
    break;
  case "draft":
    code = await cmdDraft();
    break;
  case "audit":
    code = await cmdAudit();
    break;
  case "repair-quotes":
    code = cmdRepairQuotes();
    break;
  case "slot-check":
    code = cmdSlotCheck();
    break;
  case "approx-check":
    code = cmdApproxCheck();
    break;
  case "step-duration":
    code = cmdStepDuration();
    break;
  default:
    console.log(`内容管线 CLI

  content import --blog <blog 路径> [--commit <sha>] [--dry-run]
  content check
  content build
  content review <cardId> --by <名字>
  content review --list <清单.md> --by <名字>   # 签清单里勾上的那些
  content signing-list                          # 生成待签字清单
  content draft <文章路径> [--all] [--dry-run]
  content audit [--article <文章路径>] [--no-llm] [--report-only] [--resume]
  content slot-check                           # 逐篇检查时段标注
  content approx-check                          # 列出「原文写了约、卡上没标」的剂量行
  content repair-quotes                        # 给 draft 卡补全漏掉的引文
  content step-duration [--apply] [--card <id>]  # 步级时长：列出候选 / 写盘
`);
    code = cmd ? 2 : 0;
}
// 用 exitCode 而不是 process.exit()：调过 LLM 之后连接池里还挂着 keep-alive 连接，
// 强制退出会触发 libuv 的断言（进程在收尾时崩掉，退出码也变成乱七八糟的值）。
// 让事件循环自己排空，退出码照样是对的那个。
process.exitCode = code;
