/**
 * 审阅辅助的单元测试。
 *
 * 这里守的是「别把人带偏」：审阅工具如果老报错，人就会开始无视它的提示，
 * 那它就白做了。所以宁可少报，也不能把干净的卡也标成存疑。
 */
import { describe, expect, it } from "vitest";

import { parseMarkdown } from "../src/source/parse.ts";
import { auditCardMechanically, similarity } from "../src/audit/mechanical.ts";
import { extractJson } from "../src/audit/semantic.ts";
import { mergeAudits } from "../src/audit/report.ts";
import { enrichIssues } from "../src/audit/enrich.ts";
import { runAudit } from "../src/audit/run.ts";
import type { ArticleCards, Card } from "../src/cards/load.ts";
import type { LlmClient } from "../src/extract/llm.ts";

const ARTICLE_MD = `---
title: 测试文章
---

## 每天 50 次快速踮脚尖

说明书的标准是每天 50 次，动作连贯快速进行。

## 哪些人不要做

- 膝盖或腰部患有疾病的人不要做。
`;

function articleOf(cards: Card[]): ArticleCards {
  return {
    article: "the-savvy-life-manual/body-care/test.md",
    kind: "practice",
    coverage: "partial",
    cards,
  };
}

function cardOf(over: Partial<Card> = {}): Card {
  return {
    id: "calf-raise",
    status: "draft",
    source: { anchor: "每天 50 次快速踮脚尖" },
    remind: { text: "每天 50 次", quote: "每天 50 次" },
    steps: [{ id: "prepare", text: "将脚尖踮起", quote: "将脚尖踮起" }],
    ...over,
  };
}

describe("similarity", () => {
  it("完全一样是 1", () => {
    expect(similarity("每天 50 次", "每天 50 次")).toBe(1);
  });

  it("毫不相干接近 0", () => {
    expect(similarity("每天 50 次", "坐浴泡 15 分钟")).toBeLessThan(0.2);
  });
});

describe("auditCardMechanically", () => {
  const source = parseMarkdown(ARTICLE_MD);

  it("干净��卡没有问题", () => {
    const card = cardOf({
      cautions: [{ level: "stop", text: "膝盖或腰部患有疾病的人不要做", quote: "膝盖或腰部患有疾病的人不要做。" }],
    });
    expect(auditCardMechanically(card, articleOf([card]), source)).toEqual([]);
  });

  it("原文的禁忌小节没被任何卡引用 → 标出来", () => {
    const card = cardOf();
    const issues = auditCardMechanically(card, articleOf([card]), source);
    expect(issues.some((i) => i.path === "cautions")).toBe(true);
    expect(issues[0].reason).toContain("哪些人不要做");
  });

  it("禁忌被引用了就不报", () => {
    const card = cardOf({
      cautions: [{ level: "stop", text: "膝盖或腰部患有疾病的人不要做", quote: "膝盖或腰部患有疾病的人不要做。" }],
    });
    const issues = auditCardMechanically(card, articleOf([card]), source);
    expect(issues.some((i) => i.path === "cautions")).toBe(false);
  });

  it("两张卡讲同一件事 → 标为重复（只标一次）", () => {
    const a = cardOf({ id: "a", remind: { text: "每天踮脚 50 次", quote: "每天 50 次" } });
    const b = cardOf({ id: "b", remind: { text: "每天踮脚 50 次", quote: "每天 50 次" } });
    const article = articleOf([a, b]);
    const issuesA = auditCardMechanically(a, article, source);
    const issuesB = auditCardMechanically(b, article, source);
    expect(issuesA.filter((i) => i.verdict === "duplicate")).toHaveLength(1);
    expect(issuesB.filter((i) => i.verdict === "duplicate")).toHaveLength(0);
  });

  it("卡片文字远长于引文 → 标出来（多半加了原文没有的话）", () => {
    const card = cardOf({
      remind: {
        text: "每天踮脚 50 次，可以改善血液循环与下肢静脉回流，顺便缓解久站带来的腿酸",
        quote: "每天 50 次",
      },
    });
    const issues = auditCardMechanically(card, articleOf([card]), source);
    expect(issues.some((i) => i.path === "remind.text")).toBe(true);
  });

  it("步数过多 → 标出来", () => {
    const steps = Array.from({ length: 10 }, (_, i) => ({
      id: `s${i}`,
      text: `步骤 ${i}`,
      quote: `步骤 ${i}`,
    }));
    const card = cardOf({ steps });
    const issues = auditCardMechanically(card, articleOf([card]), source);
    expect(issues.some((i) => i.path === "steps")).toBe(true);
  });
});

describe("extractJson", () => {
  it("从带围栏的回复里取出 JSON", () => {
    const out = extractJson('```json\n{"issues":[{"cardId":"a","path":"remind.text","reason":"添了原文没有的话"}]}\n```');
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0].cardId).toBe("a");
  });

  it("从夹着废话的回复里取出 JSON", () => {
    const out = extractJson('好的，我看完了。{"issues":[]}');
    expect(out.issues).toEqual([]);
  });

  it("没有 JSON 就报错", () => {
    expect(() => extractJson("我看不出问题")).toThrow();
  });
});

describe("enrichIssues", () => {
  it("给旧结论补上引文与卡片文字（不用再问模型）", () => {
    const card = cardOf({
      cautions: [{ level: "stop", text: "膝盖或腰部患有疾病的人不要做", quote: "膝盖或腰部患有疾病的人不要做。" }],
    });
    const articles = [
      {
        article: "a.md",
        cards: [
          {
            cardId: "calf-raise",
            article: "a.md",
            issues: [{ cardId: "calf-raise", path: "remind.text", verdict: "suspect" as const, reason: "r" }],
          },
        ],
      },
    ];
    const enriched = enrichIssues(articles, new Map([["calf-raise", card]]));
    const issue = enriched[0].cards[0].issues[0];
    expect(issue.text).toBe("每天 50 次");
    expect(issue.quote).toBe("每天 50 次");
  });

  it("已经带文字的不覆盖", () => {
    const card = cardOf();
    const articles = [
      {
        article: "a.md",
        cards: [
          {
            cardId: "calf-raise",
            article: "a.md",
            issues: [
              {
                cardId: "calf-raise",
                path: "remind.text",
                verdict: "suspect" as const,
                reason: "r",
                text: "原来就在",
              },
            ],
          },
        ],
      },
    ];
    const enriched = enrichIssues(articles, new Map([["calf-raise", card]]));
    expect(enriched[0].cards[0].issues[0].text).toBe("原来就在");
  });
});

describe("mergeAudits", () => {
  it("续跑时把之前审过的结论并回来", () => {
    const previous = [
      { article: "a.md", cards: [{ cardId: "x", article: "a.md", issues: [] }] },
    ];
    const current = [
      {
        article: "b.md",
        cards: [
          { cardId: "y", article: "b.md", issues: [{ cardId: "y", verdict: "suspect" as const, reason: "r" }] },
        ],
      },
    ];
    const merged = mergeAudits(previous, current);
    expect(merged.articles.map((a) => a.article)).toEqual(["a.md", "b.md"]);
    expect(merged.stats).toEqual({ cards: 2, ok: 1, suspect: 1, narrow: 0, duplicate: 0 });
  });

  it("同一篇以新的为准", () => {
    const previous = [
      { article: "a.md", cards: [{ cardId: "x", article: "a.md", issues: [] }] },
    ];
    const current = [
      {
        article: "a.md",
        cards: [
          { cardId: "x", article: "a.md", issues: [{ cardId: "x", verdict: "suspect" as const, reason: "r" }] },
        ],
      },
    ];
    const merged = mergeAudits(previous, current);
    expect(merged.articles).toHaveLength(1);
    expect(merged.stats.suspect).toBe(1);
  });
});

describe("runAudit", () => {
  it("机械检查 + 语义检查合起来，统计对得上", async () => {
    const card = cardOf({
      cautions: [{ level: "stop", text: "膝盖或腰部患有疾病的人不要做", quote: "膝盖或腰部患有疾病的人不要做。" }],
    });
    const article = articleOf([card]);
    const source = parseMarkdown(ARTICLE_MD);
    const client: LlmClient = {
      complete: async () =>
        JSON.stringify({
          issues: [{ cardId: "calf-raise", path: "remind.text", reason: "卡片把「缓解」写成了「治好」" }],
        }),
    };
    const result = await runAudit({
      articles: [article],
      sources: new Map([[article.article, source]]),
      client,
    });
    expect(result.stats.cards).toBe(1);
    expect(result.stats.suspect).toBe(1);
    expect(result.articles[0].cards[0].issues.some((i) => i.reason.includes("治好"))).toBe(true);
  });

  it("问题里带上引文与卡片文字，审阅的人不用再开卡片文件", async () => {
    const card = cardOf({
      cautions: [{ level: "stop", text: "膝盖或腰部患有疾病的人不要做", quote: "膝盖或腰部患有疾病的人不要做。" }],
    });
    const article = articleOf([card]);
    const source = parseMarkdown(ARTICLE_MD);
    const client: LlmClient = {
      complete: async () =>
        JSON.stringify({
          issues: [{ cardId: "calf-raise", path: "remind.text", reason: "引文没覆盖全部" }],
        }),
    };
    const result = await runAudit({
      articles: [article],
      sources: new Map([[article.article, source]]),
      client,
    });
    const issue = result.articles[0].cards[0].issues[0];
    expect(issue.text).toBe("每天 50 次");
    expect(issue.quote).toBe("每天 50 次");
  });

  it("模型报了一个不存在的卡 id → 丢掉，不污染报告", async () => {
    // 这张卡本身是干净的：禁忌小节被引用了，机械检查不会报
    const card = cardOf({
      cautions: [{ level: "stop", text: "膝盖或腰部患有疾病的人不要做", quote: "膝盖或腰部患有疾病的人不要做。" }],
    });
    const article = articleOf([card]);
    const source = parseMarkdown(ARTICLE_MD);
    const client: LlmClient = {
      complete: async () => JSON.stringify({ issues: [{ cardId: "不存在的卡", reason: "瞎编的" }] }),
    };
    const result = await runAudit({
      articles: [article],
      sources: new Map([[article.article, source]]),
      client,
    });
    expect(result.articles[0].cards[0].issues).toEqual([]);
  });

  it("模型这一篇挂了 → 记下来，不让整批崩掉", async () => {
    const card = cardOf();
    const article = articleOf([card]);
    const source = parseMarkdown(ARTICLE_MD);
    const client: LlmClient = {
      complete: async () => {
        throw new Error("HTTP 500");
      },
    };
    const result = await runAudit({
      articles: [article],
      sources: new Map([[article.article, source]]),
      client,
    });
    expect(result.articles[0].cards.some((c) => c.issues.length > 0)).toBe(true);
  });
});
