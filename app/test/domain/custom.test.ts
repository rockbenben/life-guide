/**
 * 用户自己加的习惯（domain/custom.ts）与其在日常管线里的位置。
 *
 * 这条通道的要害：**它不能另造一套界面**。加完的习惯在数据层就是一张卡，
 * 所以盖章、累计天数、提醒、次序全都白得 —— 这里守的就是这件事。
 */
import { describe, expect, it } from "vitest";

import {
  HABIT_ID_PREFIX,
  habitToCard,
  isCustomCard,
  newHabitId,
  type CustomHabit,
} from "../../src/domain/custom.ts";
import { cardName, displayNames } from "../../src/domain/lines.ts";
import { dailyCandidates, mergeWithDefault, todaysCards } from "../../src/domain/daily.ts";
import type { Card } from "../../src/domain/routine.ts";

function habit(over: Partial<CustomHabit> = {}): CustomHabit {
  return {
    id: `${HABIT_ID_PREFIX}abc123`,
    name: "睡前拉伸 5 分钟",
    text: "站墙靠 5 分钟",
    slot: "evening",
    createdAt: "2026-10-21T00:00:00.000Z",
    ...over,
  };
}

function contentCard(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    status: "reviewed",
    source: { anchor: "小节" },
    remind: { text: "原文那句" },
    steps: [],
    ...over,
  };
}

describe("自定义习惯 → 卡", () => {
  it("加完就是一张卡：名字、做什么、时段都在", () => {
    const c = habitToCard(habit());
    expect(c.id).toBe(`${HABIT_ID_PREFIX}abc123`);
    expect(c.customName).toBe("睡前拉伸 5 分钟");
    expect(c.remind.text).toBe("站墙靠 5 分钟");
    expect(c.slot).toBe("evening");
    expect(isCustomCard(c)).toBe(true);
  });

  it("内容层的卡不算自定义的", () => {
    expect(isCustomCard(contentCard("eyelid-clean"))).toBe(false);
  });

  it("id 前缀是硬约定：不能撞上内容层的卡 id", () => {
    // 撞了会怎样：myRoutine 存的是 id 数组，撞了就分不清「我加的」还是「手册里那张」
    expect(newHabitId().startsWith(HABIT_ID_PREFIX)).toBe(true);
    expect(HABIT_ID_PREFIX).not.toBe("");
  });

  it("两个 id 不会一样", () => {
    const ids = new Set(Array.from({ length: 50 }, () => newHabitId()));
    expect(ids.size).toBe(50);
  });
});

describe("屏上叫什么", () => {
  it("用用户起的那个名字，不是原文小节名", () => {
    const c = habitToCard(habit());
    expect(cardName(c)).toBe("睡前拉伸 5 分钟");
  });

  it("两个同名习惯各叫各的（anchor 一样也不回落成别的名字）", () => {
    const a = habitToCard(habit({ id: "my-1", name: "喝水" }));
    const b = habitToCard(habit({ id: "my-2", name: "喝水" }));
    // 故意让 anchor 撞上：displayNames 按 anchor 分组，撞了就该出错
    const c1 = { ...a, source: { anchor: "同一个" } };
    const c2 = { ...b, source: { anchor: "同一个" } };
    const names = displayNames([c1, c2]);
    expect(names.get("my-1")).toBe("喝水");
    expect(names.get("my-2")).toBe("喝水");
  });
});

describe("它在日常管线里的位置", () => {
  const mine = habitToCard(habit());
  const book = contentCard("brush-teeth", { slot: "anytime" });

  it("在日常里就出现在它自己那一段", () => {
    const cards = [book, mine];
    expect(todaysCards(cards, ["my-abc123"], "evening").map((c) => c.id)).toEqual([
      "my-abc123",
    ]);
    expect(todaysCards(cards, ["my-abc123"], "morning")).toEqual([]);
  });

  it("不进「发现」：它是「我的」，不是「可以试试的」", () => {
    const cards = [book, mine];
    // 就算它不在日常里，也不该被当成「手册里还没进日常的动作」
    expect(dailyCandidates(cards, []).map((c) => c.id)).toEqual(["brush-teeth"]);
  });
});

describe("「重置为默认」不该冲掉用户自己加的", () => {
  const DEFAULTS = ["morning-light", "brush-teeth", "face-wash"];

  it("自己加的留在清单里，排在 App 给的后面", () => {
    const current = ["my-abc123", "morning-light"];
    expect(mergeWithDefault(DEFAULTS, current)).toEqual([
      ...DEFAULTS,
      "my-abc123",
    ]);
  });

  it("没有自己加的，就原样是默认那几张", () => {
    expect(mergeWithDefault(DEFAULTS, ["morning-light"])).toEqual(DEFAULTS);
  });
});
