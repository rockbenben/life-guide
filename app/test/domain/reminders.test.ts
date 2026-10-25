/**
 * 提醒的纯逻辑测试。
 *
 * 提醒要回答两个问题：什么时候响、响的时候说什么。
 * 这两件事都在 domain/reminders.ts 里，不碰平台 API，所以能单测 ——
 * 平台那一层（platform/notify.ts）只管「怎么响」。
 *
 * 「下一次是哪一刻」只有这一处算法（nextOccurrence）：桌面端、手机端、浏览器
 * 都从这里取时刻。这几条用例就是它的规格。
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMINDERS,
  buildSpecs,
  cardReminderId,
  defaultReminderFor,
  defaultTimeForSlot,
  describeReminder,
  nextOccurrence,
  normalizeReminders,
  occurrences,
  parseTime,
  reminderSuggestion,
  reminderTitle,
  sanitizeReminders,
  type Reminder,
} from "../../src/domain/reminders.ts";
import type { Card } from "../../src/domain/routine.ts";

function card(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    status: "reviewed",
    source: { anchor: `小节 ${id}` },
    remind: { text: `做 ${id}`, quote: `做 ${id}` },
    steps: [],
    ...over,
  };
}

/** 一条整段提醒（与提醒 id 无关，只看模式与时刻）。 */
function global(over: Partial<Reminder> = {}): Reminder {
  return {
    id: "morning",
    cardId: null,
    label: "早晨",
    mode: "daily",
    time: "07:00",
    slot: "morning",
    on: true,
    ...over,
  };
}

describe("提醒时刻", () => {
  it("认得 HH:MM，认不得别的", () => {
    expect(parseTime("07:00")).toEqual({ hour: 7, minute: 0 });
    expect(parseTime("21:30")).toEqual({ hour: 21, minute: 30 });
    expect(parseTime("25:00")).toBeNull();
    expect(parseTime("7:0")).toBeNull();
    expect(parseTime("")).toBeNull();
    expect(parseTime("早上七点")).toBeNull();
  });

  it("每天：今天还没到就是今天，否则明天", () => {
    const now = new Date("2026-10-21T09:00:00");
    const t = nextOccurrence(global({ time: "21:00" }), now)!;
    expect(t.getDate()).toBe(21);
    expect(t.getHours()).toBe(21);
    const past = nextOccurrence(global({ time: "07:00" }), now)!;
    expect(past.getDate()).toBe(22);
    expect(past.getHours()).toBe(7);
  });

  it("刚好到点也算下一天（不响两次）", () => {
    const now = new Date("2026-10-21T07:00:00");
    expect(nextOccurrence(global({ time: "07:00" }), now)!.getDate()).toBe(22);
  });

  it("时刻不合法就没有下一次", () => {
    expect(nextOccurrence(global({ time: "99:99" }), new Date())).toBeNull();
  });

  it("每周：挑出下一个选中的日子", () => {
    const now = new Date("2026-10-21T09:00:00"); // 周三
    expect(now.getDay()).toBe(3);
    // 今天还没到 21:00 → 就是今天
    const today = nextOccurrence(global({ mode: "weekly", days: [3], time: "21:00" }), now)!;
    expect(today.getDate()).toBe(21);
    // 没选今天 → 明天（周四）
    const tomorrow = nextOccurrence(global({ mode: "weekly", days: [4], time: "21:00" }), now)!;
    expect(tomorrow.getDate()).toBe(22);
    expect(tomorrow.getDay()).toBe(4);
  });

  it("每周：一个日子都没选就没有下一次", () => {
    expect(
      nextOccurrence(global({ mode: "weekly", days: [] }), new Date("2026-10-21T09:00:00")),
    ).toBeNull();
  });

  it("每隔 N 天：从锚点算起，一步一步往后推", () => {
    const now = new Date("2026-10-21T09:00:00");
    const d = nextOccurrence(
      global({ mode: "interval", everyDays: 3, date: "2026-10-01", time: "08:00" }),
      now,
    )!;
    expect(d.getDate()).toBe(22);
    expect(d.getMonth()).toBe(9); // 十月
    expect(d.getHours()).toBe(8);
  });

  it("每隔 N 天：起始日在很久以前也算得出来（不能静默丢掉这条提醒）", () => {
    // 起始日选在六年前、每隔 1 天：以前有个 2000 步的上限，
    // 推不满就返回 null —— 提醒从此不响，界面上还摆着它。
    const now = new Date("2026-10-21T09:00:00");
    const d = nextOccurrence(
      global({ mode: "interval", everyDays: 1, date: "2019-01-01", time: "08:00" }),
      now,
    );
    expect(d).not.toBeNull();
    expect(d!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("步长荒唐到日期都装不下时，不给坏日期（下游 toISOString 会抛）", () => {
    const now = new Date("2026-10-21T09:00:00");
    const d = nextOccurrence(
      global({ mode: "interval", everyDays: 1_000_000_000, date: "2026-10-01", time: "08:00" }),
      now,
    );
    expect(d).toBeNull();
  });

  it("一次：就是那天；过去了就没有了", () => {
    const now = new Date("2026-10-21T09:00:00");
    const d = nextOccurrence(global({ mode: "once", date: "2026-10-30", time: "09:00" }), now)!;
    expect(d.getDate()).toBe(30);
    expect(
      nextOccurrence(global({ mode: "once", date: "2026-10-01", time: "09:00" }), now),
    ).toBeNull();
    expect(nextOccurrence(global({ mode: "once", time: "09:00" }), now)).toBeNull();
  });
});

describe("连着几次", () => {
  it("每天：一次一次往后排，不重不漏", () => {
    const now = new Date("2026-10-21T09:00:00");
    const list = occurrences(global({ time: "07:00" }), now, 3);
    expect(list.map((d) => d.getDate())).toEqual([22, 23, 24]);
    expect(list.every((d) => d.getHours() === 7)).toBe(true);
  });

  it("一次性的只有一次", () => {
    const now = new Date("2026-10-21T09:00:00");
    expect(occurrences(global({ mode: "once", date: "2026-10-30" }), now, 3)).toHaveLength(1);
  });

  it("每周：只排选中的那天", () => {
    const now = new Date("2026-10-21T09:00:00"); // 周三
    const list = occurrences(global({ mode: "weekly", days: [4], time: "21:00" }), now, 3);
    expect(list.map((d) => d.getDay())).toEqual([4, 4, 4]);
    expect(list.map((d) => d.getDate())).toEqual([22, 29, 5]); // 10-22、10-29、11-05
  });
});

describe("提醒里的建议", () => {
  const cards = [
    card("a", { slot: "morning", source: { anchor: "光照建议" } }),
    card("b", { slot: "morning", source: { anchor: "刷牙步骤" } }),
    card("c", { slot: "anytime", source: { anchor: "睑缘清洗" } }),
    card("d", { slot: "evening", source: { anchor: "睡前鼻腔冲洗" } }),
  ];
  const routine = ["a", "b", "c", "d"];

  it("说的是这一段该做哪几件（随时的一直在）", () => {
    expect(reminderSuggestion(cards, routine, "morning")).toBe("该做 3 件：光照建议、刷牙步骤、睑缘清洗");
    expect(reminderSuggestion(cards, routine, "evening")).toBe("该做 2 件：睑缘清洗、睡前鼻腔冲洗");
  });

  it("按日常里的次序说，不是按 cards.json 的顺序", () => {
    expect(reminderSuggestion(cards, ["c", "a"], "morning")).toBe("该做 2 件：睑缘清洗、光照建议");
  });

  it("超过三件就说个大概，不把通知撑爆", () => {
    const more = [...cards, card("e", { slot: "anytime", source: { anchor: "3T 保湿" } })];
    const many = ["c", "a", "b", "e"];
    expect(reminderSuggestion(more, many, "morning")).toContain("该做 4 件：");
    expect(reminderSuggestion(more, many, "morning")).toContain("等");
  });

  it("这一段没有动作就说实话", () => {
    expect(reminderSuggestion(cards, ["d"], "morning")).toBe("这一段没有安排动作 —— 打开看看");
  });

  it("标题说清是哪一段", () => {
    expect(reminderTitle(global({ id: "morning", label: "早晨" }))).toBe("生活指南 · 早晨");
    expect(reminderTitle(global({ id: "evening", label: "晚间" }))).toBe("生活指南 · 晚间");
    // 绑在卡上的：标题就是那张卡的名
    expect(reminderTitle(global({ cardId: "a", label: "光照建议" }))).toBe("光照建议");
  });
});

describe("屏上怎么写这条提醒", () => {
  it("四种模式各说一句人话", () => {
    expect(describeReminder(global({ time: "07:00" }))).toBe("每天 07:00");
    expect(describeReminder(global({ mode: "weekly", days: [1, 3, 5], time: "21:00" }))).toBe(
      "每周一、三、五 21:00",
    );
    expect(describeReminder(global({ mode: "interval", everyDays: 3, time: "08:00" }))).toBe(
      "每隔 3 天 08:00",
    );
    expect(
      describeReminder(
        global({ mode: "once", date: "2026-10-30", time: "09:00" }),
        new Date("2026-10-01T00:00:00"),
      ),
    ).toBe("10 月 30 日 09:00");
  });

  it("「就一次」的时间已经过去时，要说清楚它不会响", () => {
    expect(
      describeReminder(
        global({ mode: "once", date: "2026-10-01", time: "09:00" }),
        new Date("2026-10-24T12:00:00"),
      ),
    ).toContain("不会响");
  });
});

describe("提醒的设置", () => {
  it("没存过就用默认的（早 7:00、晚 21:00）", () => {
    expect(sanitizeReminders(undefined)).toEqual(DEFAULT_REMINDERS);
    expect(sanitizeReminders("乱七八糟")).toEqual(DEFAULT_REMINDERS);
  });

  it("自己清空过就是空的（别把删掉的塞回去）", () => {
    expect(sanitizeReminders([])).toEqual([]);
  });

  it("坏时刻丢掉，好的留下", () => {
    const saved = [
      { id: "morning", time: "25:00", slot: "morning", on: true },
      { id: "evening", time: "20:15", slot: "evening", on: true },
    ];
    const out = sanitizeReminders(saved);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("evening");
    expect(out[0].time).toBe("20:15");
  });

  it("旧格式（没有 mode / cardId / label）也认得", () => {
    const out = sanitizeReminders([{ id: "morning", time: "06:30", slot: "morning", on: true }]);
    expect(out[0].mode).toBe("daily");
    expect(out[0].cardId).toBeNull();
    expect(out[0].label).toBe("早晨");
    expect(out[0].time).toBe("06:30");
  });

  it("关掉的那条记着（用户可以只留早晨）", () => {
    const out = sanitizeReminders([
      { id: "morning", time: "06:30", mode: "daily", label: "早晨", cardId: null, on: true },
      { id: "evening", time: "21:00", mode: "daily", label: "晚间", cardId: null, on: false },
    ]);
    expect(out.find((r) => r.id === "evening")!.on).toBe(false);
  });

  it("存之前也只留合法时刻", () => {
    const out = normalizeReminders([
      global({ id: "morning", time: "06:30" }),
      global({ id: "evening", time: "nope" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("morning");
  });
});

describe("卡片上的提醒", () => {
  const cards = [card("a", { slot: "morning", source: { anchor: "光照建议" } })];

  it("一张卡一条，id 认得出是谁的", () => {
    expect(cardReminderId("a")).toBe("card:a");
  });

  it("默认时刻按这张卡属于哪一段来", () => {
    expect(defaultTimeForSlot("morning")).toBe("07:00");
    expect(defaultTimeForSlot("evening")).toBe("21:00");
    expect(defaultTimeForSlot("anytime")).toBe("09:00");
    expect(defaultTimeForSlot(undefined)).toBe("09:00");
  });

  it("新提醒的默认模式跟着卡的频率走", () => {
    const sunday = new Date(2026, 9, 25, 9, 0, 0); // 2026-10-25 是周日
    expect(defaultReminderFor("daily", sunday)).toEqual({ mode: "daily" });
    expect(defaultReminderFor("weekly", sunday)).toEqual({ mode: "weekly", days: [0] });
    expect(defaultReminderFor("monthly", sunday)).toEqual({
      mode: "interval",
      everyDays: 30,
      date: "2026-10-25",
    });
  });

  it("绑在卡上的提醒说那张卡的名，整段提醒说这一段该做哪几件", () => {
    const specs = buildSpecs(
      cards,
      ["a"],
      [
        global({ id: "morning" }),
        global({ id: "card:a", cardId: "a", label: "光照建议", time: "09:00" }),
      ],
      new Date("2026-10-21T09:00:00"),
    );
    expect(specs.map((s) => s.id)).toEqual(["morning", "card:a"]);
    expect(specs[0].body).toBe("该做 1 件：光照建议");
    expect(specs[1].body).toBe("该做了：光照建议");
  });

  it("卡改名后，通知标题用当前名字而不是创建时的 label", () => {
    const renamed = [card("a", { name: "深呼吸", slot: "morning" })];
    const specs = buildSpecs(
      renamed,
      ["a"],
      [global({ id: "card:a", cardId: "a", label: "冥想", time: "09:00" })],
      new Date("2026-10-21T08:00:00"),
    );
    expect(specs[0].title).toBe("深呼吸");
    expect(specs[0].body).toBe("该做了：深呼吸");
  });

  it("关掉的、卡没了的都不排", () => {
    const specs = buildSpecs(
      cards,
      ["a"],
      [
        global({ id: "off", on: false }),
        global({ id: "card:zz", cardId: "zz", label: "没了" }),
      ],
      new Date("2026-10-21T09:00:00"),
    );
    expect(specs).toHaveLength(0);
  });

  it("排好的那一条后面还带着几次备用（主进程用得上）", () => {
    const specs = buildSpecs(
      cards,
      ["a"],
      [global({ id: "morning", time: "07:00" })],
      new Date("2026-10-21T09:00:00"),
    );
    expect(specs[0].at).toBe(new Date("2026-10-22T07:00:00").toISOString());
    expect(specs[0].after).toHaveLength(2);
  });

  it("一次性过了就不排了", () => {
    const specs = buildSpecs(
      cards,
      ["a"],
      [global({ id: "one", mode: "once", date: "2026-10-01", time: "09:00" })],
      new Date("2026-10-21T09:00:00"),
    );
    expect(specs).toHaveLength(0);
  });
});

describe("提醒的显示文案", () => {
  it("一周里一天都没选时，要说清楚它不会响", () => {
    // 星期几可以全部点掉；那样 nextOccurrence 返回 null（排不出时刻），
    // 但开关还开着 —— 界面上得说出来，不然用户以为提醒正常。
    expect(describeReminder(global({ mode: "weekly", days: [], time: "07:00" }))).toContain("不会响");
  });

  it("「就一次」没选日期时，要说清楚它不会响", () => {
    // 同上：date 为空 → 排不出时刻，但开关是开的。
    expect(describeReminder(global({ mode: "once", date: "", time: "09:00" }))).toContain("不会响");
  });
});