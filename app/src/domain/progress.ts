/**
 * 事件日志 → 累计天数。
 *
 * 刻意不做「断签清零」：手册里「连续做 5～6 个月才显现效果」这种话，
 * 配上打卡软件的断签机制就是在劝人放弃。断签不清零；主动撤销一次周期完成
 * 会从可见累计里扣掉那一次，但原始事件仍留在日志里。
 */

export interface DoneEvent {
  date: string;
  cardId: string;
  variant: string;
  ts: number;
  periodDone?: boolean;
  periodCadence?: "weekly" | "monthly";
}

/**
 * 某张卡累计做了多少天。
 *
 * 同一天多次做只算一天 —— 一天做三遍踮脚不会让骨密度长得更快。
 */
export function daysDone(events: DoneEvent[], cardId: string): number {
  const days = new Set<string>();
  for (const e of events) {
    if (e.cardId === cardId && e.periodDone !== false) days.add(e.date);
  }
  return days.size;
}

/** 全部卡合计做过多少天（任一张卡做过即算一天；撤销过的周期完成不算）。 */
export function totalActiveDays(events: DoneEvent[]): number {
  return new Set(events.filter((e) => e.periodDone !== false).map((e) => e.date)).size;
}

/**
 * 某个时段（早/晚）有没有记录。
 *
 * 决策门要求「早晚两个时段都有记录」，否则说明只在方便的时候做，
 * 那不算真的融进生活。
 */
export function slotsWithRecords(
  events: DoneEvent[],
  slotOf: (ts: number) => string,
): Set<string> {
  const slots = new Set<string>();
  for (const e of events) {
    if (e.periodDone !== false) slots.add(slotOf(e.ts));
  }
  return slots;
}

/**
 * 最近若干天里，每天有没有留下记录（从最近一天往回数）。
 *
 * 页边那一排印迹用。它不是连续天数，也不参与任何判定 ——
 * 存在的意义恰恰是让人看见「断过，但没清零」。
 * dayOf 由调用方传入，避免这里自己再定一套日界线。
 */
export function recentActivity(
  events: DoneEvent[],
  days: number,
  now: number,
  dayOf: (ts: number) => string,
): boolean[] {
  const done = new Set(
    events.filter((e) => e.periodDone !== false).map((e) => e.date),
  );
  const out: boolean[] = [];
  for (let i = days - 1; i >= 0; i--) {
    // 取当天正午：凌晨那几小时属于「昨天」，用 00:00 减一天会算错格
    const noon = new Date(new Date(now).setHours(12, 0, 0, 0));
    noon.setDate(noon.getDate() - i);
    out.push(done.has(dayOf(noon.getTime())));
  }
  return out;
}
