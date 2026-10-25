/**
 * 起草编排：读原文 → 构造提示词 → 调 LLM → 自检 → 写 draft 卡。
 *
 * 三条硬约束（AGENTS.md §4.3）：
 *   1. 只写 status: draft。签字是人的事（`content review`）。
 *   2. 绝不覆盖已有人工成果：目标文件里有 reviewed 卡就拒绝并报告。
 *   3. 只写 content/cards/ 下的文件。
 */
import fs from "node:fs";
import path from "node:path";

import { isMap, isSeq, parseDocument, type YAMLSeq } from "yaml";

import { loadArticleFile, type ArticleCards, type Card } from "../cards/load.ts";
import { parseMarkdown } from "../source/parse.ts";
import type { LlmClient } from "./llm.ts";
import { buildDraftPrompt } from "./prompt.ts";
import { parseDraft, type DraftFinding } from "./parse.ts";

export type DraftAction = "write" | "append" | "skip" | "failed";

export interface DraftOutcome {
  /** 快照内的相对路径，如 the-savvy-life-manual/body-care/tears.md */
  article: string;
  /** 目标卡片文件 */
  target: string;
  action: DraftAction;
  cards: number;
  findings: DraftFinding[];
  error?: string;
  /** dry-run：只报计划，没调 LLM、没写盘 */
  dryRun?: boolean;
}

export interface DraftOptions {
  contentDir: string;
  cardsDir: string;
  sourceDir: string;
  client: LlmClient;
  dryRun?: boolean;
  maxTokens?: number;
}

/**
 * 快照里不是文章的文件：快照自己的记账文件，和手册目录里的 README。
 * （SOURCE.lock 不是 md，本来就不在列表里。）
 */
const NOT_ARTICLE = new Set(["README.md", "ERRATA.md"]);

/** 快照里所有文章（相对 source/ 的路径），排除 README 与 ERRATA。 */
export function listArticles(sourceDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".md") && !NOT_ARTICLE.has(entry.name)) {
        out.push(path.relative(sourceDir, full).replace(/\\/g, "/"));
      }
    }
  };
  if (fs.existsSync(sourceDir)) walk(sourceDir);
  return out.sort();
}

/** 目标卡片文件：与快照同构的相对路径，扩展名换成 .yaml。 */
export function targetFor(cardsDir: string, articleRel: string): string {
  return path.join(cardsDir, articleRel.replace(/\.md$/, ".yaml"));
}

/**
 * 把用户敲的路径解析成快照内的相对路径。
 *
 * 接受三种写法：`the-savvy-life-manual/body-care/tears.md`（相对 source/）、
 * `content/source/the-savvy-life-manual/body-care/tears.md`（相对仓库根）、
 * `body-care/tears.md`（后缀唯一时）。
 */
export function resolveArticle(input: string, sourceDir: string): string | null {
  const norm = input.replace(/\\/g, "/").replace(/^\.\//, "");
  const stripped = norm.replace(/^content\/source\//, "");

  for (const cand of [stripped, norm]) {
    if (!cand) continue;
    const abs = path.resolve(sourceDir, cand);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      return path.relative(sourceDir, abs).replace(/\\/g, "/");
    }
  }

  const all = listArticles(sourceDir);
  const hits = all.filter((rel) => rel === stripped || rel.endsWith(`/${stripped}`));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    throw new Error(`「${input}」匹配到多篇：${hits.join("、")}`);
  }
  return null;
}

function seqOf(node: unknown): YAMLSeq | null {
  return isSeq(node) ? (node as YAMLSeq) : null;
}

function itemStrings(seq: YAMLSeq, key: string): string[] {
  return seq.items.map((it) => (isMap(it) ? String(it.get(key) ?? "") : ""));
}

/** 把新起草的 ignore 清单并进已有文件（按 anchor / url 去重）。 */
function mergeIgnore(doc: ReturnType<typeof parseDocument>, incoming: ArticleCards["ignore"]): void {
  if (!incoming) return;
  if (doc.get("ignore") === null || doc.get("ignore") === undefined) {
    doc.setIn(["ignore"], {});
  }

  if (incoming.sections?.length) {
    let seq = seqOf(doc.getIn(["ignore", "sections"], true));
    if (!seq) {
      doc.setIn(["ignore", "sections"], []);
      seq = seqOf(doc.getIn(["ignore", "sections"], true));
    }
    if (seq) {
      const seen = new Set(itemStrings(seq, "anchor"));
      for (const s of incoming.sections) {
        if (seen.has(s.anchor)) continue;
        seen.add(s.anchor);
        seq.add(s);
      }
    }
  }

  const images = incoming.images;
  if (!images) return;

  if ("all" in images) {
    // 整篇豁免：已有的图片清单一律作废
    if (!doc.getIn(["ignore", "images"], true)) {
      doc.setIn(["ignore", "images"], { all: true, reason: images.reason });
    }
    return;
  }

  const cur = doc.getIn(["ignore", "images"], true);
  if (cur && !isSeq(cur)) return; // 已经是 { all: true }，不用再加
  let seq = seqOf(cur);
  if (!seq) {
    doc.setIn(["ignore", "images"], []);
    seq = seqOf(doc.getIn(["ignore", "images"], true));
  }
  if (!seq) return;
  const seen = new Set(itemStrings(seq, "url"));
  for (const im of images) {
    if (seen.has(im.url)) continue;
    seen.add(im.url);
    seq.add(im);
  }
}

/**
 * 往已有文件里追加新卡。
 *
 * 用 Document API 而不是 parse + stringify：后者会把文件里的注释全冲掉，
 * 而 ignore 清单里「为什么不抽这条」的理由正是靠注释记录着的。
 */
function appendToExisting(target: string, incoming: ArticleCards): void {
  const doc = parseDocument(fs.readFileSync(target, "utf8"));

  const seq = seqOf(doc.get("cards"));
  if (seq) {
    for (const card of incoming.cards) seq.add(card);
  } else {
    doc.setIn(["cards"], incoming.cards);
  }

  mergeIgnore(doc, incoming.ignore);

  // coverage 只有两边都 complete 才算 complete：合并后可能仍有没抽完的小节
  if (doc.get("coverage") !== "complete" || incoming.coverage !== "complete") {
    doc.setIn(["coverage"], "partial");
  }

  fs.writeFileSync(target, doc.toString({ lineWidth: 0 }), "utf8");
}

/**
 * 起草一篇文章。
 *
 * 不写 reviewed、只写 draft；目标文件里有 reviewed 卡就直接拒绝（不调 LLM，
 * 省得白花 token）。dry-run 时只报计划，不联网、不写盘。
 */
export async function draftArticle(
  articleRel: string,
  opts: DraftOptions,
): Promise<DraftOutcome> {
  const target = targetFor(opts.cardsDir, articleRel);
  const exists = fs.existsSync(target);

  if (exists) {
    const loaded = loadArticleFile(target);
    const reviewed = (loaded.data.cards ?? []).filter((c: Card) => c.status === "reviewed");
    if (reviewed.length) {
      return {
        article: articleRel,
        target,
        action: "skip",
        cards: 0,
        findings: [],
        error: `目标文件里已有 ${reviewed.length} 张 reviewed 卡，不覆盖`,
      };
    }
    if (loaded.schemaErrors.length) {
      return {
        article: articleRel,
        target,
        action: "failed",
        cards: 0,
        findings: [],
        error: `目标文件本身不合法（${loaded.schemaErrors[0]}），先修好它`,
      };
    }
  }

  const action: DraftAction = exists ? "append" : "write";
  if (opts.dryRun) {
    return { article: articleRel, target, action, cards: 0, findings: [], dryRun: true };
  }

  const articlePath = path.join(opts.sourceDir, articleRel);
  const markdown = fs.readFileSync(articlePath, "utf8");
  const source = parseMarkdown(markdown);

  const prompt = buildDraftPrompt({ articlePath: articleRel, markdown, source });
  const raw = await opts.client.complete({
    system: prompt.system,
    user: prompt.user,
    maxTokens: opts.maxTokens,
  });

  const parsed = parseDraft(raw, { source, file: target });
  if (!parsed.ok || !parsed.data) {
    return {
      article: articleRel,
      target,
      action: "failed",
      cards: 0,
      findings: parsed.findings,
      error: "自检未通过，未写盘",
    };
  }

  const findings = [...parsed.findings];

  if (exists) {
    const loaded = loadArticleFile(target);
    if (loaded.data.kind !== parsed.data.kind) {
      findings.push({
        rule: "KIND",
        level: "warning",
        path: "kind",
        message: `文件里已有 kind=${loaded.data.kind}，新起草是 kind=${parsed.data.kind}，保留原有的`,
      });
    }
    appendToExisting(target, parsed.data);
  } else {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, parsed.yaml, "utf8");
  }

  return {
    article: articleRel,
    target,
    action,
    cards: parsed.data.cards.length,
    findings,
  };
}
