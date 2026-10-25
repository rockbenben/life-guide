/**
 * 「一天」的边界与时段判定。
 *
 * 日界线定在凌晨 04:00，不是自然日 00:00：晚间的动作（睡前鼻腔冲洗、3T 保湿）
 * 常在 23:00 之后做，如果按自然日切，那些动作会算到第二天，而人是在夜里做的。
 * 04:00 之后才算「新的一天开始」，符合「晚上做的算昨天」的直觉。
 */

export const DAY_BOUNDARY_HOUR = 4;

export type Slot = "morning" | "daytime" | "evening" | "anytime";

/** 时段的显示名。 */
export const SLOT_LABELS: Record<Slot, string> = {
  morning: "早晨",
  daytime: "日间",
  evening: "晚间",
  anytime: "随时",
};

/** 可以手动切换的时段。「随时」不算 —— 它不是一段特定时间。 */
export const SWITCHABLE_SLOTS: Slot[] = ["morning", "daytime", "evening"];

/**
 * 本地日历日期（YYYY-MM-DD）。
 *
 * 与 dayOf 的区别：dayOf 有 04:00 的日界线（算「哪一天做的」），
 * 这里就是日历上的那一天 —— 提醒的日期用这个口径。
 * 不能用 toISOString()：那是 UTC，东八区的凌晨会算成前一天。
 */
export function localDate(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** 逻辑日的下一天（YYYY-MM-DD）—— 提醒的「明天」跟 04:00 日界线走。 */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + 1);
  return localDate(d.getTime());
}

/** 未知时段的显示名（退回原值，不猜）。 */
export function slotLabel(slot: string): string {
  return SLOT_LABELS[slot as Slot] ?? slot;
}

/** 把时间戳折算成「属于哪一天」的日期字符串（YYYY-MM-DD）。 */
export function dayOf(ts: number, boundaryHour = DAY_BOUNDARY_HOUR): string {
  const d = new Date(ts);
  const shifted = new Date(ts);
  if (d.getHours() < boundaryHour) {
    shifted.setDate(d.getDate() - 1);
  }
  const y = shifted.getFullYear();
  const m = String(shifted.getMonth() + 1).padStart(2, "0");
  const day = String(shifted.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * 按时段给卡片分组。
 *
 * 边界取自《每日仪式》：晨间（起床后到午前）、日间（白天）、晚间（傍晚到睡前）。
 * 00:00–03:59 仍算前一晚的「晚间」—— 与 dayOf 的 04:00 日界线同一口径。
 * 否则 00:43 的事件会记在前一天，却被算成新一天的早晨。
 */
export function slotOf(ts: number): Slot {
  const h = new Date(ts).getHours();
  if (h < DAY_BOUNDARY_HOUR) return "evening";
  if (h < 12) return "morning";
  if (h < 18) return "daytime";
  return "evening";
}
