/**
 * 构建层的单元测试。
 *
 * cards.json 只收签字有效的 reviewed 卡；manual.json 收全文。
 * 两者更新频率不同 —— 卡片跟着审阅走，手册跟着快照走 —— 所以必须分开。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildBundle, buildManual, collectManualMediaFiles } from "../src/build.ts";
import { fingerprint } from "../src/cards/fingerprint.ts";
import type { ArticleCards } from "../src/cards/load.ts";

const tmpDirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "life-guide-build-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** 一个最小的 content/ 目录：两篇文章 + 一张图。 */
function fixture() {
  const root = tmp();
  const manual = path.join(root, "source", "the-savvy-life-manual");
  fs.mkdirSync(path.join(manual, "body-care"), { recursive: true });
  fs.mkdirSync(path.join(root, "media"), { recursive: true });

  fs.writeFileSync(
    path.join(manual, "body-care", "tears.md"),
    [
      "---",
      "title: 干眼症",
      "---",
      "",
      "睑缘的清洁",
      "",
      "每天清洗睑缘。",
      "",
      "![图](https://img.newzone.top/a.png)",
      "",
      "## 禁忌",
      "",
      "眼睛有伤时不要做。",
      "",
    ].join("\n"),
    "utf8",
  );
  fs.writeFileSync(
    path.join(manual, "body-care", "tooth.md"),
    ["---", "title: 刷牙", "---", "", "每天刷牙。", ""].join("\n"),
    "utf8",
  );

  fs.writeFileSync(
    path.join(root, "source", "SOURCE.lock"),
    JSON.stringify({ repo: "x", commit: "abc", date: "2026-10-19", files: {} }),
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "media", "media.lock"),
    JSON.stringify({
      "https://img.newzone.top/a.png": { file: "a.png", sha256: "x", bytes: 1 },
    }),
    "utf8",
  );
  fs.writeFileSync(path.join(root, "media", "a.png"), "bytes", "utf8");

  return root;
}

function article(over: Partial<ArticleCards> = {}): ArticleCards {
  return {
    article: "the-savvy-life-manual/body-care/tears.md",
    kind: "practice",
    coverage: "partial",
    cards: [],
    ...over,
  };
}

describe("buildManual", () => {
  it("收进快照里的每一篇，并带上标题", () => {
    const root = fixture();
    const manual = buildManual([], root);
    expect(manual.articles.map((a) => a.path)).toEqual([
      "body-care/tears.md",
      "body-care/tooth.md",
    ]);
    expect(manual.articles[0].title).toBe("干眼症");
  });

  it("图片 URL 重写成 App 内的本地路径", () => {
    const root = fixture();
    const manual = buildManual([], root);
    // 图片在 markdown 里（手册按 markdown 渲染），所以改的是那段原文
    const md = manual.articles[0].sections.map((s) => s.md).join("\n");
    // **相对**路径（不是 /media/…）：同一份产物要能在子路径（web）、
    // app://（桌面）、capacitor://（手机）下都找得到图
    expect(md).toContain("media/a.png");
    expect(md).not.toContain("http");
  });

  it("手册带的是 markdown 原文（表格与图片的结构要留住）", () => {
    const root = fixture();
    const manual = buildManual([], root);
    const tears = manual.articles[0];
    // 第一个小节是「## 之前」那段（标题是文章标题）
    expect(tears.sections[0].md).toContain("每天清洗睑缘。");
    expect(tears.sections[0].md).toContain("![图]");
    // 第二个小节是「## 禁忌」那段，标题行本身不进正文
    expect(tears.sections[1].heading).toBe("禁忌");
    expect(tears.sections[1].md).toBe("眼睛有伤时不要做。");
  });

  it("抽过卡的文章带上 kind", () => {
    const root = fixture();
    const manual = buildManual(
      [article({ kind: "condition" })],
      root,
    );
    const tears = manual.articles.find((a) => a.path === "body-care/tears.md");
    const tooth = manual.articles.find((a) => a.path === "body-care/tooth.md");
    expect(tears?.kind).toBe("condition");
    expect(tooth?.kind).toBeUndefined();
  });

  it("手册的图片也要进 app/public/media，否则浏览时没图", () => {
    const root = fixture();
    expect(collectManualMediaFiles(root)).toEqual(["a.png"]);
  });
});

describe("buildBundle", () => {
  it("只收签字有效的 reviewed 卡", () => {
    const root = fixture();
    const card = {
      id: "tears",
      status: "reviewed" as const,
      source: { anchor: "睑缘的清洁" },
      remind: { text: "每天清洗睑缘", quote: "每天清洗睑缘。" },
      steps: [{ id: "warm", text: "用温水", quote: "用温水" }],
    };
    const signed = { ...card, review: { by: "benson", date: "2026-10-19", hash: fingerprint(card) } };
    const draft = { ...card, id: "tooth", status: "draft" as const };

    const bundle = buildBundle(
      [article({ cards: [signed, draft] })],
      root,
    );
    expect(bundle.cards.map((c) => c.id)).toEqual(["tears"]);
  });

  it("指纹失效的卡不收（改过内容就等于没审过）", () => {
    const root = fixture();
    const card = {
      id: "tears",
      status: "reviewed" as const,
      source: { anchor: "睑缘的清洁" },
      remind: { text: "每天清洗睑缘", quote: "每天清洗睑缘。" },
      steps: [{ id: "warm", text: "用温水", quote: "用温水" }],
    };
    const tampered = {
      ...card,
      remind: { text: "每天洗两次睑缘", quote: "每天清洗睑缘。" },
      review: { by: "benson", date: "2026-10-19", hash: fingerprint(card) },
    };
    const bundle = buildBundle([article({ cards: [tampered] })], root);
    expect(bundle.cards).toHaveLength(0);
  });

  it("卡上带文章信息，App 靠它区分疾病卡", () => {
    const root = fixture();
    const card = {
      id: "tears",
      status: "reviewed" as const,
      source: { anchor: "睑缘的清洁" },
      remind: { text: "每天清洗睑缘", quote: "每天清洗睑缘。" },
      steps: [{ id: "warm", text: "用温水", quote: "用温水" }],
    };
    const signed = { ...card, review: { by: "benson", date: "2026-10-19", hash: fingerprint(card) } };
    const bundle = buildBundle(
      [article({ kind: "condition", cards: [signed] })],
      root,
    );
    expect(bundle.cards[0].articleKind).toBe("condition");
    expect(bundle.cards[0].articlePath).toBe("the-savvy-life-manual/body-care/tears.md");
  });

  it("目录索引跟着 cards.json 走：手册列表不必等全文", () => {
    const root = fixture();
    const index = [
      { path: "body-care/tears.md", title: "干眼症", kind: "practice" as const },
      { path: "body-care/tooth.md", title: "刷牙" },
    ];
    const bundle = buildBundle([], root, index);
    expect(bundle.articles).toEqual(index);
  });

  it("没有模式版本的卡不把步骤 id 带进产物，有版本的必须留", () => {
    const root = fixture();
    const card = {
      id: "tears",
      status: "reviewed" as const,
      source: { anchor: "睑缘的清洁" },
      remind: { text: "每天清洗睑缘", quote: "每天清洗睑缘。" },
      steps: [{ id: "warm", text: "用温水", quote: "用温水" }],
    };
    const signed = {
      ...card,
      review: { by: "benson", date: "2026-10-19", hash: fingerprint(card) },
    };
    const plain = buildBundle([article({ cards: [signed] })], root);
    expect(plain.cards[0].steps[0].id).toBeUndefined();

    const variantCard = { ...card, variants: { busy: { include: ["warm"] } } };
    const variantSigned = {
      ...variantCard,
      review: { by: "benson", date: "2026-10-19", hash: fingerprint(variantCard) },
    };
    const withVariant = buildBundle([article({ cards: [variantSigned] })], root);
    expect(withVariant.cards[0].steps[0].id).toBe("warm");
  });
});
