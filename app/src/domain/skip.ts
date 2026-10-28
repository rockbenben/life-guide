/**
 * 「今天不做」：只跳过这一天，不改日常。
 *
 * 存在设置 `skipToday` 里：cardId → 逻辑日期（YYYY-MM-DD）。
 * 过了 04:00 日界线，日期对不上，卡自然回到清单 —— 不需要定时清理任务。
 */

export type Skips = Record<string, string>;

export function isSkippedToday(
  skips: Skips,
  cardId: string,
  today: string,
): boolean {
  return skips[cardId] === today;
}

/** 只留下仍在日常里的卡；永久移出后不该留下一条会误伤下次加回的跳过记录。 */
export function pruneSkips(skips: Skips, routineIds: string[]): Skips {
  const allowed = new Set(routineIds);
  return Object.fromEntries(
    Object.entries(skips).filter(([cardId]) => allowed.has(cardId)),
  );
}

/**
 * 标记某张卡今天不做。
 *
 * 只保留同一天的记录：前几天的跳过已经过期，留着只会让设置越积越长。
 */
export function markSkipped(
  skips: Skips,
  cardId: string,
  today: string,
  routineIds: string[],
): Skips {
  const kept = Object.entries(pruneSkips(skips, routineIds)).filter(
    ([, date]) => date === today,
  );
  return { ...Object.fromEntries(kept), [cardId]: today };
}

export function removeSkip(skips: Skips, cardId: string): Skips {
  const next = { ...skips };
  delete next[cardId];
  return next;
}
