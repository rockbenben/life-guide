/**
 * 给问题条目补上「卡片写了什么」与「引文是什么」。
 *
 * 条目里本来就带着字段路径（steps.xxx.text），卡片数据也在仓库里，
 * 所以这两行不需要模型参与 —— 补出来的东西不会与模型说的不一致。
 *
 * 为什么要补：报告里只有「哪里可疑」的话，审阅的人还得自己去开卡片文件
 * 才能判断；并排放出来才是能一眼看完的东西。
 */
import type { Card } from "../cards/load.ts";
import { fieldOf } from "./semantic.ts";
import type { ArticleAudit } from "./index.ts";

export function enrichIssues(
  articles: ArticleAudit[],
  cards: Map<string, Card>,
): ArticleAudit[] {
  return articles.map((article) => ({
    ...article,
    cards: article.cards.map((c) => {
      const card = cards.get(c.cardId);
      if (!card) return c;
      return {
        ...c,
        issues: c.issues.map((issue) => {
          if (!issue.path || issue.text || issue.quote) return issue;
          const field = fieldOf(card, issue.path);
          if (!field) return issue;
          return { ...issue, text: field.text, quote: field.quote };
        }),
      };
    }),
  }));
}
