/**
 * 类名不能撞 daisyUI 的组件名。
 *
 * 为什么要有这条：daisyUI 的类名是保留字。`steps` 是它的**步骤条组件**
 * （display: inline-grid + grid-auto-flow: column），`card-body` 是它的卡片体
 * （自带 24px 内边距与 14px 字号）。本项目自己的钩子类名一旦撞上，
 * 样式会被它悄悄接管 —— 步骤列表曾因此被排成四列 76px 的窄条，
 * 文字读起来像打乱的。
 *
 * 所以：daisyUI 的类名只允许出现在白名单里（我们**故意**用的那些），
 * 其余类名一律不能与 daisyUI 的组件类名重名。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_SRC = join(process.cwd(), "app", "src");
const DAISY = join(process.cwd(), "node_modules", "daisyui", "components");

/**
 * 我们故意使用的 daisyUI 类名（及其变体）。
 *
 * 现在是空的：组件层改成了自写的 lg- 类（手帖行 / 用法用量表），
 * 一个 daisyUI 组件类都不再出现在界面上。白名单留着不咬人的条目
 * 只会让人以为还在用那套组件，所以清空 —— 上面那条防撞名的判据照旧生效。
 */
const ALLOWED: string[] = [];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** daisyUI 组件层里的所有类名。 */
function daisyClasses(): Set<string> {
  const set = new Set<string>();
  for (const f of walk(DAISY)) {
    if (!f.endsWith(".css")) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/\.([a-zA-Z][\w-]*)/g)) {
      set.add(m[1]);
    }
  }
  return set;
}

/** 本项目源码里用到的类名。 */
function ourClasses(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const f of walk(APP_SRC)) {
    if (!/\.(tsx?|css)$/.test(f)) continue;
    const text = readFileSync(f, "utf8");
    for (const v of classValues(text)) {
      for (const c of v.split(/\s+/)) {
        if (!c || c.includes("$") || c.includes("{")) continue;
        const list = map.get(c) ?? [];
        list.push(f.replace(APP_SRC, "app/src"));
        map.set(c, list);
      }
    }
  }
  return map;
}

/**
 * 从源码里取出 class 属性的值。
 *
 * 两种写法都要认：`class="a b"` 与 `class={cond ? "a" : "b"}`。
 * 后者里被 `===` 比较的字符串（`tab === "今天"`）不是类名，要跳过 ——
 * 否则「今天」这种状态值会被当成类名。
 */
function classValues(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/class=(?:"([^"]*)"|\{([^}]*)\})/g)) {
    if (m[1] !== undefined) {
      out.push(m[1]);
      continue;
    }
    const expr = m[2] ?? "";
    for (const s of expr.matchAll(/(["'`])([^"'`]*)\1/g)) {
      const before = expr.slice(0, s.index).trimEnd().slice(-1);
      if (before === "=" || before === "!") continue; // 比较用的字面量，不是类名
      out.push(s[2]);
    }
  }
  return out;
}

describe("类名不撞 daisyUI", () => {
  it("我们自己的类名不能与 daisyUI 的组件类名重名", () => {
    const daisy = daisyClasses();
    const ours = ourClasses();
    const clashes: string[] = [];
    for (const [c, files] of ours) {
      if (!daisy.has(c)) continue;
      if (ALLOWED.includes(c)) continue;
      clashes.push(`${c}（${files[0]}）`);
    }
    expect(clashes, `这些类名会被 daisyUI 接管样式：${clashes.join("、")}`).toEqual(
      [],
    );
  });

  it("白名单里的类名都真的存在于 daisyUI（防白名单过期）", () => {
    const daisy = daisyClasses();
    const missing = ALLOWED.filter((c) => !daisy.has(c));
    expect(missing).toEqual([]);
  });
});
