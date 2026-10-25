/**
 * 规则引擎。每条规则一个函数，签名统一，便于单独测试与扩展。
 *
 * 分工（见 AGENTS.md §5.2）：
 *   R1 保证**引文**没被改写 —— 改通顺后的句子不是原文子串，会被拦下。
 *   R2 保证**卡片自己的文字**没有偏离引文 —— 这才是 LLM 起草最容易失真的地方：
 *       引文抄对了，text 里却写成了另一个数。
 */
import fs from "node:fs";
import path from "node:path";

import type { ArticleCards, Card } from "../cards/load.ts";
import type { SourceIndex } from "../source/parse.ts";
import { hasBandEvidence, SLOT_LABELS } from "../slot.ts";
import {
  findVagueTerms,
  isVerbatimSubstring,
  normalizeQuote,
  numbersCovered,
} from "../source/normalize.ts";

export type Level = "error" | "warning";

export interface Finding {
  rule: string;
  level: Level;
  file: string;
  cardId?: string;
  path?: string;
  message: string;
}

export interface RuleContext {
  article: ArticleCards;
  source: SourceIndex;
  all: ArticleCards[];
  /** content/ 根目录，用于读 media.lock / SOURCE.lock */
  contentDir: string;
  /** 当前文章在 cards/ 下的文件名 */
  file: string;
}

export type Rule = (ctx: RuleContext) => Finding[];

function quotesOf(q: string | string[] | undefined): string[] {
  if (!q) return [];
  return Array.isArray(q) ? q : [q];
}

/** 卡片里所有带引文的自由文本字段。R2 逐个检查数字一致性。 */
function textFieldsOf(card: Card): { path: string; text: string; quote: string | string[] }[] {
  const out: { path: string; text: string; quote: string | string[] }[] = [];
  out.push({ path: "remind.text", text: card.remind.text, quote: card.remind.quote });
  if (card.effect) out.push({ path: "effect.text", text: card.effect.text, quote: card.effect.quote });
  for (const [i, d] of (card.dose ?? []).entries()) {
    out.push({ path: `dose[${i}].what`, text: d.what, quote: d.quote });
  }
  for (const s of card.steps) out.push({ path: `steps.${s.id}.text`, text: s.text, quote: s.quote });
  for (const [i, c] of (card.cautions ?? []).entries()) {
    out.push({ path: `cautions[${i}].text`, text: c.text, quote: c.quote });
  }
  for (const [i, n] of (card.notices ?? []).entries()) {
    out.push({ path: `notices[${i}].text`, text: n.text, quote: n.quote });
  }
  // 三档变体（忙 / 出差 / 生病）都要查：只查一个的话，
  // 另一个变体里的引文与数字就没人管了（起草自检是三个都查的）。
  for (const [mode, v] of Object.entries(card.variants ?? {})) {
    if (v?.replace) {
      out.push({ path: `variants.${mode}.replace.text`, text: v.replace.text, quote: v.replace.quote });
    }
  }
  // 分档（segments）里的文字同样要能被校验：它也是会显示给用户的自由文本
  for (const seg of card.segments ?? []) {
    if (seg.action) out.push({ path: `segments.${seg.id}.action.text`, text: seg.action.text, quote: seg.action.quote });
    if (seg.dose) out.push({ path: `segments.${seg.id}.dose.text`, text: seg.dose.text, quote: seg.dose.quote });
    for (const [i, av] of (seg.avoid ?? []).entries()) {
      out.push({ path: `segments.${seg.id}.avoid[${i}].text`, text: av.text, quote: av.quote });
    }
  }
  return out;
}

/** 卡片里所有带引文的字段（R1 逐个检查逐字性）。 */
function allQuoteFields(card: Card): { path: string; quote: string | string[] }[] {
  const out: { path: string; quote: string | string[] }[] = [];
  out.push({ path: "remind.quote", quote: card.remind.quote });
  if (card.effect) out.push({ path: "effect.quote", quote: card.effect.quote });
  for (const [i, d] of (card.dose ?? []).entries()) {
    out.push({ path: `dose[${i}].quote`, quote: d.quote });
  }
  for (const s of card.steps) out.push({ path: `steps.${s.id}.quote`, quote: s.quote });
  for (const [i, c] of (card.cautions ?? []).entries()) {
    out.push({ path: `cautions[${i}].quote`, quote: c.quote });
  }
  for (const [i, n] of (card.notices ?? []).entries()) {
    out.push({ path: `notices[${i}].quote`, quote: n.quote });
  }
  if (card.duration?.quote) out.push({ path: "duration.quote", quote: card.duration.quote });
  for (const [mode, v] of Object.entries(card.variants ?? {})) {
    if (v?.replace) out.push({ path: `variants.${mode}.replace.quote`, quote: v.replace.quote });
  }
  for (const seg of card.segments ?? []) {
    if (seg.action) out.push({ path: `segments.${seg.id}.action.quote`, quote: seg.action.quote });
    if (seg.dose) out.push({ path: `segments.${seg.id}.dose.quote`, quote: seg.dose.quote });
    for (const [i, av] of (seg.avoid ?? []).entries()) {
      out.push({ path: `segments.${seg.id}.avoid[${i}].quote`, quote: av.quote });
    }
  }
  return out;
}

// ---------------------------------------------------------------- R1

export const r01QuoteVerbatim: Rule = (ctx) => {
  const out: Finding[] = [];
  for (const card of ctx.article.cards) {
    for (const f of allQuoteFields(card)) {
      for (const q of quotesOf(f.quote)) {
        if (!isVerbatimSubstring(q, ctx.source.text)) {
          out.push({
            rule: "R1",
            level: "error",
            file: ctx.file,
            cardId: card.id,
            path: f.path,
            message: `引文不是原文的逐字子串：${q.slice(0, 40)}…`,
          });
        }
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------- R2

export const r02NumbersInQuote: Rule = (ctx) => {
  const out: Finding[] = [];
  for (const card of ctx.article.cards) {
    for (const f of textFieldsOf(card)) {
      const { missing } = numbersCovered(f.text, f.quote);
      if (missing.length) {
        out.push({
          rule: "R2",
          level: "error",
          file: ctx.file,
          cardId: card.id,
          path: f.path,
          message: `文字里的数字 ${missing.join("、")} 没有出现在它自己的引文里；做不到就改用 derived`,
        });
      }
    }
    // 剂量里的**数值本身**也要对着引文核 —— 之前只查了 what 里的数字，
    // value 写错（32 写成 33）没人拦。具体内容不该改，指的就是这个。
    // 分级：已签字的卡是 App 的内容，错一个数就错在屏上 → error；
    // 草稿还在等人审 → warning（审阅报告里会看到，不挡 CI）。
    for (const [i, d] of (card.dose ?? []).entries()) {
      const nums = [String(d.value)];
      if (d.valueMax !== undefined) nums.push(String(d.valueMax));
      // 换算来的数（1/2 勺 → 0.5 勺）不在引文里是允许的 —— 但必须写出算式（D7）
      if (d.derived?.formula) {
        const inFormula = numbersCovered(nums.join(" "), d.derived.formula);
        if (inFormula.missing.length) {
          out.push({
            rule: "R2",
            level: card.status === "reviewed" ? "error" : "warning",
            file: ctx.file,
            cardId: card.id,
            path: `dose[${i}].derived`,
            message: `推算的算式里没有这个数 ${inFormula.missing.join("、")} —— 算式要能复核`,
          });
        }
        continue;
      }
      const { missing } = numbersCovered(nums.join(" "), d.quote);
      if (missing.length) {
        out.push({
          rule: "R2",
          level: card.status === "reviewed" ? "error" : "warning",
          file: ctx.file,
          cardId: card.id,
          path: `dose[${i}].value`,
          message: `剂量值 ${missing.join("、")} 没有出现在它自己的引文里 —— 具体内容不许改`,
        });
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------- R3

export const r03NoVagueTerms: Rule = (ctx) => {
  const out: Finding[] = [];
  for (const card of ctx.article.cards) {
    const targets: { path: string; text: string; quote?: string | string[] }[] = [
      { path: "remind.text", text: card.remind.text, quote: card.remind.quote },
      ...(card.dose ?? []).map((d, i) => ({ path: `dose[${i}].what`, text: d.what })),
    ];
    for (const t of targets) {
      // 显示的就是原文的话时，模糊词是**手册自己写的**，不是卡片写得含糊 —— 不罚。
      // （原文：「适量 = 每 1cm² 涂 2mg。」—— 那个「适量」后面紧跟着给了定义。）
      if (t.quote) {
        const q = (Array.isArray(t.quote) ? t.quote : [t.quote]).join("");
        if (normalizeQuote(t.text) === normalizeQuote(q)) continue;
      }
      const hits = findVagueTerms(t.text);
      if (hits.length) {
        out.push({
          rule: "R3",
          level: "error",
          file: ctx.file,
          cardId: card.id,
          path: t.path,
          message: `出现模糊词 ${hits.join("、")}，对使用者等于零信息量`,
        });
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------- R4

export const r04ImageExists: Rule = (ctx) => {
  const out: Finding[] = [];
  const mediaLockPath = path.join(ctx.contentDir, "media", "media.lock");
  // media.lock 的键是原始 URL，值里的 file 是按 sha256 改名后的本地文件名。
  // 所以不能拿 URL 的原始文件名去比——本地根本没有那个名字。
  const media = new Map<string, string>();
  if (fs.existsSync(mediaLockPath)) {
    const lock = JSON.parse(fs.readFileSync(mediaLockPath, "utf8")) as Record<
      string,
      { file?: string }
    >;
    for (const [url, v] of Object.entries(lock)) {
      if (v?.file) media.set(url, v.file);
    }
  }
  const inSource = new Set(ctx.source.imageUrls);

  for (const card of ctx.article.cards) {
    const cardImages = [
      ...(card.images ?? []).map((u) => ({ url: u, field: "images" })),
      ...card.steps.flatMap((s) =>
        (s.images ?? []).map((u) => ({ url: u, field: `steps.${s.id}.images` })),
      ),
    ];
    for (const { url, field } of cardImages) {
      if (!inSource.has(url)) {
        out.push({
          rule: "R4",
          level: "error",
          file: ctx.file,
          cardId: card.id,
          path: field,
          message: `图片 URL 不在源文件里：${url}`,
        });
        continue;
      }
      const local = media.get(url);
      if (!local) {
        out.push({
          rule: "R4",
          level: "error",
          file: ctx.file,
          cardId: card.id,
          path: field,
          message: `media.lock 里没有这张图：${url}`,
        });
        continue;
      }
      if (!fs.existsSync(path.join(ctx.contentDir, "media", local))) {
        out.push({
          rule: "R4",
          level: "error",
          file: ctx.file,
          cardId: card.id,
          path: field,
          message: `本地副本不存在：${local}`,
        });
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------- R5

export const r05VariantsValid: Rule = (ctx) => {
  const out: Finding[] = [];
  for (const card of ctx.article.cards) {
    const stepIds = new Set(card.steps.map((s) => s.id));
    for (const [name, v] of Object.entries(card.variants ?? {})) {
      if (!v) continue;
      const kinds = [
        v.include ? "include" : null,
        v.replace ? "replace" : null,
        v.skip !== undefined ? "skip" : null,
      ].filter(Boolean);
      if (kinds.length !== 1) {
        out.push({
          rule: "R5",
          level: "error",
          file: ctx.file,
          cardId: card.id,
          path: `variants.${name}`,
          message: `variant 必须是 include / replace / skip 之一，现在有 ${kinds.length} 个`,
        });
      }
      for (const id of v.include ?? []) {
        if (!stepIds.has(id)) {
          out.push({
            rule: "R5",
            level: "error",
            file: ctx.file,
            cardId: card.id,
            path: `variants.${name}.include`,
            message: `引用了不存在的步骤 id：${id}`,
          });
        }
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------- R6

export const r06DurationFields: Rule = (ctx) => {
  const out: Finding[] = [];
  for (const card of ctx.article.cards) {
    const d = card.duration;
    if (!d) continue;
    if (d.basis === "derived" && !d.formula) {
      out.push({
        rule: "R6",
        level: "error",
        file: ctx.file,
        cardId: card.id,
        path: "duration.formula",
        message: "basis=derived 必须写 formula（算式）",
      });
    }
    if (d.basis === "quote" && !d.quote) {
      out.push({
        rule: "R6",
        level: "error",
        file: ctx.file,
        cardId: card.id,
        path: "duration.quote",
        message: "basis=quote 必须写 quote",
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------- R8

export const r08AnchorExists: Rule = (ctx) => {
  const out: Finding[] = [];
  const anchors = new Set(ctx.source.sections.map((s) => s.heading));
  for (const card of ctx.article.cards) {
    if (!anchors.has(card.source.anchor)) {
      out.push({
        rule: "R8",
        level: "error",
        file: ctx.file,
        cardId: card.id,
        path: "source.anchor",
        message: `快照里没有这个小节：${card.source.anchor}`,
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------- R9

export const r09Coverage: Rule = (ctx) => {
  const out: Finding[] = [];
  const ignore = ctx.article.ignore;
  const ignoreAllImages = ignore?.images && "all" in ignore.images;
  const ignoredImages = new Set(
    Array.isArray(ignore?.images) ? ignore.images.map((i) => i.url) : [],
  );
  const ignoredSections = new Set((ignore?.sections ?? []).map((s) => s.anchor));

  // 被引用的图片：步骤图 + 卡片级图
  const referencedImages = new Set<string>();
  // 卡片用到的全部引文——R9 判断「这个小节被抽过没有」时要看引文落在哪，
  // 只看 source.anchor 会把「引文其实来自别的小节」误判成抽漏。
  const allQuotes: string[] = [];
  for (const card of ctx.article.cards) {
    for (const f of allQuoteFields(card)) allQuotes.push(...quotesOf(f.quote));
    for (const u of card.images ?? []) referencedImages.add(u);
    for (const step of card.steps) for (const u of step.images ?? []) referencedImages.add(u);
  }

  for (const sec of ctx.source.sections) {
    if (ignoredSections.has(sec.heading)) continue;
    const anchored = ctx.article.cards.some((c) => c.source.anchor === sec.heading);
    const quoted = allQuotes.some((q) => isVerbatimSubstring(q, sec.text));
    if (anchored || quoted) continue;
    out.push({
      rule: "R9",
      level: ctx.article.coverage === "complete" ? "error" : "warning",
      file: ctx.file,
      path: `sections:${sec.heading}`,
      message: `小节未被任何卡片引用（anchor 与引文都不在此），也不在 ignore 清单里`,
    });
  }

  // 图片：partial 只计数不逐条报（R9 规则）
  if (!ignoreAllImages) {
    for (const url of ctx.source.imageUrls) {
      if (referencedImages.has(url) || ignoredImages.has(url)) continue;
      out.push({
        rule: "R9",
        level: ctx.article.coverage === "complete" ? "error" : "warning",
        file: ctx.file,
        path: `image:${url}`,
        message: `图片未被引用，也不在 ignore 清单里`,
      });
    }
  }
  return out;
};

// ---------------------------------------------------------------- R10

export const r10ConditionClean: Rule = (ctx) => {
  const out: Finding[] = [];
  if (ctx.article.kind !== "condition") return out;
  for (const card of ctx.article.cards) {
    for (const field of ["slot", "variants"] as const) {
      if ((card as any)[field] !== undefined) {
        out.push({
          rule: "R10",
          level: "error",
          file: ctx.file,
          cardId: card.id,
          path: field,
          message: `kind=condition 的卡不得含 ${field}（疾病信息不进今日清单、不可勾选）`,
        });
      }
    }
  }
  return out;
};

// ---------------------------------------------------------------- R14

/**
 * 已知的人群标签。
 *
 * 前三个是内置的年龄档，App 设置里选一次；其余是用户自选标签
 * （如 fall-risk「易跌倒」、knee-pain「膝盖不适」），在设置里勾选。
 *
 * 为什么要有一份白名单：标签写错（比如写成 age:70 以上）不会有任何症状，
 * 只是那一档永远匹配不上，用户永远看不到那条建议——静默失效。
 * 白名单让「这个标签根本不存在」变成一条明确的错误。
 */
export const KNOWN_TAGS = new Set([
  "age:child",
  "age:adult",
  "age:senior",
  "fall-risk",
  "knee-pain",
  "pregnant",
  "menstruating",
]);

export const r14SegmentsValid: Rule = (ctx) => {
  const out: Finding[] = [];
  for (const card of ctx.article.cards) {
    const segs = card.segments ?? [];
    const ids = new Set<string>();
    for (const seg of segs) {
      if (ids.has(seg.id)) {
        out.push({
          rule: "R14",
          level: "error",
          file: ctx.file,
          cardId: card.id,
          path: `segments.${seg.id}`,
          message: `同一张卡里分档 id 重复：${seg.id}`,
        });
      }
      ids.add(seg.id);
      if (!seg.when?.length) {
        out.push({
          rule: "R14",
          level: "error",
          file: ctx.file,
          cardId: card.id,
          path: `segments.${seg.id}.when`,
          message: "分档必须声明适用人群（when 至少一个标签）",
        });
      }
      for (const tag of seg.when ?? []) {
        if (!KNOWN_TAGS.has(tag)) {
          out.push({
            rule: "R14",
            level: "error",
            file: ctx.file,
            cardId: card.id,
            path: `segments.${seg.id}.when`,
            message: `未知的人群标签「${tag}」，它永远匹配不上；已知标签：${[...KNOWN_TAGS].join("、")}`,
          });
        }
      }
    }
  }
  return out;
};

/**
 * R16：时段要有原文依据。
 *
 * slot 决定 App 什么时候推荐这张卡，也决定卡片行左边那个标签写什么。
 * 标窄了就是「在原文没这么说的时候推它」—— 上一轮 25 张卡是这样错的
 * （食谱被标成「日间」、早晚各做的训练被标成「早晨」），全是起草时随手填的。
 *
 * **只查 draft 卡**：签过字的时段是人的判断，R12 已经守着改动的路径
 * （改了就得重签），不必再由机器翻一遍。
 *
 * 级别是 warning：原文有时把时间写在另一个小节里（防晒的「早上认真涂好」
 * 写在「该什么时候补涂」那一节），那种情况该由人看一眼，而不是拦下来。
 */
export const r16SlotGrounded: Rule = (ctx) => {
  const out: Finding[] = [];
  if (ctx.article.kind === "condition") return out;
  for (const card of ctx.article.cards) {
    if (card.status !== "draft") continue;
    const slot = card.slot;
    if (!slot || slot === "anytime") continue;
    const ev = hasBandEvidence(card, ctx.source, slot);
    if (ev.ok) continue;
    out.push({
      rule: "R16",
      level: "warning",
      file: ctx.file,
      cardId: card.id,
      path: "slot",
      message: `slot=${slot}，但这张卡所在的小节里找不到「${SLOT_LABELS[slot]}」的说法 —— 拿不准就填 anytime`,
    });
  }
  return out;
};

export const ALL_RULES: { id: string; rule: Rule }[] = [
  { id: "R1", rule: r01QuoteVerbatim },
  { id: "R2", rule: r02NumbersInQuote },
  { id: "R3", rule: r03NoVagueTerms },
  { id: "R4", rule: r04ImageExists },
  { id: "R5", rule: r05VariantsValid },
  { id: "R6", rule: r06DurationFields },
  { id: "R8", rule: r08AnchorExists },
  { id: "R9", rule: r09Coverage },
  { id: "R10", rule: r10ConditionClean },
  { id: "R14", rule: r14SegmentsValid },
  { id: "R16", rule: r16SlotGrounded },
];
