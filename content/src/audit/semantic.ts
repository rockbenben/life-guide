/**
 * 语义检查：卡片自己写的文字，是不是它那条引文的忠实转述。
 *
 * 这是 R1/R2 查不出来的那一类问题，也是审阅最耗时的部分：
 *   引文逐字（过了 R1）、数字对得上（过了 R2），但卡片把引文的意思改了 ——
 *   比如引文说「缓解」，卡片写成「治好」。
 *
 * 做法：整篇一次调用，把这一篇的所有卡连同引文给模型，
 * 让它只报**语义上站不住**的字段。措辞不同但意思一致的不报。
 *
 * 模型的输出是 JSON，只列有问题的字段；没问题的字段不占地方。
 */
import type { ArticleCards, Card } from "../cards/load.ts";
import type { LlmClient } from "../extract/llm.ts";
import type { Issue } from "./index.ts";

const SYSTEM = [
  "你在审一份「生活手册卡片」草稿。每张卡里的事实字段都配了一条原文引文（quote），",
  "引文本身已经机器校验过是逐字原文，数字也对得上。你要查的是**另一件事**：",
  "卡片自己写的文字（text / what）有没有偏离它那条引文的意思。",
  "",
  "要报的，分两类：",
  '  kind = "meaning"（意思不对，必须改）',
  "  - 卡片写了引文里没有的信息（引文说「缓解」，卡片写「治好」）",
  "  - 卡片与引文矛盾（引文说「某些人不要做」，卡片写成「所有人都适合」）",
  "  - 卡片把引文里的限定词丢了（引文说「大约 3 天」，卡片写「3 天」）",
  "  - 卡片把谨慎的说法说成了确定（引文说「指向」，卡片写「判断为」）",
  "",
  '  kind = "coverage"（意思没错，只是引文没覆盖全）',
  "  - 卡片写的这句话基本忠于原文，但它那条引文只覆盖了其中一部分",
  "  - 这种情况卡片内容往往是对的，要做的是把引文换得更完整",
  "",
  "不要报的：",
  "  - 措辞不同但意思一致（引文「每天 50 次」写成「一天做 50 回」不算问题）",
  "  - 数字与引文不一致 —— 机器已经查过，别管",
  "  - 引文本身不是原文逐字 —— 机器已经查过，别管",
  "",
  "输出**只有一个 JSON 对象**，不要任何解释、不要 markdown 代码围栏：",
  '{"issues": [{"cardId": "卡 id", "path": "字段路径", "kind": "meaning|coverage", "reason": "一句话说清哪里不对"}]}',
  "",
  "没有问题就输出 {\"issues\": []}。",
  "path 用这些写法：remind.text / effect.text / dose[0].what / steps.<步骤id>.text /",
  "cautions[0].text / notices[0].text。",
].join("\n");

/** 把这一篇的卡压成给模型看的文本。 */
export function buildAuditPrompt(article: ArticleCards): string {
  const lines: string[] = [];
  lines.push(`文章：${article.article}`);
  lines.push("");
  for (const card of article.cards) {
    lines.push(`## 卡 ${card.id}`);
    const show = (path: string, text: string, quote: string | string[]) => {
      const q = Array.isArray(quote) ? quote.join(" / ") : quote;
      lines.push(`- ${path}`);
      lines.push(`  引文：${q}`);
      lines.push(`  文字：${text}`);
    };
    show("remind.text", card.remind.text, card.remind.quote);
    if (card.effect) show("effect.text", card.effect.text, card.effect.quote);
    for (const [i, d] of (card.dose ?? []).entries()) {
      show(`dose[${i}].what`, d.what, d.quote);
    }
    for (const s of card.steps) show(`steps.${s.id}.text`, s.text, s.quote);
    for (const [i, c] of (card.cautions ?? []).entries()) {
      show(`cautions[${i}].text`, c.text, c.quote);
    }
    for (const [i, n] of (card.notices ?? []).entries()) {
      show(`notices[${i}].text`, n.text, n.quote);
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** 从模型回复里取出 JSON（它有时会加围栏或前后废话）。 */
export function extractJson(text: string): {
  issues: { cardId: string; path?: string; kind?: string; reason: string }[];
} {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) {
    throw new Error("模型回复里没有 JSON");
  }
  const parsed = JSON.parse(body.slice(start, end + 1)) as {
    issues?: { cardId?: string; path?: string; kind?: string; reason?: string }[];
  };
  const issues = (parsed.issues ?? [])
    .filter((i) => typeof i.cardId === "string" && typeof i.reason === "string")
    .map((i) => ({
      cardId: i.cardId!,
      path: i.path,
      kind: i.kind,
      reason: i.reason!,
    }));
  return { issues };
}

/**
 * 按字段路径取出卡片自己的文字与它的引文。
 *
 * 为什么要取：报告里如果只有「为什么可疑」，审阅的人还得自己去开卡片文件
 * 才能判断。把「卡片写了什么」和「引文是什么」并排放出来，一眼就能看完 ——
 * 这正是 P3 退出条件「人工审阅 ≤ 10 分钟 / 篇」要的东西。
 */
export function fieldOf(card: Card, path: string): { text: string; quote: string | string[] } | null {
  const q = (v: string | string[] | undefined) => v ?? "";
  if (path === "remind.text") return { text: card.remind.text, quote: card.remind.quote };
  if (path === "effect.text" && card.effect) return { text: card.effect.text, quote: card.effect.quote };
  if (path === "duration.text" && card.duration) return { text: "", quote: q(card.duration.quote) };

  let m = /^dose\[(\d+)\]\.what$/.exec(path);
  if (m) {
    const d = card.dose?.[Number(m[1])];
    return d ? { text: d.what, quote: d.quote } : null;
  }
  m = /^steps\.([^.]+)\.text$/.exec(path);
  if (m) {
    const s = card.steps.find((x) => x.id === m![1]);
    return s ? { text: s.text, quote: s.quote } : null;
  }
  m = /^cautions\[(\d+)\]\.text$/.exec(path);
  if (m) {
    const c = card.cautions?.[Number(m[1])];
    return c ? { text: c.text, quote: c.quote } : null;
  }
  m = /^notices\[(\d+)\]\.text$/.exec(path);
  if (m) {
    const n = card.notices?.[Number(m[1])];
    return n ? { text: n.text, quote: n.quote } : null;
  }
  m = /^variants\.(\w+)\.replace\.text$/.exec(path);
  if (m) {
    const v = card.variants?.[m[1] as "busy" | "travel" | "sick"]?.replace;
    return v ? { text: v.text, quote: v.quote } : null;
  }
  return null;
}

/**
 * 审一篇文章的语义问题。
 *
 * 模型不可靠：它可能报一堆其实没问题的东西，也可能漏。
 * 所以这里的定位是「提示人去看一眼」，不是「判定有问题」。
 */
export async function auditArticleSemantics(
  article: ArticleCards,
  client: LlmClient,
): Promise<Issue[]> {
  const raw = await client.complete({ system: SYSTEM, user: buildAuditPrompt(article) });
  const parsed = extractJson(raw);
  const cards = new Map(article.cards.map((c) => [c.id, c]));
  return parsed.issues
    .filter((i) => cards.has(i.cardId))
    .map((i) => {
      const issue: Issue = {
        cardId: i.cardId,
        path: i.path,
        // 「意思不对」是必须改的，「引文没覆盖全」是换引文的事 —— 两类要分开，
        // 否则审阅的人得自己再分一遍，分不出轻重。
        verdict: i.kind === "coverage" ? ("narrow" as const) : ("suspect" as const),
        reason: i.reason,
      };
      const card = cards.get(i.cardId)!;
      if (i.path) {
        const field = fieldOf(card, i.path);
        if (field) {
          issue.text = field.text;
          issue.quote = field.quote;
        }
      }
      return issue;
    });
}
