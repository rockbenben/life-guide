/**
 * 归一化与规则层的单元测试。
 *
 * 这里最要紧的是 R1 与 R2 的分工：
 *   R1 拦「引文被改写」——改通顺的句子不是原文子串。
 *   R2 拦「引文抄对了但卡片自己写错数字」。
 * 两者的失败样例都在下面，各有独立用例，别合并。
 */
import { describe, expect, it } from "vitest";

import {
  approximationAttached,
  extractNumbers,
  findVagueTerms,
  isVerbatimSubstring,
  normalizeQuote,
  numbersCovered,
  secondsGrounded,
} from "../src/source/normalize.ts";
import { r01QuoteVerbatim, r02NumbersInQuote, r03NoVagueTerms, r04ImageExists, r05VariantsValid, r09Coverage, r14SegmentsValid, r16SlotGrounded, r17ApproximateGrounded } from "../src/rules/index.ts";
import { parseMarkdown, splitFrontmatter } from "../src/source/parse.ts";
import { fingerprint } from "../src/cards/fingerprint.ts";
import { checkBusyBudget, checkReviewSignature } from "../src/budget.ts";
import type { ArticleCards, Card } from "../src/cards/load.ts";

const SOURCE_MD = `---
title: 测试
---

## 每天 50 次快速踮脚尖

1. **准备姿势**：将脚尖踮起，身体挺直。

2. **快速下落**：卸掉脚上的力，让脚跟自然落下。

说明书的标准是**每天 50 次**，动作连贯快速进行，整套做完大约 **90 秒**。

## 哪些人不要做

- 膝盖或腰部患有疾病的人。
- 正在治疗**重度**骨质疏松症的人。

![踮脚尖：双脚并拢](https://img.newzone.top/20261016070621720.png?imageMogr2/format/webp)
`;

describe("normalizeQuote", () => {
  it("统一全半角标点", () => {
    expect(normalizeQuote("每天 50 次，动作连贯")).toBe(
      normalizeQuote("每天 50 次, 动作连贯"),
    );
  });

  it("统一空白但不动文字", () => {
    expect(normalizeQuote("  每天   50  次 ")).toBe("每天 50 次");
  });

  it("全角数字转半角", () => {
    expect(normalizeQuote("５０次")).toBe("50次");
  });
});

describe("isVerbatimSubstring", () => {
  const src = "说明书的标准是每天 50 次，动作连贯快速进行";

  it("原文的子串算逐字", () => {
    expect(isVerbatimSubstring("每天 50 次", src)).toBe(true);
  });

  it("改通顺后不算逐字（R1 的核心）", () => {
    // 「1日50回が目安」被改写成「以每天 50 次为标准」——不再是原文子串
    expect(isVerbatimSubstring("以每天 50 次为标准", src)).toBe(false);
  });

  it("标点差异不影响判定", () => {
    expect(isVerbatimSubstring("每天 50 次，动作连贯快速进行", src)).toBe(true);
  });
});

describe("extractNumbers", () => {
  it("阿拉伯数字", () => {
    expect([...extractNumbers("每天 50 次")]).toContain("50");
  });

  it("全角数字", () => {
    expect([...extractNumbers("５０次")]).toContain("50");
  });

  it("中文数字", () => {
    expect([...extractNumbers("五十次")]).toContain("50");
  });

  it("范围拆成两个字面量", () => {
    const n = extractNumbers("5～6 个月");
    expect(n.has("5")).toBe(true);
    expect(n.has("6")).toBe(true);
  });

  it("一句话里的多个数字", () => {
    const n = extractNumbers("1日50回");
    expect(n.has("1")).toBe(true);
    expect(n.has("50")).toBe(true);
  });
});

describe("numbersCovered", () => {
  it("数字出现在引文里就算过", () => {
    const r = numbersCovered("每天 50 次", "每天 50 次，动作连贯");
    expect(r.missing).toEqual([]);
  });

  it("数字不在引文里就报出来（R2 的核心）", () => {
    const r = numbersCovered("每天 3 次", "每天 50 次，动作连贯");
    expect(r.missing).toEqual(["3"]);
  });

  it("多句引文里任意一句有即可", () => {
    const r = numbersCovered("每天 50 次", ["无关的一句", "每天 50 次"]);
    expect(r.missing).toEqual([]);
  });
});

describe("findVagueTerms", () => {
  it("命中模糊词", () => {
    expect(findVagueTerms("适量食用")).toContain("适量");
  });

  it("正常表述不命中", () => {
    expect(findVagueTerms("每天 50 次")).toEqual([]);
  });
});

describe("parseMarkdown", () => {
  it("拆 frontmatter", () => {
    const { frontmatter, body } = splitFrontmatter(SOURCE_MD);
    expect(frontmatter).toContain("title: 测试");
    expect(body).not.toContain("title:");
  });

  it("抽出小节与图片", () => {
    const idx = parseMarkdown(SOURCE_MD);
    expect(idx.sections.map((s) => s.heading)).toContain("每天 50 次快速踮脚尖");
    expect(idx.imageUrls).toHaveLength(1);
  });
});

// ------------------------------------------------------------------ 规则层

function makeCtx(article: ArticleCards) {
  const source = parseMarkdown(SOURCE_MD);
  return {
    article,
    source,
    all: [article],
    contentDir: "content",
    file: "test.yaml",
  };
}

const baseCard: Card = {
  id: "heel-raise",
  status: "draft",
  source: { anchor: "每天 50 次快速踮脚尖" },
  remind: { text: "每天 50 次踮脚尖", quote: "说明书的标准是**每天 50 次**" },
  steps: [{ id: "prep", text: "将脚尖踮起，身体挺直", quote: "将脚尖踮起，身体挺直" }],
};

describe("R1 引文逐字", () => {
  it("引文被改写则报错", () => {
    const card = { ...baseCard, remind: { text: "每天 50 次", quote: "以每天 50 次为标准" } };
    const f = r01QuoteVerbatim(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.some((x) => x.rule === "R1")).toBe(true);
  });

  it("引文与原文一致则通过", () => {
    const f = r01QuoteVerbatim(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [baseCard] }));
    expect(f.filter((x) => x.rule === "R1")).toEqual([]);
  });
});

describe("R2 数字一致", () => {
  it("卡片写错数字而引文正确时报警", () => {
    const card = { ...baseCard, remind: { text: "每天 3 次踮脚尖", quote: "说明书的标准是**每天 50 次**" } };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.some((x) => x.rule === "R2")).toBe(true);
  });

  it("数字对得上则通过", () => {
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [baseCard] }));
    expect(f.filter((x) => x.rule === "R2")).toEqual([]);
  });

  it("剂量值不在引文里 → 报错（具体内容不许改）", () => {
    // 原文写「早晚各一次」，卡片却写成「2 次」—— 那个 2 是卡片自己换算出来的
    const card = {
      ...baseCard,
      dose: [{ value: 2, unit: "次", what: "早晚各一次", quote: "早晚各一次" }],
    };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.some((x) => x.rule === "R2" && x.path === "dose[0].value")).toBe(true);
  });

  it("剂量的范围值（valueMax）也要对着引文核", () => {
    const card = {
      ...baseCard,
      dose: [
        { value: 32, valueMax: 34, unit: "℃", what: "温凉水冲洗脸部", quote: "用 32 到 34℃ 的温凉水冲洗脸部" },
      ],
    };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.filter((x) => x.rule === "R2")).toEqual([]);
  });

  it("中文数字算对得上（早晚各一次 = 1 次）", () => {
    const card = {
      ...baseCard,
      dose: [{ value: 1, unit: "次", what: "早晚各一次", quote: "早晚各一次" }],
    };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.filter((x) => x.rule === "R2")).toEqual([]);
  });

  it("换算来的数（有算式）不算错", () => {
    const card = {
      ...baseCard,
      dose: [
        {
          value: 0.5,
          unit: "小勺",
          what: "食盐用量",
          quote: "盐 1/2 小勺",
          derived: { formula: "1/2 小勺 = 0.5 小勺" },
        },
      ],
    };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.filter((x) => x.rule === "R2")).toEqual([]);
  });

  it("算式里没有这个数 → 报错（算式要能复核）", () => {
    const card = {
      ...baseCard,
      dose: [
        {
          value: 0.5,
          unit: "小勺",
          what: "食盐用量",
          quote: "盐 1/2 小勺",
          derived: { formula: "1/2 小勺 = 0.25 小勺" },
        },
      ],
    };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.some((x) => x.rule === "R2" && x.path === "dose[0].derived")).toBe(true);
  });

  it("草稿卡的问题只算警告（等人审），已签字的才算错", () => {
    const draft = {
      ...baseCard,
      status: "draft" as const,
      dose: [{ value: 7, unit: "次", what: "早晚各一次", quote: "早晚各一次" }],
    };
    const df = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [draft] }));
    expect(df.filter((x) => x.rule === "R2").every((x) => x.level === "warning")).toBe(true);
    expect(df.filter((x) => x.rule === "R2").length).toBeGreaterThan(0);
  });
});

describe("secondsGrounded：这个秒数在引文里有没有着落", () => {
  it("原文写秒，直接对得上", () => {
    expect(secondsGrounded(30, "每次 30 秒")).toBe(true);
  });

  it("原文写分钟，换算后对得上", () => {
    expect(secondsGrounded(60, "保持 1 分钟")).toBe(true);
    expect(secondsGrounded(600, "泡 10 分钟")).toBe(true);
  });

  it("原文写小时，换算后对得上", () => {
    expect(secondsGrounded(3600, "冷藏一个小时")).toBe(true);
  });

  it("「1 分半」= 90 秒", () => {
    expect(secondsGrounded(90, "原样不动地煎约 1 分半")).toBe(true);
  });

  it("引文里是别的数 → 对不上", () => {
    expect(secondsGrounded(100, "保持 10 秒")).toBe(false);
    expect(secondsGrounded(180, "这篇给两件能立刻上手的事")).toBe(false);
  });

  it("中文数字 + 单位也对得上（三分钟 / 一个小时）", () => {
    expect(secondsGrounded(180, "不用去医院的三分钟自查")).toBe(true);
    expect(secondsGrounded(3600, "冷藏一个小时后即可食用")).toBe(true);
  });

  it("**裸数字不算数** —— 「煮 5 分钟」不能当成「5 秒」", () => {
    // 实测踩过：卡上写 5 秒、引文写「煮 5 分钟」—— 只比裸数字就会「对得上」，
    // 屏上把 5 分钟说成 5 秒，错 60 倍。单位是数的一部分。
    expect(secondsGrounded(5, "水烧开后放入蒜片，煮 5 分钟以上即成。")).toBe(false);
    expect(secondsGrounded(10, "切片后用 90℃ 以上的热水泡 10 分钟")).toBe(false);
  });

  it("引文是多句数组时，任意一句能换算到就算数", () => {
    expect(secondsGrounded(600, ["前面一句没有时间", "泡 10 分钟"])).toBe(true);
  });
});

describe("R2 也管时长里的秒值", () => {
  it("卡级时长抄错数字 → 报错（把 10 秒说成 100 秒没人拦是不行的）", () => {
    const card = {
      ...baseCard,
      duration: { basis: "quote" as const, sec: 100, quote: "保持 10 秒后放回" },
    };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.some((x) => x.rule === "R2" && x.path === "duration.sec")).toBe(true);
  });

  it("卡级时长的秒数对得上 → 通过", () => {
    const card = {
      ...baseCard,
      duration: { basis: "quote" as const, sec: 10, quote: "保持 10 秒后放回" },
    };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.filter((x) => x.rule === "R2")).toEqual([]);
  });

  it("步级时长抄错数字 → 报错", () => {
    const card = {
      ...baseCard,
      steps: [
        { id: "a", text: "保持", quote: "保持 10 秒后放回", duration: { basis: "quote" as const, sec: 100, quote: "保持 10 秒后放回" } },
      ],
    };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.some((x) => x.rule === "R2" && x.path === "steps.a.duration.sec")).toBe(true);
  });

  it("推算的时长：算式里没有这个秒数 → 报错", () => {
    const card = {
      ...baseCard,
      duration: { basis: "derived" as const, sec: 420, formula: "5 个动作 × 2 回 × 30 秒 = 300 秒" },
    };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.some((x) => x.rule === "R2" && x.path === "duration.derived")).toBe(true);
  });

  it("推算的时长：算式里有这个秒数 → 通过", () => {
    const card = {
      ...baseCard,
      duration: { basis: "derived" as const, sec: 300, formula: "5 个动作 × 2 回 × 30 秒 = 300 秒" },
    };
    const f = r02NumbersInQuote(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.filter((x) => x.rule === "R2")).toEqual([]);
  });
});

describe("R3 模糊词", () => {
  it("命中即报错", () => {
    const card = { ...baseCard, remind: { text: "适量踮脚尖", quote: "说明书的标准是**每天 50 次**" } };
    const f = r03NoVagueTerms(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.some((x) => x.rule === "R3")).toBe(true);
  });
});

describe("R5 variant", () => {
  it("引用不存在的步骤 id 则报错", () => {
    const card = { ...baseCard, variants: { busy: { include: ["nope"] } } };
    const f = r05VariantsValid(makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }));
    expect(f.some((x) => x.rule === "R5")).toBe(true);
  });
});

describe("指纹与签字", () => {
  it("指纹不随 review 字段变化", () => {
    const a = { ...baseCard, review: { by: "x", date: "2026-01-01", hash: "h" } };
    expect(fingerprint(a)).toBe(fingerprint(baseCard));
  });

  it("卡片内容变了指纹就变", () => {
    expect(fingerprint({ ...baseCard, remind: { text: "改", quote: "说明书的标准是**每天 50 次**" } })).not.toBe(
      fingerprint(baseCard),
    );
  });

  it("签字有效则通过", () => {
    const card: Card = { ...baseCard, status: "reviewed" };
    card.review = { by: "benson", date: "2026-10-19", hash: fingerprint(card) };
    expect(checkReviewSignature(card).ok).toBe(true);
  });

  it("改过内容后签字失效", () => {
    const card: Card = { ...baseCard, status: "reviewed" };
    card.review = { by: "benson", date: "2026-10-19", hash: fingerprint(card) };
    const changed: Card = { ...card, remind: { text: "改过的文字", quote: card.remind.quote } };
    expect(checkReviewSignature(changed).ok).toBe(false);
  });
});

describe("R9 覆盖", () => {
  it("引文落在别的小节里也算覆盖过", () => {
    // 卡片 anchor 指向 A 小节，但引文其实来自 lead 小节——
    // 只看 anchor 会把 lead 误判成「抽漏了」。
    const card: Card = {
      ...baseCard,
      source: { anchor: "每天 50 次快速踮脚尖" },
      remind: { text: "每天 50 次", quote: "年纪不算大，却总担心骨头会一天天疏松" },
    };
    const f = r09Coverage(
      makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }),
    );
    const lead = f.filter((x) => x.path === "sections:每天 50 次快速踮脚尖");
    expect(lead).toEqual([]);
  });

  it("确实没被抽到的小节会报出来", () => {
    const card: Card = { ...baseCard, source: { anchor: "每天 50 次快速踮脚尖" } };
    const f = r09Coverage(
      makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }),
    );
    expect(f.some((x) => (x.path ?? "").startsWith("sections:"))).toBe(true);
  });

  it("ignore 清单里的小节不再报", () => {
    const card: Card = { ...baseCard, source: { anchor: "每天 50 次快速踮脚尖" } };
    const f = r09Coverage(
      makeCtx({
        article: "x.md",
        kind: "practice",
        coverage: "partial",
        ignore: { sections: [{ anchor: "哪些人不要做", reason: "背景" }] },
        cards: [card],
      }),
    );
    expect(f.some((x) => x.path === "sections:哪些人不要做")).toBe(false);
  });
});

describe("R4 图片", () => {
  it("media.lock 里没有的图会被拦下", () => {
    // content/ 下没有 media.lock 时，所有图都该报「没有本地副本」
    const card: Card = {
      ...baseCard,
      steps: [{ ...baseCard.steps[0], images: ["https://img.newzone.top/x.png"] }],
    };
    const f = r04ImageExists(
      makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }),
    );
    expect(f.some((x) => x.rule === "R4")).toBe(true);
  });
});

describe("近似值检测", () => {
  it("「约 5 次」是近似", () => {
    expect(approximationAttached("来回轻柔地洗约 5 次", 5)).toBe(true);
  });

  it("「左右各 5 次」的左右是「两边」，不是近似", () => {
    expect(approximationAttached("左右各 5 次 × 1 组。", 5)).toBe(false);
  });

  it("「5 分钟左右」是近似", () => {
    expect(approximationAttached("每次 5 分钟左右", 5)).toBe(true);
  });

  it("范围不是近似（30 秒到 1 分钟）", () => {
    expect(approximationAttached("保持 30 秒到 1 分钟", 30, 60)).toBe(false);
  });

  it("中文数字也算数（约五次）", () => {
    expect(approximationAttached("约五次", 5)).toBe(true);
  });
});

describe("R17 剂量里的约", () => {
  const withDose = (dose: Card["dose"]): Card => ({ ...baseCard, dose });

  it("标了 approximate 却找不到近似词 —— 这个标志在说谎", () => {
    const card = withDose([
      { value: 5, unit: "次", what: "来回轻洗", approximate: true, quote: "来回轻柔地洗 5 次" },
    ]);
    const f = r17ApproximateGrounded(
      makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }),
    );
    expect(f.some((x) => x.rule === "R17")).toBe(true);
  });

  it("引文里有「约」，标了 approximate 就通过", () => {
    const card = withDose([
      { value: 5, unit: "次", what: "来回轻洗", approximate: true, quote: "来回轻柔地洗约 5 次" },
    ]);
    const f = r17ApproximateGrounded(
      makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }),
    );
    expect(f.filter((x) => x.rule === "R17")).toEqual([]);
  });

  it("没标 approximate 的行不报（那是待办，不是错）", () => {
    const card = withDose([
      { value: 5, unit: "次", what: "来回轻洗", quote: "来回轻柔地洗约 5 次" },
    ]);
    const f = r17ApproximateGrounded(
      makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }),
    );
    expect(f.filter((x) => x.rule === "R17")).toEqual([]);
  });
});

describe("R14 分档", () => {
  const withSeg = (segments: Card["segments"]): Card => ({ ...baseCard, segments });

  it("未知的人群标签会被拦下", () => {
    // 标签写错不会有任何症状——那一档永远匹配不上，用户永远看不到那条建议。
    const f = r14SegmentsValid(
      makeCtx({
        article: "x.md",
        kind: "practice",
        coverage: "partial",
        cards: [withSeg([{ id: "s1", when: ["age:70plus"] }])],
      }),
    );
    expect(f.some((x) => x.rule === "R14")).toBe(true);
  });

  it("已知标签通过", () => {
    const f = r14SegmentsValid(
      makeCtx({
        article: "x.md",
        kind: "practice",
        coverage: "partial",
        cards: [withSeg([{ id: "s1", when: ["age:senior"] }])],
      }),
    );
    expect(f.filter((x) => x.rule === "R14")).toEqual([]);
  });

  it("同一张卡里 id 重复会被拦下", () => {
    const f = r14SegmentsValid(
      makeCtx({
        article: "x.md",
        kind: "practice",
        coverage: "partial",
        cards: [
          withSeg([
            { id: "s1", when: ["age:child"] },
            { id: "s1", when: ["age:senior"] },
          ]),
        ],
      }),
    );
    expect(f.some((x) => x.rule === "R14")).toBe(true);
  });

  it("分档里的引文同样受 R1 约束", () => {
    const f = r01QuoteVerbatim(
      makeCtx({
        article: "x.md",
        kind: "practice",
        coverage: "partial",
        cards: [
          withSeg([
            {
              id: "s1",
              when: ["age:child"],
              action: { text: "跳跃", quote: "原文里没有这句话" },
            },
          ]),
        ],
      }),
    );
    expect(f.some((x) => x.rule === "R1")).toBe(true);
  });
  it("分档里的数字同样受 R2 约束", () => {
    const f = r02NumbersInQuote(
      makeCtx({
        article: "x.md",
        kind: "practice",
        coverage: "partial",
        cards: [
          withSeg([
            {
              id: "s1",
              when: ["age:child"],
              dose: { text: "每天 30 次", quote: "每天 10 次、每周 2～3 次" },
            },
          ]),
        ],
      }),
    );
    expect(f.some((x) => x.rule === "R2")).toBe(true);
  });
});

describe("R16 时段要有原文依据", () => {
  const withSlot = (slot: Card["slot"], status: Card["status"] = "draft"): Card => ({
    ...baseCard,
    slot,
    status,
  });

  it("草稿卡标了时段、原文却没有这个时段的说法 → 报出来", () => {
    // 测试原文里没有「晚上」这类说法，标晚间就是拍的
    const f = r16SlotGrounded(
      makeCtx({
        article: "x.md",
        kind: "practice",
        coverage: "partial",
        cards: [withSlot("evening")],
      }),
    );
    expect(f.some((x) => x.rule === "R16")).toBe(true);
  });

  it("随时不报（那是默认答案）", () => {
    const f = r16SlotGrounded(
      makeCtx({
        article: "x.md",
        kind: "practice",
        coverage: "partial",
        cards: [withSlot("anytime")],
      }),
    );
    expect(f.filter((x) => x.rule === "R16")).toEqual([]);
  });

  it("签过字的卡不查：时段是人的判断，R12 守着改动的路径", () => {
    const f = r16SlotGrounded(
      makeCtx({
        article: "x.md",
        kind: "practice",
        coverage: "partial",
        cards: [withSlot("evening", "reviewed")],
      }),
    );
    expect(f.filter((x) => x.rule === "R16")).toEqual([]);
  });
});

describe("忙档预算 R7", () => {
  const all: ArticleCards[] = [
    {
      article: "x.md",
      kind: "practice",
      coverage: "partial",
      cards: [
        { ...baseCard, id: "a", duration: { basis: "quote", sec: 60 } },
        { ...baseCard, id: "b", duration: { basis: "unknown" } },
      ],
    },
  ];

  it("没有预算文件时为空集，通过", () => {
    expect(checkBusyBudget(null, all).ok).toBe(true);
  });

  it("有未知耗时且无签字则不通过", () => {
    const r = checkBusyBudget({ members: ["a", "b"], acknowledged: [] }, all);
    expect(r.ok).toBe(false);
  });

  it("状态一致的签字可以放行", () => {
    const r = checkBusyBudget(
      {
        members: ["a", "b"],
        acknowledged: [
          {
            snapshot: { total_sec: null, unknown: ["b"] },
            by: "benson",
            date: "2026-10-19",
            note: "原文未给",
          },
        ],
      },
      all,
    );
    expect(r.ok).toBe(true);
  });

  it("卡片在中间那篇时也能找到（回归）", () => {
    // 曾经写成 for (const a of all) card = a.cards.find(...)，
    // 每次迭代都覆盖 —— 最后一篇没有这张卡，card 就成了 undefined，
    // 于是所有卡都被算成「耗时未知」，R7 永远误报，签字机制形同虚设。
    const mid: ArticleCards[] = [
      { article: "x.md", kind: "practice", coverage: "partial", cards: [] },
      {
        article: "y.md",
        kind: "practice",
        coverage: "partial",
        cards: [{ ...baseCard, id: "a", duration: { basis: "quote", sec: 10 } }],
      },
      { article: "z.md", kind: "practice", coverage: "partial", cards: [] },
    ];
    const r = checkBusyBudget({ members: ["a"], acknowledged: [] }, mid);
    expect(r.computation.unknown).toEqual([]);
    expect(r.computation.totalSec).toBe(10);
  });

  it("成员变了旧签字失效", () => {
    // 成员从 ["a","b"] 变成 ["a","c"]：问题依旧存在（仍有未知耗时的卡），
    // 但状态变了（unknown 列表不同），旧签字不能覆盖新状态。
    const withC: ArticleCards[] = [
      ...all,
      {
        article: "y.md",
        kind: "practice",
        coverage: "partial",
        cards: [{ ...baseCard, id: "c", duration: { basis: "unknown" } }],
      },
    ];
    const r = checkBusyBudget(
      {
        members: ["a", "c"],
        acknowledged: [
          {
            snapshot: { total_sec: null, unknown: ["b"] },
            by: "benson",
            date: "2026-10-19",
            note: "原文未给",
          },
        ],
      },
      withC,
    );
    expect(r.ok).toBe(false);
  });
});

describe("变体（忙/出差/生病）的引文与数字也要查", () => {
  it("生病变体的引文被改写时 R1 报错", () => {
    const card = {
      ...baseCard,
      variants: {
        sick: {
          replace: { text: "生病时每天 99 次", quote: "说明书里根本没有这句话" },
        },
      },
    };
    const f = r01QuoteVerbatim(
      makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }),
    );
    expect(f.some((x) => x.rule === "R1")).toBe(true);
  });

  it("生病变体写错数字时 R2 报错", () => {
    const card = {
      ...baseCard,
      variants: {
        sick: {
          replace: { text: "生病时每天 3 次", quote: "说明书的标准是**每天 50 次**" },
        },
      },
    };
    const f = r02NumbersInQuote(
      makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }),
    );
    expect(f.some((x) => x.rule === "R2")).toBe(true);
  });

  it("忙与出差同时存在时，出差那个也要查", () => {
    const card = {
      ...baseCard,
      variants: {
        busy: { replace: { text: "忙时每天 50 次", quote: "说明书的标准是**每天 50 次**" } },
        travel: { replace: { text: "出差时每天 88 次", quote: "说明书里没有这句话" } },
      },
    };
    const f = r01QuoteVerbatim(
      makeCtx({ article: "x.md", kind: "practice", coverage: "partial", cards: [card] }),
    );
    expect(f.some((x) => x.rule === "R1")).toBe(true);
  });
});

describe("忙档预算的确认条目", () => {
  it("确认条目漏写 snapshot 时不崩，并说清楚是哪一条", () => {
    const budget = {
      members: ["heel-raise"],
      acknowledged: [{ by: "benson", date: "2026-10-19", note: "确认过" }],
    } as never;
    const r = checkBusyBudget(budget, [
      { article: "x.md", kind: "practice", coverage: "partial", cards: [baseCard] },
    ]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("snapshot");
  });
});