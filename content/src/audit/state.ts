/**
 * 审阅进度：记住哪些篇审过、审出了什么。
 *
 * 为什么要这个：语义检查要几十分钟，凭据还可能中途过期。
 * 跟抽取流水线一样（已写盘的跳过），这里已审过的篇也跳过，
 * 换一份凭据再跑一次就补上了，不用从头再来。
 *
 * 存的是**结论**而不只是篇名：否则续跑之后的报告会缺掉已审的那几篇，
 * 报告就成了「这次审了什么」而不是「全部审出了什么」。
 */
import fs from "node:fs";
import path from "node:path";

import type { ArticleAudit } from "./index.ts";

export const AUDIT_STATE_FILE = "audit-state.json";

/**
 * 审阅工具的版本。提示词或判据变了就往上加一。
 *
 * 续跑时只跳过**当前版本**审过的篇：旧版本审出来的结论是按老标准判的，
 * 标准一换就得重来。
 */
export const AUDIT_VERSION = 2;

export interface AuditState {
  /** 已审过的篇及其结论 */
  articles: ArticleAudit[];
}

export function readAuditState(contentDir: string): Map<string, ArticleAudit> {
  const p = path.join(contentDir, AUDIT_STATE_FILE);
  const out = new Map<string, ArticleAudit>();
  if (!fs.existsSync(p)) return out;
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8")) as AuditState;
    for (const a of data.articles ?? []) out.set(a.article, a);
  } catch {
    // 状态文件坏了就当没有：从头再审一遍总比拿到半份报告强
  }
  return out;
}

export function writeAuditState(contentDir: string, articles: ArticleAudit[]): void {
  const p = path.join(contentDir, AUDIT_STATE_FILE);
  fs.writeFileSync(
    p,
    JSON.stringify({ articles }, null, 2) + "\n",
    "utf8",
  );
}
