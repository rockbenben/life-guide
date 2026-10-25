/**
 * 用户自己加的习惯。
 *
 * 手册里 518 张卡是别人的习惯；「我每天冥想 10 分钟」这种只有用户自己知道。
 * 这一条通道让用户能加自己的 —— 但**不新造一套界面**：
 * 自定义习惯在数据层就是一张卡（`habitToCard`），所以盖章、累计天数、
 * 提醒、次序、「已做 N 天」全都白得。
 *
 * 与内容层的卡有三条不同：
 *   · 没有出处（不在手册里，屏上不摆「出自〈哪一篇〉」）
 *   · 没有引文（用户自己写的，不是原文）
 *   · 时段是**用户说的**，不是原文说的 —— 内容层那条「只有原文明确说了才填时段」
 *     的规矩管的是策展，管不到用户自己的习惯
 */
import type { Card } from "./routine.ts";

export type HabitSlot = "morning" | "daytime" | "evening" | "anytime";

/** 一条自定义习惯（存在 IndexedDB 的 custom 表里）。 */
export interface CustomHabit {
  id: string;
  /** 用户起的名字 —— 屏上的卡名就是它 */
  name: string;
  /** 「做什么」那一行；可以空（空了就只显示名字） */
  text: string;
  slot: HabitSlot;
  createdAt: string;
}

/** 名字最长多少字：收起态那行放得下的宽度（与内容层卡片同一个 NAME_MAX）。 */
export const HABIT_NAME_MAX = 16;
/** 「做什么」最长多少字（与内容层卡片的 DO_MAX 同一个口径）。 */
export const HABIT_TEXT_MAX = 30;

/**
 * id 前缀：与内容层的卡 id 不会撞。
 *
 * 撞了会怎样：`myRoutine` 存的是 id 数组，撞了就分不清「这是我加的」还是
 * 「这是手册里那张」—— 所以前缀是硬约定，不是装饰。
 */
export const HABIT_ID_PREFIX = "my-";

/** 新 id。时间戳 + 随机尾巴：同一毫秒加两个也不会撞。 */
export function newHabitId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${HABIT_ID_PREFIX}${Date.now().toString(36)}-${rand}`;
}

/** 这张卡是用户自己加的吗。 */
export function isCustomCard(card: Pick<Card, "customName">): boolean {
  return Boolean(card.customName && card.customName.trim());
}

/**
 * 一条习惯 → 一张卡。
 *
 * anchor 给一个**唯一**的假小节名（带 id）：`displayNames` 按 anchor 分组，
 * 两个自定义习惯共用一个 anchor 的话，第二个会被当成「同名卡」换成别的名字。
 * 屏上不会露出这个 anchor（自定义卡没有出处，那一栏摆的是名字）。
 */
export function habitToCard(h: CustomHabit): Card {
  return {
    id: h.id,
    status: "custom",
    source: { anchor: `我的习惯 ${h.id}` },
    slot: h.slot,
    customName: h.name.trim(),
    remind: { text: h.text.trim() },
    steps: [],
    duration: null,
  };
}
