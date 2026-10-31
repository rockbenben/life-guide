/**
 * 内容审计工具的单元测试。
 *
 * **重点是「它得真能抓到问题」** —— 一个永远说「没发现问题」的检查器
 * 比没有检查器更坏：它让人以为查过了（实测踩过：审计脚本的指纹比对
 * 拿 YAML 原始对象算，全表失配，看着像大事，其实是脚本自己错了）。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { parseDocument } from "yaml";

import { auditContent } from "../src/content-audit.ts";

describe("内容审计", () => {
  it("跑得出结果，数字对得上", () => {
    const r = auditContent();
    expect(r.total).toBeGreaterThan(400);
    expect(r.reviewed).toBeGreaterThan(400);
    // 有名字的应等于已签字的（2026-10-31 补齐了 78 张）
    expect(r.named).toBe(r.reviewed);
    expect(r.steps).toBeGreaterThan(1000);
  });

  it("**现在**没有发现问题（补完名、补完时长、修完重复步骤之后）", () => {
    const r = auditContent();
    const kinds = r.findings.map((f) => f.kind);
    expect(kinds).toEqual([]);
  });

  it("每一类检查项都能被触发 —— 不会因为写错了而永远说「没问题」", () => {
    // 把一张卡的时长改回「分钟被写成秒」，审计必须报出来
    const file = "content/cards/the-savvy-life-manual/food/garlic.yaml";
    const original = fs.readFileSync(file, "utf8");
    try {
      const doc = parseDocument(original);
      const cards = doc.get("cards") as {
        items: { get(k: string): unknown; set(k: string, v: unknown): void }[];
      };
      const card = cards.items.find((c) => (c.get("id") as string) === "garlic-slice-hot-water")!;
      const d = (card.get("duration") as { get(k: string): unknown }).get("quote");
      card.set("duration", {
        basis: "quote",
        sec: 10,
        quote: d,
      });
      fs.writeFileSync(file, doc.toString({ lineWidth: 0 }), "utf8");

      const r = auditContent();
      const kinds = r.findings.map((f) => f.kind);
      expect(kinds).toContain("卡级时长与引文对不上");
      expect(kinds).toContain("签字指纹失效");
    } finally {
      fs.writeFileSync(file, original, "utf8");
    }
  });
});
