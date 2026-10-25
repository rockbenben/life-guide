/**
 * 卡片上的提示分级与纯文本清理。
 *
 * 从 domain/manual.ts 拆出来：今天页的卡片也要用这些，但卡片不该为了
 * 四个小函数把整本手册的 markdown 渲染器（marked）拖进首屏。
 */
import type { Card } from "./routine.ts";

export type NoticeLevel = "seek-care" | "with-doctor" | "info";

export interface Notice {
  level: NoticeLevel;
  text: string;
  quote?: string | string[];
}

/** 提示的显示名。分级从重到轻：seek-care 最醒目。 */
export const NOTICE_LABELS: Record<NoticeLevel, string> = {
  "seek-care": "该就医",
  "with-doctor": "遵医嘱",
  info: "参考",
};

const NOTICE_ORDER: NoticeLevel[] = ["seek-care", "with-doctor", "info"];

/** 按严重程度排序：seek-care（该就医）→ with-doctor（遵医嘱）→ info（一般知识）。 */
export function sortNotices(notices: Notice[]): Notice[] {
  return [...notices].sort(
    (a, b) => NOTICE_ORDER.indexOf(a.level) - NOTICE_ORDER.indexOf(b.level),
  );
}

/**
 * 收起态也要显示的提示：只有 seek-care。
 *
 * 「出现某症状应就医」折叠起来等于没有 —— 用户多数时候只扫一眼收起态。
 */
export function urgentNotices(notices: Notice[]): Notice[] {
  return notices.filter((n) => n.level === "seek-care");
}

/** 疾病卡：只出现在手册里，不进今日清单、不可勾选。 */
export function isConditionCard(card: Pick<Card, "articleKind">): boolean {
  return card.articleKind === "condition";
}

/**
 * 清掉正文里的 markdown 残留。
 *
 * 卡片上的文字是纯文本（引文抄的是原文那句话），但原文那句话里可能夹着
 * 排版记号（`**`、`[!TIP]`）—— 那是记号不是内容，留在屏幕上只是噪音。
 * 手册正文走 markdown 渲染，不用这个函数（见 domain/markdown.ts）。
 */
export function plainText(text: string): string {
  return (
    text
      .replace(/\[!(TIP|NOTE|WARNING|CAUTION|IMPORTANT)\]/gi, "")
      // 快照正文里残留的脚注记号（`^[「涙」のトリセツ]`）：那是排版记号不是内容
      .replace(/\s*\^\[[^\]\n]*\]/g, "")
      .replace(/\*\*/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}
