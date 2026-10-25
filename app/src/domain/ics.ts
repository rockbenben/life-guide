/**
 * 生成日历订阅文件（.ics）。
 *
 * App 自己已经会提醒（见 platform/notify.ts）；日历是那条不依赖 App 进程的
 * 备份通道 —— 浏览器后台定时器会被节流，iPhone 上 Web Push 又有系统门槛。
 * 日历事件是系统级的、全平台、零后端。
 *
 * 早 / 晚两条整段事件每日重复，链接带 ?slot=morning / ?slot=evening；
 * 卡片提醒按各自的每天 / 每周 / 隔几天 / 一次规则展开。
 */

import type { Card } from "./routine.ts";
import { cardName } from "./lines.ts";
import {
  describeReminder,
  nextOccurrence,
  type Reminder,
} from "./reminders.ts";

export interface IcsOptions {
  /** 事件链接前缀，例如 https://newzone.top/life-guide/ */
  urlBase: string;
  /** 站点名 */
  name?: string;
  /** 生成时间（UTC 字符串） */
  now?: string;
  /** 早晨提醒的本地小时，默认 7 */
  morningHour?: number;
  /** 早晨提醒的本地分钟，默认 0 */
  morningMinute?: number;
  /** 晚间提醒的本地小时，默认 21 */
  eveningHour?: number;
  /** 晚间提醒的本地分钟，默认 0 */
  eveningMinute?: number;
  /** 绑在卡上的提醒（可选）：一起导出，网页端也能用系统日历响 */
  cardReminders?: Reminder[];
  /** 用来把 cardId 换成名字 */
  cards?: Pick<Card, "id" | "source" | "remind" | "customName" | "name">[];
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Date → ICS 的 UTC 格式：20261019T081000Z */
function utcStamp(d: Date): string {
  return (
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

/** 折行：ICS 每行不超过 75 字节，超出用 CRLF + 空格续行 */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out: string[] = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // 不要从 UTF-8 字符中间切开
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push(new TextDecoder().decode(bytes.slice(start, end)));
    start = end;
    limit = 74; // 续行开头有一个空格，占一字节
  }
  return out.join("\r\n ");
}

export function buildIcs(opts: IcsOptions): string {
  const name = opts.name ?? "生活指南";
  const now = opts.now ?? new Date().toISOString();
  const morningHour = opts.morningHour ?? 7;
  const morningMinute = opts.morningMinute ?? 0;
  const eveningHour = opts.eveningHour ?? 21;
  const eveningMinute = opts.eveningMinute ?? 0;

  // 提醒必须是**定时**事件：全天事件（VALUE=DATE）在系统日历里不会按时响，
  // P2 的退出条件「.ics 导入后按时提醒」就落空了。
  // 时间用本地时刻写、再折算成 UTC 时间戳 —— 日历按本地时区显示，
  // 换算错了就会出现「早 7 点提醒其实是凌晨 5 点」。
  // 分钟也要带上：用户把提醒设成 07:30，日历那条就该是 07:30 ——
  // 丢掉分钟会差出几十分钟（闹钟还提前 10 分钟响，差得更远）。
  const today = new Date(now);
  const at = (hour: number, minute: number) =>
    new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
      hour,
      minute,
      0,
      0,
    );

  const events: {
    uid: string;
    summary: string;
    desc: string;
    url: string;
    start: Date;
    rrule?: string;
    alarmMinutes?: number;
  }[] = [
    {
      uid: "life-guide-morning@newzone.top",
      summary: `${name} · 早晨`,
      desc: "打开看看今天该做的几件事",
      url: `${opts.urlBase}?slot=morning`,
      start: at(morningHour, morningMinute),
      rrule: "FREQ=DAILY",
      alarmMinutes: 10,
    },
    {
      uid: "life-guide-evening@newzone.top",
      summary: `${name} · 晚间`,
      desc: "打开看看今天该做的几件事",
      url: `${opts.urlBase}?slot=evening`,
      start: at(eveningHour, eveningMinute),
      rrule: "FREQ=DAILY",
      alarmMinutes: 10,
    },
  ];

  const cardsById = new Map((opts.cards ?? []).map((c) => [c.id, c]));
  for (const r of opts.cardReminders ?? []) {
    if (!r.on || !r.cardId) continue;
    const card = cardsById.get(r.cardId);
    if (!card) continue;
    const start = nextOccurrence(r, new Date(now));
    if (!start) continue;
    let rrule: string | undefined;
    if (r.mode === "daily") rrule = "FREQ=DAILY";
    if (r.mode === "weekly") {
      const days = (r.days ?? [])
        .filter((d) => d >= 0 && d <= 6)
        .map((d) => ["SU", "MO", "TU", "WE", "TH", "FR", "SA"][d]);
      if (days.length) rrule = `FREQ=WEEKLY;BYDAY=${days.join(",")}`;
    }
    if (r.mode === "interval") {
      rrule = `FREQ=DAILY;INTERVAL=${Math.max(1, Math.round(r.everyDays ?? 1))}`;
    }
    if (r.mode === "once" && !r.date) continue;
    const label = cardName(card);
    events.push({
      uid: `life-guide-card-${r.cardId}@newzone.top`,
      summary: `${name} · ${label}`,
      desc: `该做了：${label}（${describeReminder(r, new Date(now))}）`,
      url: `${opts.urlBase}#today`,
      start: new Date(start.getTime()),
      rrule,
      alarmMinutes: 0,
    });
  }

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LearnData//Life Guide//CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    fold(`X-WR-CALNAME:${name}`),
    fold(`X-WR-TIMEZONE:Asia/Shanghai`),
  ];

  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      fold(`UID:${e.uid}`),
      "DTSTAMP:" + utcStamp(new Date(now)),
      "DTSTART:" + utcStamp(e.start),
      "DTEND:" + utcStamp(new Date(e.start.getTime() + 30 * 60000)),
      ...(e.rrule ? [`RRULE:${e.rrule}`] : []),
      fold(`SUMMARY:${e.summary}`),
      fold(`DESCRIPTION:${e.desc}`),
      fold(`URL:${e.url}`),
      "TRANSP:TRANSPARENT",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      fold(`DESCRIPTION:${e.summary}`),
      `TRIGGER:-PT${e.alarmMinutes ?? 0}M`,
      "END:VALARM",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}

/** 触发浏览器下载。 */
export function downloadIcs(content: string, filename = "life-guide.ics"): void {
  const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
