/**
 * 审阅编排：机械检查 + 语义检查 → 一份报告。
 *
 * 语义检查要调模型，所以它可能很慢（每篇一次调用）。慢就慢 ——
 * 审阅本来就该慢，快出来的结论没人敢签。
 */
import type { ArticleCards } from "../cards/load.ts";
import type { SourceIndex } from "../source/parse.ts";
import type { LlmClient } from "../extract/llm.ts";

import type { ArticleAudit, AuditResult, Issue } from "./index.ts";
import { auditCardMechanically } from "./mechanical.ts";
import { auditArticleSemantics } from "./semantic.ts";
import { AUDIT_VERSION } from "./state.ts";

export interface AuditOptions {
  articles: ArticleCards[];
  /** 文章路径 → 快照解析结果 */
  sources: Map<string, SourceIndex>;
  /** 不传就只跑机械检查 */
  client?: LlmClient;
  /** 每处理完一篇回调一次 */
  onProgress?: (done: number, total: number) => void;
  /**
   * 每处理完一篇把当前结果回调出去（用来增量写报告）。
   *
   * 语义检查要跑几十分钟，报告只在最后写的话，中途断了就全丢 ——
   * 所以每篇做完就落一次盘。
   */
  onPartial?: (result: AuditResult) => void;
  /** 语义检查的并发数（默认 4） */
  concurrency?: number;
}

export async function runAudit(opts: AuditOptions): Promise<AuditResult> {
  const audits: ArticleAudit[] = [];
  let ok = 0;
  let suspect = 0;
  let narrow = 0;
  let duplicate = 0;

  // 机械检查先把每篇的卡摊开：这一步不调模型，全同步，很快。
  const prepared = opts.articles.map((article) => {
    const source = opts.sources.get(article.article);
    const cards: { cardId: string; article: string; issues: Issue[] }[] = [];
    for (const card of article.cards) {
      const issues = source ? auditCardMechanically(card, article, source) : [];
      cards.push({ cardId: card.id, article: article.article, issues });
    }
    return { article, source, cards };
  });

  // 语义检查要调模型，串行的话 90 多篇要跑几十分钟 —— 并发跑。
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  let cursor = 0;
  let done = 0;
  /** 已完成的篇目，按完成的顺序（报告按这个顺序写，人读起来是顺的） */
  const finished: { item: (typeof prepared)[number]; index: number }[] = [];

  const snapshot = (): AuditResult => {
    const stats = { cards: 0, ok: 0, suspect: 0, narrow: 0, duplicate: 0 };
    const articles = finished
      .slice()
      .sort((a, b) => a.index - b.index)
      .map(({ item }) => {
        for (const c of item.cards) {
          stats.cards++;
          if (!c.issues.length) stats.ok++;
          else if (c.issues.some((i) => i.verdict === "suspect")) stats.suspect++;
          else if (c.issues.some((i) => i.verdict === "narrow")) stats.narrow++;
          else stats.duplicate++;
        }
        return {
          article: item.article.article,
          version: AUDIT_VERSION,
          cards: item.cards.map((c) => ({ cardId: c.cardId, article: c.article, issues: c.issues })),
        };
      });
    return { articles, stats };
  };

  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= prepared.length) return;
      const item = prepared[i];
      if (opts.client && item.source) {
        try {
          const semantic = await auditArticleSemantics(item.article, opts.client);
          for (const issue of semantic) {
            const hit = item.cards.find((c) => c.cardId === issue.cardId);
            if (hit) hit.issues.push(issue);
          }
        } catch (err) {
          // 模型这一篇挂了不能拖垮整篇：记下来，人自己看
          item.cards.push({
            cardId: "(语义检查失败)",
            article: item.article.article,
            issues: [
              {
                cardId: "(语义检查失败)",
                verdict: "suspect",
                reason: `模型没给出可用结果，这篇要全人工看：${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          });
        }
      }
      finished.push({ item, index: i });
      done++;
      opts.onProgress?.(done, prepared.length);
      opts.onPartial?.(snapshot());
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, prepared.length) }, worker),
  );

  for (const item of prepared) {
    for (const c of item.cards) {
      if (!c.issues.length) {
        ok++;
        continue;
      }
      if (c.issues.some((i) => i.verdict === "suspect")) suspect++;
      else if (c.issues.some((i) => i.verdict === "narrow")) narrow++;
      else duplicate++;
    }
    audits.push({
      article: item.article.article,
      version: AUDIT_VERSION,
      cards: item.cards.map((c) => ({ cardId: c.cardId, article: c.article, issues: c.issues })),
    });
  }

  return { articles: audits, stats: { cards: ok + suspect + narrow + duplicate, ok, suspect, narrow, duplicate } };
}