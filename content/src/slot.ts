/**
 * 时段检查：卡上的 slot 是不是与原文说的时间一致。
 *
 * 为什么要有这个文件：slot 决定 App 什么时候推荐这张卡，也决定卡片行左边
 * 那个标签写什么。原文里明明白白写着「起床后 3 小时内」的动作，标成「随时」
 * 是把一条能用的信息丢掉了；反过来，「为什么明明涂了还是会晒黑」这种知识卡
 * 标成「早晨」是给用户一个假的时间承诺。
 *
 * 判断的依据只能是**原文**：slot 是策展，但策展的依据在快照里，不在模型脑子里。
 * 所以这里的做法是：把卡片的引文定位回原文小节，只在小节范围内找时间线索，
 * 把「线索句」原样带出来给人看 —— 判断留给人，机器只负责把证据摆齐。
 */
import type { ArticleCards, Card } from "./cards/load.ts";
import type { SourceIndex, SourceSection } from "./source/parse.ts";

export type Slot = "morning" | "daytime" | "evening" | "anytime";

export const SLOT_LABELS: Record<Slot, string> = {
  morning: "早晨",
  daytime: "日间",
  evening: "晚间",
  anytime: "随时",
};

/**
 * 时间线索词。
 *
 * 分两类：
 *   · band —— 指向 App 的某一段（早晨 / 日间 / 晚间）
 *   · free —— 指向「不是某一段」（饭后、洗澡时、通勤……）。App 只有三段，
 *     这些词落不进任何一段，一律当「随时」。
 *
 * 「早晚」是 free：原文说「早晚各一次」时，动作在两段都做，标任何一段都会漏一段。
 */
export const BAND_CUES: { slot: Slot; words: string[] }[] = [
  {
    slot: "morning",
    words: [
      "早晨", "早上", "清晨", "晨间", "晨光", "起床后", "醒来后", "一大早", "早起后", "早起",
      "上午", "晨起", "早餐",
    ],
  },
  {
    slot: "daytime",
    words: ["午后", "下午", "中午", "白天", "日间", "午休", "晒太阳", "日晒"],
  },
  {
    slot: "evening",
    words: [
      "睡前", "就寝前", "入睡前", "睡觉前", "睡前1小时", "睡前 1 小时", "晚上", "夜里", "夜间",
      "傍晚", "过夜", "晾一夜", "入睡", "侧睡",
    ],
  },
];

export const FREE_CUES: string[] = [
  "早晚", "每天 2 次", "每天2次", "一天 2 次", "一天2次", "每天两次", "随时", "不限",
  "饭后", "饭前", "每餐", "吃饭", "洗澡时", "洗澡后", "泡澡时", "洗浴后", "淋浴",
  "通勤", "上班", "出门", "回家", "空腹", "固定时间", "任意时间", "当天的", "一次性",
];

/** 一句话：按中文句读切。 */
function sentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；!?;])/)
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/** 卡的所有引文（拼起来当指纹用）。 */
function quotesOf(card: Card): string[] {
  const out: string[] = [];
  const push = (q: string | string[] | undefined) => {
    if (!q) return;
    if (Array.isArray(q)) out.push(...q);
    else out.push(q);
  };
  push(card.remind?.quote);
  push(card.effect?.quote);
  for (const d of card.dose ?? []) push(d.quote);
  for (const s of card.steps ?? []) push(s.quote);
  for (const c of card.cautions ?? []) push(c.quote);
  for (const n of card.notices ?? []) push(n.quote);
  for (const seg of card.segments ?? []) {
    push(seg.action?.quote);
    push(seg.dose?.quote);
    for (const a of seg.avoid ?? []) push(a.quote);
  }
  return out.map((q) => q.replace(/\s+/g, " ").trim()).filter(Boolean);
}

/**
 * 卡片落在原文的哪几个小节。
 *
 * 判据：卡片的引文逐字出现在哪个小节里（归一化空白后比对）。
 * 命中一个就算 —— 卡片常常只引了小节里的几句话。
 * 引文一个都没命中时退回整篇（多半是引文被改写过，R1 会另行报错）。
 */
export function cardSections(card: Card, source: SourceIndex): SourceSection[] {
  const quotes = quotesOf(card);
  if (!quotes.length) return source.sections;
  const hit = source.sections.filter((s) => quotes.some((q) => s.text.includes(q)));
  return hit.length ? hit : source.sections;
}

export interface TimeHit {
  slot: Slot | "free";
  word: string;
  sentence: string;
}

/** 一段文字里带时间线索的句子。 */
export function timeHits(text: string): TimeHit[] {
  const out: TimeHit[] = [];
  for (const s of sentences(text)) {
    for (const { slot, words } of BAND_CUES) {
      for (const w of words) {
        if (s.includes(w)) {
          out.push({ slot, word: w, sentence: s });
          break;
        }
      }
    }
    for (const w of FREE_CUES) {
      if (s.includes(w)) {
        out.push({ slot: "free", word: w, sentence: s });
        break;
      }
    }
  }
  return out;
}

export interface SlotVerdict {
  cardId: string;
  article: string;
  anchor: string;
  status: string;
  current: Slot;
  /** 规则给出的建议（不是结论 —— 机器只摆证据） */
  proposed: Slot;
  /** 为什么给这个建议 */
  reason: string;
  /** 证据句：原文里带时间线索的那几句 */
  evidence: string[];
  /** 命中的线索词 */
  words: string[];
}

/**
 * 规则建议。
 *
 * 只有**只命中一个 band、没有命中 free** 时才给具体时段；
 * 其余一律「随时」。宁可标宽一点，也不要给一个没依据的窄时段 ——
 * 标窄了 App 会在那个时段推它，而原文其实没这么说。
 */
export function proposeSlot(hits: TimeHit[]): { slot: Slot; reason: string } {
  const bands = new Set(hits.filter((h) => h.slot !== "free").map((h) => h.slot as Slot));
  const frees = hits.filter((h) => h.slot === "free");
  if (bands.size === 1 && frees.length === 0) {
    const only = [...bands][0];
    const word = hits.find((h) => h.slot === only)!.word;
    return { slot: only, reason: `原文只给了这一个时段（「${word}」），没有别的时机` };
  }
  if (bands.size === 1 && frees.length > 0) {
    return {
      slot: "anytime",
      reason: `原文既说了「${[...bands][0]}」，又说了「${frees[0].word}」这类不落段的时机 —— 按随时处理`,
    };
  }
  if (bands.size > 1) {
    return {
      slot: "anytime",
      reason: `原文给了不止一个时段（${[...bands].map((s) => SLOT_LABELS[s]).join("、")}）—— 按随时处理`,
    };
  }
  if (frees.length > 0) {
    return { slot: "anytime", reason: `原文说的是「${frees[0].word}」这类不落段的时机` };
  }
  return { slot: "anytime", reason: "原文没给时间" };
}

/** 一张卡的时段判定。 */
export function judgeCard(card: Card, article: ArticleCards, source: SourceIndex): SlotVerdict {
  const sections = cardSections(card, source);
  const hits = timeHits(sections.map((s) => s.text).join("\n"));
  const { slot, reason } = proposeSlot(hits);
  const current = (card.slot ?? "anytime") as Slot;
  return {
    cardId: card.id,
    article: article.article,
    anchor: card.source?.anchor ?? "",
    status: card.status,
    current,
    proposed: slot,
    reason,
    evidence: [...new Set(hits.map((h) => h.sentence))].slice(0, 4),
    words: [...new Set(hits.map((h) => h.word))],
  };
}

/**
 * 原文（卡自己所在的小节）里有没有某个时段的说法。
 *
 * R16 用它：卡标了「早晨」，原文却找不到「早晨」的说法 —— 那这个时段是拍的。
 */
export function hasBandEvidence(
  card: Card,
  source: SourceIndex,
  band: Slot,
): { ok: boolean; words: string[] } {
  const sections = cardSections(card, source);
  const hits = timeHits(sections.map((s) => s.text).join("\n"));
  const words = [...new Set(hits.filter((h) => h.slot === band).map((h) => h.word))];
  return { ok: words.length > 0, words };
}
