/**
 * 待签字清单：把「机器没挑出毛病」的卡按篇整理成一份能逐条看的单子。
 *
 * 为什么要它：审阅报告是给机器读的（有问题才写出来，没问题的卡连引文都不列）；
 * 签字是**逐条过**的事 —— 一份带勾选框、每条给一张卡预览的清单才过得动。
 * 289 张卡分 88 篇，一次一篇地翻报告比看清单慢得多。
 *
 * 清单也是签字的输入：勾上的 `[x]` 行由 `content review --list` 读走。
 * 签字仍然是人的判断 —— 机器只负责把「可以看的」挑出来并排好队。
 */
import fs from "node:fs";
import path from "node:path";

import type { LoadedArticle } from "./cards/load.ts";

/** 清单文件放哪（相对 content/）。 */
export const SIGNING_LIST_FILE = "signing-list.md";

export interface SigningEntry {
  cardId: string;
  article: string;
  articleTitle: string;
  /** 这一篇是不是疾病类（疾病类内容单独看） */
  condition: boolean;
  anchor: string;
  /** 屏上显示的名字（内容层另起的动作名，或原文小节名） */
  name: string;
  slot: string;
  /** 这张卡在做什么（卡片自己的话） */
  action: string;
  /** 步骤（卡片自己的话） */
  steps: string[];
  /** 剂量（卡片自己的话） */
  doses: string[];
  /** 注意与禁忌 */
  cautions: string[];
}

const SLOT_LABELS: Record<string, string> = {
  morning: "早晨",
  daytime: "日间",
  evening: "晚间",
  anytime: "随时",
};

/** 短句：这张卡在做什么（跟 App 里回落用的那一句同一个规矩）。 */
export function firstClause(text: string): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.split(/[。；;：:，,、]/)[0].trim() || t;
}

function clip(text: string, max: number): string {
  const t = String(text ?? "").replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}

/** 快照文章标题（frontmatter 的 title）。 */
export function articleTitleOf(contentDir: string, article: string): string {
  const p = path.join(contentDir, "source", article);
  if (!fs.existsSync(p)) return article;
  try {
    const head = fs.readFileSync(p, "utf8").slice(0, 400);
    const m = /^title:\s*(.+)$/m.exec(head);
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : article;
  } catch {
    return article;
  }
}

/**
 * 整理清单。
 *
 * 只收「机器没挑出毛病」的卡（okIds）—— 意思不对的、引文没覆盖全的、
 * 重复的都不该签，混进来等于让人白看。
 */
export function buildSigningList(
  loaded: LoadedArticle[],
  okIds: Set<string>,
  contentDir: string,
): { entries: SigningEntry[]; articles: number } {
  const entries: SigningEntry[] = [];
  const seenArticles = new Set<string>();
  for (const l of loaded) {
    const article = l.data.article;
    for (const card of l.data.cards) {
      if (!okIds.has(card.id)) continue;
      if (card.status === "reviewed") continue; // 已经签过的不进清单
      seenArticles.add(article);
      entries.push({
        cardId: card.id,
        article,
        articleTitle: articleTitleOf(contentDir, article),
        condition: l.data.kind === "condition",
        anchor: card.source?.anchor ?? "",
        name: card.name?.trim() || card.source?.anchor || "",
        slot: SLOT_LABELS[card.slot ?? "anytime"] ?? "随时",
        action: card.remind?.text ?? "",
        steps: (card.steps ?? []).map((s) => s.text),
        doses: (card.dose ?? []).map(
          (d) =>
            `${d.valueMax !== undefined ? `${d.value}～${d.valueMax}` : d.value}${d.unit} ${d.what}`,
        ),
        cautions: (card.cautions ?? []).map((c) => c.text),
      });
    }
  }
  return { entries, articles: seenArticles.size };
}

/**
 * 清单正文。
 *
 * 每条给一张卡的预览：做什么、几步、剂量、注意 —— 签字的人要看的正是这些。
 * 引文不用列：R1 已经保证每句引文都是原文的逐字子串，机器查过。
 */
export function renderSigningList(entries: SigningEntry[]): string {
  const byArticle = new Map<string, SigningEntry[]>();
  for (const e of entries) {
    const list = byArticle.get(e.article) ?? [];
    list.push(e);
    byArticle.set(e.article, list);
  }

  const lines: string[] = [];
  lines.push("# 待签字清单");
  lines.push("");
  lines.push(
    "> 机器已经挑过一遍：下面这些卡在审阅报告里**没查出问题**（引文逐字对得上、数字对得上）。",
  );
  lines.push("> 机器看不出的是「这样做对不对、说得清不清楚」—— 那是签字的人要看的。");
  lines.push("");
  lines.push(
    "**勾的含义是「人逐条看过」**；批量签的那批（机器过了一遍、人没逐条读）不该出现在这里。",
  );
  lines.push("");
  lines.push("怎么用：");
  lines.push("");
  lines.push("1. 逐条看。觉得没问题的，把 `- [ ]` 改成 `- [x]`。");
  lines.push("2. 签：");
  lines.push("");
  lines.push("   ```");
  lines.push("   npm run content:review -- --list content/signing-list.md --by 你的名字");
  lines.push("   ```");
  lines.push("");
  lines.push(
    "   签完跑一次 `npm run content:check`（卡被改过而没重签会报错），再 `npm run content:build`。",
  );
  lines.push("");
  lines.push(
    `共 ${entries.length} 张 · 分布在 ${byArticle.size} 篇里。⚠ 标的是疾病类 —— 那种更要慢一点看。`,
  );
  lines.push("");

  for (const [article, list] of byArticle) {
    const title = list[0].articleTitle;
    const cond = list.some((e) => e.condition);
    lines.push(`## ${article} 《${title}》${cond ? " ⚠ 疾病类" : ""}`);
    lines.push("");
    for (const e of list) {
      // 名字另起过就把两样都摆出来：签字的人要看的是屏上那个名字对不对
      const named = e.name && e.name !== e.anchor ? ` · 屏上叫「${e.name}」` : "";
      lines.push(
        `- [ ] \`${e.cardId}\` · ${e.slot}${named} · 原文《${e.anchor}》`,
      );
      lines.push(`  做什么：${clip(e.action, 60)}`);
      e.steps.forEach((s, i) => lines.push(`  ${i + 1}. ${clip(s, 70)}`));
      if (e.doses.length) lines.push(`  剂量：${e.doses.map((d) => clip(d, 30)).join("；")}`);
      e.cautions.forEach((c) => lines.push(`  ⚠ ${clip(c, 60)}`));
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * 读清单里勾上的卡。
 *
 * 只认 `- [x] <id>` 这一种形状 —— 别的行（说明、标题）一律忽略。
 */
export function parseTickedIds(text: string): string[] {
  const out: string[] = [];
  for (const line of String(text ?? "").split(/\r?\n/)) {
    const m = /^\s*-\s*\[x\]\s+`?([A-Za-z0-9._-]+)`?/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

/** 清单里勾了几个、共几个（用于报进度）。 */
export function countTicked(text: string): { ticked: number; total: number } {
  const total = (String(text ?? "").match(/^\s*-\s*\[[ x]\]/gm) ?? []).length;
  return { ticked: parseTickedIds(text).length, total };
}
