/**
 * 「多久做一次」：同一份日常里，不是每张卡都该每天出现。
 *
 * 原文里明确写「每周累计 60 分钟」「每月一次」的动作，如果当成每日卡，
 * 今天页会天天摆着它；盖一次印也不代表这个周期完成。这里只解决可见性：
 *   · 每天：照旧每天出现；
 *   · 每周 / 每月：本周期没做完就出现，做完后收进「本周期已完成」，下周期再出来。
 *
 * 默认从卡片自己的提醒语判断（只认明确写了「每周」「每月」的），
 * 判断不了就是每天 —— 不猜原文没说的周期。
 */
import type { Card } from "./routine.ts";

export type Cadence = "daily" | "weekly" | "monthly";

export const CADENCE_LABELS: Record<Cadence, string> = {
  daily: "每天",
  weekly: "每周",
  monthly: "每月",
};

export const CADENCES: Cadence[] = ["daily", "weekly", "monthly"];

export function defaultCadenceOf(card: Pick<Card, "remind">): Cadence {
  const text = String(card.remind?.text ?? "");
  if (/每月|每个月/.test(text)) return "monthly";
  if (/每周/.test(text)) return "weekly";
  return "daily";
}

function dateOf(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00`);
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** 这一天落在哪个周期：月 = YYYY-MM；周 = 该周周一（YYYY-MM-DD）；天 = 当天。 */
export function periodKeyOf(isoDate: string, cadence: Cadence): string {
  if (cadence === "monthly") return isoDate.slice(0, 7);
  if (cadence === "weekly") {
    const d = dateOf(isoDate);
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return ymd(d);
  }
  return isoDate;
}

/**
 * 这张卡在本周期有没有完成记录。
 *
 * 周期卡优先看 periodDone 标记：true 是完成，false 是撤销过的历史。
 * 没有标记的旧事件按旧规则兼容；但一旦本周期存在 false，就不再把
 * 旧事件当成完成 —— 否则撤销后卡还会躲在「本周期已完成」里。
 */
export function doneInPeriod(
  events: {
    date: string;
    cardId: string;
    periodDone?: boolean;
    periodCadence?: "weekly" | "monthly";
  }[],
  cardId: string,
  today: string,
  cadence: Cadence,
): boolean {
  if (cadence === "daily") {
    return events.some(
      (e) => e.cardId === cardId && e.date === today && e.periodDone !== false,
    );
  }
  const key = periodKeyOf(today, cadence);
  const inPeriod = events.filter(
    (e) => e.cardId === cardId && periodKeyOf(e.date, cadence) === key,
  );
  const marked = inPeriod.filter(
    (e) =>
      e.periodDone !== undefined &&
      (e.periodCadence === undefined || e.periodCadence === cadence),
  );
  if (marked.some((e) => e.periodDone === true)) return true;
  if (marked.some((e) => e.periodDone === false)) return false;
  // 没有标记的旧事件才走兼容兜底；别的频率留下的标记不能冒充当前频率
  return inPeriod.some((e) => e.periodDone === undefined);
}

/** 周期完成后的提示。 */
export function periodDoneText(cadence: Cadence): string {
  return cadence === "weekly" ? "本周已完成" : "本月已完成";
}
