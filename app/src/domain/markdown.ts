/**
 * 手册的 markdown 渲染。
 *
 * **为什么不能只用纯文本**：114 篇里有 47 篇带表格、27 篇带图、113 篇带嵌套列表、
 * 36 篇带「> [!IMPORTANT]」这样的提示框。剥成纯文本，这些结构全没了 ——
 * 表格变成一堆挤在一起的竖线，图片只剩一句图注，加粗也没了。
 * 手册是给人读的东西，格式就是内容的一部分。
 *
 * 用 marked（GFM：表格 ✓）渲染成 HTML，App 直接摆上去。
 *
 * 快照里有两处自创的记号，单独处理：
 *   · `^[[「腹痛」のトリセツ](https://…)` —— 脚注记号（215 处）：做成小字出处链接；
 *   · `> [!IMPORTANT]` —— 提示框（36 篇）：做成带底色的块。
 *
 * 产物里的正文是**我们自己的快照**（内容层从 blog 抄进来的定稿），
 * 不是用户输入，所以不另做 HTML 消毒。站内相对 `.md` 链接改成应用内文章跳转；
 * 真正的外链仍新开标签页 —— 点一下就把 PWA 导航走了，那比不渲染还糟。
 */
import { Marked } from "marked";

/**
 * 相对 `.md` 链接 → 应用内文章路径（含可选的小节锚点）。
 *
 * 手册正文里写的是「见[膝盖养护](./knee.md)」这种站内相对链接；
 * 直接交给浏览器会打开 `/knee.md`（PWA 里落到应用壳，不是文章）。
 * 这里只解析同目录/上级目录的 `.md`，其余链接保持原样。
 */
export function resolveArticleHref(
  href: string,
  basePath?: string,
): { path: string; anchor?: string } | null {
  if (!basePath || !href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("/")) {
    return null;
  }
  const [rawPath, rawAnchor = ""] = href.split("#");
  if (!/\.md$/i.test(rawPath)) return null;
  const baseDir = basePath.includes("/") ? basePath.slice(0, basePath.lastIndexOf("/") + 1) : "";
  const stack = baseDir.split("/").filter(Boolean);
  for (const part of rawPath.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  const path = stack.join("/");
  if (!path) return null;
  let anchor = rawAnchor;
  try {
    anchor = decodeURIComponent(rawAnchor);
  } catch {
    // 坏锚点原样带着，至少文章能打开
  }
  return { path, anchor: anchor || undefined };
}

let activeBasePath: string | undefined;

/** GitHub 风格的提示框 → 中文标签 */
const CALLOUT_LABELS: Record<string, string> = {
  TIP: "提示",
  NOTE: "说明",
  WARNING: "注意",
  CAUTION: "警告",
  IMPORTANT: "重要",
};

function escapeAttr(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * 脚注记号 → 小字出处链接。
 *
 * 快照里全是带 URL 的写法（`^[[标题](url)]`，215 处），没有不带 URL 的。
 * 标题是日文（「腹痛」のトリセツ），做成小字链接搁在段尾，
 * 既不占地方，又留着「这句出自哪本说明书」这层出处。
 */
function preprocessFootnotes(md: string): string {
  return md.replace(
    /\^\[\[([^\]\n]+)\]\(([^)\s]+)\)\]/g,
    (_, title: string, href: string) =>
      `<sup class="lg-fn"><a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" title="出处：${escapeAttr(title)}">${escapeAttr(title)}</a></sup>`,
  );
}

/**
 * `**粗体**` → `<strong>`。
 *
 * **为什么自己来**：CommonMark 的 flank 规则碰上全角标点就不成立 ——
 * `**「鳄鱼姿势」**` 的开标记前面是「的」、后面是全角括号「「」，
 * 按规则不算 left-flanking，于是强调不成立，星号原样留在屏幕上。
 * 实测：52 篇文章、238 处会这样（marked 与 markdown-it 一致）。
 *
 * 手册里的 `**` 只有「加粗」一个意思，所以这里直接自己认 ——
 * 宁可渲染得比源渲染器更宽，也不能让星号露在正文里。
 */
function preprocessBold(md: string): string {
  return md.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
}

const renderer = new Marked({
  gfm: true,
  breaks: false,
  renderer: {
    /**
     * 提示框：`> [!IMPORTANT]` 开头的那一段做成带底色的块。
     *
     * 判据是**第一个段落的开头** —— GitHub 的写法就是这样定的
     * （`> [!NOTE]` 后面接正文）。纯引用（`> **注意**：…`）不在这个格式里，
     * 照旧渲染成引用块。
     */
    blockquote({ tokens }) {
      const first = tokens[0];
      if (first?.type === "paragraph") {
        const head = first.tokens?.[0];
        if (head?.type === "text") {
          const m = /^\[!([A-Z]+)\]/.exec(head.raw);
          if (m) {
            const label = CALLOUT_LABELS[m[1]] ?? m[1];
            head.raw = head.raw.slice(m[0].length);
            head.text = head.text.slice(m[0].length);
            // 记号独占一段的话，那一段就空了 —— 丢掉它，别留一个空 <p>
            if (!head.text.trim() && first.tokens?.length === 1) tokens.shift();
            const body = this.parser.parse(tokens);
            return (
              `<blockquote class="lg-callout lg-callout-${m[1].toLowerCase()}">` +
              `<p class="lg-callout-h">${label}</p>${body}</blockquote>`
            );
          }
        }
      }
      return `<blockquote>${this.parser.parse(tokens)}</blockquote>`;
    },
    /** 图片：懒加载 + 说明文字当 alt。 */
    image({ href, title, text }) {
      const t = title ? ` title="${escapeAttr(title)}"` : "";
      return `<img src="${escapeAttr(href)}" alt="${escapeAttr(text)}" loading="lazy"${t}>`;
    },
    /** 链接：站内文章走应用内跳转，外链才新开标签页。 */
    link({ href, title, tokens, text }) {
      const t = title ? ` title="${escapeAttr(title)}"` : "";
      const body = tokens?.length ? this.parser.parseInline(tokens) : escapeAttr(text);
      const internal = resolveArticleHref(href, activeBasePath);
      if (internal) {
        const anchor = internal.anchor
          ? ` data-anchor="${escapeAttr(internal.anchor)}"`
          : "";
        return `<a href="#manual" data-article="${escapeAttr(internal.path)}"${anchor}${t}>${body}</a>`;
      }
      return `<a href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer"${t}>${body}</a>`;
    },
  },
});

/** 一小节的 markdown → HTML。basePath 用于解析文章里的相对 `.md` 链接。 */
export function renderMarkdown(src: string, basePath?: string): string {
  if (!src || !src.trim()) return "";
  activeBasePath = basePath;
  const html = renderer.parse(preprocessBold(preprocessFootnotes(src))) as string;
  activeBasePath = undefined;
  // 表格套一层：宽表在窄屏上横向滚，不撑破正文栏。
  // （marked 不给表格加容器，这里补上 —— 表格是正文的一部分，挤成竖线就废了。）
  return html.replace(/<table>/g, '<div class="lg-tablewrap"><table>').replace(/<\/table>/g, "</table></div>");
}

/**
 * markdown → 纯文本（给全文检索用）。
 *
 * 只用于「这篇文章里有没有这个词」—— 检索是子串匹配，
 * 语法记号（`**`、`|`、`-`）留着也不影响命中，但会让词被切断
 * （「涂**两**遍」里的「涂两遍」就搜不到了），所以先剥掉。
 */
export function mdToPlain(md: string): string {
  return String(md ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // 图片：只留位置，不留 alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接：留文字
    .replace(/\^\[\[([^\]\n]+)\]\([^)]*\)\]/g, "$1") // 脚注：留标题
    .replace(/\[!(TIP|NOTE|WARNING|CAUTION|IMPORTANT)\]/gi, "")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // 标题记号
    .replace(/^\s*>\s?/gm, "") // 引用记号
    .replace(/^\s*[-*+]\s+/gm, "") // 无序列表记号
    .replace(/^\s*\d+\.\s+/gm, "") // 有序列表记号
    .replace(/^\s*\|.*$/gm, (row) => row.replace(/\|/g, " ")) // 表格：竖线换成空格
    .replace(/^\s*[-:| ]{3,}$/gm, "") // 表格的分隔行
    .replace(/\*\*([^*]+)\*\*/g, "$1") // 粗体
    .replace(/\*([^*\n]+)\*/g, "$1") // 斜体
    .replace(/`([^`\n]+)`/g, "$1") // 行内代码
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
