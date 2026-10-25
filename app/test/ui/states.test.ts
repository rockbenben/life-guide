/**
 * 交互态成套性：每一类可点控件必须齐 hover / 按下 / 键盘焦点三态。
 *
 * 为什么钉这条而不是靠眼睛看：batch2 用真事件量过 —— 18 类控件里只有印章写了 :hover，
 * 主键的「静止 / hover / 按下」三张 PNG 逐字节相同（md5 一致）。
 * 也就是说：不写规则，屏上就没有这一态，而 CSS 里少写一行不会有任何症状。
 *
 * 判据自己会长：可点类名是从 ui/*.tsx 里 <button … class="…"> 扫出来的，
 * 新加一类按钮而没补三态，这里就红。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const APP_SRC = join(process.cwd(), "app", "src");
const CSS = join(APP_SRC, "style.css");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** ui/ 下所有 <button> 上出现的 lg- 类名组合（同一颗键常挂多个类，覆盖要按组合算）。 */
function buttonCombos(): Map<string, { classes: string[]; file: string }> {
  const map = new Map<string, { classes: string[]; file: string }>();
  for (const f of walk(join(APP_SRC, "ui"))) {
    if (!/\.tsx$/.test(f)) continue;
    const text = readFileSync(f, "utf8");
    for (const m of text.matchAll(/<button[^>]*?class=(?:"([^"]*)"|\{[^}]*?"([^"]*)"[^}]*\})/gs)) {
      const raw = (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
      const classes = raw.split(/\s+/).filter((c) => /^lg-[a-z-]+$/.test(c));
      if (!classes.length) continue;
      const key = [...new Set(classes)].sort().join(" ");
      if (!map.has(key)) map.set(key, { classes, file: f.replace(APP_SRC, "app/src") });
    }
  }
  return map;
}

/** style.css 里带某个伪类/属性态的选择器覆盖了哪些类。 */
function classesWith(css: string, state: string): Set<string> {
  const set = new Set<string>();
  for (const m of css.matchAll(/([^{}]+)\{/g)) {
    const sel = m[1].trim();
    if (!sel.includes(state)) continue;
    for (const c of sel.match(/\.lg-[a-z-]+/g) ?? []) set.add(c.slice(1));
  }
  return set;
}

describe("交互态成套性", () => {
  const css = readFileSync(CSS, "utf8");
  const combos = buttonCombos();
  const hover = classesWith(css, ":hover");
  const active = classesWith(css, ":active");
  const focus = classesWith(css, ":focus-visible");

  it("从 ui/ 的 <button> 上扫到了控件类名（判据没空转）", () => {
    expect([...combos.keys()].length).toBeGreaterThanOrEqual(6);
  });

  for (const [combo, { classes, file }] of combos) {
    it(`${combo} 三态齐全`, () => {
      // 组合里任意一个类被规则覆盖，这颗键就有那一态（.lg-btn.lg-btn-ghost 靠 .lg-btn:hover 生效）
      const has = (set: Set<string>) => classes.some((c) => set.has(c));
      const missing = [
        has(hover) ? null : ":hover",
        has(active) ? null : ":active",
        has(focus) ? null : ":focus-visible",
      ].filter(Boolean);
      expect(missing, `${combo}（${file}）缺 ${missing.join(" ")}`).toEqual([]);
    });
  }

  it("「开着」态有规则（aria-expanded=true 不能和没点开长得一样）", () => {
    expect(css).toMatch(/\[aria-expanded="true"\]/);
  });

  it("禁用态有规则，且带 not-allowed", () => {
    expect(css).toMatch(/:disabled[\s\S]{0,240}not-allowed/);
  });
});
