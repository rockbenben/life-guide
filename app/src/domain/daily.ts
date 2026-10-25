/**
 * 「今日一篇」：每天从还没加入自己日常的保健卡里轮换一张。
 *
 * 用日期做种子：同一天内刷新、切页签，拿到的是同一张卡。
 * 每次渲染都换一张就成了随机噪音，用户记不住，也就无从判断值不值得试。
 *
 * 疾病卡不在候选里 —— 它不是可做的动作（AGENTS.md §5.4）。
 */

import type { Card } from "./routine.ts";
import { isConditionCard } from "./notices.ts";
import { isCustomCard } from "./custom.ts";
import { HABIT_ID_PREFIX } from "./custom.ts";

/** FNV-1a：同一个日期字符串永远得到同一个数。 */
function seedOf(date: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 候选：保健卡，且用户还没加入自己的日常。 */
export function dailyCandidates(cards: Card[], myRoutine: string[]): Card[] {
  const routine = new Set(myRoutine);
  return cards.filter(
    (c) =>
      !isConditionCard(c) &&
      // 用户自己加的不进「发现」：它是「我的」，不是「可以试试的」
      !isCustomCard(c) &&
      !routine.has(c.id),
  );
}

/**
 * 今天的「今日一篇」；没有候选时返回 null。
 *
 * 候选按 id 排序后再取，保证同一个候选集合在任何设备上都是同一张卡。
 * offset 给「换一个」用：同一天内偏移量决定取哪一张，刷新不会自己跳。
 */
export function dailyPick(
  cards: Card[],
  myRoutine: string[],
  date: string,
  offset = 0,
): Card | null {
  const candidates = dailyCandidates(cards, myRoutine);
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const i = (seedOf(date) + offset) % sorted.length;
  return sorted[i];
}

/** 「发现」今天给几张。 */
export const DAILY_PICKS = 3;

/**
 * 从「发现」里加走一张后，把空出来的那一格补上。
 *
 * 剩下的两张必须原地不动 —— 用户正在看它们。只把被加走的那张换成
 * 候选池里下一张还没在日常里的；加的不是这一批里的卡，这一批原样返回。
 */
export function refillPicks(
  cards: Card[],
  routine: string[],
  currentIds: string[],
  removedId: string,
): string[] {
  if (!currentIds.includes(removedId)) return currentIds;
  const target = currentIds.length;
  const kept = currentIds.filter((id) => id !== removedId);
  const routineSet = new Set(routine);
  const used = new Set(currentIds);
  const candidates = dailyCandidates(cards, routine)
    .map((c) => c.id)
    .sort();
  for (const id of candidates) {
    if (kept.length >= target) break;
    if (used.has(id) || routineSet.has(id)) continue;
    kept.push(id);
    used.add(id);
  }
  return kept;
}

/**
 * 今天的「发现」：给 DAILY_PICKS 张。
 *
 * 为什么不是一张：候选池现在有 407 张（默认清单之外的练习卡），一天一张的话
 * 一个月才看过约 7%。三张是个折中：一眼能看完，又不至于把「今天」那一屏撑成目录。
 *
 * 候选按 id 排序后再取，保证同一个候选集合在任何设备上都是同一批。
 * offset 给「换一批」用：一次跳过 DAILY_PICKS 张，所以换一批看到的不是刚才那几张。
 */
export function dailyPicks(
  cards: Card[],
  myRoutine: string[],
  date: string,
  offset = 0,
  count = DAILY_PICKS,
): Card[] {
  const candidates = dailyCandidates(cards, myRoutine);
  if (!candidates.length) return [];
  const sorted = [...candidates].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const start = (seedOf(date) + offset * Math.max(1, count)) % sorted.length;
  const out: Card[] = [];
  for (let i = 0; i < Math.min(count, sorted.length); i++) {
    out.push(sorted[(start + i) % sorted.length]);
  }
  return out;
}

/**
 * 放回默认清单时，用户自己加的习惯要留着。
 *
 * 「重置为默认」重置的是**App 给的那几张**，不是用户自己加的那些。
 * 一起冲掉的话，那几条会变成库里的孤儿 —— 看不见、也删不掉（实测踩过）。
 * 自己加的排在后面：App 给的在前，你的在后。
 */
export function mergeWithDefault(restoreIds: string[], current: string[]): string[] {
  const mine = current.filter((id) => id.startsWith(HABIT_ID_PREFIX));
  return [...restoreIds, ...mine];
}

/**
 * 放回默认之前，先数清楚会丢掉什么。
 *
 * dropped 只数「不在默认清单里、也不是自己加的」——那些是用户从手册/发现
 * 自己挑进来的，会被替换掉。自己加的习惯会保留（见 mergeWithDefault）。
 */
export function restoreCounts(
  routine: string[],
  restoreIds: string[],
): { dropped: number; mine: number } {
  const defaults = new Set(restoreIds);
  let dropped = 0;
  let mine = 0;
  for (const id of routine) {
    if (id.startsWith(HABIT_ID_PREFIX)) mine++;
    else if (!defaults.has(id)) dropped++;
  }
  return { dropped, mine };
}

/** 从日常里移走。移走不等于删记录：盖过的印还在纸上。 */
export function removeFromRoutine(
  myRoutine: string[],
  cardId: string,
): string[] {
  return myRoutine.filter((id) => id !== cardId);
}

/**
 * 起步包：按时段挑，每段最多 PER_SLOT 张。
 *
 * 不是「把已签字的全塞进今天」—— 那样 12 张时看着对，等 450 张签完，
 * 这个按钮就会把 P1 刚解决的问题原地复活（一次给你 450 个动作）。
 * 规则要自己封顶：
 *   · 每段最多 3 张，按 id 排序取，任何设备上结果都一样；
 *   · 「随时」那一档也算一段：不是标了时段的卡才进 —— 刚起步时已签字的卡里
 *     一张日间的都没有，只按时段挑的话 12:00–18:00 首启仍然是空的
 *     （「初次进去一个动作都没有」）。没标时段的卡按「随时」算，
 *     与 todaysCards 同一口径。
 * 挑不满也没关系：起步包的意义是一个能改的起点，不是最终清单。
 */
export const STARTER_PER_SLOT = 3;

/** 卡落在哪一档：只有早/日/晚三档按时段分，其余（随时或没标）都算「随时」。 */
function bucketOf(card: Card): "morning" | "daytime" | "evening" | "anytime" {
  return card.slot === "morning" || card.slot === "daytime" || card.slot === "evening"
    ? card.slot
    : "anytime";
}

export function starterPack(cards: Card[]): string[] {
  const perSlot: Record<string, string[]> = { morning: [], daytime: [], evening: [], anytime: [] };
  for (const c of [...cards]
    .filter((c) => !isConditionCard(c))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const bucket = perSlot[bucketOf(c)];
    if (bucket.length < STARTER_PER_SLOT) bucket.push(c.id);
  }
  return [...perSlot.morning, ...perSlot.daytime, ...perSlot.evening, ...perSlot.anytime];
}

/**
 * 刷新后首启说明还该不该出现。
 *
 * 只有「新用户自动放好清单时写下的 pending」才算数：老用户没有这个标记，
 * 不会升级后突然又看到一遍；用户动手后 pending 被清掉，也不会回来。
 */
export function firstRunOnLoad(
  saved: string[] | undefined,
  pending: boolean | undefined,
): boolean {
  return saved !== undefined && pending === true;
}

/**
 * 首启的「我的日常」。
 *
 * 两种「空」必须分得开：
 *   · undefined —— 从来没设置过（第一次打开）→ 给默认清单那几张，
 *     用户不必先做一次设置才能看到东西；
 *   · []        —— 用户自己清空过 → 原样尊重，不再自动塞回去。
 * 区别靠 IndexedDB 里那条设置存不存在来判断（见 ui/Today.tsx 的首启 effect）。
 *
 * 默认清单来自内容层（content/default-routine.yaml → cards.json 的 defaultRoutine），
 * 那是**策展**：App 不自己编该做哪几件。清单空了才回落到起步包。
 */
export function initialRoutine(
  saved: string[] | undefined,
  defaultRoutine: string[],
  cards: Card[],
): string[] {
  if (saved !== undefined) return saved;
  return defaultRoutine.length ? [...defaultRoutine] : starterPack(cards);
}

/** 今天这一屏该显示哪几张：在日常里、且属于当前时段（随时的一直在）。 */
export function todaysCards(
  cards: Card[],
  myRoutine: string[],
  slot: string,
): Card[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: Card[] = [];
  for (const id of myRoutine) {
    const c = byId.get(id);
    if (!c) continue;
    if (isConditionCard(c)) continue;
    if (c.slot && c.slot !== "anytime" && c.slot !== slot) continue;
    out.push(c);
  }
  return out;
}

/** 日常里的全部卡（不分时段），按次序 —— 调顺序那一屏要的是这个。 */
export function routineCards(cards: Card[], myRoutine: string[]): Card[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const out: Card[] = [];
  for (const id of myRoutine) {
    const c = byId.get(id);
    if (c && !isConditionCard(c)) out.push(c);
  }
  return out;
}

/**
 * 在日常里挪一位：dir = -1 上移 / +1 下移。
 *
 * 次序就存在这条数组里，所以「调顺序」不用另设一个字段 ——
 * 少一个地方存同一件事，就少一处能对不上的地方。
 */
export function moveInRoutine(routine: string[], cardId: string, dir: -1 | 1): string[] {
  const i = routine.indexOf(cardId);
  if (i < 0) return routine;
  const j = i + dir;
  if (j < 0 || j >= routine.length) return routine;
  const next = [...routine];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
