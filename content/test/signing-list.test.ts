/**
 * 待签字清单的测试。
 *
 * 这份清单是「签字」的输入，所以两件事必须钉住：
 *   1. 只收机器没挑出毛病的卡（意思不对的不该混进来让人白看）；
 *   2. 签字只认清单里**勾上的**那几行 —— 没勾的绝不能被签。
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { stringify } from "yaml";

import {
  buildSigningList,
  countTicked,
  firstClause,
  parseTickedCards,
  renderSigningList,
} from "../src/signing-list.ts";
import type { LoadedArticle } from "../src/cards/load.ts";
import { reviewFingerprint } from "../src/cards/fingerprint.ts";

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
  function list(articles: LoadedArticle[], okIds: string[]) {
    const hashes = articles.flatMap(({ data }) => data.cards
      .filter((card) => okIds.includes(card.id))
      .map((card) => reviewFingerprint(data, card)));
    return buildSigningList(articles, new Set(hashes), ".");
  }

  it("只收机器没挑出毛病的卡", () => {
    const { entries } = list(loaded([{ id: "a" }, { id: "b" }]), ["a"]);
    expect(entries.map((e) => e.cardId)).toEqual(["a"]);
  });

  it("已经签过的不进清单（没签的活儿才是清单上的活儿）", () => {
    const { entries } = list(
      loaded([{ id: "a", status: "reviewed" }, { id: "b" }]),
      ["a", "b"],
    );
    expect(entries.map((e) => e.cardId)).toEqual(["b"]);
  });

  it("每条给一张卡的预览（做什么、步骤、剂量、注意）", () => {
    const { entries } = list(loaded([{ id: "a" }]), ["a"]);
    const md = renderSigningList(entries);
    expect(md).toContain("- [ ] `a`");
    expect(md).toContain("做什么：");
    expect(md).toContain("1. 取一段牙线");
    expect(md).toContain("剂量：");
    expect(md).toContain("⚠ 别太用力");
  });

  it("疾病类的篇要标出来（那种更要慢一点看）", () => {
    const { entries } = list(loaded([{ id: "a" }], "condition"), ["a"]);
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
    expect([...parseTickedCards(md).keys()]).toEqual(["b", "c"]);
    expect(countTicked(md)).toEqual({ ticked: 2, total: 4 });
  });

  it("首句就是「这张卡在做什么」", () => {
    expect(firstClause("每天用牙线：缠在手指上，拉锯式滑入牙缝")).toBe("每天用牙线");
    expect(firstClause("中午百会集中力提升")).toBe("中午百会集中力提升");
  });
});

it("CLI 续审发现同 ID 卡片改动，旧勾选清单拒签，重新审阅后可以签字", () => {
  const repo = path.resolve(import.meta.dirname, "../..");
  const root = fs.mkdtempSync(path.join(repo, ".review-test-"));
  try {
    const contentDir = path.join(root, "content");
    fs.cpSync(path.join(repo, "content/src"), path.join(contentDir, "src"), { recursive: true });
    fs.cpSync(path.join(repo, "schema"), path.join(root, "schema"), { recursive: true });
    const [{ data }] = loaded([{ id: "review-test" }]);
    const card = data.cards[0];
    card.remind = { text: "拿起牙线", quote: "拿起牙线" };
    card.steps = [{ id: "s1", text: "取一段牙线", quote: "取一段牙线" }];
    delete card.dose;
    delete card.cautions;
    const source = path.join(contentDir, "source", data.article);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.writeFileSync(source, "## 刷牙步骤\n\n拿起牙线。取一段牙线。整理牙线。\n");
    const cards = path.join(contentDir, "cards", "test.yaml");
    fs.mkdirSync(path.dirname(cards));
    const writeCards = () => fs.writeFileSync(cards, stringify(data));
    writeCards();

    const run = (...args: string[]) => spawnSync(
      process.execPath, [path.join(contentDir, "src", "cli.ts"), ...args],
      { cwd: root, encoding: "utf8" },
    );
    const succeeds = (...args: string[]) => {
      const result = run(...args);
      expect(result.status, result.stderr || result.stdout).toBe(0);
      return result.stdout;
    };
    const list = path.join(contentDir, "signing-list.md");
    const state = path.join(contentDir, "audit-state.json");
    const tickList = () => fs.writeFileSync(
      list, fs.readFileSync(list, "utf8").replace("- [ ] `review-test`", "- [x] `review-test`"),
    );
    succeeds("audit", "--no-llm");
    const before = fs.readFileSync(state, "utf8");
    expect(succeeds("audit", "--no-llm", "--resume")).toContain("没有待审");
    succeeds("signing-list");
    tickList();

    card.remind = { text: "整理牙线", quote: "整理牙线" };
    writeCards();
    const rejected = run("review", "--list", list, "--by", "test");
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain("卡片已变更");
    expect(fs.readFileSync(cards, "utf8")).toContain("status: draft");
    expect(run("signing-list").status).toBe(1);

    succeeds("audit", "--no-llm", "--resume");
    expect(fs.readFileSync(state, "utf8")).not.toBe(before);
    succeeds("signing-list");
    tickList();
    succeeds("review", "--list", list, "--by", "test");
    expect(fs.readFileSync(cards, "utf8")).toContain("status: reviewed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
