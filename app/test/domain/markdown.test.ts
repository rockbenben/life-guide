/**
 * 手册正文的 markdown 渲染。
 *
 * 手册是给人读的东西：表格、图片、列表、加粗都是内容的一部分。
 * 剥成纯文本这些全没了（实测 114 篇里 47 篇带表格、27 篇带图）。
 *
 * 这里钉住几件事：结构留住、快照自创的两种记号有各自的处理、
 * 以及全文检索用的纯文本剥得对。
 */
import { describe, expect, it } from "vitest";

import { mdToPlain, renderMarkdown, resolveArticleHref } from "../../src/domain/markdown.ts";

describe("手册正文：markdown 渲染", () => {
  it("表格留住结构，还套一层好横向滚", () => {
    const html = renderMarkdown("| 分组 | 风险 |\n| --- | --- |\n| 孩子队 | 0.53% |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>分组</th>");
    expect(html).toContain("<td>0.53%</td>");
    expect(html).toContain('<div class="lg-tablewrap">');
  });

  it("图片在原位，路径照旧是相对的", () => {
    const html = renderMarkdown("![动作说明](media/abc.png)");
    expect(html).toContain('<img src="media/abc.png"');
    expect(html).toContain('alt="动作说明"');
    expect(html).toContain('loading="lazy"');
  });

  it("加粗、斜体、列表都留住", () => {
    const html = renderMarkdown("**重点**与*斜体*\n\n- 甲\n- 乙");
    expect(html).toContain("<strong>重点</strong>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<li>甲</li>");
  });

  it("粗体挨着全角标点也要成立（CommonMark 会判成字面量）", () => {
    // `**「鳄鱼姿势」**`：开标记前面是「的」、后面是全角括号，按 flank 规则不成立 ——
    // 实测 52 篇文章、238 处会漏出星号。手册里的 `**` 只有加粗一个意思，自己认。
    const html = renderMarkdown("说明书的第一招，是瑜伽里的**「鳄鱼姿势」**，用来让交感神经平稳下来。");
    expect(html).toContain("<strong>「鳄鱼姿势」</strong>");
    expect(html).not.toContain("**");
  });

  it("提示框（> [!IMPORTANT]）做成带标签的块", () => {
    const html = renderMarkdown("> [!IMPORTANT]\n> 这条别忽略。");
    expect(html).toContain('class="lg-callout lg-callout-important"');
    expect(html).toContain("重要");
    expect(html).toContain("这条别忽略。");
    expect(html).not.toContain("[!IMPORTANT]");
  });

  it("普通引用不是提示框", () => {
    const html = renderMarkdown("> **注意**：感觉身体状况变差，请停止运动。");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("lg-callout");
  });

  it("相对 .md 链接变成应用内文章，外链仍新开标签页", () => {
    const internal = renderMarkdown("[膝盖养护](./knee.md#怎么练)", "body-care/bone.md");
    expect(internal).toContain('data-article="body-care/knee.md"');
    expect(internal).toContain('data-anchor="怎么练"');
    expect(internal).not.toContain('target="_blank"');
    const external = renderMarkdown("[出处](https://example.com/a)", "body-care/bone.md");
    expect(external).toContain('target="_blank"');
    expect(external).not.toContain("data-article");
  });

  it("解析上级目录与真外链", () => {
    expect(resolveArticleHref("../body-care/acupoints.md", "life-hacks/picks-100.md")).toEqual({
      path: "body-care/acupoints.md",
      anchor: undefined,
    });
    expect(resolveArticleHref("./knee.md", "body-care/bone.md")?.path).toBe("body-care/knee.md");
    expect(resolveArticleHref("https://example.com/a.md", "body-care/bone.md")).toBeNull();
    expect(resolveArticleHref("#section", "body-care/bone.md")).toBeNull();
  });

  it("脚注记号做成小字出处链接", () => {
    const html = renderMarkdown(
      "这一句来自说明书。^[[「腹痛」のトリセツ](https://at.web.nhk/files/x.pdf)]",
    );
    expect(html).toContain('<sup class="lg-fn">');
    expect(html).toContain('href="https://at.web.nhk/files/x.pdf"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("^[[");
  });

  it("外链一律新开标签页 —— 点一下不能把 PWA 导航走", () => {
    const html = renderMarkdown("[说明书原文](https://example.com/a)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("空段落不出东西", () => {
    expect(renderMarkdown("")).toBe("");
    expect(renderMarkdown("   \n  ")).toBe("");
  });
});

describe("手册正文：剥成纯文本（给检索用）", () => {
  it("记号剥掉，词不被切断", () => {
    const plain = mdToPlain("用**笔握法**刷[牙线](https://x)与![图](media/a.png)");
    expect(plain).toContain("用笔握法刷");
    expect(plain).toContain("牙线");
    expect(plain).not.toContain("**");
    expect(plain).not.toContain("](");
  });

  it("表格的行还在，竖线没了", () => {
    const plain = mdToPlain("| 分组 | 风险 |\n| --- | --- |\n| 孩子队 | 0.53% |");
    expect(plain).toContain("孩子队");
    expect(plain).not.toContain("|");
  });

  it("列表记号剥掉，内容留下", () => {
    const plain = mdToPlain("1. 晨光\n2. 睑缘清洗");
    expect(plain).toContain("晨光");
    expect(plain).toContain("睑缘清洗");
    expect(plain).not.toContain("1.");
  });
});
