import { describe, expect, it } from "vitest";
import { secondsGrounded } from "../src/source/normalize.ts";
import { r02NumbersInQuote } from "../src/rules/index.ts";
import { parseMarkdown } from "../src/source/parse.ts";
import type { ArticleCards, Card } from "../src/cards/load.ts";

describe("时长须匹配完整数值、单位或明确范围端点", () => {
  it.each([
    [300, "保持 8～10 分钟"],
    [720, "保持 8～10 分钟"],
    [540, "保持 8～10 分钟"],
    [210, "炸 3～4 分钟"],
    [300, "做 1～2 次，然后保持 10 分钟"],
    [5, "保持 15 秒"],
    [3, "保持十三秒"],
    [90, "保持 3 分半"],
    [180, "保持 3 分半"],
    [900, "片刻后取出"],
    [900, "等待两刻钟"],
    [60, "保持 1 分钟 30 秒"],
    [30, "保持 1 分钟 30 秒"],
    [300, "保持 3 分钟，再保持 2 分钟"],
    [5400, ["保持 1 小时", "然后 30 分钟"]],
    [30, "保持 2 分钟～30 秒"],
    [300, "温度 5℃，等待片刻"],
    [300, "保持 -5 分钟"],
    [300, "保持 −5 分钟"],
    [120, "保持 1～2～3 分钟"],
    [120, "保持 1～ 2～3 分钟"],
    [120, "保持 1e2 分钟"],
    [1800, "保持一百三十分钟"],
    [Infinity, "保持 5 分钟"],
    [-1, "保持 5 分钟"],
    [NaN, "保持 5 分钟"],
    [90, "加热 2 分半～3 分钟"],
    [10, "评分十分"],
    [90, "等分半再取出"],
  ] as [number, string | string[]][])(
    "拒绝 %s 秒作为 %j 的逐字时长",
    (sec, quote) => {
      expect(secondsGrounded(sec, quote)).toBe(false);
    },
  );

  it.each([
    [480, "保持 8～10 分钟"],
    [600, "保持 8～10 分钟"],
    [60, "保持 1~2 分钟"],
    [120, "保持 1~2 分钟"],
    [30, "保持 30 秒到 1 分钟"],
    [60, "保持 30 秒到 1 分钟"],
    [1200, "冷藏 20 分钟～1 小时"],
    [3600, "冷藏 20 分钟～1 小时"],
    [210, "保持 3 分半"],
    [90, "煎约一分半"],
    [900, "等待一刻钟"],
    [1800, "等待两刻钟"],
    [780, "保持十三分钟"],
    [1800, "保持三十分钟"],
    [1800, "冷藏半小时"],
    [5400, "冷藏一个半小时"],
    [5400, "冷藏 1 小时 30 分钟"],
    [90, "保持 1 分钟 30 秒"],
    [90, "保持 **１．５ 分钟**"],
    [60, "保持一至两分钟"],
    [120, "保持一至两分钟"],
    [600, ["前一句没有时间", "保持 10 分钟"]],
    [600, "泡到 10 分钟为止"],
    [600, "短到 10 分钟"],
    [2100, "把煮的时间拉长到 35 分钟"],
    [150, "加热 2 分半～3 分钟"],
    [180, "加热 2 分半～3 分钟"],
    [900, "保持十五～十七分钟"],
    [1020, "保持十五～十七分钟"],
  ] as [number, string | string[]][])("认可 %s 秒对应 %j", (sec, quote) => {
    expect(secondsGrounded(sec, quote)).toBe(true);
  });
});

it("R2 同时阻断卡级与步级错误秒值，草稿仍报告 warning", () => {
  for (const status of ["reviewed", "draft"] as const) {
    const card = {
      id: "a",
      status,
      source: { anchor: "动作" },
      remind: { text: "保持", quote: "保持" },
      duration: { basis: "quote", sec: 300, quote: "保持 8～10 分钟" },
      steps: [
        {
          id: "hold",
          text: "保持",
          quote: "保持",
          duration: { basis: "quote", sec: 90, quote: "保持 3 分半" },
        },
      ],
    } as Card;
    const article: ArticleCards = {
      article: "test.md",
      kind: "practice",
      coverage: "partial",
      cards: [card],
    };
    const findings = r02NumbersInQuote({
      article,
      all: [article],
      source: parseMarkdown("# 动作\n保持"),
      contentDir: "content",
      file: "test.yaml",
    });
    expect(findings.map((f) => f.path)).toEqual([
      "duration.sec",
      "steps.hold.duration.sec",
    ]);
    expect(
      findings.every(
        (f) => f.level === (status === "reviewed" ? "error" : "warning"),
      ),
    ).toBe(true);
  }
});
