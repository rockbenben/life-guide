/**
 * 「条件」：模式 + 我的情况。
 *
 * 这两个不是今天要做的事，是**在什么条件下做**。所以它们在界面上
 * 收成一行，需要时才展开（AGENTS.md §4.3 的「降级是版本」与 §5.1b 的分档）。
 */

/**
 * 人群标签的显示名。标签本身是机器口径（age:senior），界面要说人话。
 *
 * 年龄档用**中文的岁数**说，不说日语的「60 代 / 70 代」——
 * 那是日本按世代分档的说法（原文：「维持期（成人～60 代）」「骨粗期（70 代～）」），
 * 中文读者看到的是「60 多岁 / 70 岁以上」。
 */
export const TAG_LABELS: Record<string, string> = {
  "age:child": "未成年人",
  "age:adult": "成年人（未满 70 岁）",
  "age:senior": "70 岁以上",
  "fall-risk": "易跌倒",
  "knee-pain": "膝盖不适",
  pregnant: "孕期",
  menstruating: "经期",
};

/** 年龄档：一次只能选一个（内置年龄档，设置里选一次）。 */
export const AGE_TAGS = ["age:child", "age:adult", "age:senior"];

/** 自选状态：可多选（易跌倒、膝盖不适、孕期……）。 */
export const STATE_TAGS = [
  "fall-risk",
  "knee-pain",
  "pregnant",
  "menstruating",
];

/** 人群标签的顺序：年龄段在前，状态在后 —— 先定人群，再定状态。 */
export const TAG_ORDER = [...AGE_TAGS, ...STATE_TAGS];

/** 按固定顺序取出选中的标签。 */
export function orderedTags(tags: string[]): string[] {
  const set = new Set(tags);
  return TAG_ORDER.filter((t) => set.has(t));
}

/**
 * 补齐缺失的年龄档。
 *
 * 年龄档必须始终有一个，默认是「成年人（未满 70 岁）」—— 原文里的分档是按人群分的
 * （骨密度运动：未成年人跳跃 / 成人深蹲 / 70 岁以上防跌倒），
 * 没有年龄档就等于成人那一档永远命中不了，用户看到的是默认动作而不是
 * 原文给成人的那一版。
 */
export function normalizeTags(tags: string[]): string[] {
  const hasAge = tags.some((t) => AGE_TAGS.includes(t));
  return hasAge ? tags : ["age:adult", ...tags];
}

/** 机器口径的标签 → 人话。界面不直接显示 `age:senior`。 */
export function tagText(tag: string): string {
  return TAG_LABELS[tag] ?? tag;
}

/**
 * 切换一个标签。
 *
 * 年龄档是单选：同时选中「未成年人」和「70 岁以上」没有意义，
 * 选一个就把别的年龄档取消掉。状态标签可多选，点一下取消、再点回来。
 */
export function toggleTag(tags: string[], tag: string): string[] {
  if (AGE_TAGS.includes(tag)) {
    return [...tags.filter((t) => !AGE_TAGS.includes(t)), tag];
  }
  return tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
}

/**
 * 条件的完整说明。
 *
 * 收成一行之后，界面上只写「跟默认不一样」的部分；需要说清楚全部时
 * （比如 title 提示）用这个 —— 模式、年龄段、状态都写出来。
 */
export function describeConditionsFull(
  mode: string,
  tags: string[],
  modeLabels: Record<string, string>,
): string {
  const picked = orderedTags(tags);
  const age = picked.find((t) => AGE_TAGS.includes(t));
  const states = picked.filter((t) => STATE_TAGS.includes(t));
  const parts = [
    `模式：${modeLabels[mode] ?? mode}`,
    `年龄段：${age ? tagText(age) : "未选"}`,
  ];
  if (states.length) parts.push(`我的情况：${states.map(tagText).join("、")}`);
  return parts.join(" · ");
}

/**
 * 条件的一行摘要。
 *
 * 只说「跟默认不一样」的部分：默认是「正常 · 成人」，用户没改过就不用占地方。
 */
export function describeConditions(
  mode: string,
  tags: string[],
  modeLabels: Record<string, string>,
): string {
  const parts: string[] = [];
  if (mode && mode !== "normal") parts.push(modeLabels[mode] ?? mode);
  const picked = orderedTags(tags).filter((t) => t !== "age:adult");
  for (const t of picked) parts.push(tagText(t));
  return parts.length ? parts.join(" · ") : "默认";
}
