/**
 * LLM 起草结果的解析与自检。
 *
 * 起草工具**只能**写 status: draft（AGENTS.md §4.3）——签字是人的事。
 * 所以这里做的第一件事就是把 status 强制成 draft、把 review 块剥掉。
 *
 * 自检的规则（R1/R2/R3/R4/R9/R10/R14）与 content/src/rules/index.ts 里的同名规则
 * 语义一致，但**故意在这里重写一遍**，而不是 import：
 *   · 起草是写盘前的闸门，权威校验仍然是 `content check`；
 *   · 规则文件在 P3 里正在被改，起草流水线不能被它的内部结构绑住。
 * 复用的是更底层的归一化原语（content/src/source/normalize.ts）：
 * 引文逐字比对、数字覆盖、模糊词。
 */
import { isMap, isScalar, isSeq, parseDocument, type YAMLMap, type YAMLSeq } from "yaml";

import { makeValidator, type ArticleCards, type Card } from "../cards/load.ts";
import { KNOWN_TAGS } from "../rules/index.ts";
import type { SourceIndex } from "../source/parse.ts";
import { findVagueTerms, isVerbatimSubstring, numbersCovered } from "../source/normalize.ts";

export interface DraftFinding {
  rule: string;
  level: "error" | "warning";
  cardId?: string;
  path?: string;
  message: string;
}

export interface DraftParseContext {
  /** 快照解析结果：R1 的底稿、R9 的清单来源 */
  source: SourceIndex;
  /** 报告里显示用的文件路径 */
  file: string;
}

export interface DraftParseResult {
  ok: boolean;
  /** 规范化后的 yaml 文本（已强制 draft、已剥掉 review） */
  yaml: string;
  data: ArticleCards | null;
  findings: DraftFinding[];
}

function quoteList(q: string | string[] | undefined): string[] {
  if (!q) return [];
  return Array.isArray(q) ? q : [q];
}

/** 卡片里所有带引文的字段（R1 逐个查逐字性）。 */
function quoteFieldsOf(card: Card): { path: string; quote: string | string[] }[] {
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
  for (const [name, v] of Object.entries(card.variants ?? {})) {
    if (v?.replace) out.push({ path: `variants.${name}.replace.quote`, quote: v.replace.quote });
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

/** 卡片里所有带引文的自由文本字段（R2 逐个查数字一致性）。 */
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
  for (const [name, v] of Object.entries(card.variants ?? {})) {
    if (v?.replace) {
      out.push({ path: `variants.${name}.replace.text`, text: v.replace.text, quote: v.replace.quote });
    }
  }
  for (const seg of card.segments ?? []) {
    if (seg.action) {
      out.push({ path: `segments.${seg.id}.action.text`, text: seg.action.text, quote: seg.action.quote });
    }
    if (seg.dose) out.push({ path: `segments.${seg.id}.dose.text`, text: seg.dose.text, quote: seg.dose.quote });
    for (const [i, av] of (seg.avoid ?? []).entries()) {
      out.push({ path: `segments.${seg.id}.avoid[${i}].text`, text: av.text, quote: av.quote });
    }
  }
  return out;
}

/**
 * 从模型回复里取出 yaml。
 *
 * 模型经常在 yaml 前后加话（「以下是抽出来的卡片：」），这里把它们切掉：
 * 开头找第一个顶层键，结尾遇到「不是键值对的顶格行」就停。
 */
export function extractYamlBlock(text: string): string {
  let body = text;
  const fenced = /```[ \t]*(?:yaml|yml)?[ \t]*\r?\n([\s\S]*?)```/i.exec(text);
  if (fenced) {
    body = fenced[1] ?? "";
  } else {
    body = body.replace(/```[^\n]*\r?\n?/g, "");
  }

  const start = body.search(/^(article|kind|coverage|ignore|cards)\s*:/m);
  if (start > 0) body = body.slice(start);

  const out: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    const isYamlTop = /^[A-Za-z_][\w.-]*\s*:/.test(line);
    if (out.length && line.trim() && !/^\s/.test(line) && !/^#/.test(line) && !isYamlTop) break;
    out.push(line);
  }
  return out.join("\n");
}

/** 强制 draft、剥掉 review 签字（AGENTS.md §4.3：签字是人的事）。 */
function enforceDraft(doc: ReturnType<typeof parseDocument>): DraftFinding[] {
  const findings: DraftFinding[] = [];
  const cards = doc.get("cards");
  if (!isSeq(cards)) return findings; // 结构不对的话，交给 schema 校验去报
  for (let i = 0; i < cards.items.length; i++) {
    const status = doc.getIn(["cards", i, "status"]);
    if (status !== "draft") {
      doc.setIn(["cards", i, "status"], "draft");
      findings.push({
        rule: "DRAFT",
        level: "warning",
        path: `cards[${i}].status`,
        message: `起草结果只能是 status: draft，已把 ${String(status)} 改写为 draft`,
      });
    }
    const review = doc.getIn(["cards", i, "review"]);
    if (review !== undefined && review !== null) {
      doc.deleteIn(["cards", i, "review"]);
      findings.push({
        rule: "DRAFT",
        level: "warning",
        path: `cards[${i}].review`,
        message: "起草结果不得带 review 签字块，已剥离",
      });
    }
  }
  return findings;
}

/**
 * 一张卡里所有引文在文档里的路径（用来改写它们）。
 *
 * 索引式（dose[0].quote）而不是 id 式：yaml 文档的 setIn 要的是位置。
 */
function quotePathsOfCard(cardNode: unknown): (string | number)[][] {
  const paths: (string | number)[][] = [];
  if (!isMap(cardNode)) return paths;
  const card = cardNode as YAMLMap;
  const seqOf = (key: string): YAMLSeq | null => {
    const v = card.get(key, true);
    return isSeq(v) ? (v as YAMLSeq) : null;
  };

  for (const key of ["remind", "effect", "duration"]) {
    if (card.has(key)) paths.push([key, "quote"]);
  }
  const dose = seqOf("dose");
  if (dose) for (const [i] of dose.items.entries()) paths.push(["dose", i, "quote"]);
  const steps = seqOf("steps");
  if (steps) for (const [i, s] of steps.items.entries()) if (isMap(s)) paths.push(["steps", i, "quote"]);
  const cautions = seqOf("cautions");
  if (cautions) for (const [i] of cautions.items.entries()) paths.push(["cautions", i, "quote"]);
  const notices = seqOf("notices");
  if (notices) for (const [i] of notices.items.entries()) paths.push(["notices", i, "quote"]);

  const variants = card.get("variants", true);
  if (isMap(variants)) {
    for (const name of ["busy", "travel", "sick"]) {
      const v = (variants as YAMLMap).get(name, true);
      if (isMap(v) && (v as YAMLMap).has("replace")) {
        paths.push(["variants", name, "replace", "quote"]);
      }
    }
  }

  const segments = seqOf("segments");
  if (segments) {
    for (const [i, s] of segments.items.entries()) {
      if (!isMap(s)) continue;
      const seg = s as YAMLMap;
      if (seg.has("action")) paths.push(["segments", i, "action", "quote"]);
      if (seg.has("dose")) paths.push(["segments", i, "dose", "quote"]);
      const avoid = seg.get("avoid", true);
      if (isSeq(avoid)) {
        for (const [j] of (avoid as YAMLSeq).items.entries()) {
          paths.push(["segments", i, "avoid", j, "quote"]);
        }
      }
    }
  }
  return paths;
}

/** 末尾的省略号：全角「…」与半角「...」都算。 */
const TRAILING_ELLIPSIS = /(?:…|\.{3})+$/;

/**
 * 剪掉模型自己加的省略号。
 *
 * 模型抄长引文时爱在末尾加「…」，原文里没有 —— 引文于是不再是逐字子串，R1 拦下，
 * 整篇稿子作废。这是纯机械的错，不需要人来判断。
 *
 * 修复有三条硬约束：
 *   1. 只动**本来就不逐字**的引文（本来就逐字的不碰，原文自己带省略号的那种不动）；
 *   2. 剪掉之后**必须仍是原文的逐字子串**，否则不剪；
 *   3. 只删末尾那几个字符，不改一个字。
 * 换句话说：剪完之后引文更接近原文，不是更远。
 */
function repairEllipsisQuotes(
  doc: ReturnType<typeof parseDocument>,
  source: SourceIndex,
): DraftFinding[] {
  const findings: DraftFinding[] = [];
  const cards = doc.get("cards", true);
  if (!isSeq(cards)) return findings;

  for (const [ci, cardNode] of (cards as YAMLSeq).items.entries()) {
    for (const rel of quotePathsOfCard(cardNode)) {
      // quotePathsOfCard 给的是卡内相对路径，文档里还要带上 cards[i]
      const p = ["cards", ci, ...rel];
      const node = doc.getIn(p, true);
      // getIn 取到的是 yaml 的标量节点，取它的 value 才是字符串
      const scalar = isScalar(node) ? node.value : node;
      const repair = (s: string): string | null => {
        if (!TRAILING_ELLIPSIS.test(s)) return null;
        if (isVerbatimSubstring(s, source.text)) return null; // 本来就逐字，不动
        const trimmed = s.replace(TRAILING_ELLIPSIS, "").trimEnd();
        if (!trimmed) return null;
        if (!isVerbatimSubstring(trimmed, source.text)) return null;
        return trimmed;
      };
      const where = `cards[${ci}].${rel.join(".")}`;

      if (typeof scalar === "string") {
        const fixed = repair(scalar);
        if (fixed) {
          doc.setIn(p, fixed);
          findings.push({
            rule: "R1",
            level: "warning",
            path: where,
            message: "引文末尾多出的省略号已剪掉（剪完仍是原文逐字）",
          });
        }
        continue;
      }
      if (isSeq(node)) {
        const seq = node as YAMLSeq;
        for (const [qi, item] of seq.items.entries()) {
          if (!isScalar(item) || typeof item.value !== "string") continue;
          const fixed = repair(item.value);
          if (fixed) {
            seq.items[qi] = fixed;
            findings.push({
              rule: "R1",
              level: "warning",
              path: `${where}[${qi}]`,
              message: "引文末尾多出的省略号已剪掉（剪完仍是原文逐字）",
            });
          }
        }
      }
    }
  }
  return findings;
}

function checkR1(data: ArticleCards, source: SourceIndex): DraftFinding[] {
  const out: DraftFinding[] = [];
  for (const card of data.cards) {
    for (const f of quoteFieldsOf(card)) {
      for (const q of quoteList(f.quote)) {
        if (!isVerbatimSubstring(q, source.text)) {
          out.push({
            rule: "R1",
            level: "error",
            cardId: card.id,
            path: f.path,
            message: `引文不是原文的逐字子串：${q.slice(0, 40)}…`,
          });
        }
      }
    }
  }
  return out;
}

function checkR2(data: ArticleCards): DraftFinding[] {
  const out: DraftFinding[] = [];
  for (const card of data.cards) {
    for (const f of textFieldsOf(card)) {
      const { missing } = numbersCovered(f.text, f.quote);
      if (missing.length) {
        out.push({
          rule: "R2",
          level: "error",
          cardId: card.id,
          path: f.path,
          message: `文字里的数字 ${missing.join("、")} 没有出现在它自己的引文里；做不到就改用 derived`,
        });
      }
    }
  }
  return out;
}

/**
 * R8：source.anchor 必须是快照里真实存在的小节标题。
 *
 * 模型常把小节标题改一个字（「早见表」→「早发表」）或者拿文章标题冒充小节，
 * 机器在 content check 里会报，但那时稿子已经写盘了 —— 这里提前拦一道。
 */
function checkR8(data: ArticleCards, source: SourceIndex): DraftFinding[] {
  const out: DraftFinding[] = [];
  const anchors = new Set(source.sections.map((s) => s.heading));
  for (const card of data.cards ?? []) {
    if (!anchors.has(card.source.anchor)) {
      out.push({
        rule: "R8",
        level: "error",
        cardId: card.id,
        path: "source.anchor",
        message: `快照里没有这个小节：${card.source.anchor}`,
      });
    }
  }
  return out;
}

function checkR3(data: ArticleCards): DraftFinding[] {
  const out: DraftFinding[] = [];
  for (const card of data.cards) {
    const targets: { path: string; text: string }[] = [
      { path: "remind.text", text: card.remind.text },
      ...(card.dose ?? []).map((d, i) => ({ path: `dose[${i}].what`, text: d.what })),
    ];
    for (const t of targets) {
      const hits = findVagueTerms(t.text);
      if (hits.length) {
        out.push({
          rule: "R3",
          level: "error",
          cardId: card.id,
          path: t.path,
          message: `出现模糊词 ${hits.join("、")}，对使用者等于零信息量`,
        });
      }
    }
  }
  return out;
}

/** 图片 URL 必须在原文里出现过（本地副本由 R4/R13 在 content check 里管）。 */
function checkR4(data: ArticleCards, source: SourceIndex): DraftFinding[] {
  const out: DraftFinding[] = [];
  const known = new Set(source.imageUrls);
  for (const card of data.cards) {
    const refs: { path: string; url: string }[] = [
      ...(card.images ?? []).map((u) => ({ path: "images", url: u })),
      ...card.steps.flatMap((s) =>
        (s.images ?? []).map((u) => ({ path: `steps.${s.id}.images`, url: u })),
      ),
    ];
    for (const { path, url } of refs) {
      if (!known.has(url)) {
        out.push({
          rule: "R4",
          level: "error",
          cardId: card.id,
          path,
          message: `图片 URL 不在原文里：${url}`,
        });
      }
    }
  }
  return out;
}

/**
 * R9 覆盖：每个小节、每张图，要么被卡引用，要么在 ignore 里。
 *
 * 判断「被抽过没有」既看 source.anchor，也看引文落在哪 ——
 * 只认 anchor 会把「引文其实来自别的小节」误判成抽漏。
 */
function checkR9(data: ArticleCards, source: SourceIndex): DraftFinding[] {
  const out: DraftFinding[] = [];
  const ignore = data.ignore;
  const ignoreAllImages = !!ignore?.images && "all" in ignore.images;
  const ignoredImages = new Set(
    Array.isArray(ignore?.images) ? ignore.images.map((i) => i.url) : [],
  );
  const ignoredSections = new Set((ignore?.sections ?? []).map((s) => s.anchor));

  const referencedImages = new Set<string>();
  const allQuotes: string[] = [];
  for (const card of data.cards) {
    for (const f of quoteFieldsOf(card)) allQuotes.push(...quoteList(f.quote));
    for (const u of card.images ?? []) referencedImages.add(u);
    for (const step of card.steps) for (const u of step.images ?? []) referencedImages.add(u);
  }

  const level = data.coverage === "complete" ? "error" : "warning";

  for (const sec of source.sections) {
    if (ignoredSections.has(sec.heading)) continue;
    const anchored = data.cards.some((c) => c.source.anchor === sec.heading);
    const quoted = allQuotes.some((q) => isVerbatimSubstring(q, sec.text));
    if (anchored || quoted) continue;
    out.push({
      rule: "R9",
      level,
      path: `sections:${sec.heading}`,
      message: "小节未被任何卡片引用（anchor 与引文都不在此），也不在 ignore 清单里",
    });
  }

  if (!ignoreAllImages) {
    for (const url of source.imageUrls) {
      if (referencedImages.has(url) || ignoredImages.has(url)) continue;
      out.push({
        rule: "R9",
        level,
        path: `image:${url}`,
        message: "图片未被引用，也不在 ignore 清单里",
      });
    }
  }
  return out;
}

/** R10：疾病类卡片不得有 slot / variants。 */
function checkR10(data: ArticleCards): DraftFinding[] {
  const out: DraftFinding[] = [];
  if (data.kind !== "condition") return out;
  for (const card of data.cards) {
    for (const field of ["slot", "variants"] as const) {
      if ((card as unknown as Record<string, unknown>)[field] !== undefined) {
        out.push({
          rule: "R10",
          level: "error",
          cardId: card.id,
          path: field,
          message: `kind=condition 的卡不得含 ${field}（疾病信息不进今日清单、不可勾选）`,
        });
      }
    }
  }
  return out;
}

/** R14：分档 id 不重复、when 非空、标签在白名单里。 */
function checkR14(data: ArticleCards): DraftFinding[] {
  const out: DraftFinding[] = [];
  for (const card of data.cards) {
    const ids = new Set<string>();
    for (const seg of card.segments ?? []) {
      if (ids.has(seg.id)) {
        out.push({
          rule: "R14",
          level: "error",
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
            cardId: card.id,
            path: `segments.${seg.id}.when`,
            message: `未知的人群标签「${tag}」；已知标签：${[...KNOWN_TAGS].join("、")}`,
          });
        }
      }
    }
  }
  return out;
}

/**
 * 解析并自检一份 LLM 起草结果。
 *
 * ok = 没有任何 error 级问题。warning 会被原样报出（人工审阅时看），
 * 但不拦写盘 —— 比如 coverage: partial 下 R9 的「还没抽完」只是提醒。
 */
export function parseDraft(raw: string, ctx: DraftParseContext): DraftParseResult {
  const findings: DraftFinding[] = [];
  const block = extractYamlBlock(raw);

  let doc: ReturnType<typeof parseDocument>;
  try {
    doc = parseDocument(block);
  } catch (err) {
    findings.push({
      rule: "YAML",
      level: "error",
      message: `yaml 解析失败：${err instanceof Error ? err.message : String(err)}`,
    });
    return { ok: false, yaml: block, data: null, findings };
  }

  if (doc.errors.length) {
    for (const e of doc.errors) {
      findings.push({ rule: "YAML", level: "error", message: e.message });
    }
    return { ok: false, yaml: block, data: null, findings };
  }

  findings.push(...enforceDraft(doc));
  // 先修机械错（末尾多出的省略号），再校验：不然这些稿子会被 R1 整篇拦掉
  findings.push(...repairEllipsisQuotes(doc, ctx.source));

  const data = doc.toJS() as ArticleCards;
  const yaml = doc.toString({ lineWidth: 0 });

  const { valid, errors } = makeValidator()(data);
  if (!valid) {
    for (const e of errors) findings.push({ rule: "SCHEMA", level: "error", message: e });
    return { ok: false, yaml, data, findings };
  }

  findings.push(...checkR1(data, ctx.source));
  findings.push(...checkR2(data));
  findings.push(...checkR3(data));
  findings.push(...checkR4(data, ctx.source));
  findings.push(...checkR8(data, ctx.source));
  findings.push(...checkR9(data, ctx.source));
  findings.push(...checkR10(data));
  findings.push(...checkR14(data));

  const ok = !findings.some((f) => f.level === "error");
  return { ok, yaml, data, findings };
}
