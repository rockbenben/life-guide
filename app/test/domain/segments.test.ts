/**
 * 人群分档的匹配用例。
 *
 * 这块逻辑的复杂度全在「命中几档」上：
 *   0 档 → 默认动作
 *   1 档 → 用那一档
 *   多档 → 分档写重了，要提示而不是随便挑一个
 */
import { describe, expect, it } from "vitest";

import { matchSegments, segmentApplies, type CardWithSegments } from "../../src/domain/segments.ts";

const card: CardWithSegments = {
  id: "heel-raise",
  remind: { text: "踮起脚尖再快速落下，每天 50 次、约 90 秒", quote: "原文" },
  dose: [
    { value: 50, unit: "次", what: "踮脚", quote: "原文" },
    { value: 90, unit: "秒", what: "整套做完大约", quote: "原文" },
  ],
  steps: [
    { id: "prep", text: "将脚尖踮起，身体挺直", quote: "原文" },
    { id: "drop", text: "卸掉脚上的力，让脚跟自然落下", quote: "原文" },
  ],
  cautions: [{ level: "stop", text: "有跌倒风险的话，请不要做这个动作", quote: "原文" }],
  segments: [
    {
      id: "bone-child",
      when: ["age:child"],
      action: { text: "跳跃", quote: "原文" },
      dose: { text: "每天 10 次、每周 2～3 次", quote: "原文" },
      avoid: [{ text: "疼痛、担心跌倒者请不要做", quote: "原文" }],
    },
    {
      id: "bone-adult",
      when: ["age:adult"],
      action: { text: "深蹲一类的力量训练", quote: "原文" },
      dose: { text: "负荷越高效果越高，养成持续运动的习惯", quote: "原文" },
    },
    {
      id: "bone-senior",
      when: ["age:senior"],
      action: { text: "防跌倒——单脚站立、提踵、深蹲", quote: "原文" },
      avoid: [{ text: "用一张稳固的椅子", quote: "原文" }],
    },
  ],
};

describe("分档匹配", () => {
  it("没命中任何一档时用默认动作", () => {
    const r = matchSegments(card, []);
    expect(r.segment).toBeNull();
    expect(r.action).toBe("踮起脚尖再快速落下，每天 50 次、约 90 秒");
    expect(r.dose).toBe("50次 · 90秒");
  });

  it("命中一档时换动作与剂量", () => {
    const r = matchSegments(card, ["age:child"]);
    expect(r.segment?.id).toBe("bone-child");
    expect(r.action).toBe("跳跃");
    expect(r.dose).toBe("每天 10 次、每周 2～3 次");
  });

  it("分档的禁忌会追加到默认禁忌后面", () => {
    const r = matchSegments(card, ["age:child"]);
    expect(r.cautions).toHaveLength(2);
    expect(r.cautions[0].text).toBe("有跌倒风险的话，请不要做这个动作");
    expect(r.cautions[1].text).toBe("疼痛、担心跌倒者请不要做");
    expect(r.cautions[1].level).toBe("stop");
  });

  it("没有 avoid 时禁忌只有默认的", () => {
    const r = matchSegments(card, ["age:adult"]);
    expect(r.cautions).toHaveLength(1);
  });

  it("分档换了动作，默认剂量不能跟着走", () => {
    // 分档命中 bone-senior（防跌倒）时，卡片默认的「50次·90秒」是踮脚的量，
    // 挂在另一个动作上是错的 —— 用户会以为防跌倒也是每天 50 次。
    const r = matchSegments(card, ["age:senior"]);
    expect(r.action).toBe("防跌倒——单脚站立、提踵、深蹲");
    expect(r.dose).toBe("");
  });

  it("分档给了剂量就用分档的", () => {
    const r = matchSegments(card, ["age:child"]);
    expect(r.dose).toBe("每天 10 次、每周 2～3 次");
  });

  it("分档换了动作，默认步骤也不跟着走", () => {
    const r = matchSegments(card, ["age:senior"]);
    expect(r.steps).toEqual([]);
  });

  it("没命中分档时用卡片的剂量与步骤", () => {
    const r = matchSegments(card, []);
    expect(r.dose).toBe("50次 · 90秒");
    expect(r.steps).toHaveLength(2);
  });

  it("多档同时命中时不随便挑一个", () => {
    const r = matchSegments(card, ["age:adult", "age:senior"]);
    expect(r.matched).toHaveLength(2);
    expect(r.segment).toBeNull();
    expect(r.action).toBe("踮起脚尖再快速落下，每天 50 次、约 90 秒");
  });

  it("when 是 AND 语义，标签不全就不算命中", () => {
    const multi = {
      ...card,
      segments: [{ id: "x", when: ["age:adult", "knee-pain"], action: { text: "A", quote: "q" } }],
    };
    expect(segmentApplies(multi.segments![0], ["age:adult"])).toBe(false);
    expect(segmentApplies(multi.segments![0], ["age:adult", "knee-pain"])).toBe(true);
  });

  it("空的 when 不匹配任何人", () => {
    expect(segmentApplies({ id: "x", when: [] }, ["age:adult"])).toBe(false);
  });
});
