/**
 * 忙档预算（R7）与审阅签字（R12）。
 *
 * 两者是同一套机制：**记录当时的状态，状态一变旧签字自动失效。**
 * 签字如果永不过期等于没有 —— 忙档成员加了卡、卡片内容改了，旧签字却还「有效」，
 * 那这道闸门形同虚设。
 */
import type { ArticleCards, Card } from "./cards/load.ts";
import { fingerprint } from "./cards/fingerprint.ts";

export interface BusyBudget {
  members: string[];
  acknowledged?: {
    snapshot: { total_sec: number | null; unknown: string[] };
    by: string;
    date: string;
    note: string;
  }[];
}

export interface BusyComputation {
  totalSec: number | null;
  unknown: string[];
  known: { cardId: string; sec: number; derived: boolean }[];
}

/** 算出忙档当前的耗时状况。任一卡耗时未知则总时长不可知。 */
export function computeBusy(
  members: string[],
  all: ArticleCards[],
): BusyComputation {
  const known: BusyComputation["known"] = [];
  const unknown: string[] = [];
  let total = 0;

  for (const cardId of members) {
    let card: Card | undefined;
    for (const a of all) {
      const hit = a.cards.find((c) => c.id === cardId);
      if (hit) {
        card = hit;
        break;
      }
    }
    if (!card) {
      unknown.push(cardId);
      continue;
    }
    const d = card.duration;
    if (!d || d.basis === "unknown" || d.sec === undefined) {
      unknown.push(cardId);
      continue;
    }
    known.push({ cardId, sec: d.sec, derived: d.basis === "derived" });
    total += d.sec;
  }

  return {
    totalSec: unknown.length ? null : total,
    unknown,
    known,
  };
}

function sameSnapshot(
  a: BusyComputation,
  b: { total_sec: number | null; unknown: string[] } | undefined,
): boolean {
  // 确认条目可能漏写 snapshot —— 那不是「与当前状态一致」，也别在这里崩
  if (!b) return false;
  if (a.totalSec !== b.total_sec) return false;
  const x = [...a.unknown].sort().join(",");
  const y = [...(b.unknown ?? [])].sort().join(",");
  return x === y;
}

/** R7：忙档预算是否已被当前状态的有效确认覆盖。 */
export function checkBusyBudget(
  budget: BusyBudget | null,
  all: ArticleCards[],
): { ok: boolean; computation: BusyComputation; reason?: string } {
  const members = budget?.members ?? [];
  const computation = computeBusy(members, all);
  // 没有预算文件 = 没有忙档成员 = 空集，R7 空真通过。
  // P1 填上 members 之后，这条规则才开始起作用。
  if (!budget || members.length === 0) return { ok: true, computation };
  const over = computation.totalSec !== null && computation.totalSec > 300;
  const hasUnknown = computation.unknown.length > 0;
  if (!over && !hasUnknown) return { ok: true, computation };

  const acks = budget.acknowledged ?? [];
  // 确认条目漏了 snapshot：核对不了，要说清楚是哪一条
  const brokenAck = acks.find((a) => !a?.snapshot);
  if (brokenAck) {
    return {
      ok: false,
      computation,
      reason: `忙档确认条目缺 snapshot（无法核对当前状态）：${JSON.stringify(brokenAck)}`,
    };
  }

  const ack = acks.find((a) => sameSnapshot(computation, a.snapshot));
  if (!ack) {
    return {
      ok: false,
      computation,
      reason: over
        ? `忙档总时长 ${computation.totalSec} 秒 > 300 秒，且没有与当前状态一致的确认`
        : `忙档有 ${computation.unknown.length} 张卡耗时未知，且没有与当前状态一致的确认`,
    };
  }
  return { ok: true, computation };
}

/** R12：审阅签字是否有效（存在、且指纹与当前卡片内容相符）。 */
export function checkReviewSignature(card: Card): { ok: boolean; reason?: string } {
  if (card.status !== "reviewed") return { ok: true }; // draft 不需要签字
  if (!card.review) {
    return { ok: false, reason: "status=reviewed 但没有签字" };
  }
  const now = fingerprint(card);
  if (card.review.hash !== now) {
    return {
      ok: false,
      reason: `签字指纹 ${card.review.hash} 与当前内容指纹 ${now} 不符（卡片被改过，需重新审阅）`,
    };
  }
  return { ok: true };
}
