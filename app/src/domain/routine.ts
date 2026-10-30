/**
 * 模式 → 每张卡用哪个 variant。
 *
 * 模式是用户自己选的（正常 / 忙 / 出差 / 生病），它决定卡片是照常做、
 * 走简化版、换做法，还是今天不做。
 *
 * 注意：模式（variants）和人群分档（segments）是两回事：
 *   · variants 由**模式**触发，回答「今天没时间怎么办」
 *   · segments 由**用户画像**触发，回答「我这种情况该做哪个动作」
 */

import type { Segment } from "./segments.ts";

export type Mode = "normal" | "busy" | "travel" | "sick";

/** 三种非正常模式各自有没有卡带对应版本。 */
export interface ModeVariants {
  busy: boolean;
  travel: boolean;
  sick: boolean;
}

/** 当前这一屏里，各模式各有多少张卡真的有对应版本。 */
export interface ModeCounts {
  busy: number;
  travel: number;
  sick: number;
}

export function variantAvailability(cards: Pick<Card, "variants">[]): ModeVariants {
  return {
    busy: cards.some((c) => c.variants?.busy != null),
    travel: cards.some((c) => c.variants?.travel != null),
    sick: cards.some((c) => c.variants?.sick != null),
  };
}

export const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: "normal", label: "正常", hint: "照常做" },
  { id: "busy", label: "很忙", hint: "只做能挤进五分钟的" },
  { id: "travel", label: "出差", hint: "换个做法" },
  { id: "sick", label: "生病", hint: "今天不做" },
];

export interface Step {
  /** 只有带模式版本的卡需要：busy/travel/sick 用它选步骤 */
  id?: string;
  text: string;
  quote?: string | string[];
  images?: string[];
  /**
   * 这一步要做多久（2026-10-30 加）。
   *
   * **跟卡级的 duration 是两回事**：卡级是**整张卡的总时长**，
   * 这一级是**这一步**的时长。「每个动作 30 秒」这种原文说的是每一步 ——
   * 血管拉伸那张卡记的 420 秒是 5 个动作 × 2 回 × 30 秒加休息的总和，
   * 只看总数，30 秒一组的节奏就丢了。
   *
   * 规矩与卡级一致：原文给了就 quote（带引文），换算来的写 derived
   * （带算式），不知道就不写 —— 逼着填就是编数（D7）。
   */
  duration?: {
    basis: "quote" | "derived" | "unknown";
    sec?: number;
    quote?: string | string[];
    formula?: string;
    /** 原文写的是近似值（「约 30 秒」）—— 屏上要显示「约」 */
    approximate?: boolean;
  } | null;
}

export interface Variant {
  include?: string[];
  replace?: { text: string; quote?: string | string[] };
  skip?: boolean;
}

export interface Card {
  id: string;
  status: string;
  /**
   * 这张卡用过的旧 id（内容层合并或改名时记下）。
   *
   * 用户的盖章记录、日常清单存的是旧 id，靠它认回来 ——
   * 没有这一项，改名就等于丢历史（AGENTS.md §5）。
   */
  formerIds?: string[];
  source: { anchor: string };
  /**
   * 屏上显示的动作名（内容层策展）。
   *
   * 平时用「原文小节名」当名字 —— 那是手册作者自己给动作起的名字。
   * 但小节名有时是文章的骨架而不是动作的名字：「涂法一：打圈涂」「为什么偏偏是胰腺」
   * 「该什么时候补涂」—— 在文章里是标题，在今天的清单里不是名字。
   * 这时由内容层另起一个动作名（≤16 字，界面那一行放得下）。
   */
  name?: string;
  review?: { by: string; date: string; hash: string } | null;
  slot?: "morning" | "daytime" | "evening" | "anytime";
  images?: string[];
  /** 构建产物里带上的文章信息；App 靠 articleKind 区分疾病卡 */
  articlePath?: string;
  /**
   * 篇名。
   *
   * 放在卡上而不是只放在手册全文里：今天页展开态那句「出自〈哪一篇〉」要篇名，
   * 而手册全文约有 811 KB —— 为了一个篇名在启动时拉一整本手册，不划算。
   */
  articleTitle?: string;
  articleKind?: "practice" | "condition";
  /**
   * 用户自己起的名字（自定义习惯）。
   *
   * 有这个字段的卡就是用户自己加的：没有出处、没有引文，
   * 时段也是用户说的而不是原文说的（见 domain/custom.ts）。
   */
  customName?: string;
  remind: { text: string; quote?: string | string[] };
  effect?: { text: string; quote?: string | string[] } | null;
  dose?: {
    value: number;
    valueMax?: number;
    unit: string;
    what: string;
    /** 原文写的是近似值（「约 5 次」）—— 屏上要显示「约」，不许把近似说成定值 */
    approximate?: boolean;
    /** 这一行的数是换算来的（1/2 勺 → 0.5 勺）—— 记算式，界面标「推算」 */
    derived?: { formula: string };
    quote?: string | string[];
  }[];
  duration?: {
    basis: "quote" | "derived" | "unknown";
    sec?: number;
    quote?: string | string[];
    formula?: string;
  } | null;
  steps: Step[];
  cautions?: { level: "stop" | "with-doctor" | "info"; text: string; quote?: string | string[] }[];
  /** 疾病类卡片的提示分级（AGENTS.md §5.4）；practice 卡没有这个字段 */
  notices?: { level: "seek-care" | "with-doctor" | "info"; text: string; quote?: string | string[] }[];
  variants?: { busy?: Variant; travel?: Variant; sick?: Variant };
  segments?: Segment[];
}

export interface ResolvedStep extends Step {
  /** 这一步在当前模式下是否被保留 */
  included: boolean;
  /** 替代文案（travel 模式下的 replace） */
  replaced?: string;
}

/**
 * 按模式过滤步骤：忙/出差/生病时只做其中一部分，或整个跳过。
 *
 * 与分档（segments）是两回事：
 *   · 这里由**模式**触发 —— 今天没时间/出差/生病，做个简化版
 *   · 分档由**用户画像**触发 —— 这种情况该做另一个动作
 * 两者都要用时，先用分档换掉动作与步骤，再对换后的步骤套模式。
 */
export function filterByMode(
  steps: Step[],
  card: Pick<Card, "variants">,
  mode: Mode,
): ResolvedStep[] {
  if (mode === "normal") {
    return steps.map((s) => ({ ...s, included: true }));
  }
  const v = card.variants?.[mode];
  if (!v) return steps.map((s) => ({ ...s, included: true }));
  if (v.skip) return steps.map((s) => ({ ...s, included: false }));
  if (v.replace) {
    return steps.map((s, i) =>
      i === 0
        ? { ...s, included: true, replaced: v.replace!.text }
        : { ...s, included: false },
    );
  }
  if (v.include) {
    const keep = new Set(v.include);
    return steps.map((s) => ({ ...s, included: keep.has(s.id ?? "") }));
  }
  return steps.map((s) => ({ ...s, included: true }));
}

/** 这张卡在当前模式下做哪几步。 */
export function resolveSteps(card: Card, mode: Mode): ResolvedStep[] {
  return filterByMode(card.steps, card, mode);
}

/** 这个模式今天是否完全跳过这张卡。 */
export function skipped(card: Card, mode: Mode): boolean {
  if (mode === "normal") return false;
  return card.variants?.[mode]?.skip === true;
}

/**
 * 「我的日常」：用户自己挑进日常的动作。
 *
 * 加进日常的动作不再进「今日一篇」候选 —— 今日一篇的意义是给出还没试过的选择。
 * 已经在了就不重复加，重复加会让存下来的列表越滚越长。
 */
export function addToRoutine(myRoutine: string[], cardId: string): string[] {
  return myRoutine.includes(cardId) ? myRoutine : [...myRoutine, cardId];
}
