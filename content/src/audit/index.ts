/**
 * 审阅工具：帮人看草稿。
 *
 * 为什么需要它：P3 的退出条件之一是「人工审阅 ≤ 10 分钟 / 篇」。
 * 现在有 96 篇、500 多张卡，靠 `git diff` 一张张读是不现实的。
 * 所以这里做的是**分流**：把机器能判的先判掉，把机器判不了的挑出来，
 * 让人只盯住少数几张存疑的卡。
 *
 * 两条分工：
 *   · 机械检查（mechanical.ts）：重复、缺禁忌、字段比例异常 —— 不用模型。
 *   · 语义检查（semantic.ts）：「text 是不是 quote 的忠实转述」——
 *     这是 R1/R2 查不出来的那一类：引文逐字，但卡片自己添了原文没有的话。
 *
 * **这个工具不签字。** 签字是人的判断（AGENTS.md §4.3），工具只出报告。
 */

export type Verdict = "ok" | "suspect" | "duplicate" | "narrow";

export interface Issue {
  /** 卡 id */
  cardId: string;
  /** 字段路径，如 steps.pain-relief.text */
  path?: string;
  verdict: Verdict;
  /** 为什么可疑 —— 要具体到能直接判断 */
  reason: string;
  /** 引用原文的引文 */
  quote?: string | string[];
  /** 卡片自己写的文字 */
  text?: string;
}

export interface CardAudit {
  cardId: string;
  article: string;
  /** 该卡的问题；空数组 = 没发现问题 */
  issues: Issue[];
}

export interface ArticleAudit {
  article: string;
  cards: CardAudit[];
  /**
   * 审这一篇时用的工具版本。
   *
   * 提示词一改，之前的结论就不作数了（比如加了「意思不对 / 引文没覆盖全」的区分）。
   * 所以续跑时只跳过**用当前版本**审过的篇，旧版本的要重审。
   */
  version?: number;
}

export interface AuditResult {
  articles: ArticleAudit[];
  /** 统计 */
  stats: {
    cards: number;
    ok: number;
    /** 意思不对，必须改 */
    suspect: number;
    /** 意思没错，引文没覆盖全 */
    narrow: number;
    duplicate: number;
  };
}
