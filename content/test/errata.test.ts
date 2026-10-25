/**
 * R13：快照完整性的单元测试。
 *
 * 这条规则守的是「快照与上游分叉之后，改动不许消失」。
 * 所以要测的不是「文件能不能改」—— 改是允许的，要测的是
 * 「改了但没记」会被抓出来。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkSnapshotIntegrity, parseErrata } from "../src/source/errata.ts";

const tmpDirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "life-guide-r13-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function sha256(text: string): string {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/** 造一个最小快照：source/ 一篇文章 + media/ 一张图。 */
function fixture(opts: {
  articleText?: string;
  lockHash?: string;
  errata?: string;
  mediaText?: string;
  omitMedia?: boolean;
} = {}) {
  const root = tmp();
  const sourceDir = path.join(root, "source");
  const mediaDir = path.join(root, "media");
  fs.mkdirSync(path.join(sourceDir, "body-care"), { recursive: true });
  fs.mkdirSync(mediaDir, { recursive: true });

  const articleText = opts.articleText ?? "每天洗脸。\n";
  const rel = "the-savvy-life-manual/body-care/tears.md";
  fs.mkdirSync(path.join(sourceDir, "the-savvy-life-manual", "body-care"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(sourceDir, rel), articleText, "utf8");
  fs.writeFileSync(
    path.join(sourceDir, "SOURCE.lock"),
    JSON.stringify({ repo: "x", commit: "abc", date: "2026-10-19", files: { [rel]: opts.lockHash ?? sha256(articleText) } }, null, 2),
    "utf8",
  );
  fs.writeFileSync(
    path.join(sourceDir, "ERRATA.md"),
    opts.errata ??
      [
        "# 勘误记录",
        "",
        "```yaml",
        "- file: <相对 content/source 的路径>",
        "  before: <改动前>",
        "  after: <改动后>",
        "  reason: <为什么改>",
        "  upstream: fixed | pending | n/a",
        "```",
        "",
      ].join("\n"),
    "utf8",
  );

  const mediaText = opts.mediaText ?? "fake-image-bytes";
  const mediaFile = `${sha256(mediaText)}.png`;
  if (!opts.omitMedia) fs.writeFileSync(path.join(mediaDir, mediaFile), mediaText, "utf8");
  fs.writeFileSync(
    path.join(mediaDir, "media.lock"),
    JSON.stringify(
      { "https://img.newzone.top/a.png": { file: mediaFile, sha256: sha256(mediaText), bytes: mediaText.length, fetchedAt: "2026-10-19" } },
      null,
      2,
    ),
    "utf8",
  );

  return { root, rel, mediaFile };
}

describe("parseErrata", () => {
  it("读出 yaml 代码块里的记录", () => {
    const recs = parseErrata(
      [
        "# 勘误记录",
        "",
        "```yaml",
        "- file: the-savvy-life-manual/body-care/tears.md",
        "  before: 旧文字",
        "  after: 新文字",
        "  reason: 原文有误",
        "  upstream: pending",
        "```",
        "",
      ].join("\n"),
    );
    expect(recs).toHaveLength(1);
    expect(recs[0].file).toBe("the-savvy-life-manual/body-care/tears.md");
    expect(recs[0].upstream).toBe("pending");
  });

  it("模板占位符不算记录", () => {
    const recs = parseErrata(
      ["```yaml", "- file: <相对 content/source 的路径>", "  reason: <为什么改>", "```"].join("\n"),
    );
    expect(recs).toEqual([]);
  });

  it("路径写法不同也归一到同一个键", () => {
    const recs = parseErrata(
      ["```yaml", "- file: content/source/the-savvy-life-manual/body-care/tears.md", "```"].join("\n"),
    );
    expect(recs[0].file).toBe("the-savvy-life-manual/body-care/tears.md");
  });
});

describe("checkSnapshotIntegrity", () => {
  it("一切对得上时没有报错", () => {
    const f = fixture();
    expect(checkSnapshotIntegrity({ contentDir: f.root })).toEqual([]);
  });

  it("快照被改过但没有勘误记录 → 报错", () => {
    const f = fixture();
    fs.writeFileSync(
      path.join(f.root, "source", f.rel),
      "每天洗脸，改过了。\n",
      "utf8",
    );
    const findings = checkSnapshotIntegrity({ contentDir: f.root });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe("R13");
    expect(findings[0].message).toContain("ERRATA.md");
  });

  it("改了但记了勘误 → 不报错", () => {
    const f = fixture({
      errata: [
        "```yaml",
        "- file: the-savvy-life-manual/body-care/tears.md",
        "  reason: 原文有误",
        "  upstream: pending",
        "```",
      ].join("\n"),
    });
    fs.writeFileSync(path.join(f.root, "source", f.rel), "每天洗脸，改过了。\n", "utf8");
    expect(checkSnapshotIntegrity({ contentDir: f.root })).toEqual([]);
  });

  it("快照文件不在了 → 报错", () => {
    const f = fixture();
    fs.rmSync(path.join(f.root, "source", f.rel));
    const findings = checkSnapshotIntegrity({ contentDir: f.root });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("不在了");
  });

  it("图片副本不在了 → 报错", () => {
    const f = fixture({ omitMedia: true });
    const findings = checkSnapshotIntegrity({ contentDir: f.root });
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toContain("content/media/");
  });

  it("图片内容被换过 → 报错", () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.root, "media", f.mediaFile), "别的字节", "utf8");
    const findings = checkSnapshotIntegrity({ contentDir: f.root });
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain("media.lock");
  });
});
