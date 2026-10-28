/**
 * 提醒：什么时候响、响的时候说什么。
 *
 * 这一层是纯逻辑，不碰任何平台 API —— 平台差异全在 platform/notify.ts。
 * 「App 自己提醒」要三端都能用，就得先把「提醒是什么」与「怎么响」分开。
 *
 * 提醒有两种：
 *   · 整段的（cardId = null）—— 「早晨」「晚间」那两条，响的时候说这一段该做哪几件；
 *   · 绑在卡上的（cardId = 某张卡）—— 「这张卡该在什么时候做」的提醒。
 *
 * 时间支持四种模式（用户要的「多种模式」）：
 *   · daily    每天
 *   · weekly   每周几（可多选）
 *   · interval 每隔 N 天
 *   · once     某天某时（一次性）
 *
 * 「下一次是哪一刻」只有这一处算法（nextOccurrence）：桌面端、手机端、浏览器
 * 都从这里取时刻，主进程不另写一份日期算法（D7：推算 ≠ 原文，规则也别分叉）。
 */
import type { Card } from "./routine.ts";
import type { Cadence } from "./cadence.ts";
import { dayOf, localDate } from "./day.ts";
import { cardName, displayNames } from "./lines.ts";

export type ReminderMode = "daily" | "weekly" | "interval" | "once";

export interface Reminder {
  id: string;
  /** 绑在哪张卡上；null = 整段的通用提醒 */
  cardId: string | null;
  /** 屏上显示的名字（绑在卡上的是那张卡的名） */
  label: string;
  mode: ReminderMode;
  /** 本地时刻 "HH:MM" */
  time: string;
  /** 整段提醒落在哪一段（早晨 / 晚间）；绑在卡上的提醒不用它 */
  slot?: string;
  /** weekly：周几（0=周日 … 6=周六） */
  days?: number[];
  /** interval：每隔几天 */
  everyDays?: number;
  /** once：那天（YYYY-MM-DD）；interval 时当锚点用 */
  date?: string;
  on: boolean;
}

/** 排好的一次触发：给平台层用（谁响、什么时候、说什么）。 */
export interface ReminderSpec {
  id: string;
  /** 下一次触发（ISO） */
  at: string;
  title: string;
  body: string;
  /** 规则本身：系统排程（手机）要靠它表达重复 */
  rule: Reminder;
  /** 再往后几次（ISO）：桌面端主进程在渲染层不在时靠它续着响 */
  after: string[];
  /**
   * 这一次（at 那一次）被「今天不做」跳掉了。
   *
   * 手机端的系统排程靠 rule 表达重复，**表达不了「今天不算」** ——
   * 系统那条「每天 08:00」一旦排上，今天 08:00 就会响。
   * 知道这件事，手机端才能退成一串一次性通知：今天不响，明天起照常。
   */
  firstSkipped?: boolean;
}

export const MODE_LABELS: Record<ReminderMode, string> = {
  daily: "每天",
  weekly: "每周",
  interval: "隔几天",
  once: "就一次",
};

export const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

/** 默认的两条整段提醒（与日历导出的那两条一致）。 */
export const DEFAULT_REMINDERS: Reminder[] = [
  {
    id: "morning",
    cardId: null,
    label: "早晨",
    mode: "daily",
    time: "07:00",
    slot: "morning",
    on: true,
  },
  {
    id: "evening",
    cardId: null,
    label: "晚间",
    mode: "daily",
    time: "21:00",
    slot: "evening",
    on: true,
  },
];

/** 整段提醒的固定名字（旧设置里存的就是这两个 id）。 */
const KNOWN_LABELS: Record<string, string> = { morning: "早晨", evening: "晚间" };

/** 卡片级提醒的 id：一张卡一条。 */
export function cardReminderId(cardId: string): string {
  return `card:${cardId}`;
}

/** 新建一条卡片提醒时给的默认时刻：按这张卡属于哪一段来。 */
export function defaultTimeForSlot(slot?: string): string {
  if (slot === "morning") return "07:00";
  if (slot === "daytime") return "12:00";
  if (slot === "evening") return "21:00";
  return "09:00";
}

/**
 * 新建一条卡片提醒时给的默认模式：跟着这张卡的「多久做一次」。
 *
 * 周卡默认每周当天，月卡默认每隔 30 天（没有「每月」提醒模式，用间隔表达）。
 * 用户仍可在编辑器里改成每天 / 每周几 / 隔几天 / 就一次。
 */
export function defaultReminderFor(
  cadence: Cadence,
  now: Date = new Date(),
): Pick<Reminder, "mode" | "days" | "everyDays" | "date"> {
  if (cadence === "weekly") {
    return { mode: "weekly", days: [now.getDay()] };
  }
  if (cadence === "monthly") {
    return {
      mode: "interval",
      everyDays: 30,
      date: localDate(now.getTime()),
    };
  }
  return { mode: "daily" };
}

/** 校验一个 "HH:MM"；不合法返回 null。 */
export function parseTime(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time ?? "").trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function atTime(day: Date, time: string): Date {
  const t = parseTime(time);
  const d = new Date(day.getTime());
  d.setHours(t?.hour ?? 0, t?.minute ?? 0, 0, 0);
  return d;
}

/**
 * 下一次触发的时间；算不出来（一次性且已过去 / 每周没选日子）返回 null。
 *
 * from 是「现在」—— 传入是为了能测：同一个函数，换个 from 就换答案。
 */
export function nextOccurrence(reminder: Reminder, from: Date): Date | null {
  const t = parseTime(reminder.time);
  if (!t) return null;

  if (reminder.mode === "once") {
    if (!reminder.date) return null;
    const d = atTime(new Date(`${reminder.date}T00:00:00`), reminder.time);
    if (Number.isNaN(d.getTime())) return null;
    return d.getTime() > from.getTime() ? d : null;
  }

  if (reminder.mode === "daily") {
    const d = atTime(from, reminder.time);
    if (d.getTime() <= from.getTime()) d.setDate(d.getDate() + 1);
    return d;
  }

  if (reminder.mode === "weekly") {
    const days = (reminder.days ?? []).filter((d) => d >= 0 && d <= 6);
    if (!days.length) return null;
    for (let i = 0; i < 8; i++) {
      const day = new Date(from.getTime());
      day.setDate(day.getDate() + i);
      const d = atTime(day, reminder.time);
      if (days.includes(day.getDay()) && d.getTime() > from.getTime()) return d;
    }
    return null;
  }

  // interval：锚点日期 + 每隔 N 天
  const step = Math.max(1, Math.round(reminder.everyDays ?? 1));
  const anchor = reminder.date ? new Date(`${reminder.date}T00:00:00`) : new Date(from.getTime());
  if (Number.isNaN(anchor.getTime())) return null;
  const d = atTime(anchor, reminder.time);
  // 锚点那天的时刻可能还没到，也可能早过了 —— 往前推若干个间隔直到落在 now 之后。
  //
  // 步数**不能设上限**：起始日选在很久以前时（例如「每隔 1 天」从六年前开始），
  // 推不满上限就会掉出循环、返回 null —— 提醒就此静默消失，界面上还摆着它。
  // 步长至少是 1 天，循环自己会停。
  while (d.getTime() <= from.getTime()) {
    d.setDate(d.getDate() + step);
    // 步子大到日期都装不下（例如手输了一个九位数）：别把坏日期传下去
    // （下游 toISOString 会抛 RangeError，整轮排程就废了）
    if (Number.isNaN(d.getTime())) return null;
  }
  return d;
}

/**
 * 「下一次是哪一刻」的人话（编辑器里用）。
 *
 * 改了模式或时刻却看不到结果，用户只能先存下来、再回卡片上看 ——
 * 这句话把结果直接摆在设置旁边。排不出下一次时返回空串，
 * 由调用方去说「不会响」（两种语气不同，别混成一句）。
 */
export function nextOccurrenceText(reminder: Reminder, now: Date = new Date()): string {
  const d = nextOccurrence(reminder, now);
  if (!d) return "";
  const week = WEEKDAY_LABELS[d.getDay()];
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日（周${week}）${hh}:${mi}`;
}

/**
 * 连着几次的触发时刻。
 *
 * 桌面端主进程是常驻的，但渲染层未必在（窗口关掉）。给它备上后几次，
 * 它就能自己续着响，不必每次都回头问渲染层。
 */
export function occurrences(reminder: Reminder, from: Date, count = 3): Date[] {
  const out: Date[] = [];
  let cursor = from;
  for (let i = 0; i < count; i++) {
    const d = nextOccurrence(reminder, cursor);
    if (!d) break;
    out.push(d);
    // 下一轮要严格大于这一轮：+1 秒就够（同一时刻不该响两次）
    cursor = new Date(d.getTime() + 1000);
  }
  return out;
}

/**
 * 提醒里的建议：这一段该做哪几件。
 *
 * 用的是**日常里的次序**（用户自己排的），不是 cards.json 的顺序 ——
 * 提醒要说的是「你今天打算做的这几件」。
 */
export function reminderSuggestion(
  cards: Card[],
  routine: string[],
  slot: string,
  skippedIds: ReadonlySet<string> = new Set(),
): string {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const names = displayNames(cards);
  const out: string[] = [];
  let skippedHere = 0;
  for (const id of routine) {
    const c = byId.get(id);
    if (!c) continue;
    if (c.slot && c.slot !== "anytime" && c.slot !== slot) continue;
    if (skippedIds.has(id)) {
      skippedHere++;
      continue;
    }
    out.push(shortName(names.get(c.id) ?? cardName(c)));
  }
  if (!out.length) {
    return skippedHere
      ? "这一段今天都标了不做"
      : "这一段没有安排动作 —— 打开看看";
  }
  const head = out.slice(0, 3).join("、");
  return out.length > 3
    ? `该做 ${out.length} 件：${head} 等`
    : `该做 ${out.length} 件：${head}`;
}

/** 通知标题。 */
export function reminderTitle(reminder: Reminder): string {
  return reminder.cardId ? reminder.label : `生活指南 · ${reminder.label}`;
}

/** 名字太长就把尾巴收掉（通知横幅只有一行）。 */
function shortName(name: string, max = 10): string {
  const n = name.trim();
  return n.length > max ? n.slice(0, max) + "…" : n;
}

/** 日期写成「10 月 22 日」（不要 ISO 那串）。 */
function friendlyDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return date;
  return `${Number(m[2])} 月 ${Number(m[3])} 日`;
}

/** 屏上怎么描述这条提醒的时间。 */
export function describeReminder(reminder: Reminder, now: Date = new Date()): string {
  if (reminder.mode === "daily") return `每天 ${reminder.time}`;
  if (reminder.mode === "weekly") {
    const days = (reminder.days ?? []).slice().sort();
    // 一天都没选：这条提醒排不出时刻（nextOccurrence 返回 null），但开关是开的 ——
    // 界面上得说清楚它不会响，不然用户以为提醒正常。
    if (!days.length) return `每周 ${reminder.time}（没选哪天，不会响）`;
    return `每周${days.map((d) => WEEKDAY_LABELS[d]).join("、")} ${reminder.time}`;
  }
  if (reminder.mode === "interval") {
    return `每隔 ${Math.max(1, reminder.everyDays ?? 1)} 天 ${reminder.time}`;
  }
  // 「就一次」却没选日期，或者选的时刻已经过去：排不出时刻（nextOccurrence 返回 null），
  // 但开关是开的 —— 界面上得说出来，否则用户以为提醒正常。
  if (reminder.mode === "once" && !reminder.date) {
    return `就一次 ${reminder.time}（没选日期，不会响）`;
  }
  if (reminder.mode === "once" && reminder.date && !nextOccurrence(reminder, now)) {
    return `${friendlyDate(reminder.date)} ${reminder.time}（时间已过，不会响）`;
  }
  return reminder.date ? `${friendlyDate(reminder.date)} ${reminder.time}` : reminder.time;
}

/**
 * 从存下来的设置里读出提醒。
 *
 * 旧格式（{id, time, slot, on}）也要认 —— 早两版存的是那个形状。
 * 坏值一律丢掉：提醒是给人用的，宁可少一条也不要一个永远不响的条目。
 *
 * 「没存过」与「自己清空了」要分得开：前者给默认的两条，后者就是空的，
 * 别把用户删掉的提醒塞回去（与「我的日常」同一条道理）。
 */
export function sanitizeReminders(saved: unknown): Reminder[] {
  if (!Array.isArray(saved)) return [...DEFAULT_REMINDERS];
  const out: Reminder[] = [];
  for (const r of saved) {
    if (!r || typeof r !== "object") continue;
    const raw = r as Partial<Reminder>;
    if (typeof raw.id !== "string" || !raw.id) continue;
    if (!parseTime(String(raw.time ?? ""))) continue;
    const mode: ReminderMode =
      raw.mode === "weekly" || raw.mode === "interval" || raw.mode === "once"
        ? raw.mode
        : "daily";
    out.push({
      id: raw.id,
      cardId: typeof raw.cardId === "string" ? raw.cardId : null,
      // 整段那两条的名字由 id 定（morning → 早晨）——
      // 旧设置里存的是「晨间」，一并改成「早晨」，跟时段标签对得上。
      // 卡上的提醒用用户/内容给的名字，原样留着。
      label: KNOWN_LABELS[raw.id] ??
        (typeof raw.label === "string" && raw.label ? raw.label : raw.id),
      mode,
      time: String(raw.time),
      slot: typeof raw.slot === "string" ? raw.slot : undefined,
      days: Array.isArray(raw.days)
        ? raw.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)
        : undefined,
      everyDays: Number.isFinite(raw.everyDays)
        ? Math.max(1, Math.round(raw.everyDays!))
        : undefined,
      date: typeof raw.date === "string" ? raw.date : undefined,
      on: raw.on !== false,
    });
  }
  return out;
}

/** 存进设置之前：只留合法时刻与合法模式。 */
export function normalizeReminders(reminders: Reminder[]): Reminder[] {
  const out: Reminder[] = [];
  for (const r of reminders) {
    if (!parseTime(r.time)) continue;
    out.push({ ...r });
  }
  return out;
}

/**
 * 把设置变成「什么时候响、响的时候说什么」。
 *
 * 绑在卡上的提醒说那张卡的名字；整段提醒说这一段该做哪几件（按用户排的次序）。
 * 卡没了（内容更新过）的那条直接跳过 —— 响起来没对象更糟。
 */
export function buildSpecs(
  cards: Card[],
  routine: string[],
  reminders: Reminder[],
  now: Date,
  skipped: Record<string, string> = {},
): ReminderSpec[] {
  const out: ReminderSpec[] = [];
  const names = displayNames(cards);
  for (const r of reminders) {
    if (!r.on) continue;
    const card = r.cardId ? cards.find((c) => c.id === r.cardId) : null;
    if (r.cardId && !card) continue;

    /** 整段提醒落在哪一段；绑在卡上的提醒不用它。 */
    const slot = r.slot ?? "morning";
    /** 这一段（含「随时」）在日常里的卡。 */
    const slotIds = card
      ? []
      : routine.filter((id) => {
          const c = cards.find((x) => x.id === id);
          return c && (!c.slot || c.slot === "anytime" || c.slot === slot);
        });

    /**
     * 这一次要不要跳：
     *   · 卡级提醒 —— 这张卡当天标了「今天不做」；
     *   · 整段提醒 —— 这一天这一段的卡**全**被跳过了（还有别的可做就不跳）。
     *
     * **只跳这一次，不跳整条**：整段提醒是每天重复的，跳过今天之后明天照常。
     * （早先的写法是把整条丢掉，结果这一段在本次会话里就没了。）
     */
    const isSkippedAt = (d: Date): boolean => {
      const day = dayOf(d.getTime());
      if (card) return skipped[card.id] === day;
      if (!slotIds.length) return false;
      return slotIds.every((id) => skipped[id] === day);
    };

    const raw = occurrences(r, now, 3);
    // 原本的下一次被跳掉了 —— 手机端要知道，才能把系统重复退成一次性串
    const firstSkipped = raw.length > 0 && isSkippedAt(raw[0]);
    const times = raw.filter((d) => !isSkippedAt(d));
    if (!times.length) continue;
    // 建议说的是**这一次**（下一次）该做哪几件；跳过只作用于它自己那一天。
    const occurrenceDay = dayOf(times[0].getTime());
    const skippedForOccurrence = new Set(
      Object.entries(skipped)
        .filter(([, date]) => date === occurrenceDay)
        .map(([id]) => id),
    );
    const body = card
      ? `该做了：${names.get(card.id) ?? cardName(card)}`
      : reminderSuggestion(cards, routine, slot, skippedForOccurrence);
    out.push({
      id: r.id,
      at: times[0].toISOString(),
      // 卡改名后通知标题也要跟着改名；r.label 只是创建时的快照
      title: card
        ? (names.get(card.id) ?? cardName(card))
        : reminderTitle(r),
      body,
      rule: r,
      after: times.slice(1).map((d) => d.toISOString()),
      firstSkipped,
    });
  }
  return out;
}
