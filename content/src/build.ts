/**
 * 构建 cards.json：只收「签字有效」的 reviewed 卡，并把图片 URL 重写为本地路径。
 *
 * 图片本地化的意义（AGENTS.md §8）：img.newzone.top 没有 CORS，Service Worker
 * 只能存不透明响应、配额占用还大。图片进了 content/media/ 之后，App 与图片同源，
 * 可以直接全部预缓存，离线才真正可用。
 */
import fs from "node:fs";
import path from "node:path";

import type { ArticleCards, Card } from "./cards/load.ts";
import { checkReviewSignature } from "./budget.ts";
import { parseMarkdown } from "./source/parse.ts";
import { defaultRoutineIds } from "./default-routine.ts";

export interface ManualIndexEntry {
  path: string;
  title: string;
  kind?: "practice" | "condition";
}

export interface CardsBundle {
  schemaVersion: string;
  source: { repo: string; commit: string; date: string };
  cards: BuiltCard[];
  /**
   * 手册目录的轻量索引（path / title / kind）。
   *
   * 手册列表只要这三样；全文在 manual.json 里，第一次打开文章或搜索时才取。
   * 把它放进 cards.json 是因为启动本来就要取 cards.json —— 多这十几 KB，
   * 换来「点手册先看到目录，不必等 800 KB 全文」。
   */
  articles: ManualIndexEntry[];
  /**
   * 默认清单：App 第一次打开时放进「我的日常」的那几张，次序即显示次序。
   * 来自 content/default-routine.yaml（策展在内容层，App 不自己编）。
   */
  defaultRoutine: string[];
}

/**
 * 构建产物里的一张卡：**引文被剥掉了**。
 *
 * 引文是内容层的证据 —— R1/R2 逐字校验读的是 yaml，不是这个产物。
 * App 一次都不读它：屏上摆的就是原文的话，要对质就点「出自〈哪一篇〉」去看原文。
 * 留着它就是每次启动白传 351 KB（实测占 cards.json 的 40% —— 同一段原文存了两遍）。
 *
 * articlePath / articleKind 来自文章级别：疾病信息要单独处理，
 * App 靠 articleKind 决定这张卡是不是进不了今日清单（AGENTS.md §5.4）。
 *
 * articleTitle 也在这里：今天页展开态那句「出自〈哪一篇〉」要篇名，
 * 而篇名原先只存在于手册全文（manual.json）里 —— 那就意味着今天页
 * 启动时也得把约 811 KB 的手册全文取回来。文章多了就是每张卡都带一遍篇名，
 * 比每次启动拉一整本手册划算得多。
 */
export type BuiltCard = Omit<
  Card,
  | "remind"
  | "effect"
  | "dose"
  | "steps"
  | "cautions"
  | "notices"
  | "variants"
  | "segments"
  | "status"
  | "review"
  | "images"
> & {
  remind: { text: string };
  effect?: { text: string } | null;
  dose?: {
    value: number;
    valueMax?: number;
    unit: string;
    what: string;
    /** 原文是近似值（「约 5 次」）—— 屏上要显示「约」 */
    approximate?: boolean;
    derived?: { formula: string };
  }[];
  steps: { id?: string; text: string; images?: string[] }[];
  cautions?: { level: "stop" | "with-doctor" | "info"; text: string }[];
  notices?: { level: "seek-care" | "with-doctor" | "info"; text: string }[];
  variants?: Card["variants"];
  segments?: Card["segments"];
  articlePath: string;
  articleTitle: string;
  /** 只有疾病类卡需要：App 靠它把这些卡排除在今日清单外 */
  articleKind?: "condition";
};

export interface BuildResult {
  bundle: CardsBundle;
  /** 需要拷进 app/public/media/ 的本地文件 */
  mediaFiles: string[];
}

/** 手册浏览用的一篇文章。图片路径已重写为 App 内的本地路径（在 markdown 里）。 */
export interface ManualSection {
  heading: string;
  /** 这一小节的 markdown 原文（不含标题行）—— App 按 markdown 渲染 */
  md: string;
}

export interface ManualArticle {
  /** 相对 the-savvy-life-manual 的路径，如 body-care/tears.md */
  path: string;
  title: string;
  /** 抽过卡的文章才有 kind；疾病类卡片由人工定 kind（AGENTS.md §5.4） */
  kind?: "practice" | "condition";
  sections: ManualSection[];
}

export interface ManualBundle {
  schemaVersion: string;
  source: { repo: string; commit: string; date: string };
  articles: ManualArticle[];
}

function loadSourceLock(contentDir: string): { repo: string; commit: string; date: string } {
  const p = path.join(contentDir, "source", "SOURCE.lock");
  if (!fs.existsSync(p)) return { repo: "", commit: "", date: "" };
  const lock = JSON.parse(fs.readFileSync(p, "utf8"));
  return { repo: lock.repo ?? "", commit: lock.commit ?? "", date: lock.date ?? "" };
}

function loadMediaLock(contentDir: string): Record<string, { file: string }> {
  const p = path.join(contentDir, "media", "media.lock");
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/**
 * 把卡片里所有图片 URL 换成 App 内的本地路径（卡片级图 + 步骤图）。
 *
 * 路径是**相对**的（media/xxx.png，不是 /media/xxx.png）：
 * 同一份产物要能在三处跑 —— 浏览器部署在子路径（https://…/045/）、
 * 桌面端在 app://bundle/、手机端在 capacitor://localhost/。
 * 写成绝对的，部署到子路径时每张图都会指向域名根，全部 404。
 */
function localizeImages(card: Card, media: Record<string, { file?: string }>): Card {
  const map = (urls: string[] | undefined) =>
    urls?.map((u) => {
      const entry = media[u];
      return entry ? `media/${entry.file}` : u;
    });
  return {
    ...card,
    images: map(card.images),
    steps: card.steps.map((s) => ({ ...s, images: map(s.images) })),
  };
}

/**
 * 把 markdown 里的图片 URL 换成 App 内的本地路径。
 *
 * 手册按 markdown 渲染，图片就写在那段 markdown 里（`![说明](https://img.newzone.top/…)`），
 * 所以要按文本替换 —— 跟卡片那边改 `images` 数组不是一回事。
 * 路径同样是**相对**的（media/xxx.png）：三处跑同一份产物（子路径部署 / app:// / capacitor://）。
 */
function localizeMarkdown(
  md: string,
  media: Record<string, { file?: string }>,
): string {
  let out = md;
  for (const [url, entry] of Object.entries(media)) {
    if (!entry?.file) continue;
    if (!out.includes(url)) continue;
    out = out.split(url).join(`media/${entry.file}`);
  }
  return out;
}

/**
 * 剥掉引文与 App 不读的字段。
 *
 * 只留「屏上要显示的话」：引文、签字指纹（review）、status、卡级图片
 * 都是内容层或校验层的证据，App 一次都不读 —— 实测它们合计约 40 KB。
 * 这一步（连同引文）把 cards.json 从约 886 KB 压到 535 KB：
 * 引文本身 351 KB，占剥之前那份的 40%（同一段原文存了两遍）。
 */
function stripQuotes(card: Card): BuiltCard {
  const { quote: _q1, ...remind } = card.remind;
  const effect = card.effect
    ? (({ quote: _q2, ...rest }) => rest)(card.effect)
    : card.effect;
  return {
    id: card.id,
    source: card.source,
    // 屏上显示的动作名（没有就让它在 App 里回落到小节名）
    name: card.name,
    slot: card.slot,
    remind,
    effect: effect ?? null,
    dose: card.dose?.map((d) => {
      const { quote: _q, ...rest } = d;
      return rest;
    }),
    duration: card.duration
      ? (({ quote: _q, ...rest }) => rest)(card.duration)
      : card.duration,
    steps: card.steps.map((s) => {
      const { quote: _q, ...rest } = s;
      if (card.variants) return rest;
      // 没有模式版本的卡，步骤 id 只是内容层的锚点；App 用下标就能渲染
      const { id: _id, ...noId } = rest;
      return noId;
    }),
    cautions: card.cautions?.map((c) => {
      const { quote: _q, ...rest } = c;
      return rest;
    }),
    notices: card.notices?.map((n) => {
      const { quote: _q, ...rest } = n;
      return rest;
    }),
    // 变体与分档里的引文同样剥掉（现在没有变体，分档有 7 张卡）
    variants: card.variants
      ? Object.fromEntries(
          Object.entries(card.variants).map(([k, v]) => {
            if (!v) return [k, v];
            if ("replace" in v && v.replace) {
              const { quote: _q, ...rest } = v.replace;
              return [k, { ...v, replace: rest }];
            }
            return [k, v];
          }),
        )
      : card.variants,
    segments: card.segments?.map((s) => ({
      id: s.id,
      when: s.when,
      action: s.action ? (({ quote: _q, ...rest }) => rest)(s.action) : s.action,
      dose: s.dose ? (({ quote: _q, ...rest }) => rest)(s.dose) : s.dose,
      avoid: s.avoid?.map((a) => {
        const { quote: _q, ...rest } = a;
        return rest;
      }),
    })),
  } as BuiltCard;
}

/**
 * 文章的篇名（frontmatter 里的 title）。
 *
 * 只读文件头那一段，不用 remark 解析整篇 —— 构建要为抽过卡的 104 篇文章各问一次，
 * 全文解析太贵。引号照 frontmatter 的写法剥掉（与 parseMarkdown 同一口径）。
 */
export function articleTitleOf(contentDir: string, article: string): string {
  const abs = path.join(contentDir, "source", article);
  if (!fs.existsSync(abs)) return "";
  const head = fs.readFileSync(abs, "utf8").slice(0, 2000);
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head);
  if (!m) return "";
  const t = /^title:\s*(.+)$/m.exec(m[1]);
  return t ? t[1].trim().replace(/^["']|["']$/g, "") : "";
}

export function buildBundle(
  all: ArticleCards[],
  contentDir: string,
  articles: ManualIndexEntry[] = [],
): CardsBundle {
  const media = loadMediaLock(contentDir);
  const cards: BuiltCard[] = [];
  for (const a of all) {
    const title = articleTitleOf(contentDir, a.article);
    for (const c of a.cards) {
      if (c.status !== "reviewed") continue;
      if (!checkReviewSignature(c).ok) continue; // 指纹失效的剔除
      cards.push({
        ...stripQuotes(localizeImages(c, media)),
        articlePath: a.article,
        articleTitle: title,
        articleKind: a.kind === "condition" ? "condition" : undefined,
      });
    }
  }
  // 默认清单里若混进了没进产物的卡（不该有，R15 会报错），这里只留真正在产物里的
  const shipped = new Set(cards.map((c) => c.id));
  const defaultRoutine = defaultRoutineIds(contentDir).filter((id) => shipped.has(id));
  return {
    schemaVersion: "0.1.0",
    source: loadSourceLock(contentDir),
    cards,
    articles,
    defaultRoutine,
  };
}

/** 收集构建产物里用到的图片本地文件。 */
export function collectMediaFiles(
  all: ArticleCards[],
  contentDir: string,
): string[] {
  const media = loadMediaLock(contentDir);
  const used = new Set<string>();
  for (const a of all) {
    for (const c of a.cards) {
      if (c.status !== "reviewed") continue;
      if (!checkReviewSignature(c).ok) continue;
      for (const s of c.steps) {
        for (const u of s.images ?? []) {
          const e = media[u];
          if (e) used.add(e.file);
        }
      }
      for (const u of c.images ?? []) {
        const e = media[u];
        if (e) used.add(e.file);
      }
    }
  }
  return [...used].sort();
}

// ------------------------------------------------------------------ manual

const MANUAL_DIR = "the-savvy-life-manual";

function listManualFiles(contentDir: string): string[] {
  const root = path.join(contentDir, "source", MANUAL_DIR);
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), relPath);
      else if (entry.name.endsWith(".md")) out.push(relPath);
    }
  };
  walk(root, "");
  return out.sort();
}

/**
 * 手册全文：给「手册浏览」用。
 *
 * 文章是不是疾病类，只有被抽过卡才知道（kind 由人工定，AGENTS.md §5.4），
 * 所以这里不对没抽过卡的文章猜 —— 猜错的方向是「把疾病知识当保健动作」，
 * 那比反过来危险。
 */
export function buildManual(
  all: ArticleCards[],
  contentDir: string,
): ManualBundle {
  const media = loadMediaLock(contentDir);
  const kindOf = new Map<string, "practice" | "condition">();
  for (const a of all) kindOf.set(a.article, a.kind);

  const articles: ManualArticle[] = [];
  for (const rel of listManualFiles(contentDir)) {
    const abs = path.join(contentDir, "source", MANUAL_DIR, rel);
    const parsed = parseMarkdown(fs.readFileSync(abs, "utf8"));
    articles.push({
      path: rel,
      title: parsed.title,
      kind: kindOf.get(`${MANUAL_DIR}/${rel}`),
      sections: parsed.sections.map((s) => ({
        heading: s.heading,
        // 手册按 markdown 渲染：表格、图片、列表、加粗都在这段原文里。
        // 纯文本不再随产物走 —— 搜索在 App 那边从 markdown 剥出来就够了，
        // 两份都带着会让 manual.json 白胖一倍。
        md: localizeMarkdown(s.md, media),
      })),
    });
  }

  return {
    schemaVersion: "0.1.0",
    source: loadSourceLock(contentDir),
    articles,
  };
}

/** 手册浏览用到的图片（全部文章的图片都要，浏览时才有图）。 */
export function collectManualMediaFiles(contentDir: string): string[] {
  const media = loadMediaLock(contentDir);
  const used = new Set<string>();
  for (const rel of listManualFiles(contentDir)) {
    const abs = path.join(contentDir, "source", MANUAL_DIR, rel);
    const parsed = parseMarkdown(fs.readFileSync(abs, "utf8"));
    for (const url of parsed.imageUrls) {
      const e = media[url];
      if (e) used.add(e.file);
    }
  }
  return [...used].sort();
}
