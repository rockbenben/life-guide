import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

// 独立解析器展开实际导出的日历。子进程使 TZ 在 Node 启动时生效。
function expand(timezone, rule, { skipped = {}, now = [2026, 10, 8, 5] } = {}) {
  const script = `
    import ICAL from "ical.js";
    import { buildIcs } from "./app/src/domain/ics.ts";
    const text = buildIcs({
      urlBase: "https://example.com/",
      now: new Date(...${JSON.stringify(now)}).toISOString(),
      cards: [{ id: "a", name: "a", source: { anchor: "a" }, remind: { text: "a" } }],
      skipped: ${JSON.stringify(skipped)},
      cardReminders: [{
        id: "card:a", cardId: "a", label: "a", on: true, ...${JSON.stringify(rule)}
      }]
    });
    const calendar = new ICAL.Component(ICAL.parse(text));
    const component = calendar.getAllSubcomponents("vevent").at(-1);
    const event = new ICAL.Event(component);
    const iterator = event.iterator();
    const dates = [];
    for (let i = 0; i < 5; i++) {
      const next = iterator.next();
      if (!next) break;
      dates.push(next.toString());
    }
    console.log(JSON.stringify({
      dates, start: event.startDate.toString(),
      stamp: component.getFirstPropertyValue("dtstamp").toString()
    }));
  `;
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      cwd: new URL("../..", import.meta.url),
      env: { ...process.env, TZ: timezone },
      encoding: "utf8",
    }),
  );
}

it.each(["Asia/Shanghai", "America/Los_Angeles"])(
  "%s 每周一 07:00 连续三周日期正确",
  (zone) => {
    const result = expand(zone, { mode: "weekly", days: [1], time: "07:00" });
    expect(result.dates.slice(0, 3)).toEqual([
      "2026-11-09T07:00:00",
      "2026-11-16T07:00:00",
      "2026-11-23T07:00:00",
    ]);
    expect(result.stamp.endsWith("Z")).toBe(true);
  },
);

it("多星期规则跨周保持当地星期，排除日期只跳过一次", () => {
  const result = expand(
    "Asia/Shanghai",
    { mode: "weekly", days: [1, 3], time: "07:00" },
    { skipped: { a: "2026-11-09" } },
  );
  expect(result.dates.slice(0, 3)).toEqual([
    "2026-11-11T07:00:00",
    "2026-11-16T07:00:00",
    "2026-11-18T07:00:00",
  ]);
});

it("每天与每隔两天的规则跨夏令时切换仍保持当地 07:00", () => {
  const daily = expand(
    "America/Los_Angeles",
    { mode: "daily", time: "07:00" },
    { now: [2026, 9, 31, 6] },
  );
  expect(daily.dates.slice(0, 3)).toEqual([
    "2026-10-31T07:00:00",
    "2026-11-01T07:00:00",
    "2026-11-02T07:00:00",
  ]);
  const interval = expand(
    "America/Los_Angeles",
    { mode: "interval", everyDays: 2, date: "2026-10-31", time: "07:00" },
    { now: [2026, 9, 31, 6] },
  );
  expect(interval.dates.slice(0, 3)).toEqual([
    "2026-10-31T07:00:00",
    "2026-11-02T07:00:00",
    "2026-11-04T07:00:00",
  ]);
});

it("周日凌晨跨周重复正确，一次性提醒只产生一次", () => {
  const weekly = expand("Asia/Shanghai", { mode: "weekly", days: [0], time: "00:30" },
    { now: [2026, 10, 7, 23] });
  expect(weekly.dates.slice(0, 3)).toEqual([
    "2026-11-08T00:30:00", "2026-11-15T00:30:00", "2026-11-22T00:30:00",
  ]);
  const once = expand("Asia/Shanghai", { mode: "once", date: "2026-11-09", time: "07:00" });
  expect(once.dates).toEqual(["2026-11-09T07:00:00"]);
});
