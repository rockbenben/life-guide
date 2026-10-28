/**
 * 引文比对与数字归一化。
 *
 * R1（引文逐字）与 R2（数字一致）都建立在这里，所以归一化的尺度必须保守：
 * 归一化放宽得越多，就越可能把「卡片写错」判成「引文正确」。
 *
 * 只做两件事：
 *   1. 空白与全半角标点的统一——这些不影响语义。
 *   2. 数字写法的统一（中文数字 / 全角数字 / 范围号）——R2 要拿数字集合做比较。
 *
 * 明确不做：单位换算（1 小时 ≠ 60 分钟）、同义改写、近似词。
 * 「做不了就改用 derived」是 R2 的出路，不要在归一化里放宽。
 *
 * 近似词是另一回事：归一化不碰它，但要知道原文有没有写「约」——
 * 那是 R17 的判据，见本文件末尾的 approximationAttached。
 */

/** 全角 → 半角，覆盖 ASCII 可见字符那一段。 */
function toHalfWidth(s: string): string {
  let out = "";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (code >= 0xff01 && code <= 0xff5e) {
      out += String.fromCodePoint(code - 0xfee0);
    } else {
      out += ch;
    }
  }
  return out;
}

/** 常见中英文标点统一成一种形态，避免「」『』""'' 造成假失配。 */
const PUNCT_MAP: Record<string, string> = {
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "‘": "'",
  "’": "'",
  "‛": "'",
  "「": '"',
  "」": '"',
  "『": '"',
  "』": '"',
  "，": ",",
  "。": ".",
  "、": ",",
  "；": ";",
  "：": ":",
  "！": "!",
  "？": "?",
  "（": "(",
  "）": ")",
  "【": "[",
  "】": "]",
  "《": "<",
  "》": ">",
  "〈": "<",
  "〉": ">",
  "～": "~",
  "－": "-",
  "—": "-",
  "–": "-",
  "‐": "-",
};

/**
 * 引文比对的归一化：空白与标点统一，字符本身不动。
 *
 * 两处必须统一，否则合法的引文会被误判：
 *   · 加粗标记：源文里是 **每天 50 次**，而解析出的纯文本是「每天 50 次」——
 *     人从页面上复制引文时带的正是 **，LLM 起草时也大概率照抄。不剥掉的话
 *     每一条含加粗的引文都会误报 R1。
 *   · 标点旁的空格：中文「，」后面没空格，半角「, 」后面有空格，两者应视为相同。
 */
export function normalizeQuote(s: string): string {
  let out = toHalfWidth(s);
  // 加粗 / 斜体的成对标记：只在成对时剥
  out = out.replace(/\*\*(.*?)\*\*/g, "$1").replace(/__(.*?)__/g, "$1");
  out = out.replace(/[「」『』“”„‟‘’‛]/g, (c) => PUNCT_MAP[c] ?? c);
  out = out.replace(/[，。、；：！？（）【】《》〈〉～－—–‐]/g, (c) => PUNCT_MAP[c] ?? c);
  // 空白一律压成单个半角空格；行首行尾去掉
  out = out.replace(/\s+/g, " ").trim();
  // 标点旁的空格删掉：中文「，」与半角「, 」等价
  out = out.replace(/\s*([,.;:!?()[\]<>~])\s*/g, "$1");
  return out;
}

/** 判断 needle 是否是 haystack 的逐字子串（比较前两边都归一化）。 */
export function isVerbatimSubstring(needle: string, haystack: string): boolean {
  if (!needle.trim()) return false;
  return normalizeQuote(haystack).includes(normalizeQuote(needle));
}

const CN_DIGITS: Record<string, number> = {
  〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5,
  六: 6, 七: 7, 八: 8, 九: 9,
};

/**
 * 抽出文本里的数字，规范化后作为集合。
 *
 * 覆盖：
 *   50        阿拉伯数字
 *   ５０      全角数字
 *   五十      中文数字
 *   5～6      范围（拆成 5 和 6 两个字面量）
 *   10回      阿拉伯 + 单位
 *   1日50回   两个数字
 *   3-6       范围（半角连字符）
 *
 * 不做：单位换算、序数词（第一个）、百分比与小数点的语义合并。
 */
export function extractNumbers(text: string): Set<string> {
  const s = toHalfWidth(text);
  const found = new Set<string>();

  // 阿拉伯 / 全角数字：\d+(?:\.\d+)?
  // 千分位先去掉：原文写「8,000 步」时，那是一个数 8000，不是两个数 8 和 000。
  for (const m of s.replace(/(\d),(\d{3})(?!\d)/g, "$1$2").matchAll(/\d+(?:\.\d+)?/g)) found.add(m[0]);

  // 中文数字：十 / 十五 / 二十 / 二十五 …
  // 简化：只处理「十」开头的成数，以及 〇零一二两三四五六七八九 单独成字。
  for (const m of s.matchAll(/[〇零一二两三四五六七八九十]+/g)) {
    const token = m[0];
    if (token === "十") {
      found.add("10");
      continue;
    }
    if (!token.includes("十")) {
      // 单个中文数字逐字记（"五十" 这类会在下一个分支处理）
      for (const ch of token) {
        if (ch in CN_DIGITS) found.add(String(CN_DIGITS[ch]));
      }
      continue;
    }
    // 十位：二十 / 二十三 / 十五
    const idx = token.indexOf("十");
    const tens = idx === 0 ? 1 : CN_DIGITS[token[idx - 1]];
    const ones = idx === token.length - 1 ? 0 : CN_DIGITS[token[idx + 1]];
    if (tens !== undefined && ones !== undefined) {
      found.add(String(tens * 10 + ones));
    }
  }

  return found;
}

/**
 * 一个数字的规范写法：去掉小数末尾的零。
 *
 * 为什么：原文写「6.0cm」、卡片写 6 —— 同一个数，不该报「不在引文里」。
 * 跟的是「具体内容不许改」那条：6.0 与 6 没差，1/2 与 0.5 才有差（那是换算）。
 */
function normNumber(n: string): string {
  if (!n.includes(".")) return n;
  return n.replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * R2 用：text 里出现的数字，是否都出现在 quote 的数字集合里。
 *
 * 允许 quote 是多句数组——数字出现在任意一句即可。
 */
export function numbersCovered(
  text: string,
  quotes: string | string[],
): { missing: string[]; all: Set<string> } {
  const list = Array.isArray(quotes) ? quotes : [quotes];
  const quoteNumbers = new Set<string>();
  for (const q of list) for (const n of extractNumbers(q)) quoteNumbers.add(normNumber(n));

  const textNumbers = extractNumbers(text);
  const missing: string[] = [];
  for (const n of textNumbers) if (!quoteNumbers.has(normNumber(n))) missing.push(n);
  return { missing, all: textNumbers };
}

/**
 * 近似限定词（「约 / 大约 / 左右」）是不是就贴在这个数上。
 *
 * 两件事必须分清：
 *   · 「约 5 次」「5 分钟左右」—— 近似，屏上要写「约」。
 *   · 「左右各 5 次」「左右手」—— 这里的「左右」是「两边」，不是近似。
 *     分不清就会把一半带「左右各」的卡都误判成近似值。
 *
 * 数用 `extractNumbers` 比，中文数字（"约五次"）也算数 —— 窗口取限定词旁边那几个字。
 */
export function approximationAttached(
  text: string,
  value: number,
  valueMax?: number,
): boolean {
  // 「两边」的那种左右先换掉，免得它冒充近似
  const s = toHalfWidth(text).replace(/左右(各|手|侧|两|边|脚|臂|腿)/g, "两边");
  const wanted = [value, valueMax].filter((v): v is number => typeof v === "number");
  if (!wanted.length) return false;
  const hit = (window: string): boolean => {
    const got = extractNumbers(window);
    return wanted.some((v) => got.has(String(v)));
  };
  // 窗口要含空格（「5 分钟左右」中间有空格），但不能跨过句子标点 ——
  // 「约 5 次，10 分钟」里的 10 不是那个 5 的同伴。
  const SEG = 8;
  // 限定词在前：约 5 次 / 大约 5 次
  for (const m of s.matchAll(/(?:约|大约|差不多)/g)) {
    const start = m.index + m[0].length;
    const seg = s.slice(start, Math.min(s.length, start + SEG)).split(/[，,。；;、]/)[0];
    if (hit(seg)) return true;
  }
  // 限定词在后：5 次左右 / 5 上下
  for (const m of s.matchAll(/(?:左右|上下|前后)/g)) {
    const start = Math.max(0, m.index - SEG);
    const seg = s.slice(start, m.index).split(/[，,。；;、]/).pop() ?? "";
    if (hit(seg)) return true;
  }
  return false;
}

/** R3：模糊词。命中即 error —— 这些词对使用者等于零信息量。 */
export const VAGUE_TERMS = [
  "适量",
  "适度",
  "适当",
  "少量",
  "少许",
  "尽量",
  "尽可能",
  "视情况",
  "酌情",
  "若干",
  "一些",
  "适量多",
];

export function findVagueTerms(text: string): string[] {
  return VAGUE_TERMS.filter((t) => text.includes(t));
}
