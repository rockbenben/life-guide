/**
 * 补引文的测试。
 *
 * 这套逻辑替的是「引文引窄了」这件事：卡片的话没错，只是漏引了原文里的一段。
 * 找法要是找错了，补出来的引文会变成不相干的段落 —— 所以要钉住。
 */
import { describe, expect, it } from "vitest";

import {
  chunksOf,
  coveringChunk,
  extendQuote,
  longestCommonSubstring,
  quoteOf,
  uncoveredText,
} from "../src/repair-quotes.ts";
import type { Card } from "../src/cards/load.ts";

/** 原文的**纯文本**（解析之后的样子：markdown 标记已经没了） */
const SOURCE = `髋关节篇（4 个动作）

① 抬腿

起始姿势：

屈膝仰卧，双脚分开约一个拳头宽。
两侧手掌插入腰背下方。

动作：

吸气，以髋关节为轴缓慢抬起双脚，大腿与床面垂直，小腿与之平行。
呼气，缓慢放下。`;

function card(over: Partial<Card> = {}): Card {
  return {
    id: "hip-leg-raise",
    status: "draft",
    source: { anchor: "髋关节篇" },
    remind: {
      text: "屈膝仰卧，以髋关节为轴抬起双脚，再缓慢放下，保持腰不动。",
      quote: ["吸气，以髋关节为轴缓慢抬起双脚，大腿与床面垂直，小腿与之平行。", "呼气，缓慢放下。"],
    },
    steps: [],
    ...over,
  };
}

describe("补引文", () => {
  it("找出跟文字重合最长的那一段原文", () => {
    expect(longestCommonSubstring("屈膝仰卧，双脚分开", "屈膝仰卧，双脚分开约一个拳头宽。")).toBe(9);
  });

  it("先把引文盖住的部分剔掉，剩下的才是缺的那块", () => {
    const missing = uncoveredText(
      "屈膝仰卧，以髋关节为轴抬起双脚，再缓慢放下，保持腰不动。",
      "吸气，以髋关节为轴缓慢抬起双脚，大腿与床面垂直，小腿与之平行。\n呼气，缓慢放下。",
    );
    expect(missing).toContain("屈膝仰卧");
    expect(missing).not.toContain("缓慢放下");
  });

  it("漏掉的是「起始姿势」那一行 —— 要把它找出来", () => {
    const chunk = coveringChunk(
      "屈膝仰卧，以髋关节为轴抬起双脚，再缓慢放下，保持腰不动。",
      "吸气，以髋关节为轴缓慢抬起双脚，大腿与床面垂直，小腿与之平行。\n呼气，缓慢放下。",
      SOURCE,
    );
    expect(chunk).toContain("屈膝仰卧");
  });

  it("已经引过的那段不会再被选中", () => {
    const chunk = coveringChunk(
      "吸气，以髋关节为轴缓慢抬起双脚，大腿与床面垂直",
      "吸气，以髋关节为轴缓慢抬起双脚，大腿与床面垂直，小腿与之平行。",
      SOURCE,
    );
    expect(chunk ?? "").not.toContain("吸气，以髋关节为轴缓慢抬起双脚");
  });

  it("把找到的那段补进引文里", () => {
    const next = extendQuote(
      card(),
      "remind",
      "屈膝仰卧，以髋关节为轴抬起双脚，再缓慢放下，保持腰不动。",
      SOURCE,
    );
    expect(next).not.toBeNull();
    expect(next!.length).toBe(3);
    expect(next![2]).toContain("屈膝仰卧");
  });

  it("补进去的那段是原文的逐字片段 —— R1 仍然成立", () => {
    const next = extendQuote(
      card(),
      "remind",
      "屈膝仰卧，以髋关节为轴抬起双脚，再缓慢放下，保持腰不动。",
      SOURCE,
    )!;
    for (const q of next) {
      expect(SOURCE.replace(/\n/g, "")).toContain(q.replace(/\n/g, ""));
    }
  });

  it("找不到能覆盖的就别乱补", () => {
    expect(coveringChunk("完全不相干的一句话", "", "这一段里没有任何共同的东西出现。")).toBeNull();
    expect(extendQuote(card(), "remind", "完全不相干的一句话", "别的段落。")).toBeNull();
  });

  it("步骤的引文也认得", () => {
    const c = card({
      steps: [{ id: "s1", text: "先屈膝仰卧", quote: ["吸气，以髋关节为轴缓慢抬起双脚。"] }],
    });
    expect(quoteOf(c, "steps.s1")).toEqual(["吸气，以髋关节为轴缓慢抬起双脚。"]);
    const next = extendQuote(c, "steps.s1", "先屈膝仰卧，双脚分开", SOURCE);
    expect(next![1]).toContain("屈膝仰卧");
  });

  it("原文切成行：空行与纯标记行不要", () => {
    const chunks = chunksOf("一\n\n---\n\n一条内容\n");
    expect(chunks).toContain("一条内容");
    expect(chunks).not.toContain("---");
    expect(chunks).not.toContain("一");
  });
});
