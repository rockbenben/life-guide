/**
 * 机械检查：不调模型就能判的问题。
 *
 * 这些判据都是**结构上**看出来的，不需要理解语义：
 *   · 重复：两张卡讲的是同一件事（remind 或步骤几乎一样）
 *   · 缺禁忌：原文有「不要做 / 禁忌」类小节，卡里却一条禁忌都没有
 *   · 比例异常：卡片文字比它自己的引文长出一大截 —— 常见于「添了原文没有的话」
 *   · 步数过多：一张卡塞了十几个步骤，多半该拆
 *
 * 宁可多报一点。这里的定位是「值得人看一眼」，不是「确定有问题」。
 */
import type { ArticleCards, Card } from "../cards/load.ts";
import type { SourceIndex } from "../source/parse.ts";
import type { Issue } from "./index.ts";

/**
 * 原文里「专门讲禁忌」的小节。
 *
 * 只看**小节标题**，不看正文 —— 正文里出现「注意」两个字太常见了
 * （注意事项、要注意火候……），按正文判会把大半文章都误报成「缺禁忌」。
 */
const CAUTION_HEADINGS = /不要|禁忌|不适合|避免|慎|谁不能|这些人/;

export function cautionSections(source: SourceIndex): { heading: string; text: string }[] {
  return source.sections
    .filter((s) => CAUTION_HEADINGS.test(s.heading))
    .map((s) => ({ heading: s.heading, text: s.text }));
}

function textOf(q: string | string[]): string {
  return Array.isArray(q) ? q.join(" ") : q;
}

/** 两段文字的相似度（字符二元组 Dice 系数），够用且不必引依赖。 */
export function similarity(a: string, b: string): number {
  const grams = (s: string) => {
    const clean = s.replace(/\s+/g, "");
    const out = new Set<string>();
    for (let i = 0; i + 2 <= clean.length; i++) out.add(clean.slice(i, i + 2));
    return out;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (!ga.size || !gb.size) return a === b ? 1 : 0;
  let hit = 0;
  for (const g of ga) if (gb.has(g)) hit++;
  return (2 * hit) / (ga.size + gb.size);
}

/** 一篇文章里，原文有没有讲「禁忌 / 注意」的内容。 */
export function sourceHasCautionContent(source: SourceIndex): boolean {
  return cautionSections(source).length > 0;
}

/** 一张卡自己的所有自由文本字段与其引文。 */
function fieldsOf(card: Card): { path: string; text: string; quote: string }[] {
  const out: { path: string; text: string; quote: string }[] = [];
  out.push({ path: "remind.text", text: card.remind.text, quote: textOf(card.remind.quote) });
  if (card.effect) out.push({ path: "effect.text", text: card.effect.text, quote: textOf(card.effect.quote) });
  for (const [i, d] of (card.dose ?? []).entries()) {
    out.push({ path: `dose[${i}].what`, text: d.what, quote: textOf(d.quote) });
  }
  for (const s of card.steps) out.push({ path: `steps.${s.id}.text`, text: s.text, quote: textOf(s.quote) });
  for (const [i, c] of (card.cautions ?? []).entries()) {
    out.push({ path: `cautions[${i}].text`, text: c.text, quote: textOf(c.quote) });
  }
  for (const [i, n] of (card.notices ?? []).entries()) {
    out.push({ path: `notices[${i}].text`, text: n.text, quote: textOf(n.quote) });
  }
  return out;
}

/** 文字比引文长多少倍：超过 3 倍就要看一眼，多半是卡片自己加了话。 */
const LENGTH_RATIO_LIMIT = 3;

export function auditCardMechanically(
  card: Card,
  article: ArticleCards,
  source: SourceIndex,
): Issue[] {
  const issues: Issue[] = [];

  // 原文专门讲禁忌的小节没被任何卡引用 —— 这才是真的「漏抽了禁忌」
  const sections = cautionSections(source);
  for (const sec of sections) {
    const covered = article.cards.some((c) =>
      [c.remind, ...c.steps, ...(c.cautions ?? []), ...(c.notices ?? [])].some((f) =>
        textOf(f.quote)
          .split(" / ")
          .some((q) => q.length > 3 && sec.text.includes(q.replace(/\s+/g, ""))),
      ),
    );
    if (!covered) {
      issues.push({
        cardId: card.id,
        verdict: "suspect",
        path: "cautions",
        reason: `原文有专门讲禁忌的小节「${sec.heading}」，但整篇的卡都没引用它`,
      });
      break; // 一篇只报一次
    }
  }

  // 步数过多
  if (card.steps.length > 8) {
    issues.push({
      cardId: card.id,
      verdict: "suspect",
      path: "steps",
      reason: `一张卡塞了 ${card.steps.length} 步，多半该拆成几张`,
    });
  }

  // 文字远长于引文
  for (const f of fieldsOf(card)) {
    const q = f.quote.replace(/\s+/g, "");
    const t = f.text.replace(/\s+/g, "");
    if (!q.length) continue;
    if (t.length > q.length * LENGTH_RATIO_LIMIT) {
      issues.push({
        cardId: card.id,
        verdict: "suspect",
        path: f.path,
        reason: `卡片文字比引文长 ${(t.length / q.length).toFixed(1)} 倍，多半加了原文没有的话`,
        quote: f.quote,
        text: f.text,
      });
    }
  }

  // 卡内重复：两张卡讲同一件事
  // 比 remind 容易漏（同一件事换个说法），所以也把步骤一起比。
  for (const other of article.cards) {
    if (other.id === card.id) continue;
    if (other.id < card.id) continue; // 只报一次
    const sim = Math.max(
      similarity(card.remind.text, other.remind.text),
      similarity(
        card.steps.map((s) => s.text).join(" "),
        other.steps.map((s) => s.text).join(" "),
      ),
    );
    if (sim > 0.6) {
      issues.push({
        cardId: card.id,
        verdict: "duplicate",
        path: "remind.text",
        reason: `与卡片 ${other.id} 讲的是同一件事（相似度 ${sim.toFixed(2)}），多半该合并`,
        text: card.remind.text,
        quote: card.remind.quote,
      });
    }
  }

  return issues;
}
