/**
 * 收起态那一行的「三行契约」：名 / 做什么 / 剂量。
 *
 * 为什么要有这个文件：实测过，LLM 草稿的 remind.text 中位 21 字、p90 32 字、
 * 最长 54 字，直接当标题会让每张卡占 2–4 行粗体，行形随数据而变；
 * 而每张卡都带着 source.anchor —— 原文的小节名（p50=12 字），
 * 那才是手册作者自己给动作起的名字。
 *
 * 还有两条不能靠眼睛看的规矩：
 *   · 同一组数字不许在一屏里说两遍（剂量数字已经写在 remind 里的卡，不再重复）
 *   · 耗时不知道就写不知道（D7）；把疗程长度当单次耗时的坏数据，界面不许念出来
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
 */
export function doLine(card: Pick<Card, "remind">, shown: string, known = ""): string {
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
  return out.length > DO_MAX ? out.slice(0, DO_MAX) + "…" : out;
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
): { value: number; valueMax?: number; unit: string; what: string }[] {
  const out = (card.dose ?? []).filter(
    (d) => !shown.includes(flat(`${d.value}${d.unit}`)) && overlap(d.what, shown) < 0.75,
  );
  return out.slice(0, DOSE_MAX);
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
  doses: { value: number; valueMax?: number; unit: string; what: string }[];
  duration: DurationLabel;
}

export function cardLines(card: Card): CardLines {
  const name = cardName(card);
  const duration = durationLabel(card);
  // 两遍去重：先按「名 + 耗时 + 剂量里的数」削掉做什么中的重复数字，
  // 再按「名 + 耗时 + 做什么」削掉剂量里那半句重复的 what
  //（实测：3T 那行的 what「早晚各涂一次」与做什么整句一字不差）。
  const withDoseNums = shownTextOf(name, duration, card.dose ?? []);
  const doText = doLine(
    card,
    withDoseNums,
    (card.dose ?? []).map((d) => d.what).join(""),
  );
  const doses = doseLines(card, shownTextOf(name, duration) + flat(doText));
  return { name, doText, doses, duration };
}
