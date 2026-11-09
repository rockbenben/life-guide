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
  urlBase: "https://life.newzone.top/",
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
    expect(ics.match(/DTSTART:\d{8}T\d{6}\r\n/g)).toHaveLength(2);
  });

  it("带 VALARM，提前 10 分钟提醒", () => {
    expect(ics.match(/BEGIN:VALARM/g)).toHaveLength(2);
    expect(ics.match(/TRIGGER:-PT10M/g)).toHaveLength(2);
    expect(ics.match(/ACTION:DISPLAY/g)).toHaveLength(2);
  });

  it("链接带时段参数，打开 App 落到对应时段", () => {
    expect(ics).toContain("URL:https://life.newzone.top/?slot=morning");
    expect(ics).toContain("URL:https://life.newzone.top/?slot=evening");
  });

  it("事件日期跟着传入的 now，而不是机器当前日期", () => {
    const localNow = new Date(2026, 9, 20, 12, 0, 0);
    const withDate = buildIcs({
      urlBase: "https://life.newzone.top/",
      name: "生活指南",
      now: localNow.toISOString(),
    });
    expect(withDate).toContain("DTSTART:20261020T070000");
    expect(withDate).toContain("DTSTART:20261020T210000");
  });

  it("用户设的分钟要带上（07:30 的提醒不能导成 07:00）", () => {
    const withMin = buildIcs({
      urlBase: "https://life.newzone.top/",
      name: "生活指南",
      now: new Date(2026, 9, 20, 12).toISOString(),
      morningHour: 7,
      morningMinute: 30,
      eveningHour: 21,
      eveningMinute: 5,
    });
    expect(withMin).toContain("DTSTART:20261020T073000");
    expect(withMin).toContain("DTSTART:20261020T210500");
  });

  it("绑在卡上的提醒也写进日历，并且按它的重复规则", () => {
    const withCard = buildIcs({
      urlBase: "https://life.newzone.top/",
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
    expect(withCard).toContain("URL:https://life.newzone.top/#today");
    expect(withCard).toContain("TRIGGER:-PT0M");
    expect(withCard).toContain("该做了：轻洗睫毛根部给眼睛补油");
    expect(withCard).not.toContain("EXDATE:");
  });

  it("今天不做的卡：日历当天那次用 EXDATE 排除", () => {
    const withSkip = buildIcs({
      urlBase: "https://life.newzone.top/",
      name: "生活指南",
      now: new Date(2026, 9, 20, 8, 0, 0).toISOString(),
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
          mode: "daily",
          time: "09:00",
          on: true,
        },
      ],
      skipped: { "eyelid-clean": "2026-10-20" },
    });
    expect(withSkip).toContain("EXDATE:");
  });

  it("整段的卡全部今天不做时，整段日历事件也排除当天", () => {
    const withSlotSkip = buildIcs({
      urlBase: "https://life.newzone.top/",
      name: "生活指南",
      now: new Date(2026, 9, 20, 6, 0, 0).toISOString(),
      cards: [
        {
          id: "a",
          name: "晨光",
          source: { anchor: "晨光" },
          slot: "morning",
          remind: { text: "晒 15 分钟" },
        },
      ],
      routine: ["a"],
      skipped: { a: "2026-10-20" },
    });
    expect(withSlotSkip).toContain("EXDATE:");
  });

  it("每行不超过 75 字节（ICS 规范）", () => {
    for (const line of ics.split("\r\n")) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
