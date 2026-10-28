/**
 * 收起态那一行的「三行契约」：名 / 做什么 / 剂量。
 *
 * 为什么要有这个文件：实测过，LLM 草稿的 remind.text 中位 21 字、p90 32 字、
 * 最长 54 字，直接当标题会让每张卡占 2–4 行粗体，行形随数据而变；
 * 而每张卡都带着 source.anchor —— 原文的小节名（p50=12 字），
 * 那才是手册作者自己给动作起的名字。
 *
 * 还有四条不能靠眼睛看的规矩：
 *   · 同一组数字不许在一屏里说两遍（剂量数字已经写在 remind 里的卡，不再重复）
 *   · 耗时不知道就写不知道（D7）；把疗程长度当单次耗时的坏数据，界面不许念出来
 *   · 「做什么」与「名」说的是同一句话时，那一行整个不显示（redundantWithName）
 *   · 原文是近似值（「约 5 次」）时，剂量要带上「约」（doseValueText）
 */

import type { Card } from "./routine.ts";
import { isCustomCard } from "./custom.ts";

/** 名字最长多少字（超过就截，收起态一行放得下）。 */
export const NAME_MAX = 16;
/** 「做什么」最长多少字。 */
export const DO_MAX = 30;
/** 收起态最多列几条剂量。 */
export const DOSE_MAX = 3;
/** 超过这个秒数就不当场显示：草稿把「持续 2 周」「浸 3 天」写进了单次耗时。 */
export const DUR_SUSPICIOUS_SEC = 3600;

/** 归一化：去掉空白，比较数字时不让「10 秒」和「10秒」变成两种东西。 */
function flat(s: string | undefined | null): string {
  return String(s ?? "").replace(/\s/g, "");
}

/** 原文小节名（去掉 markdown 的井号前缀）。 */
function anchorOf(card: Pick<Card, "source">): string {
  return String(card.source?.anchor ?? "").replace(/^#+\s*/, "").trim();
}

/**
 * 短名：优先用内容层给的动作名，其次原文小节名。
 *
 * anchor 缺失（旧数据）才回落到 remind 的首句 —— 回落是有代价的：
 * 首句往往是整句说明，甚至是一句禁忌。
 */
export function cardName(
  card: Pick<Card, "source" | "remind" | "id" | "customName" | "name">,
): string {
  // 用户自己起的名字：原样用（名字是用户打的，不该被「原文小节名」那套改写）
  const custom = card.customName?.trim();
  if (custom) return custom.length > NAME_MAX ? custom.slice(0, NAME_MAX) + "…" : custom;
  // 内容层另起的动作名（小节名是文章的骨架时用它）
  const named = card.name?.trim();
  if (named) return named.length > NAME_MAX ? named.slice(0, NAME_MAX) + "…" : named;
  const anchor = anchorOf(card);
  const base = anchor || String(card.remind?.text ?? "").split(/[。；;]/)[0].trim() || card.id;
  return base.length > NAME_MAX ? base.slice(0, NAME_MAX) + "…" : base;
}

/**
 * 这张卡在做什么 —— 第一个短句。
 *
 * 共享小节时拿它当卡名（见 displayNames）。它也是原文的话：
 * remind 本来就是从原文摘下来的一句话。
 */
export function actionName(card: Pick<Card, "remind" | "id">): string {
  const t = String(card.remind?.text ?? "").replace(/\s+/g, " ").trim();
  const first = t.split(/[。；;：:，,、]/)[0].trim() || t || card.id;
  return first.length > NAME_MAX ? first.slice(0, NAME_MAX) + "…" : first;
}

/**
 * 每张卡在屏上叫什么。
 *
 * 「名 = 内容层给的动作名，或原文小节名」—— 但**同名必然撞车**：
 * 刷牙与牙线都出自「刷牙步骤」，三个穴位卡都出自「三个想每天都按的穴位」，
 * 屏上并排出现两个「刷牙步骤」看着像出了错。
 *
 * 这时回落到**这张卡在做什么**的首句（还是原文的话）——
 * 「每天用牙线清牙缝」和「轻握牙刷轻轻刷」就分得开了。
 *
 * 撞车的判定按**最终会显示的那个名字**算：显式写了 name 的两张卡同名，
 * 一样要回落 —— 否则屏上并排两行一模一样的名字。
 *
 * 纯函数：传进来全部卡，返回每张卡该显示的名字。
 */
export function displayNames(cards: Card[]): Map<string, string> {
  /** 这张卡显示的名字（撞车判定用同一个口径） */
  const keyOf = (c: Card): string => c.name?.trim() || anchorOf(c);
  const shared = new Map<string, number>();
  for (const c of cards) {
    const a = keyOf(c);
    if (!a) continue;
    shared.set(a, (shared.get(a) ?? 0) + 1);
  }
  const out = new Map<string, string>();
  for (const c of cards) {
    // 用户自己加的：名字就是用户起的那句，不参与「同名卡」的回落
    if (isCustomCard(c)) {
      out.set(c.id, cardName(c));
      continue;
    }
    const a = keyOf(c);
    out.set(c.id, a && (shared.get(a) ?? 0) > 1 ? actionName(c) : cardName(c));
  }
  return out;
}

/** 数字：只取数本身。单位跟着数走，比较时按「这个数说过没有」。 */
function numbersOf(s: string): string[] {
  return s.match(/\d+(?:\.\d+)?/g) ?? [];
}

/**
 * 「做什么」：remind 的子句，去掉名、耗时栏与剂量行已经说过的数字。
 *
 * **比较用去空白，显示用原样** —— 「10 秒」与「10秒」是同一件事（比较那一步要 flat），
 * 但屏上摆的是原文的话，去了空格就不是原文了（「站墙靠5分钟」读着像机器剥的）。
 *
 * 全部子句都被去掉时宁可原样保留 —— 空行比重复更糟，
 * 那等于把这条动作唯一的说明弄丢了。
 *
 * `name` 是屏上真正显示的那个名（可能与父组件算出的显示名不同）：
 * 「做什么」与它说的是同一句话时，这一行整个不显示（见 redundantWithName）。
 */
export function doLine(
  card: Pick<Card, "remind">,
  shown: string,
  known = "",
  name = "",
): string {
  const clauses = String(card.remind?.text ?? "")
    .split(/[，、。；;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const shownFlat = flat(shown);
  const knownFlat = flat(known);
  const kept = clauses.filter((cl) => {
    const nums = numbersOf(flat(cl));
    if (!nums.length || !nums.every((n) => shownFlat.includes(n))) return true;
    // 数字都在名/时长里说过了，但这个子句还有别的新内容 —— 整段丢掉会把
    // 「太阳、颧髎、颊车、翳风」里的「太阳」一起吃掉。只有数字和「约」这类
    // 修饰词时才算重复；剩下两个以上新字才保留。
    const rest = flat(cl)
      .replace(/\d+(?:\.\d+)?/g, "")
      .replace(/约|左右/g, "");
    const chars = new Set([...rest]);
    const unseen = [...chars].filter(
      (ch) => !shownFlat.includes(ch) && !knownFlat.includes(ch),
    );
    return unseen.length / Math.max(1, chars.size) >= 0.5;
  });
  const out = (kept.length ? kept : clauses).join("，");
  if (redundantWithName(out, name)) return "";
  return out.length > DO_MAX ? out.slice(0, DO_MAX) + "…" : out;
}

/**
 * 程度词：这些词在「做什么」里、而「名」里没有，说明两句话说的**强度**不同 ——
 * 那不是重复，是信息，不能当重复删掉。
 *
 * 「把切好的萝卜晾干」与「把切好的萝卜稍微晾干」只差「稍微」，
 * 差的是「晾透」与「晾一会儿」。药方与手法都吃这个。
 */
const DEGREE_WORDS = [
  "稍微",
  "微微",
  "略",
  "一点",
  "些许",
  "少许",
  "少量",
  "尽量",
  "尽可能",
  "轻轻",
  "大约",
  "差不多",
  "左右",
  "至少",
  "最多",
  "偶尔",
  "单独",
  "酌情",
  "适可",
  "浓",
  "淡",
];

/** 「做什么」相对「名」的新字占比不到这个数，就算没有新东西。 */
const NOVEL_RATIO = 0.2;

/** 新字占比：汉字没有词边界，按字算。 */
function novelRatio(text: string, name: string): number {
  const t = flat(text);
  if (!t.length) return 1;
  const n = flat(name);
  let novel = 0;
  for (const ch of t) if (!n.includes(ch)) novel++;
  return novel / t.length;
}

/** 「做什么」里有没有「名」没有的程度词。 */
function hasDegreeWord(text: string, name: string): boolean {
  const t = flat(text);
  const n = flat(name);
  return DEGREE_WORDS.some((w) => t.includes(w) && !n.includes(w));
}

/**
 * 「做什么」与「名」说的是同一句话吗？是的话这一行整个不显示。
 *
 * 为什么要管这件事：名是内容层起的策展名，「做什么」是原文摘的那一句。
 * 两者撞车时屏上会并排出现同一句话 —— 实测 518 张里有 50 张有重叠，
 * 其中 5 张一字不差（「每天酒精不超过 20～25 克」写两遍），
 * 有一张是首启就能看见的（「睡前用生理盐水冲鼻腔 / 睡前用生理盐水冲洗鼻腔」）。
 *
 * 判据是**新字占比**不到两成：汉字没有词边界，按字算最稳。
 * 两种例外不算重复：
 *   · 「名」里没有的新数字 —— 那是别处没有的事实；
 *   · 「名」里没有的程度词 —— 强度不同（「稍微」与不「稍微」）。
 *
 * 只判**整行**，不逐句删：逐句删会把「想提升食材的鲜味和香气时，先冷冻再料理」
 * 里的动作句删掉、只留下「想提升食材的鲜味和香气时」这种半截话。
 *
 * 删掉的不是信息：展开态的「做什么」那一行仍然摆原文（D2）。
 */
function redundantWithName(text: string, name: string): boolean {
  if (!text || !name) return false;
  const n = flat(name);
  if (!n) return false;
  // 名里没有的新数字是信息
  if (numbersOf(flat(text)).some((x) => !n.includes(x))) return false;
  // 程度词不同 = 强度不同，不是重复
  if (hasDegreeWord(text, name)) return false;
  return novelRatio(text, name) <= NOVEL_RATIO;
}

/** `what` 与已显示文本的重合度：汉字没有词边界，按字符重合率判。 */
function overlap(what: string, shown: string): number {
  const t = flat(what);
  if (!t.length) return 1;
  let hit = 0;
  for (const ch of t) if (shown.includes(ch)) hit++;
  return hit / t.length;
}

/**
 * 收起态的剂量行：值与单位已在别处出现过的不再列，最多三条。
 *
 * 上限三条不是审美：超过三条这一行就比「做什么」还长，
 * 而完整的剂量表在展开态的「用法用量」里，一条都不会少。
 */
export function doseLines(
  card: Pick<Card, "dose">,
  shown: string,
): {
  value: number;
  valueMax?: number;
  unit: string;
  what: string;
  /** 原文是近似值 —— 类型里得留着它，不然运行时带着、类型上却看不见 */
  approximate?: boolean;
}[] {
  const out = (card.dose ?? []).filter(
    (d) => !shown.includes(flat(`${d.value}${d.unit}`)) && overlap(d.what, shown) < 0.75,
  );
  return out.slice(0, DOSE_MAX);
}

/**
 * 剂量那一行的数：原文是近似值时带「约」。
 *
 * 原文写「来回轻柔地洗约 5 次」，屏上写「5 次」—— 把近似说成定值。
 * 内容层把这件事记在 dose 的 `approximate` 上（AGENTS.md §5.1），
 * 这里只负责把它显示出来，不许自己判断哪个数是近似（判错就是编数，D7）。
 */
export function doseValueText(d: {
  value: number;
  valueMax?: number;
  unit: string;
  approximate?: boolean;
}): string {
  const range = d.valueMax !== undefined ? `${d.value}～${d.valueMax}` : `${d.value}`;
  return `${d.approximate ? "约 " : ""}${range} ${d.unit}`;
}

export type DurationState = "known" | "derived" | "unknown" | "suspicious";

export interface DurationLabel {
  state: DurationState;
  /** 屏上那几个字。unknown / suspicious 时是空的 —— 那两句解释是废话，不摆。 */
  text: string;
  sec: number | null;
  formula?: string;
}

/**
 * 耗时三态如实（§5.3 的界面规定 + D7）。
 *
 * suspicious 是本轮新加的一态：草稿把「持续 2 周」「浸 3 天」写进了 duration.sec，
 * 照字面显示就是「约 20160 分钟」。界面不许替坏数据背书，
 * 但也不许把它悄悄当成 0 秒 —— 那等于编了个数。
 *
 * **但「不显示」不等于「说一句废话」。** §5.3 写的是「有 unknown 时不显示总时长」，
 * 之前界面上摆的是「原文没给，也不该替你估」—— 那是给审阅人看的话，不是给使用者看的。
 * 不知道就不知道，那一栏干脆没有：收起态不显示「未给耗时」，展开态不摆「耗时」那一行。
 * 数据层照旧如实记着（basis: unknown / 原样保留那个可疑的秒数），只是界面不念出来。
 */
export function durationLabel(card: Pick<Card, "duration">): DurationLabel {
  const d = card.duration;
  if (!d || d.basis === "unknown" || !d.sec) return { state: "unknown", text: "", sec: null };
  if (d.sec > DUR_SUSPICIOUS_SEC) return { state: "suspicious", text: "", sec: d.sec };
  const text = d.sec < 120 ? `${d.sec} 秒` : `约 ${Math.round(d.sec / 60)} 分钟`;
  return d.basis === "derived"
    ? { state: "derived", text: `推算 ${text}`, sec: d.sec, formula: d.formula }
    : { state: "known", text, sec: d.sec };
}

/**
 * 一屏内「已经说过」的文本：名 + 耗时栏 + 剂量行的数字。
 *
 * 剂量要先进 shown 再算「做什么」：remind 里的数字与剂量表里的数字是同一批，
 * 只拿名去重的话，两边会各念一遍（实测有这种卡）。
 */
export function shownTextOf(
  name: string,
  dur: DurationLabel,
  doses: { value: number; unit: string }[] = [],
): string {
  const durText =
    dur.state === "unknown" || dur.state === "suspicious"
      ? ""
      : dur.text.replace(/^推算 /, "");
  return flat(name) + flat(durText) + doses.map((d) => flat(String(d.value))).join("");
}

/** 一张卡的收起态三行。 */
export interface CardLines {
  name: string;
  doText: string;
  doses: {
    value: number;
    valueMax?: number;
    unit: string;
    what: string;
    approximate?: boolean;
  }[];
  duration: DurationLabel;
}

/**
 * 一张卡的收起态三行。
 *
 * `displayName` 是屏上真正显示的那个名（父组件算好的：撞车时会回落成
 * 「这张卡在做什么」的首句）。去重要对着**屏上那个名**算 ——
 * 对着别的名算，重复的照样会留在屏上。
 */
export function cardLines(card: Card, displayName?: string): CardLines {
  const name = displayName?.trim() || cardName(card);
  const duration = durationLabel(card);
  // 两遍去重：先按「名 + 耗时 + 剂量里的数」削掉做什么中的重复数字，
  // 再按「名 + 耗时 + 做什么」削掉剂量里那半句重复的 what
  //（实测：3T 那行的 what「早晚各涂一次」与做什么整句一字不差）。
  const withDoseNums = shownTextOf(name, duration, card.dose ?? []);
  const doText = doLine(
    card,
    withDoseNums,
    (card.dose ?? []).map((d) => d.what).join(""),
    name,
  );
  const doses = doseLines(card, shownTextOf(name, duration) + flat(doText));
  return { name, doText, doses, duration };
}
