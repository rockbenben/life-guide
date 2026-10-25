/**
 * 待签字清单的测试。
 *
 * 这份清单是「签字」的输入，所以两件事必须钉住：
 *   1. 只收机器没挑出毛病的卡（意思不对的不该混进来让人白看）；
 *   2. 签字只认清单里**勾上的**那几行 —— 没勾的绝不能被签。
 */
import { describe, expect, it } from "vitest";

import {
  buildSigningList,
  countTicked,
  firstClause,
  parseTickedIds,
  renderSigningList,
} from "../src/signing-list.ts";
import type { LoadedArticle } from "../src/cards/load.ts";

function loaded(
  cards: { id: string; status?: "draft" | "reviewed" }[],
  kind: "practice" | "condition" = "practice",
): LoadedArticle[] {
  return [
    {
      file: "x.yaml",
      data: {
        article: "the-savvy-life-manual/body-care/tooth.md",
        kind,
        coverage: "partial",
        cards: cards.map((c) => ({
          id: c.id,
          status: c.status ?? "draft",
          source: { anchor: "刷牙步骤" },
          remind: { text: "每天用牙线：缠在手指上，拉锯式滑入牙缝", quote: "…" },
          steps: [{ id: "s1", text: "取一段牙线", quote: "…" }],
          dose: [{ value: 10, unit: "秒", what: "每次时长", quote: "…" }],
          cautions: [{ level: "info", text: "别太用力", quote: "…" }],
        })),
      },
    },
  ] as unknown as LoadedArticle[];
}

describe("待签字清单", () => {
  it("只收机器没挑出毛病的卡", () => {
    const { entries } = buildSigningList(loaded([{ id: "a" }, { id: "b" }]), new Set(["a"]), ".");
    expect(entries.map((e) => e.cardId)).toEqual(["a"]);
  });

  it("已经签过的不进清单（没签的活儿才是清单上的活儿）", () => {
    const { entries } = buildSigningList(
      loaded([{ id: "a", status: "reviewed" }, { id: "b" }]),
      new Set(["a", "b"]),
      ".",
    );
    expect(entries.map((e) => e.cardId)).toEqual(["b"]);
  });

  it("每条给一张卡的预览（做什么、步骤、剂量、注意）", () => {
    const { entries } = buildSigningList(loaded([{ id: "a" }]), new Set(["a"]), ".");
    const md = renderSigningList(entries);
    expect(md).toContain("- [ ] `a`");
    expect(md).toContain("做什么：");
    expect(md).toContain("1. 取一段牙线");
    expect(md).toContain("剂量：");
    expect(md).toContain("⚠ 别太用力");
  });

  it("疾病类的篇要标出来（那种更要慢一点看）", () => {
    const { entries } = buildSigningList(loaded([{ id: "a" }], "condition"), new Set(["a"]), ".");
    expect(renderSigningList(entries)).toContain("⚠ 疾病类");
  });

  it("只认勾上的那几行", () => {
    const md = [
      "# 待签字清单",
      "",
      "- [ ] `a` — 做什么",
      "- [x] `b` — 做什么",
      "- [x] `c` — 做什么",
      "",
      "## 别的篇",
      "- [ ] `d` — 做什么",
    ].join("\n");
    expect(parseTickedIds(md)).toEqual(["b", "c"]);
    expect(countTicked(md)).toEqual({ ticked: 2, total: 4 });
  });

  it("首句就是「这张卡在做什么」", () => {
    expect(firstClause("每天用牙线：缠在手指上，拉锯式滑入牙缝")).toBe("每天用牙线");
    expect(firstClause("中午百会集中力提升")).toBe("中午百会集中力提升");
  });
});
