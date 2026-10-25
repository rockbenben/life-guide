/**
 * 审阅报告：给人看的那一份。
 *
 * 排序规则：**存疑的排前面**。审阅的时间应该花在有问题的地方，
 * 没问题的卡只需要扫一眼标题就知道。
 */
import type { ArticleAudit, AuditResult, Issue, Verdict } from "./index.ts";

/** 把两批审阅结果并成一批：同一篇以新的为准。 */
export function mergeAudits(
  previous: ArticleAudit[],
  current: ArticleAudit[],
): AuditResult {
  const byArticle = new Map<string, ArticleAudit>();
  for (const a of previous) byArticle.set(a.article, a);
  for (const a of current) byArticle.set(a.article, a);

  const articles = [...byArticle.values()].sort((a, b) => a.article.localeCompare(b.article));
  const stats = { cards: 0, ok: 0, suspect: 0, narrow: 0, duplicate: 0 };
  for (const a of articles) {
    for (const c of a.cards) {
      stats.cards++;
      if (!c.issues.length) stats.ok++;
      else if (c.issues.some((i) => i.verdict === "suspect")) stats.suspect++;
      else if (c.issues.some((i) => i.verdict === "narrow")) stats.narrow++;
      else stats.duplicate++;
    }
  }
  return { articles, stats };
}

const MARK: Record<Verdict, string> = {
  suspect: "⚠️",
  narrow: "ⓘ",
  duplicate: "⧉",
  ok: "✅",
};

const VERDICT_NAME: Record<Verdict, string> = {
  suspect: "意思不对，必须改",
  narrow: "意思没错，引文没覆盖全（换引文即可）",
  duplicate: "与另一张卡重复（该合并）",
  ok: "没问题",
};

function line(issue: Issue): string {
  const where = issue.path ? ` \`${issue.path}\`` : "";
  const out = [`  - ${MARK[issue.verdict]}${where} ${issue.reason}`];
  // 卡片写的与引文写的并排放出来：不这样，审阅的人还得自己去开卡片文件才能判断。
  if (issue.text || issue.quote) {
    const quote = Array.isArray(issue.quote) ? issue.quote.join(" / ") : issue.quote;
    if (quote) out.push(`      引文：${quote}`);
    if (issue.text) out.push(`      卡片：${issue.text}`);
  }
  return out.join("\n");
}

export function renderReport(result: AuditResult, generatedAt: string): string {
  const out: string[] = [];
  out.push("# 审阅报告");
  out.push("");
  out.push(`生成时间：${generatedAt}`);
  out.push("");
  out.push(
    `共 ${result.stats.cards} 张卡 · 没发现问题 ${result.stats.ok} 张 · 意思不对 ${result.stats.suspect} 张 · 引文没覆盖全 ${result.stats.narrow} 张 · 重复 ${result.stats.duplicate} 张`,
  );
  out.push("");
  out.push(
    "「存疑」是工具的提示，不是判决 —— 机器查不出语义改写，只能把可疑的地方挑出来给你看。",
  );
  out.push("");
  out.push("| 标记 | 意思 |");
  out.push("| --- | --- |");
  for (const v of ["suspect", "narrow", "duplicate"] as const) {
    out.push(`| ${MARK[v]} | ${VERDICT_NAME[v]} |`);
  }
  out.push("");
  out.push("逐条看完、确认没问题后签字：`npm run content:review -- <cardId> --by <名字>`");
  out.push("");

  for (const article of result.articles) {
    const suspect = article.cards.filter((c) => c.issues.length > 0);
    const clean = article.cards.filter((c) => c.issues.length === 0);
    out.push(`## ${article.article}`);
    out.push("");
    if (!suspect.length) {
      out.push(`✅ ${clean.length} 张卡都没发现问题。`);
      out.push("");
      continue;
    }
    for (const card of suspect) {
      out.push(`### ${card.cardId}`);
      // 意思不对的排前面：那是必须改的，引文没覆盖全的是换引文的事
      const order: Record<string, number> = { suspect: 0, narrow: 1, duplicate: 2 };
      const sorted = [...card.issues].sort(
        (a, b) => (order[a.verdict] ?? 3) - (order[b.verdict] ?? 3),
      );
      for (const issue of sorted) out.push(line(issue));
      out.push("");
    }
    if (clean.length) {
      out.push(`（另有 ${clean.length} 张卡没发现问题：${clean.map((c) => c.cardId).join("、")}）`);
      out.push("");
    }
  }
  return out.join("\n");
}

export function summarize(result: AuditResult): string[] {
  const lines: string[] = [];
  for (const article of result.articles) {
    const suspect = article.cards.filter((c) => c.issues.length > 0);
    if (!suspect.length) continue;
    lines.push(`${article.article}：${suspect.length} 张卡待看`);
    for (const card of suspect) {
      const order: Record<string, number> = { suspect: 0, narrow: 1, duplicate: 2 };
      const sorted = [...card.issues].sort(
        (a, b) => (order[a.verdict] ?? 3) - (order[b.verdict] ?? 3),
      );
      for (const issue of sorted) {
        lines.push(`  ${MARK[issue.verdict]} ${card.cardId}${issue.path ? ` · ${issue.path}` : ""} — ${issue.reason}`);
      }
    }
  }
  return lines;
}
