/**
 * 抽取流水线的单元测试。
 *
 * 全部用**假 LLM 客户端**（依赖注入，不联网）。要守住的四件事：
 *   1. 合格的 yaml 能通过、且 status 被强制成 draft；
 *   2. 引文被改写 → 拒绝（这是 R1 的意义：引文必须逐字）；
 *   3. 卡片文字里的数字不在引文里 → 拒绝（R2 的意义：文字不能偏离引文）；
 *   4. 模型自己写了 status: reviewed / review 块 → 强制改回 draft 并剥掉签字。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { draftArticle, listArticles, resolveArticle, targetFor } from "../src/extract/draft.ts";
import { extractText, type LlmClient, type LlmRequest } from "../src/extract/llm.ts";
import { parseDraft } from "../src/extract/parse.ts";
import { parseMarkdown } from "../src/source/parse.ts";

const ARTICLE_MD = `---
title: 测试文章
---

## 每天 50 次快速踮脚尖

**准备姿势**：将脚尖踮起，身体挺直。

说明书的标准是**每天 50 次**，动作连贯快速进行。

![踮脚尖：双脚并拢](https://img.newzone.top/20261016070621720.png?imageMogr2/format/webp)

## 哪些人不要做

- 膝盖或腰部患有疾病的人。
`;

const tmpDirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "life-guide-extract-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** 造一个最小仓库：source/ 一篇文章 + cards/ 空目录。 */
function fixture(): { root: string; sourceDir: string; cardsDir: string; rel: string } {
  const root = tmp();
  const sourceDir = path.join(root, "source");
  const cardsDir = path.join(root, "cards");
  const rel = "the-savvy-life-manual/body-care/test.md";
  fs.mkdirSync(path.join(sourceDir, "the-savvy-life-manual", "body-care"), { recursive: true });
  fs.mkdirSync(cardsDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, rel), ARTICLE_MD, "utf8");
  return { root, sourceDir, cardsDir, rel };
}

/** 假客户端：永远回同一段文本，并记录收到的请求。 */
function fakeClient(reply: string): LlmClient & { calls: LlmRequest[] } {
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(req: LlmRequest): Promise<string> {
      calls.push(req);
      return reply;
    },
  };
}

const GOOD_YAML = `article: the-savvy-life-manual/body-care/test.md
kind: practice
coverage: partial
ignore:
  sections:
    - anchor: "哪些人不要做"
      reason: "禁忌清单不是动作，单独由卡片 cautions 表达"
  images:
    - url: "https://img.newzone.top/20261016070621720.png?imageMogr2/format/webp"
      reason: "整篇配图，不对应可执行步骤"
cards:
  - id: calf-raise
    status: draft
    source:
      anchor: "每天 50 次快速踮脚尖"
    slot: anytime
    remind:
      text: "每天 50 次"
      quote: "每天 50 次"
    steps:
      - id: prepare
        text: "将脚尖踮起，身体挺直"
        quote: "将脚尖踮起，身体挺直"
    cautions:
      - level: stop
        text: "膝盖或腰部患有疾病的人不要做"
        quote: "膝盖或腰部患有疾病的人"
`;

/** 解析一份草稿（用真实快照当 R1 的底稿）。 */
function parse(reply: string, sourceDir: string) {
  const rel = "the-savvy-life-manual/body-care/test.md";
  const source = parseMarkdown(fs.readFileSync(path.join(sourceDir, rel), "utf8"));
  return parseDraft(reply, { source, file: "test.yaml" });
}

describe("parseDraft", () => {
  it("合格的 yaml 解析通过，status 被强制为 draft", () => {
    const { sourceDir } = fixture();
    const result = parse(GOOD_YAML, sourceDir);
    expect(result.ok).toBe(true);
    expect(result.findings.filter((f) => f.level === "error")).toEqual([]);
    expect(result.data?.cards[0].status).toBe("draft");
    expect(result.data?.cards[0].id).toBe("calf-raise");
  });

  it("引文被改写 → 拒绝，并指出是哪一条引文", () => {
    const { sourceDir } = fixture();
    const tampered = GOOD_YAML.replace(
      "quote: \"将脚尖踮起，身体挺直\"",
      "quote: \"把脚尖踮起来，身体保持挺直\"",
    );
    const result = parse(tampered, sourceDir);
    expect(result.ok).toBe(false);
    const r1 = result.findings.filter((f) => f.rule === "R1");
    expect(r1.length).toBe(1);
    expect(r1[0].level).toBe("error");
    expect(r1[0].path).toBe("steps.prepare.quote");
  });

  it("文字里的数字不在引文里 → 拒绝（R2）", () => {
    const { sourceDir } = fixture();
    // 引文是「每天 50 次」，文字却写成 30 次
    const tampered = GOOD_YAML.replace('text: "每天 50 次"', 'text: "每天 30 次"');
    const result = parse(tampered, sourceDir);
    expect(result.ok).toBe(false);
    const r2 = result.findings.filter((f) => f.rule === "R2");
    expect(r2.length).toBe(1);
    expect(r2[0].message).toContain("30");
  });

  it("模型写了 status: reviewed → 强制改成 draft，review 块被剥掉", () => {
    const { sourceDir } = fixture();
    const tampered = GOOD_YAML.replace(
      "    status: draft",
      '    status: reviewed\n    review:\n      by: llm\n      date: 2026-10-20\n      hash: deadbeef',
    );
    const result = parse(tampered, sourceDir);
    expect(result.ok).toBe(true);
    expect(result.data?.cards[0].status).toBe("draft");
    expect(result.data?.cards[0].review).toBeUndefined();
    expect(result.yaml).not.toContain("deadbeef");
    const notes = result.findings.filter((f) => f.rule === "DRAFT");
    expect(notes.length).toBe(2);
  });

  it("模糊词（R3）被拦下", () => {
    const { sourceDir } = fixture();
    const tampered = GOOD_YAML.replace('text: "每天 50 次"', 'text: "每天适量 50 次"');
    const result = parse(tampered, sourceDir);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === "R3")).toBe(true);
  });

  it("疾病类卡片不得带 slot（R10）", () => {
    const { sourceDir } = fixture();
    const tampered = GOOD_YAML.replace("kind: practice", "kind: condition");
    const result = parse(tampered, sourceDir);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === "R10")).toBe(true);
  });

  it("anchor 不是快照里的小节 → 拒绝（R8）", () => {
    const { sourceDir } = fixture();
    // 模型把小节标题改一个字（「早见表」→「早发表」）是常见错
    const tampered = GOOD_YAML.replace(
      'anchor: "每天 50 次快速踮脚尖"',
      'anchor: "每天 50 次快速踮脚尖（改）"',
    );
    const result = parse(tampered, sourceDir);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === "R8")).toBe(true);
  });

  it("引文末尾多出的省略号被剪掉，剪完仍逐字就放行", () => {
    const { sourceDir } = fixture();
    // 模型抄长引文时爱在末尾加「…」，原文里没有 —— 这是机械错，不该整篇作废
    const tampered = GOOD_YAML.replace(
      'quote: "将脚尖踮起，身体挺直"',
      'quote: "将脚尖踮起，身体挺直…"',
    );
    const result = parse(tampered, sourceDir);
    expect(result.ok).toBe(true);
    expect(result.data?.cards[0].steps[0].quote).toBe("将脚尖踮起，身体挺直");
    const notes = result.findings.filter((f) => f.message.includes("省略号"));
    expect(notes).toHaveLength(1);
    expect(notes[0].level).toBe("warning");
  });

  it("剪掉省略号后仍不逐字 → 照样拒绝（R1 不放松）", () => {
    const { sourceDir } = fixture();
    const tampered = GOOD_YAML.replace(
      'quote: "将脚尖踮起，身体挺直"',
      'quote: "把脚尖踮起来，身体站直…"',
    );
    const result = parse(tampered, sourceDir);
    expect(result.ok).toBe(false);
    expect(result.findings.some((f) => f.rule === "R1")).toBe(true);
  });

  it("模型在 yaml 前后加了话，也能取出 yaml", () => {
    const { sourceDir } = fixture();
    const chatty = `好的，我抽出了下面这张卡：\n\n\`\`\`yaml\n${GOOD_YAML}\`\`\`\n\n以上。`;
    const result = parse(chatty, sourceDir);
    expect(result.ok).toBe(true);
    expect(result.data?.cards.length).toBe(1);
  });
});

describe("draftArticle", () => {
  it("写出的文件是 draft，且不覆盖已有 reviewed 卡", async () => {
    const { root, sourceDir, cardsDir, rel } = fixture();
    const client = fakeClient(GOOD_YAML);

    const outcome = await draftArticle(rel, {
      contentDir: root,
      cardsDir,
      sourceDir,
      client,
    });
    expect(outcome.action).toBe("write");
    expect(outcome.cards).toBe(1);
    expect(client.calls.length).toBe(1);
    // 提示词里必须带原文与图片清单
    expect(client.calls[0].user).toContain("每天 50 次快速踮脚尖");
    expect(client.calls[0].user).toContain(
      "https://img.newzone.top/20261016070621720.png?imageMogr2/format/webp",
    );

    const target = targetFor(cardsDir, rel);
    const written = fs.readFileSync(target, "utf8");
    expect(written).toContain("status: draft");
    expect(written).not.toContain("reviewed");

    // 再起草一次：文件里已有卡（draft），走追加
    const second = await draftArticle(rel, {
      contentDir: root,
      cardsDir,
      sourceDir,
      client: fakeClient(GOOD_YAML),
    });
    expect(second.action).toBe("append");
    expect(second.cards).toBe(1);

    // 把已有卡改成 reviewed 之后，起草必须被拒绝
    const doc = fs.readFileSync(target, "utf8").replace("status: draft", "status: reviewed");
    fs.writeFileSync(target, doc, "utf8");
    const third = await draftArticle(rel, {
      contentDir: root,
      cardsDir,
      sourceDir,
      client: fakeClient(GOOD_YAML),
    });
    expect(third.action).toBe("skip");
    expect(third.error).toContain("reviewed");
  });

  it("dry-run 不联网、不写盘", async () => {
    const { root, sourceDir, cardsDir, rel } = fixture();
    const client = fakeClient(GOOD_YAML);
    const outcome = await draftArticle(rel, {
      contentDir: root,
      cardsDir,
      sourceDir,
      client,
      dryRun: true,
    });
    expect(outcome.dryRun).toBe(true);
    expect(outcome.action).toBe("write");
    expect(client.calls.length).toBe(0);
    expect(fs.existsSync(targetFor(cardsDir, rel))).toBe(false);
  });

  it("自检不过就不写盘", async () => {
    const { root, sourceDir, cardsDir, rel } = fixture();
    const broken = GOOD_YAML.replace(
      "quote: \"将脚尖踮起，身体挺直\"",
      "quote: \"把脚尖踮起来，身体保持挺直\"",
    );
    const outcome = await draftArticle(rel, {
      contentDir: root,
      cardsDir,
      sourceDir,
      client: fakeClient(broken),
    });
    expect(outcome.action).toBe("failed");
    expect(outcome.findings.some((f) => f.rule === "R1")).toBe(true);
    expect(fs.existsSync(targetFor(cardsDir, rel))).toBe(false);
  });
});

describe("extractText", () => {
  it("取最后一个 text 块（前面通常是 thinking 块）", () => {
    const body = {
      content: [
        { type: "thinking", thinking: "想一下……" },
        { type: "text", text: "第一段" },
        { type: "text", text: "第二段" },
      ],
    };
    expect(extractText(body)).toBe("第二段");
  });

  it("没有 text 块时报错，并说清是不是预算用尽", () => {
    const body = { content: [{ type: "thinking", thinking: "…" }], stop_reason: "max_tokens" };
    expect(() => extractText(body)).toThrow(/max_tokens/);
  });
});

describe("文章定位", () => {
  it("接受相对 source/、相对仓库根与后缀三种写法", () => {
    const { root, sourceDir } = fixture();
    const rel = "the-savvy-life-manual/body-care/test.md";
    expect(resolveArticle(rel, sourceDir)).toBe(rel);
    expect(resolveArticle(`content/source/${rel}`, sourceDir)).toBe(rel);
    expect(resolveArticle("body-care/test.md", sourceDir)).toBe(rel);
    expect(resolveArticle("不存在的文章.md", sourceDir)).toBe(null);
    expect(listArticles(sourceDir)).toEqual([rel]);
  });
});
