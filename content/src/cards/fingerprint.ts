/**
 * 卡片内容指纹：用于 R12 审阅签字的失效判定。
 *
 * 关键点：**排除 review 字段本身** —— 否则写入签字这一步本身就会改变指纹，
 * 签字立刻失效。也要排除 status：draft → reviewed 是签字流程的一部分。
 */
import { createHash } from "node:crypto";

import type { Card } from "./load.ts";

/** 稳定序列化：键按字典序，值递归规范化。 */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([k]) => k !== "review" && k !== "status")
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, stable(v)]));
  }
  return value;
}

export function fingerprint(card: Card): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(card)))
    .digest("hex")
    .slice(0, 16);
}
