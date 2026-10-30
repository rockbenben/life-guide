/**
 * 补名工具的单元测试。
 *
 * 这里守的是「名字会不会撞、会不会太长、名册会不会写错 id」——
 * 名字错了不会让校验器报错（R1 管的是引文，名字不是引文），
 * 所以只能靠这里守住。
 */
import { describe, expect, it } from "vitest";

import { CARD_NAMES } from "../src/card-names.ts";
import { checkNameList, NAME_MAX } from "../src/card-name-tool.ts";

/** 造一份卡片索引来测。 */
function cardsOf(entries: [string, string?][]): Map<string, { file: string; name?: string; anchor: string }> {
  const m = new Map<string, { file: string; name?: string; anchor: string }>();
  for (const [id, name] of entries) {
    m.set(id, { file: "a.yaml", name, anchor: "" });
  }
  return m;
}

describe("名册本身", () => {
  it("每个名字都不超过 16 字（收起态一行放不下）", () => {
    for (const [id, name] of Object.entries(CARD_NAMES)) {
      expect([...name].length, `${id} 的名字太长`).toBeLessThanOrEqual(NAME_MAX);
    }
  });

  it("没有两个名字一样（屏上并排两行一样看着像出了错）", () => {
    const seen = new Map<string, string>();
    for (const [id, name] of Object.entries(CARD_NAMES)) {
      expect(seen.has(name), `${id} 与 ${seen.get(name)} 同名`).toBe(false);
      seen.set(name, id);
    }
  });

  it("每个名字都非空", () => {
    for (const [id, name] of Object.entries(CARD_NAMES)) {
      expect(name.trim().length, `${id} 的名字是空的`).toBeGreaterThan(0);
    }
  });
});

describe("checkNameList：写盘前要查出来的问题", () => {
  it("名字太长 → 报出来", () => {
    const cards = cardsOf([["x"]]);
    const p = checkNameList(cards, { x: "这是一个非常非常非常非常非常非常长的名字" });
    expect(p.some((q) => q.problem.includes("超过"))).toBe(true);
  });

  it("名册里有卡片里找不到的 id → 报出来（静默跳过的话那张卡永远补不上名）", () => {
    const cards = cardsOf([]);
    const p = checkNameList(cards, { ghost: "某个名字" });
    expect(p.some((q) => q.problem.includes("找不到"))).toBe(true);
  });

  it("两个卡同名 → 报出来", () => {
    const cards = cardsOf([["a"], ["b"]]);
    const p = checkNameList(cards, { a: "同一个名字", b: "同一个名字" });
    expect(p.some((q) => q.problem.includes("重复"))).toBe(true);
  });

  it("同一篇里撞名 → 报出来", () => {
    const cards = new Map([
      ["a", { file: "same.yaml", name: undefined, anchor: "" }],
      ["b", { file: "same.yaml", name: undefined, anchor: "" }],
    ]);
    const p = checkNameList(cards, { a: "名字甲", b: "名字甲" });
    expect(p.some((q) => q.problem.includes("同一篇"))).toBe(true);
  });

  it("都没问题 → 不报", () => {
    const cards = cardsOf(Object.keys(CARD_NAMES).map((id) => [id, undefined]));
    const p = checkNameList(cards);
    expect(p).toEqual([]);
  });
});
