/**
 * 「条件」的领域规则。
 *
 * 值得盯住的是两件事：年龄段必须单选（同时是「未成年人」和「70 岁以上」没有意义），
 * 摘要只说跟默认不一样的部分（默认条件不用占地方）。
 */
import { describe, expect, it } from "vitest";

import {
  describeConditions,
  normalizeTags,
  orderedTags,
  tagText,
  toggleTag,
} from "../../src/domain/conditions.ts";

const MODE_LABELS = { normal: "正常", busy: "很忙", travel: "出差", sick: "生病" };

describe("标签切换", () => {
  it("年龄段是单选：换一个就取消另一个", () => {
    const tags = toggleTag(["age:adult"], "age:senior");
    expect(tags).toEqual(["age:senior"]);
  });

  it("年龄档不会丢掉状态标签", () => {
    const tags = toggleTag(["age:adult", "knee-pain"], "age:child");
    expect(tags).toContain("knee-pain");
    expect(tags).toContain("age:child");
    expect(tags).not.toContain("age:adult");
  });

  it("状态标签可多选", () => {
    const tags = toggleTag(["knee-pain"], "fall-risk");
    expect(tags.sort()).toEqual(["fall-risk", "knee-pain"]);
  });

  it("状态标签再点一次就取消", () => {
    expect(toggleTag(["knee-pain", "fall-risk"], "knee-pain")).toEqual([
      "fall-risk",
    ]);
  });
});

describe("条件摘要", () => {
  it("默认条件不占地方", () => {
    expect(describeConditions("normal", [], MODE_LABELS)).toBe("默认");
  });

  it("只说跟默认不一样的部分", () => {
    expect(describeConditions("normal", ["age:adult"], MODE_LABELS)).toBe(
      "默认",
    );
    expect(describeConditions("busy", ["age:senior"], MODE_LABELS)).toBe(
      "很忙 · 70 岁以上",
    );
  });

  it("标签说人话，不给机器口径", () => {
    expect(tagText("age:senior")).toBe("70 岁以上");
    expect(describeConditions("normal", ["fall-risk"], MODE_LABELS)).toBe(
      "易跌倒",
    );
  });
});

describe("年龄档", () => {
  it("没选年龄档时补上成人（否则成人那一档永远命中不了）", () => {
    expect(normalizeTags([])).toEqual(["age:adult"]);
    expect(normalizeTags(["fall-risk"])).toEqual(["age:adult", "fall-risk"]);
  });

  it("已经选了年龄档就不动它", () => {
    expect(normalizeTags(["age:senior"])).toEqual(["age:senior"]);
  });
});

describe("标签顺序", () => {
  it("按固定顺序返回（年龄段在前）", () => {
    expect(orderedTags(["knee-pain", "age:senior"])).toEqual([
      "age:senior",
      "knee-pain",
    ]);
  });
});
