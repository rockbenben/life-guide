/**
 * Markdown 解析：把小节、段落、图片抽成结构，供 R1 / R4 / R8 / R9 使用。
 *
 * 用 remark 而不是正则：引文比对要的是「原文的一段连续文字」，
 * 正则切出来的片段容易在标点、空行、缩进上与原文对不上。
 *
 * ⚠ 必须单遍遍历。写成 visit(heading) + visit(paragraph) 两遍是错的：
 * heading 那遍先跑完，current 已经停在最后一个标题上，
 * 于是所有段落都会被算进最后一个小节，前面的全空。
 * 2026-10-19 实测踩过：bone.md 的 5 个小节里有 4 个是空的。
 */
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { visit } from "unist-util-visit";

export interface SourceImage {
  url: string;
  alt: string;
  /** 所属小节标题；无小节时为文章标题 */
  section: string;
  /** 在文档中的出现序号，同 url 重复出现时区分 */
  index: number;
}

export interface SourceSection {
  /** 小节标题原文；首个 ## 之前的内容用文章标题 */
  heading: string;
  /** 该小节的正文纯文本（不含标题本身） */
  text: string;
  /**
   * 该小节的 markdown 原文（不含标题那一行）。
   *
   * 纯文本是给 R1/R9 校验用的（引文要比对字面），但手册要给人看 ——
   * 表格、图片、加粗、列表都是 markdown 里的结构，纯文本里全丢了
   * （实测：114 篇里 47 篇有表格、27 篇有图、113 篇有嵌套列表）。
   * 所以原文切片也一并带出来，App 按 markdown 渲染。
   */
  md: string;
  /** 该小节内的图片 */
  images: SourceImage[];
}

export interface SourceIndex {
  /** 全文纯文本（frontmatter 之后），R1 的比对底稿 */
  text: string;
  /** 去掉 frontmatter 后的 markdown 原文 */
  body: string;
  /** frontmatter 里的 title，用作首个 ## 之前那段的标题 */
  title: string;
  sections: SourceSection[];
  images: SourceImage[];
  /** 所有出现过的图片 URL（去重） */
  imageUrls: string[];
}

/** 去掉 YAML frontmatter，返回正文与 frontmatter 原文。 */
export function splitFrontmatter(markdown: string): {
  frontmatter: string;
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(markdown);
  if (!m) return { frontmatter: "", body: markdown };
  return { frontmatter: m[1], body: markdown.slice(m[0].length) };
}

function frontmatterTitle(frontmatter: string): string {
  const m = /^title:\s*(.+)$/m.exec(frontmatter);
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
}

function nodeText(node: any): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value ?? "";
  if (!node.children) return "";
  return node.children.map(nodeText).join("");
}

export function parseMarkdown(markdown: string): SourceIndex {
  const { frontmatter, body } = splitFrontmatter(markdown);
  const title = frontmatterTitle(frontmatter);
  // GFM：手册里有不少表格，不开的话表格会被当成普通段落，
  // 引文虽然也能命中，但那是巧合——表格结构丢了，将来加 remark 插件就会崩。
  const tree = unified().use(remarkParse).use(remarkGfm).parse(body);

  const sections: SourceSection[] = [];
  const images: SourceImage[] = [];
  const imageUrls: string[] = [];
  const seenUrls = new Set<string>();

  let current: SourceSection | null = null;

  const ensureSection = (heading: string): SourceSection => {
    if (!current || current.heading !== heading) {
      const sec: SourceSection = { heading, text: "", md: "", images: [] };
      current = sec;
      sections.push(sec);
    }
    return current;
  };

  // 单遍遍历，按文档顺序处理标题 / 段落 / 表格单元 / 图片
  visit(tree, ["heading", "paragraph", "tableCell", "image"], (node: any) => {
    if (node.type === "heading") {
      if (node.depth === 2) {
        current = null; // 下一段会新建
        ensureSection(nodeText(node).trim());
      }
      return;
    }
    if (node.type === "image") {
      const sec = ensureSection(current ? current.heading : title);
      const idx = images.length;
      images.push({
        url: node.url,
        alt: node.alt ?? "",
        section: sec.heading,
        index: idx,
      });
      sec.images.push(images[images.length - 1]);
      if (!seenUrls.has(node.url)) {
        seenUrls.add(node.url);
        imageUrls.push(node.url);
      }
      return;
    }
    // paragraph 与 tableCell 都算正文
    const text = nodeText(node);
    if (text.trim()) {
      const sec = ensureSection(current ? current.heading : title);
      sec.text += (sec.text ? "\n" : "") + text;
    }
  });

  const text = sections.map((s) => s.text).join("\n");

  // 原文切片：手册要按 markdown 渲染（表格、图片、列表都得在原位）
  const { lead, h2 } = sliceByH2(body);
  const titleIdx = sections.findIndex((s) => s.heading === title);
  let hi = 0;
  sections.forEach((s, i) => {
    if (i === titleIdx && titleIdx >= 0) {
      s.md = lead;
      return;
    }
    s.md = h2[hi]?.md ?? "";
    hi++;
  });

  return { text, body, title, sections, images, imageUrls };
}

/**
 * 按二级标题把原文切片。
 *
 * 为什么按行切而不靠 remark 的位置：位置要按「标题那行」算，
 * 而 remark 给的是标题**文字**的起止 —— 差一个「## 」的长度。
 * 行切更直白，也更好核对：切出来的每一行都还在原文里。
 */
function sliceByH2(body: string): {
  /** 第一个 ## 之前的那段（文章的引子） */
  lead: string;
  /** 每个 ## 小节的正文（不含标题行） */
  h2: { heading: string; md: string }[];
} {
  const lines = body.split("\n");
  const idx: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+\S/.test(lines[i])) idx.push(i);
  }
  const lead = lines.slice(0, idx.length ? idx[0] : lines.length).join("\n").trim();
  const h2: { heading: string; md: string }[] = [];
  for (let k = 0; k < idx.length; k++) {
    const from = idx[k] + 1;
    const to = k + 1 < idx.length ? idx[k + 1] : lines.length;
    h2.push({
      heading: lines[idx[k]].replace(/^##\s+/, "").trim(),
      md: lines.slice(from, to).join("\n").trim(),
    });
  }
  return { lead, h2 };
}
