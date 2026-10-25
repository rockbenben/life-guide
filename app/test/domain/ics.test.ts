/**
 * .ics 的单测。
 *
 * 关键一条：事件必须是**定时**事件且带 VALARM。
 * 全天事件（DTSTART;VALUE=DATE）在 iOS / Google 日历里不会按时响 ——
 * App 自己提醒，日历是备份；备份不按时响，这条路就塌了（AGENTS.md §4.2）。
 */
import { describe, expect, it } from "vitest";

import { buildIcs } from "../../src/domain/ics.ts";

const ics = buildIcs({
  urlBase: "https://newzone.top/life-guide/",
  name: "生活指南",
  now: "2026-10-20T00:00:00.000Z",
});

describe("buildIcs", () => {
  it("是一个合法的 VCALENDAR", () => {
    expect(ics.startsWith("BEGIN:VCALENDAR\r\n")).toBe(true);
    expect(ics.trimEnd().endsWith("END:VCALENDAR")).toBe(true);
    expect(ics).toContain("VERSION:2.0");
  });

  it("有早、晚两条每日重复的事件", () => {
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics.match(/RRULE:FREQ=DAILY/g)).toHaveLength(2);
    expect(ics).toContain("SUMMARY:生活指南 · 早晨");
    expect(ics).toContain("SUMMARY:生活指南 · 晚间");
  });

  it("是定时事件，不是全天事件", () => {
    expect(ics).not.toContain("VALUE=DATE");
    // DTSTART 必须带时分秒，全天事件会退化成纯日期
    expect(ics.match(/DTSTART:\d{8}T\d{6}Z/g)).toHaveLength(2);
  });

  it("带 VALARM，提前 10 分钟提醒", () => {
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics.match(/TRIGGER:-PT10M/g)).toHaveLength(2);
    expect(ics.match(/ACTION:DISPLAY/g)).toHaveLength(2);
  });

  it("链接带时段参数，打开 App 落到对应时段", () => {
    expect(ics).toContain("URL:https://newzone.top/life-guide/?slot=morning");
    expect(ics).toContain("URL:https://newzone.top/life-guide/?slot=evening");
  });

  it("事件日期跟着传入的 now，而不是机器当前日期", () => {
    const localNow = new Date(2026, 9, 20, 12, 0, 0);
    const withDate = buildIcs({
      urlBase: "https://newzone.top/life-guide/",
      name: "生活指南",
      now: localNow.toISOString(),
    });
    const stamp = (hour: number) => {
      const d = new Date(
        localNow.getFullYear(),
        localNow.getMonth(),
        localNow.getDate(),
        hour,
        0,
        0,
      );
      return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    };
    expect(withDate).toContain(`DTSTART:${stamp(7)}`);
    expect(withDate).toContain(`DTSTART:${stamp(21)}`);
  });

  it("用户设的分钟要带上（07:30 的提醒不能导成 07:00）", () => {
    const withMin = buildIcs({
      urlBase: "https://newzone.top/life-guide/",
      name: "生活指南",
      morningHour: 7,
      morningMinute: 30,
      eveningHour: 21,
      eveningMinute: 5,
    });
    // 期望值按**本地时间**算：.ics 用本地时刻写、再折算成 UTC 时间戳，
    // 写死一个 UTC 字符串的话换个时区就红（这个测试在 UTC 的 CI 上也过）。
    const localStamp = (hour: number, minute: number) => {
      const d = new Date();
      d.setHours(hour, minute, 0, 0);
      return d.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    };
    expect(withMin).toContain(`DTSTART:${localStamp(7, 30)}`);
    expect(withMin).toContain(`DTSTART:${localStamp(21, 5)}`);
  });

  it("绑在卡上的提醒也写进日历，并且按它的重复规则", () => {
    const withCard = buildIcs({
      urlBase: "https://newzone.top/life-guide/",
      name: "生活指南",
      now: "2026-10-20T00:00:00.000Z",
      cards: [
        {
          id: "eyelid-clean",
          name: "轻洗睫毛根部给眼睛补油",
          source: { anchor: "睑缘清洗" },
          remind: { text: "每天 10 秒" },
        },
      ],
      cardReminders: [
        {
          id: "card:eyelid-clean",
          cardId: "eyelid-clean",
          label: "轻洗睫毛根部给眼睛补油",
          mode: "weekly",
          time: "09:00",
          days: [1, 3],
          on: true,
        },
      ],
    });
    expect(withCard.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(withCard).toContain("SUMMARY:生活指南 · 轻洗睫毛根部给眼睛补油");
    expect(withCard).toContain("RRULE:FREQ=WEEKLY;BYDAY=MO,WE");
    expect(withCard).toContain("URL:https://newzone.top/life-guide/#today");
    expect(withCard).toContain("TRIGGER:-PT0M");
    expect(withCard).toContain("该做了：轻洗睫毛根部给眼睛补油");
  });

  it("每行不超过 75 字节（ICS 规范）", () => {
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
