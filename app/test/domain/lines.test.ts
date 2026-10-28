/**
 * 三行契约的测试。
 *
 * 夹具有来历：字段形状取自 content/cards/ 下真实卡的结构，
 * 文本用实测过的几种坏形状（anchor 是整句、remind 是禁忌句、
 * duration 把「持续 2 周」写成秒）。判据都是量出来的数字，不是偏好。
 */
import { describe, expect, it } from "vitest";

import {
  actionName,
  cardLines,
  cardName,
  displayNames,
  doLine,
  doseLines,
  doseValueText,
  durationLabel,
} from "../../src/domain/lines.ts";
import type { Card } from "../../src/domain/routine.ts";

function card(over: Partial<Card> = {}): Card {
  return {
    id: "heel-raise",
    status: "reviewed",
    source: { anchor: "每天 50 次快速踮脚尖" },
    remind: { text: "踮起脚尖再快速落下，每天 50 次、约 90 秒", quote: "…" },
    steps: [],
    duration: { basis: "quote", sec: 90, quote: "整套做完大约 90 秒" },
    ...over,
  } as Card;
}

describe("名：取原文小节名，不取整句 remind", () => {
  it("anchor 存在就用 anchor", () => {
    expect(cardName(card())).toBe("每天 50 次快速踮脚尖");
  });

  it("remind 是禁忌句时也不能当标题", () => {
    const c = card({
      source: { anchor: "哪些人不能自己练" },
      remind: {
        text: "患有心脏疾病、糖尿病的人，不要自行练习",
        quote: "…",
      },
    });
    expect(cardName(c)).toBe("哪些人不能自己练");
    expect(cardName(c)).not.toContain("不要自行练习");
  });

  it("anchor 缺失才回落到 remind 首句", () => {
    const c = card({ source: { anchor: "" } });
    expect(cardName(c)).toContain("踮起脚尖");
  });

  it("过长要截断，一行放得下", () => {
    const c = card({ source: { anchor: "慢性腰痛怎么办：7 个动作练 4 周再评估一次" } });
    expect([...cardName(c)].length).toBeLessThanOrEqual(17); // 16 + 省略号
    expect(cardName(c).endsWith("…")).toBe(true);
  });
});

describe("名：内容层另起的动作名优先于小节名", () => {
  // 夹具来自真事：防晒那篇的「涂法一：打圈涂（クルクル塗り）」——
  // 它在文章里是标题，在今天的清单里不是名字（用户原话：「标题也不对」）。
  const sunscreen = card({
    id: "sunscreen-circle-application",
    source: { anchor: "涂法一：打圈涂（クルクル塗り）" },
    name: "涂防晒霜",
    remind: { text: "打圈涂，涂两遍", quote: "…" },
  });

  it("有 name 就用它", () => {
    expect(cardName(sunscreen)).toBe("涂防晒霜");
  });

  it("用户自己加的名字仍然最优先", () => {
    const custom = card({ customName: "睡前拉伸 5 分钟", name: "涂防晒霜" });
    expect(cardName(custom)).toBe("睡前拉伸 5 分钟");
  });

  it("两张卡同名时回落到「这张卡在做什么」的首句", () => {
    const a = card({ id: "a", name: "涂防晒霜", remind: { text: "打圈涂，涂两遍", quote: "…" } });
    const b = card({ id: "b", name: "涂防晒霜", remind: { text: "补涂防晒霜", quote: "…" } });
    const names = displayNames([a, b]);
    expect(names.get("a")).toBe("打圈涂");
    expect(names.get("b")).toBe("补涂防晒霜");
  });

  it("name 不影响小节名那一套（旧卡照旧）", () => {
    expect(cardName(card())).toBe("每天 50 次快速踮脚尖");
  });
});

describe("数字不重复：一行只说一件事", () => {
  it("名里已有 50 次，做什么就不再念它", () => {
    const lines = cardLines(card());
    expect(lines.doText).toContain("踮起脚尖再快速落下");
    expect(lines.doText).not.toContain("50");
  });

  it("耗时栏已有 90 秒，做什么不第三次念它", () => {
    const lines = cardLines(card());
    expect(lines.duration.text).toContain("90 秒");
    expect(lines.doText).not.toContain("90");
  });

  it("数字已在名字里，但子句还有新内容时不能整段丢掉", () => {
    const c = card({
      source: { anchor: "美容用的 12 个穴位" },
      remind: {
        text: "第一次不妨只做基础的 4 个穴位：太阳、颧髎、颊车、翳风，对着镜子边看边按。",
        quote: "…",
      },
    });
    expect(doLine(c, "先按美容基础 4 穴")).toContain("太阳");
  });

  it("子句全被去重吃掉时宁可留原文，不许给空行", () => {
    const c = card({
      source: { anchor: "每天 10 秒" },
      remind: { text: "每天 10 秒", quote: "…" },
    });
    // 留的是**原文**：空格也在（比较那一步去空白，显示那一步不去）
    expect(doLine(c, "每天10秒")).toBe("每天 10 秒");
  });

  it("显示的那一句是原文：空格不被吃掉", () => {
    const c = card({
      source: { anchor: "睡前拉伸" },
      remind: { text: "站墙靠 5 分钟", quote: "…" },
    });
    expect(doLine(c, "")).toBe("站墙靠 5 分钟");
  });

  it("剂量：值与单位已在别处出现过的不重复列", () => {
    const c = card({
      dose: [
        { value: 50, unit: "次", what: "踮脚", quote: "…" },
        { value: 90, unit: "秒", what: "整套做完大约", quote: "…" },
        { value: 2, unit: "回", what: "两足各", quote: "…" },
      ],
    });
    const lines = cardLines(c);
    expect(lines.doses.map((d) => d.value)).toEqual([2]);
  });

  it("剂量最多三条，其余在展开态的用法用量表里", () => {
    const c = card({
      dose: [1, 2, 3, 4, 5].map((n) => ({ value: n, unit: "组", what: `第${n}项`, quote: "…" })),
    });
    expect(cardLines(c).doses).toHaveLength(3);
  });
});

describe("剂量那一行的数", () => {
  it("普通值就是那个数", () => {
    expect(doseValueText({ value: 5, unit: "次" })).toBe("5 次");
  });

  it("原文是近似值时带「约」", () => {
    expect(doseValueText({ value: 5, unit: "次", approximate: true })).toBe("约 5 次");
  });

  it("范围仍是一行，「约」在前面", () => {
    expect(doseValueText({ value: 30, valueMax: 60, unit: "秒", approximate: true })).toBe(
      "约 30～60 秒",
    );
  });
});

describe("耗时三态如实（§5.3 + D7）", () => {
  it("没有 duration → 什么也不显示，不是 0 秒，也不是一句废话", () => {
    const d = durationLabel(card({ duration: undefined }));
    expect(d.state).toBe("unknown");
    // §5.3：「有 unknown 时不显示总时长」—— 屏上不摆「未给耗时」那类解释
    expect(d.text).toBe("");
    expect(d.sec).toBeNull();
  });

  it("basis=unknown 同样不显示，不许为了好看编数", () => {
    expect(durationLabel(card({ duration: { basis: "unknown" } })).state).toBe("unknown");
  });

  it("推算要标推算，并带着算式", () => {
    const d = durationLabel(
      card({ duration: { basis: "derived", sec: 420, formula: "5 × 2 × 30 + 4 × 30 = 420 秒" } }),
    );
    expect(d.state).toBe("derived");
    expect(d.text).toMatch(/^推算 约 7 分钟$/);
    expect(d.formula).toContain("420");
  });

  it("120 秒以内用秒，超过才用分钟", () => {
    expect(durationLabel(card({ duration: { basis: "quote", sec: 10 } })).text).toBe("10 秒");
    expect(durationLabel(card({ duration: { basis: "quote", sec: 90 } })).text).toBe("90 秒");
    expect(durationLabel(card({ duration: { basis: "quote", sec: 150 } })).text).toBe("约 3 分钟");
  });

  it("把疗程写成单次耗时的坏数据，界面不许念出来", () => {
    const d = durationLabel(
      card({ duration: { basis: "derived", sec: 1209600, formula: "2 周 × 7 × 24 × 3600" } }),
    );
    expect(d.state).toBe("suspicious");
    // 那个秒数不念出来，界面也不摆解释 —— 一句「待核」也是废话
    expect(d.text).toBe("");
    expect(d.text).not.toMatch(/20160|分钟/);
    expect(d.sec).toBe(1209600); // 数还在，只是不当场显示
  });
});

describe("整卡收起来", () => {
  it("三行都在，且顺序是 名 / 做什么 / 剂量", () => {
    const l = cardLines(card({ dose: [{ value: 2, unit: "回", what: "两足各", quote: "…" }] }));
    expect(l.name).toBeTruthy();
    expect(l.doText).toBeTruthy();
    expect(l.doses).toHaveLength(1);
  });

  it("剂量那半句 what 与「做什么」一字不差时，也不重复列", () => {
    const c = card({
      source: { anchor: "什么是 3T 涂抹法？" },
      remind: { text: "每天早晚各涂一次保湿霜，用足量，每个部位轻柔地涂抹 30 次", quote: "…" },
      dose: [
        { value: 2, unit: "次/天", what: "早晚各涂一次", quote: "…" },
        { value: 30, unit: "次", what: "每个部位涂抹", quote: "…" },
      ],
    });
    const l = cardLines(c);
    expect(l.doses.map((d) => d.value)).toEqual([30]);
    expect(l.doText).toContain("早晚各涂一次");
  });
});

/**
 * 「做什么」与「名」说的是同一句话时，那一行整个不显示。
 *
 * 实测 518 张卡里有 50 张两行重叠，其中 5 张一字不差
 * （「每天酒精不超过 20～25 克」写两遍），有一张首启就能看见
 * （「睡前用生理盐水冲鼻腔 / 睡前用生理盐水冲洗鼻腔」）。
 *
 * 夹具全是真卡的数据（content/cards 下原样），不是编的。
 */
describe("名与「做什么」重复时不做两遍", () => {
  it("一字不差时，「做什么」这一行不显示", () => {
    const c = card({
      id: "limit-alcohol",
      name: "每天酒精不超过 20～25 克",
      remind: { text: "每天酒精不超过 20～25 克", quote: "…" },
      dose: [{ value: 20, unit: "克", what: "每日酒精上限范围", quote: "…" }],
    });
    expect(cardLines(c).doText).toBe("");
    expect(cardLines(c).name).toBe("每天酒精不超过 20～25 克");
  });

  it("只差一个「洗」字（同一件事的两种说法）也不显示", () => {
    const c = card({
      id: "nasal-rinse",
      name: "睡前用生理盐水冲鼻腔",
      remind: { text: "睡前用生理盐水冲洗鼻腔，坚持约 2 周", quote: "…" },
      dose: [
        { value: 2, unit: "次", what: "每个鼻孔", quote: "…" },
        { value: 2, unit: "周", what: "睡前坚持", quote: "…" },
      ],
    });
    expect(cardLines(c).doText).toBe("");
  });

  it("程度词不同就不是重复：晾透与晾一会儿差着强度", () => {
    // 原文：「水分充足的萝卜，稍微晾一下」
    const c = card({
      id: "lightly-dry-radish",
      name: "把切好的萝卜晾干",
      remind: { text: "把切好的萝卜稍微晾干。", quote: "…" },
    });
    expect(cardLines(c).doText).toContain("稍微");
  });

  it("「名」里没有的新数字是信息，不当重复删掉", () => {
    const c = card({
      id: "wash-face",
      name: "洗脸",
      remind: { text: "洗脸 30 秒", quote: "…" },
    });
    expect(cardLines(c).doText).toContain("30 秒");
  });

  it("整行判据：前半句是理由时不能只留下半截话", () => {
    const c = card({
      id: "freeze-before-cooking",
      name: "先冷冻再料理",
      remind: { text: "想提升食材的鲜味和香气时，先冷冻再料理", quote: "…" },
    });
    expect(cardLines(c).doText).toContain("想提升食材的鲜味和香气时");
    expect(cardLines(c).doText).toContain("先冷冻再料理");
  });

  it("对着屏上真正显示的那个名算：显示名回落后要重新判一次", () => {
    const c = card({
      id: "sunscreen-circle-application",
      name: "打圈涂防晒霜两遍",
      remind: { text: "打圈涂，涂两遍", quote: "…" },
    });
    // 显示名就是「打圈涂防晒霜两遍」→ 「打圈涂，涂两遍」是重复
    expect(cardLines(c, "打圈涂防晒霜两遍").doText).toBe("");
    // 换一个显示名（父组件回落成别的话）就不再是重复
    expect(cardLines(c, "涂防晒霜").doText).toBe("打圈涂，涂两遍");
  });
});

/**
 * 共享小节时的名字回落。
 *
 * 「名 = 原文小节名」这条规则有个后果：一个小节拆出多张卡时名字必然一样
 * （刷牙与牙线都出自「刷牙步骤」，三个穴位卡都出自「三个想每天都按的穴位」），
 * 屏上并排出现两个「刷牙步骤」看着像出了错。
 *
 * 这时回落到**这张卡在做什么**的首句 —— 还是原文的话。
 */
describe("共享小节时名字回落", () => {
  const brush = card({
    id: "brush-teeth",
    source: { anchor: "刷牙步骤" },
    remind: { text: "改用笔握法或端握法轻轻刷，别用力", quote: "…" },
  });
  const floss = card({
    id: "floss",
    source: { anchor: "刷牙步骤" },
    remind: { text: "每天用牙线：缠在手指上，拉锯式滑入牙缝", quote: "…" },
  });
  const sole = card({
    id: "sole",
    source: { anchor: "脚底放松" },
    remind: { text: "坐着把脚跟抬起来，放松足底", quote: "…" },
  });

  it("小节只有一张卡时，名字还是小节名", () => {
    const names = displayNames([sole]);
    expect(names.get("sole")).toBe("脚底放松");
  });

  it("小节拆出多张卡时，各自回落到自己那件事", () => {
    const names = displayNames([brush, floss, sole]);
    expect(names.get("brush-teeth")).toBe("改用笔握法或端握法轻轻刷");
    expect(names.get("floss")).toBe("每天用牙线");
    // 不共享的小节不受影响
    expect(names.get("sole")).toBe("脚底放松");
  });

  it("回落取的是第一个短句（原文的话）", () => {
    expect(actionName(floss)).toBe("每天用牙线");
    expect(actionName(brush)).toBe("改用笔握法或端握法轻轻刷");
    expect(actionName(card({ remind: { text: "中午百会集中力提升", quote: "…" } }))).toBe(
      "中午百会集中力提升",
    );
  });

  it("名太长要截断（跟小节名一个规矩）", () => {
    const long = card({
      remind: { text: "这是一段特别特别长的动作说明文字呀，应该被截断才对", quote: "…" },
    });
    expect(actionName(long).length).toBeLessThanOrEqual(17);
    expect(actionName(long).endsWith("…")).toBe(true);
  });
});
