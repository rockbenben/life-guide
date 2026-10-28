/**
 * 手册浏览：全文检索 + 疾病提示分级。
 *
 * 数据来自 content 侧构建产物 manual.json（快照 114 个 md；其中 113 篇可读）。
 * 正文是**markdown 原文**，不是纯文本 —— 表格、图片、列表、加粗都是内容的一部分
 * （见 domain/markdown.ts）。App 只负责把它渲染出来。
 *
 * 疾病类内容（AGENTS.md §5.4）在这里单独处理：它不进今日清单、不可勾选，
 * 只在手册里出现，并且必须带着「这不是治疗方案」的提示。
 */

import { mdToPlain, renderMarkdown } from "./markdown.ts";
import { displayNames } from "./lines.ts";
import type { Card } from "./routine.ts";

export interface ManualSection {
  heading: string;
  /** 这一小节的 markdown 原文（不含标题行） */
  md: string;
}

export interface ManualArticle {
  /** 相对 the-savvy-life-manual 的路径，如 body-care/tears.md */
  path: string;
  title: string;
  /** 抽过卡的文章才有 kind；疾病类文章由人工定 */
  kind?: "practice" | "condition";
  sections: ManualSection[];
}

/** 手册目录：只要 path/title/kind，够画列表；全文在 manual.json 里按需取。 */
export type ManualIndexEntry = Omit<ManualArticle, "sections">;

export interface ManualBundle {
  schemaVersion: string;
  source: { repo: string; commit: string; date: string };
  articles: ManualArticle[];
}

/**
 * 某篇文章下的卡片。
 *
 * cards.json 里的 articlePath 带 the-savvy-life-manual/ 前缀，手册里的 path 不带，
 * 所以按后缀比而不是全等。
 */
export function cardsOfArticle(cards: Card[], path: string): Card[] {
  const target = path.replace(/\\/g, "/");
  return cards.filter((c) => {
    const p = (c.articlePath ?? "").replace(/\\/g, "/");
    return p === target || p.endsWith("/" + target);
  });
}

/**
 * 手册的分类。
 *
 * 快照本来就是四个目录（body-care / food / mind-growth / life-hacks），
 * 113 篇摊成一条长列表没法找 —— 按目录分成四类才对得上读者的脑子。
 */
export interface Category {
  id: string;
  label: string;
  /** 路径前缀 */
  prefix: string;
}

export const CATEGORIES: Category[] = [
  { id: "all", label: "全部", prefix: "" },
  { id: "body", label: "身体", prefix: "body-care/" },
  { id: "food", label: "饮食", prefix: "food/" },
  { id: "mind", label: "思维", prefix: "mind-growth/" },
  { id: "life", label: "生活", prefix: "life-hacks/" },
];

/**
 * 一篇文章属于哪一类（按路径前缀）。
 *
 * 返回 null 表示不属于任何一类（比如手册自己的 README 索引页）——
 * 这种文章只出现在「全部」里，不该给它贴一个「全部」的标签。
 */
export function categoryOf(path: string): Category | null {
  const p = path.replace(/\\/g, "/");
  return CATEGORIES.find((c) => c.prefix && p.startsWith(c.prefix)) ?? null;
}

/** 按分类过滤文章。 */
export function filterByCategory<T extends { path: string }>(
  articles: T[],
  categoryId: string,
): T[] {
  const cat = CATEGORIES.find((c) => c.id === categoryId);
  if (!cat || !cat.prefix) return articles;
  return articles.filter((a) => a.path.replace(/\\/g, "/").startsWith(cat.prefix));
}

/**
 * 一篇文章的卡名索引：手册相对路径 → 这一篇的卡名。
 *
 * 卡名是内容层起的**策展名**（原文里未必有那个词），但它就是 App 屏上显示的那行 ——
 * 用户照着自己刚看到的词来搜，手册里也得搜得到。
 * 键用手册里的相对路径（body-care/sleep.md），与 manual.json 的 path 同一套写法。
 */
export type CardNameIndex = Map<string, string[]>;

/**
 * 从全部卡里造出「路径 → 卡名」的索引。
 *
 * 显示名用 displayNames —— 与屏上看到的完全一致（同名相撞时的回落也一致）。
 */
export function buildCardNameIndex(cards: Card[]): CardNameIndex {
  const shown = displayNames(cards);
  const index: CardNameIndex = new Map();
  for (const c of cards) {
    const p = (c.articlePath ?? "").replace(/\\/g, "/");
    if (!p) continue;
    // cards.json 的 articlePath 带 the-savvy-life-manual/ 前缀，手册里的 path 不带
    const marker = "the-savvy-life-manual/";
    const rel = p.includes(marker) ? p.slice(p.indexOf(marker) + marker.length) : p;
    const label = (shown.get(c.id) ?? "").trim();
    if (!label) continue;
    const list = index.get(rel) ?? [];
    if (!list.includes(label)) list.push(label);
    index.set(rel, list);
  }
  return index;
}

/** 某篇文章的卡名（索引里没有就是没有）。 */
export function cardNamesOf(index: CardNameIndex | undefined, path: string): string[] {
  if (!index) return [];
  return index.get(path.replace(/\\/g, "/")) ?? [];
}

/**
 * 一篇文章摊开后的可搜索文本：标题 + 各小节标题与正文 + 这一篇的卡名。
 *
 * 正文是 markdown，检索前先剥成纯文本 —— 否则「涂**两**遍」这种会被记号切断。
 */
function searchText(a: ManualArticle, names: string[] = []): string {
  const parts: string[] = [a.title];
  for (const s of a.sections) parts.push(s.heading, mdToPlain(s.md));
  parts.push(...names);
  return parts.join("\n").toLowerCase();
}

/**
 * 标题或正文命中即算命中。
 *
 * 空格分词后要求全部命中（AND）—— 中文正文很长，
 * 只命中标题里没有的词就当命中，会搜出一堆不相干的文章。
 */
export function articleMatches(
  a: ManualArticle,
  query: string,
  names: string[] = [],
): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const hay = searchText(a, names);
  return terms.every((t) => hay.includes(t));
}

/**
 * 标题里出现了搜索词中的任意一个（排序用）。
 */
function titleHit(a: ManualArticle, terms: string[]): boolean {
  const t = a.title.toLowerCase();
  return terms.some((x) => t.includes(x));
}

/**
 * 按查询过滤文章；空查询返回全部。
 *
 * **标题命中的排前面**：搜「蛋白质」时，「早餐缺蛋白质？每餐 20g 以上的三步吃法」
 * 该排在「食物过敏：让你发作的，常常不是吃下去的那口」前面 ——
 * 后者只是正文里提到了蛋白质。按快照的文件顺序排，命中与否全看运气，
 * 用户会以为搜不准。
 */
/** 全文还没到时的搜索：只能按标题找。 */
export function searchIndexByTitle(
  index: ManualIndexEntry[],
  query: string,
  names?: CardNameIndex,
): ManualIndexEntry[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return index;
  return index.filter((a) => {
    const hay = [a.title, ...cardNamesOf(names, a.path)].join("\n").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

export function searchArticles(
  articles: ManualArticle[],
  query: string,
  names?: CardNameIndex,
): ManualArticle[] {
  const q = query.trim();
  if (!q) return articles;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = articles.filter((a) => articleMatches(a, q, cardNamesOf(names, a.path)));
  // 命中标题的排 0（在前），只命中正文的排 1；同一档里保持原来的次序（sort 是稳定的）
  const rank = (a: ManualArticle) => (titleHit(a, terms) ? 0 : 1);
  return hits.sort((a, b) => rank(a) - rank(b));
}

/**
 * 按路径找一篇文章。
 *
 * cards.json 里的 articlePath 带 the-savvy-life-manual/ 前缀，
 * manual.json 里的 path 不带 —— 全等比会找不到，「出自」那点就白给。
 * 与 cardsOfArticle 用同一套比法。
 */
export function findArticle(
  articles: ManualArticle[],
  path: string,
): ManualArticle | null {
  const target = path.replace(/\\/g, "/");
  return (
    articles.find((a) => {
      const p = a.path.replace(/\\/g, "/");
      return p === target || target.endsWith("/" + p);
    }) ?? null
  );
}

/**
 * 手册列表该显示哪些篇。
 *
 * 快照根下还有一个 README.md —— 它是《精致生活》这本书自己的目录页（11604 字），
 * 不是手册的一篇。buildManual 把 the-savvy-life-manual/ 下所有 .md 都当文章，
 * 于是它排在列表第一位、还被算进「114 篇」。
 * 判据用「有没有目录前缀」而不是写死文件名：快照的四个分类都在子目录里。
 */
export function listableArticles<T extends { path: string }>(articles: T[]): T[] {
  return articles.filter((a) => a.path.replace(/\\/g, "/").includes("/"));
}

/**
 * 手册头部那一行：没筛选时是总数，筛选时是结果数。
 *
 * 只改搜索词或分类都算筛选；否则列表从 113 缩到 14，顶部还写「113 篇」，
 * 看起来像没筛。
 */
export function searchSummary(
  query: string,
  category: string,
  total: number,
  found: number,
): string {
  const filtered = query.trim() !== "" || category !== "all";
  return filtered ? `找到 ${found} 篇（共 ${total} 篇）` : `${total} 篇`;
}

export interface RenderSection {
  /** 与文章标题重复的小节不再重复显示标题 */
  heading: string | null;
  /** 这一小节的 markdown 渲染结果（HTML） */
  html: string;
}

/**
 * 渲染用的小节。
 *
 * 正文第一个小节的 heading 就是文章标题（原文 `##` 之前那段的标题），
 * 显示两遍标题只是噪音，所以那一条标题留空、正文照常显示。
 */
export function renderSections(article: ManualArticle): RenderSection[] {
  const out: RenderSection[] = [];
  for (const s of article.sections) {
    const html = renderMarkdown(s.md, article.path);
    if (!html) continue;
    const heading = s.heading.trim();
    out.push({
      heading: heading === article.title.trim() ? null : s.heading,
      html,
    });
  }
  return out;
}
