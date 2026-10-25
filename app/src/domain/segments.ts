/**
 * 人群分档（segments）的匹配。
 *
 * 一张卡可以带若干分档：「适用人群不同，就该做不同的动作」。
 * 原文里说得很直接——「没有一个动作适合所有人」。
 *
 * `when` 是标签列表，AND 语义：用户的画像标签必须全部覆盖。
 * 标签来源：age:child / age:adult / age:senior 是内置年龄档（设置里选一次），
 * 其余是用户自选状态（易跌倒、膝盖不适……）。
 *
 * 匹配结果有三种，不是两种：
 *   · 命中一档  → 用那一档替代默认动作
 *   · 一档都没中 → 用默认动作
 *   · 命中多档  → 说明分档写重了，交给调用方提示（内容层已用 R14 拦 id 重复，
 *                  但「两个分档的 when 同时成立」只有运行时才知道）
 */

export interface Segment {
  id: string;
  when: string[];
  action?: { text: string; quote?: string | string[] };
  dose?: { text: string; quote?: string | string[] };
  avoid?: { text: string; quote?: string | string[] }[];
  /**
   * 分档自己的步骤。分档换了动作，默认步骤就不适用了。
   * 内容 schema 目前还不产出这个字段；App 保留兼容，有则用、没有就提示见原文。
   */
  steps?: { id?: string; text: string; quote?: string | string[]; images?: string[] }[];
}

export interface CardWithSegments {
  id: string;
  remind: { text: string; quote?: string | string[] };
  dose?: { value: number; unit: string; what: string; quote?: string | string[] }[];
  steps: { id?: string; text: string; quote?: string | string[]; images?: string[] }[];
  cautions?: { level: "stop" | "with-doctor" | "info"; text: string; quote?: string | string[] }[];
  variants?: {
    busy?: { include?: string[]; replace?: { text: string; quote?: string | string[] }; skip?: boolean };
    travel?: { include?: string[]; replace?: { text: string; quote?: string | string[] }; skip?: boolean };
    sick?: { include?: string[]; replace?: { text: string; quote?: string | string[] }; skip?: boolean };
  };
  segments?: Segment[];
}

export interface MatchResult {
  /** 命中的分档；没有则为 null */
  segment: Segment | null;
  /** 全部命中的分档（多于一个说明分档写重了） */
  matched: Segment[];
  /** 最终展示的动作文案 */
  action: string;
  /** 最终展示的剂量文案；分档命中但没给剂量时为空 */
  dose: string;
  /** 最终展示的步骤；分档命中但没给步骤时为空（默认步骤属于另一个动作） */
  steps: { id?: string; text: string; quote?: string | string[]; images?: string[] }[];
  /** 最终展示的禁忌（默认 + 分档追加） */
  cautions: { level: string; text: string; quote?: string | string[] }[];
}

/** 分档的 when 是否被用户的标签覆盖。 */
export function segmentApplies(segment: Segment, userTags: string[]): boolean {
  if (!segment.when.length) return false;
  const owned = new Set(userTags);
  return segment.when.every((t) => owned.has(t));
}

/** 找出这张卡对用户适用的分档。 */
export function matchSegments(
  card: CardWithSegments,
  userTags: string[],
): MatchResult {
  const matched = (card.segments ?? []).filter((s) => segmentApplies(s, userTags));
  const segment = matched.length === 1 ? matched[0] : null;

  const action = segment?.action?.text ?? card.remind.text;

  // 分档换了动作，默认的剂量和步骤就属于**另一个动作**了，不能跟着走。
  // 分档没给剂量就显示空（界面上不显示总剂量），别拿默认的糊弄过去 ——
  // 用户会以为「防跌倒」也是每天 50 次。
  let dose: string;
  let steps: MatchResult["steps"];
  if (segment) {
    dose = segment.dose?.text ?? "";
    steps = segment.steps ?? [];
  } else {
    dose = card.dose?.length
      ? card.dose.map((d) => `${d.value}${d.unit}`).join(" · ")
      : "";
    steps = card.steps;
  }

  const cautions = [...(card.cautions ?? [])];
  for (const av of segment?.avoid ?? []) {
    cautions.push({ level: "stop", text: av.text, quote: av.quote });
  }

  return { segment, matched, action, dose, steps, cautions };
}
