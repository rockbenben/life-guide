/**
 * 补引文：把「意思没错、只是引文没覆盖全」的卡的引文补齐。
 *
 * 审阅报告里的「引文没覆盖全」（narrow）说的是这种情况：卡片自己写的那句话
 * 没错，但它比配的引文多了一个细节（多半是**起始姿势**），而那个细节原文里有、
 * 只是没被引进去 —— 起草时引窄了。
 *
 * 修法不是改卡片的话（那是内容判断），是**把原文里那一段也引进去**。
 * 找法：原文切成行，跟卡片文字算最长公共子串，取最长、且尚未被引用的那一行。
 * 找到的行是原文的逐字片段 → R1 仍然成立 ✓。
 *
 * 只动 draft 卡：reviewed 的卡是人工成果，改了就得重签，不在这里碰。
 */
import type { Card } from "./cards/load.ts";

/** 原文切成「行」：空行与纯标记行不要，其余按行算。 */
export function chunksOf(source: string): string[] {
  return source
    .split(/\r?\n/)
    .map((l) => l.trim())
    // 3 个字起步：漏掉的细节常常就短到「屈膝仰卧」四个字
    .filter((l) => l.length >= 3)
    .filter((l) => !/^[-*#>|]+$/.test(l));
}

/** 两个字符串的最长公共子串长度（短字符串当 DP 的一维）。 */
export function longestCommonSubstring(a: string, b: string): number {
  if (!a || !b) return 0;
  const s = a.length <= b.length ? a : b;
  const t = a.length <= b.length ? b : a;
  let best = 0;
  const prev = new Array<number>(t.length + 1).fill(0);
  const cur = new Array<number>(t.length + 1).fill(0);
  for (let i = 1; i <= s.length; i++) {
    cur[0] = 0;
    for (let j = 1; j <= t.length; j++) {
      if (s[i - 1] === t[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      } else {
        cur[j] = 0;
      }
    }
    for (let j = 0; j <= t.length; j++) prev[j] = cur[j];
  }
  return best;
}

/**
 * 卡片文字里**还没被引到**的部分。
 *
 * 关键：不能直接拿整句话去找最像的原文段 —— 已经引过的那部分往往重合更长
 * （「以髋关节为轴」比漏掉的「屈膝仰卧」长），会挑错。
 * 所以先把引文盖住的部分从文字里剔掉，剩下的才是缺的那一块。
 */
export function uncoveredText(text: string, quoted: string): string {
  const q = quoted.replace(/\s+/g, "");
  let out = "";
  let i = 0;
  while (i < text.length) {
    let best = 0;
    for (let len = Math.min(30, text.length - i); len >= 2; len--) {
      const piece = text.slice(i, i + len).replace(/\s+/g, "");
      if (piece && q.includes(piece)) {
        best = len;
        break;
      }
    }
    if (best) {
      i += best;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/**
 * 找出最能覆盖 text、且还没被引用过的那一段原文。
 *
 * @param text 卡片自己写的那句话
 * @param quoted 已经引着的那些话（合起来）
 * @param source 原文（纯文本，与快照逐字一致的那份）
 * @returns 找到就返回那一段（原文逐字），没找到返回 null
 */
export function coveringChunk(
  text: string,
  quoted: string,
  source: string,
): string | null {
  const missing = uncoveredText(text, quoted);
  if (missing.replace(/\s+/g, "").length < 2) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const chunk of chunksOf(source)) {
    const score = longestCommonSubstring(missing, chunk);
    if (score > bestScore) {
      bestScore = score;
      best = chunk;
    }
  }
  // 至少要有 2 个字重合才算命中 —— 否则就是把不相干的段落塞进引文
  return bestScore >= 2 ? best : null;
}

/** 卡里某个字段现在的引文（统一成数组）。 */
export function quoteOf(card: Card, field: string): string[] {
  const raw =
    field === "remind"
      ? card.remind?.quote
      : field.startsWith("steps.")
        ? card.steps?.find((s) => s.id === field.slice("steps.".length))?.quote
        : undefined;
  if (raw === undefined || raw === null) return [];
  return Array.isArray(raw) ? [...raw] : [raw];
}

/** 把某一段补进那个字段的引文。返回新引文数组（没找到就返回 null）。 */
export function extendQuote(
  card: Card,
  field: string,
  text: string,
  source: string,
): string[] | null {
  const quoted = quoteOf(card, field);
  const chunk = coveringChunk(text, quoted.join("\n"), source);
  if (!chunk) return null;
  return [...quoted, chunk];
}
