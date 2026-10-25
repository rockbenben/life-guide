/**
 * 「今日一篇」与手册检索的纯函数。
 *
 * manual.ts 的用例也放在这里：这两份 domain 是本次新增的全部纯逻辑，
 * 而本次允许新增的 domain 测试文件只有这一个。
 */
import { describe, expect, it } from "vitest";

import { addToRoutine, variantAvailability } from "../../src/domain/routine.ts";
import type { Card } from "../../src/domain/routine.ts";
import {
  dailyCandidates,
  dailyPick,
  dailyPicks,
  firstRunOnLoad,
  initialRoutine,
  moveInRoutine,
  refillPicks,
  removeFromRoutine,
  restoreCounts,
  routineCards,
  starterPack,
  todaysCards,
} from "../../src/domain/daily.ts";
import { recentActivity } from "../../src/domain/progress.ts";
import { dayOf } from "../../src/domain/day.ts";
import {
  articleMatches,
  cardsOfArticle,
  renderSections,
  searchArticles,
} from "../../src/domain/manual.ts";
import {
  isConditionCard,
  plainText,
  sortNotices,
  urgentNotices,
} from "../../src/domain/notices.ts";
import type { ManualArticle } from "../../src/domain/manual.ts";

function makeCard(id: string, over: Partial<Card> = {}): Card {
  return {
    id,
    status: "reviewed",
    source: { anchor: "小节" },
    remind: { text: `做 ${id}`, quote: `做 ${id}` },
    steps: [],
    ...over,
  };
}

function makeArticle(over: Partial<ManualArticle> = {}): ManualArticle {
  return {
    path: "body-care/tears.md",
    title: "睑缘清洗",
    sections: [{ heading: "睑缘清洗", md: "每天 10 秒" }],
    ...over,
  };
}

describe("今日一篇：候选", () => {
  it("疾病卡不进候选 —— 它不是可做的动作", () => {
    const cards = [
      makeCard("a"),
      makeCard("b", { articleKind: "condition" }),
    ];
    expect(dailyCandidates(cards, []).map((c) => c.id)).toEqual(["a"]);
  });

  it("用户已加入日常的卡不再进候选", () => {
    const cards = [makeCard("a"), makeCard("b"), makeCard("c")];
    expect(dailyCandidates(cards, ["a", "c"]).map((c) => c.id)).toEqual(["b"]);
  });

  it("没有候选时返回 null", () => {
    expect(dailyPick([makeCard("a")], ["a"], "2026-10-20")).toBeNull();
    expect(dailyPick([], [], "2026-10-20")).toBeNull();
  });
});

describe("今日一篇：同一天内是同一张卡", () => {
  const cards = [
    makeCard("a"),
    makeCard("b"),
    makeCard("c"),
    makeCard("d"),
    makeCard("e"),
  ];

  it("同一天反复取都是同一张", () => {
    const first = dailyPick(cards, [], "2026-10-20");
    for (let i = 0; i < 5; i++) {
      expect(dailyPick(cards, [], "2026-10-20")).toBe(first);
    }
  });

  it("换一天会换一张（轮换得起来）", () => {
    const picked = new Set(
      Array.from({ length: 30 }, (_, i) =>
        dailyPick(cards, [], `2026-10-${String(i + 1).padStart(2, "0")}`),
      ).map((c) => c!.id),
    );
    expect(picked.size).toBeGreaterThan(1);
  });

  it("取到的卡一定不在我的日常里，也不是疾病卡", () => {
    const withCondition = [...cards, makeCard("z", { articleKind: "condition" })];
    const pick = dailyPick(withCondition, ["a"], "2026-10-20");
    expect(pick).not.toBeNull();
    expect(pick!.id).not.toBe("a");
    expect(pick!.id).not.toBe("z");
  });
});

describe("发现：今天给三张", () => {
  const many = Array.from({ length: 10 }, (_, i) => makeCard(String.fromCharCode(97 + i)));

  it("同一天内是同一批（刷新不会自己跳）", () => {
    const first = dailyPicks(many, [], "2026-10-20").map((c) => c.id);
    expect(first).toHaveLength(3);
    for (let i = 0; i < 5; i++) {
      expect(dailyPicks(many, [], "2026-10-20").map((c) => c.id)).toEqual(first);
    }
  });

  it("三张互不相同", () => {
    const ids = dailyPicks(many, [], "2026-10-20").map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("换一批看到的不是刚才那几张", () => {
    const a = dailyPicks(many, [], "2026-10-20", 0).map((c) => c.id);
    const b = dailyPicks(many, [], "2026-10-20", 1).map((c) => c.id);
    expect(b.some((id) => a.includes(id))).toBe(false);
  });

  it("候选不够就少给，不报错", () => {
    expect(dailyPicks([makeCard("a")], [], "2026-10-20")).toHaveLength(1);
    expect(dailyPicks([], [], "2026-10-20")).toEqual([]);
  });

  it("都在日常里的、疾病卡，都不进这一批", () => {
    const pool = [...many, makeCard("z", { articleKind: "condition" })];
    const ids = dailyPicks(pool, ["a", "b"], "2026-10-20").map((c) => c.id);
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("b");
    expect(ids).not.toContain("z");
  });
});

describe("我的日常", () => {
  it("加进去不重复", () => {
    expect(addToRoutine([], "a")).toEqual(["a"]);
    expect(addToRoutine(["a"], "a")).toEqual(["a"]);
    expect(addToRoutine(["a"], "b")).toEqual(["a", "b"]);
  });
});

describe("手册检索", () => {
  const articles = [
    makeArticle({
      path: "a.md",
      title: "睑缘清洗",
      sections: [{ heading: "睑缘清洗", md: "每天 10 秒，早晚各一次" }],
    }),
    makeArticle({
      path: "b.md",
      title: "血管拉伸",
      sections: [{ heading: "血管拉伸", md: "五个动作，两足各 2 回" }],
    }),
  ];

  it("标题命中", () => {
    expect(searchArticles(articles, "血管").map((a) => a.path)).toEqual(["b.md"]);
  });

  it("正文命中（标题里没有那个词）", () => {
    expect(searchArticles(articles, "早晚各一次").map((a) => a.path)).toEqual([
      "a.md",
    ]);
  });

  it("多个词要全部命中", () => {
    expect(searchArticles(articles, "血管 两足").map((a) => a.path)).toEqual([
      "b.md",
    ]);
    expect(searchArticles(articles, "血管 早晚")).toEqual([]);
  });

  it("空查询返回全部", () => {
    expect(searchArticles(articles, "  ")).toHaveLength(2);
  });

  it("没有命中时返回空", () => {
    expect(searchArticles(articles, "青光眼")).toEqual([]);
  });

  it("articleMatches 与搜索结果一致", () => {
    expect(articleMatches(articles[0], "睑缘")).toBe(true);
    expect(articleMatches(articles[0], "青光眼")).toBe(false);
  });
});

describe("疾病类", () => {
  it("只有 articleKind=condition 算疾病卡", () => {
    expect(isConditionCard(makeCard("a"))).toBe(false);
    expect(isConditionCard(makeCard("a", { articleKind: "condition" }))).toBe(true);
  });

  it("提示按严重程度排序：seek-care 最前", () => {
    const notices = [
      { level: "info" as const, text: "一般知识", quote: "一般知识" },
      { level: "with-doctor" as const, text: "遵医嘱", quote: "遵医嘱" },
      { level: "seek-care" as const, text: "该就医", quote: "该就医" },
    ];
    expect(sortNotices(notices).map((n) => n.level)).toEqual([
      "seek-care",
      "with-doctor",
      "info",
    ]);
  });

  it("收起态只显示 seek-care", () => {
    const notices = [
      { level: "info" as const, text: "一般知识", quote: "一般知识" },
      { level: "with-doctor" as const, text: "遵医嘱", quote: "遵医嘱" },
      { level: "seek-care" as const, text: "该就医", quote: "该就医" },
    ];
    expect(urgentNotices(notices).map((n) => n.level)).toEqual(["seek-care"]);
  });

  it("cardsOfArticle 按路径后缀匹配（cards.json 带目录前缀）", () => {
    const cards = [
      makeCard("a", { articlePath: "the-savvy-life-manual/body-care/tears.md" }),
      makeCard("b", { articlePath: "the-savvy-life-manual/body-care/bone.md" }),
    ];
    expect(cardsOfArticle(cards, "body-care/tears.md").map((c) => c.id)).toEqual([
      "a",
    ]);
  });
});

describe("小节渲染", () => {
  it("第一个小节标题与文章标题相同时不重复显示标题", () => {
    const article = makeArticle({
      title: "睑缘清洗",
      sections: [
        { heading: "睑缘清洗", md: "开头那段" },
        { heading: "怎么做", md: "步骤" },
      ],
    });
    const sections = renderSections(article);
    expect(sections[0].heading).toBeNull();
    expect(sections[0].html).toContain("开头那段");
    expect(sections[1].heading).toBe("怎么做");
  });

  it("清掉 markdown 残留的排版记号", () => {
    expect(plainText("**每天 50 次**\n[!TIP]\n继续")).toBe("每天 50 次\n\n继续");
  });
});

describe("今天只放自己挑的（策展层）", () => {
  const cards = [
    makeCard("a", { slot: "morning" }),
    makeCard("b", { slot: "evening" }),
    makeCard("c"), // 没有 slot
    makeCard("d", { slot: "anytime" }),
    makeCard("e", { articleKind: "condition" }),
  ];

  it("只有日常里、且属于当前时段的卡进今天", () => {
    const ids = todaysCards(cards, ["a", "b", "c", "d"], "morning").map((c) => c.id);
    expect(ids).toEqual(["a", "c", "d"]);
  });

  it("疾病卡即使在日程里也不进今天（D8）", () => {
    expect(todaysCards(cards, ["e"], "morning").map((c) => c.id)).toEqual([]);
  });

  it("没有 slot 的卡按「随时」处理，一直看得见", () => {
    expect(todaysCards(cards, ["c"], "evening").map((c) => c.id)).toEqual(["c"]);
  });

  it("起步包按时段挑，每段最多 3 张；「随时」也算一段", () => {
    // a=早晨 b=晚间 c=没标时段 d=随时 —— c 与 d 都是「随时」（与 todaysCards 同一口径）
    expect(starterPack(cards)).toEqual(["a", "b", "c", "d"]);
  });

  it("起步包自己封顶：签完 450 张时它不能把今天塞回 450 条", () => {
    const slots = ["morning", "daytime", "evening", "anytime"] as const;
    const many = Array.from({ length: 450 }, (_, i) =>
      makeCard(`c${i}`, { slot: slots[i % 4] }),
    );
    const pack = starterPack(many);
    expect(pack.length).toBeLessThanOrEqual(12);
    expect(new Set(pack).size).toBe(pack.length);
  });

  it("起步包与卡片顺序无关（按 id 排，换设备同一个结果）", () => {
    const a = starterPack(cards);
    const b = starterPack([...cards].reverse());
    expect(a).toEqual(b);
  });

  it("移出去不销毁记录：印还在", () => {
    expect(removeFromRoutine(["a", "b"], "a")).toEqual(["b"]);
    expect(removeFromRoutine(["a"], "zz")).toEqual(["a"]);
  });

  it("「换一个」在同一天内是确定的，且不会跳出候选", () => {
    const one = dailyPick(cards, ["a"], "2026-10-20", 0);
    const two = dailyPick(cards, ["a"], "2026-10-20", 1);
    expect(one?.id).toBe(dailyPick(cards, ["a"], "2026-10-20", 0)?.id);
    expect(one?.id).not.toBe(two?.id);
    expect(["b", "c", "d", "e"]).toContain(two?.id);
  });
});

describe("放回默认：先数清楚会丢什么", () => {
  it("只数会被换掉的自己挑的卡；自己加的习惯保留", () => {
    expect(restoreCounts(["a", "b", "my-x"], ["a", "c"])).toEqual({
      dropped: 1,
      mine: 1,
    });
  });

  it("没有自己挑的卡时 dropped 是 0（不弹确认）", () => {
    expect(restoreCounts(["a", "my-x"], ["a"]).dropped).toBe(0);
  });
});

describe("发现：加走一张后其余保持", () => {
  const cards = ["a", "b", "c", "d", "e", "f"].map((id) => makeCard(id));

  it("只替换被加走的那一张，另外两张原地不动", () => {
    expect(refillPicks(cards, ["b"], ["b", "c", "d"], "b")).toEqual([
      "c",
      "d",
      "a",
    ]);
  });

  it("加的不是这一批里的卡，这一批原样", () => {
    expect(refillPicks(cards, ["z"], ["a", "b", "c"], "z")).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("候选不够就少给，不重复", () => {
    const only = [makeCard("a"), makeCard("b")];
    expect(refillPicks(only, ["b"], ["b", "a"], "b")).toEqual(["a"]);
  });
});

describe("模式变体的可用性", () => {
  it("按模式分别判断，不能只看「有没有任意 variants」", () => {
    expect(variantAvailability([makeCard("a")])).toEqual({
      busy: false,
      travel: false,
      sick: false,
    });
    expect(
      variantAvailability([
        makeCard("a", { variants: { busy: { include: ["step"] } } }),
      ]),
    ).toEqual({ busy: true, travel: false, sick: false });
    expect(
      variantAvailability([makeCard("a", { variants: { sick: { skip: true } } })]),
    ).toEqual({ busy: false, travel: false, sick: true });
  });
});

describe("首启说明：刷新后还该不该出现", () => {
  it("新用户自动放好的清单，没动手前刷新仍显示", () => {
    expect(firstRunOnLoad(["a"], true)).toBe(true);
  });

  it("老用户没有标记，不重新显示", () => {
    expect(firstRunOnLoad(["a"], undefined)).toBe(false);
  });

  it("用户动手后不再显示", () => {
    expect(firstRunOnLoad(["a"], false)).toBe(false);
  });
});

describe("首启的默认清单", () => {
  const cards = [
    makeCard("a", { slot: "morning" }),
    makeCard("b", { slot: "anytime" }),
  ];
  /** 内容层给的那份默认清单（次序即显示次序） */
  const routine = ["a", "b"];

  it("从没设置过 → 给默认清单那几张（用户不必先做一次设置）", () => {
    expect(initialRoutine(undefined, routine, cards)).toEqual(["a", "b"]);
  });

  it("用户自己清空过 → 尊重他，不自动塞回去", () => {
    expect(initialRoutine([], routine, cards)).toEqual([]);
  });

  it("用户自己挑过 → 原样", () => {
    expect(initialRoutine(["z"], routine, cards)).toEqual(["z"]);
  });

  it("默认清单为空（内容层没给）→ 回落起步包", () => {
    expect(initialRoutine(undefined, [], cards)).toEqual(starterPack(cards));
  });

  it("首启给的那几张在每个时段都看得到（不然又回到「一个动作都没有」）", () => {
    const pool = [
      makeCard("a", { slot: "morning" }),
      makeCard("b", { slot: "evening" }),
      makeCard("c", { slot: "anytime" }),
    ];
    const seeded = initialRoutine(undefined, ["a", "b", "c"], pool);
    // 日间没有专属的卡，但「随时」那一张一直在
    expect(todaysCards(pool, seeded, "daytime").map((c) => c.id)).toEqual(["c"]);
    expect(todaysCards(pool, seeded, "morning").map((c) => c.id)).toEqual(["a", "c"]);
  });
});

describe("自定义排序", () => {
  const cards = [
    makeCard("a", { slot: "morning" }),
    makeCard("b", { slot: "anytime" }),
    makeCard("c", { slot: "anytime" }),
  ];

  it("清单按日常里的次序摆，不按 cards.json 的顺序", () => {
    // cards.json 里是 a,b,c；日常里摆成 c,a,b → 屏上就该是 c,a,b
    expect(todaysCards(cards, ["c", "a", "b"], "morning").map((c) => c.id)).toEqual(["c", "a", "b"]);
  });

  it("调顺序看的是全部日常里的卡（不分时段）", () => {
    expect(routineCards(cards, ["c", "a"]).map((c) => c.id)).toEqual(["c", "a"]);
  });

  it("上移下移只动一位", () => {
    expect(moveInRoutine(["a", "b", "c"], "c", -1)).toEqual(["a", "c", "b"]);
    expect(moveInRoutine(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
  });

  it("到头就不再动（不是把第一张甩到末尾）", () => {
    expect(moveInRoutine(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
    expect(moveInRoutine(["a", "b", "c"], "c", 1)).toEqual(["a", "b", "c"]);
  });

  it("卡不在日常里就不动", () => {
    expect(moveInRoutine(["a", "b"], "zz", 1)).toEqual(["a", "b"]);
  });
});

describe("页边那一排印迹", () => {
  const noon = (daysAgo: number) => {
    const d = new Date("2026-10-20T12:00:00");
    d.setDate(d.getDate() - daysAgo);
    return d.getTime();
  };

  it("逐天回答「这天有没有留下记录」，断掉的不抹掉前面的", () => {
    const events = [
      { date: dayOf(noon(0)), cardId: "a", variant: "normal", ts: noon(0) },
      { date: dayOf(noon(2)), cardId: "a", variant: "normal", ts: noon(2) },
    ];
    const dots = recentActivity(events, 5, noon(0), dayOf);
    expect(dots).toEqual([false, false, true, false, true]);
  });

  it("没有任何记录时是全空，而不是报错", () => {
    expect(recentActivity([], 3, noon(0), dayOf)).toEqual([false, false, false]);
  });
});
