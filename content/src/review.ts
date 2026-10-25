/**
 * R12：审阅签字。
 *
 * 「draft → reviewed」只能由人运行 `content review <cardId>` 完成，它写入
 * 签字 { by, date, hash }，hash 是该卡片当时内容的指纹。卡片之后被任何人
 * （含 bot）改动，指纹对不上即视为未审阅，构建时剔除。
 *
 * 为什么不用 PR approvals：这是个人项目，GitHub 不允许自己批准自己的 PR。
 * 签字 + 内容指纹在单人和多人下都成立，而且与忙档预算（§5.3）是同一套机制。
 */
import { checkReviewSignature } from "./budget.ts";
import type { Rule } from "./rules/index.ts";

export const r12Check: Rule = (ctx) => {
  const out = [];
  for (const card of ctx.article.cards) {
    const r = checkReviewSignature(card);
    if (!r.ok) {
      out.push({
        rule: "R12",
        level: "error" as const,
        file: ctx.file,
        cardId: card.id,
        path: "review",
        message: r.reason ?? "",
      });
    }
  }
  return out;
};
