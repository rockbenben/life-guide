/**
 * 设计令牌的正文对比度底线：WCAG AA 4.5:1。
 *
 * 颜色写在 CSS 里，组件测试看不见 —— 直接从 style.css 读令牌和
 * 导航激活态那条规则，免得「深色下朱红底上写白字」这种问题再漏过去。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(join(process.cwd(), "app", "src", "style.css"), "utf8");
const DARK_AT = CSS.indexOf("@media (prefers-color-scheme: dark)");
const LIGHT = CSS.slice(0, DARK_AT).match(/:root \{([\s\S]*?)\}/)?.[1] ?? "";
const DARK = CSS.slice(DARK_AT).match(/:root \{([\s\S]*?)\}/)?.[1] ?? "";

function token(block: string, name: string): string {
  const m = block.match(new RegExp(`${name}: (#[0-9a-fA-F]{6})`));
  if (!m) throw new Error(`缺少令牌 ${name}`);
  return m[1];
}

function resolveColor(rule: string, prop: string, block: string): string {
  // 前面必须是行首/空白/分号：否则查 color 会先撞上 border-color
  const raw = rule.match(new RegExp(`(?:^|[\\s;])${prop}:\\s*([^;]+);`))?.[1]?.trim() ?? "";
  const varName = raw.match(/^var\((--[a-z0-9-]+)\)$/)?.[1];
  return varName ? token(block, varName) : raw;
}

function normalizeHex(hex: string): string {
  return /^#[0-9a-f]{3}$/i.test(hex)
    ? "#" + hex.slice(1).split("").map((c) => c + c).join("")
    : hex;
}

function luminance(hex: string): number {
  const full = normalizeHex(hex);
  const channels = [1, 3, 5].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const linear = channels.map((v) =>
    v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: string, b: string): number {
  const l1 = luminance(normalizeHex(a));
  const l2 = luminance(normalizeHex(b));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

describe("正文对比度", () => {
  const themes = [
    ["浅色", LIGHT],
    ["深色", DARK],
  ] as const;

  it("所有正文/警示令牌在自己的底色上过 4.5", () => {
    const pairs = [
      ["--lg-ink", "--lg-paper"],
      ["--lg-ink", "--lg-sheet"],
      ["--lg-ink-2", "--lg-paper"],
      ["--lg-ink-2", "--lg-sheet"],
      ["--lg-ink-3", "--lg-paper"],
      ["--lg-ink-3", "--lg-sheet"],
      ["--lg-alert", "--lg-paper"],
      ["--lg-zhu", "--lg-paper"],
      ["--lg-moss", "--lg-paper"],
      ["--lg-indigo", "--lg-paper"],
      ["--lg-warn", "--lg-paper"],
    ] as const;
    for (const [theme, block] of themes) {
      for (const [fg, bg] of pairs) {
        expect(
          contrast(token(block, fg), token(block, bg)),
          `${theme} ${fg} on ${bg}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("导航当前页：朱红底上的字在浅色和深色下都读得清", () => {
    const rule =
      CSS.match(/\.lg-nav button\[aria-current="page"\] \{([\s\S]*?)\}/)?.[1] ?? "";
    for (const [theme, block] of themes) {
      expect(
        contrast(
          resolveColor(rule, "color", block),
          resolveColor(rule, "background", block),
        ),
        `${theme} 导航当前页`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("主键 hover：深底浅字不能变成浅底浅字", () => {
    const rule =
      CSS.match(
        /\.lg-btn:hover:not\(:disabled\):not\(\[aria-disabled="true"\]\) \{([\s\S]*?)\}/,
      )?.[1] ?? "";
    for (const [theme, block] of themes) {
      expect(
        contrast(
          resolveColor(rule, "color", block),
          resolveColor(rule, "background", block),
        ),
        `${theme} 主键 hover`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
