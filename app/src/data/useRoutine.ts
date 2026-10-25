/**
 * 「我的日常」：清单 + 用户自己加的习惯。
 *
 * **为什么要有这个文件**：以前这两样东西存在两个地方 ——
 * `ui/Today.tsx` 存一份清单（给界面显示），`main.tsx` 又存一份
 * （给提醒算「这一段该做哪几件」用），两边靠一个回调同步。
 * 同一件事两个真相，迟早会对不上：哪边漏了一次回调，提醒就会说「没有动作」。
 *
 * 现在它们在一处：main.tsx 调这个 hook，Today 页拿到的就是同一份。
 *
 * 放 data/ 而不是 ui/：它管的是「存起来的东西」（IndexedDB），
 * 界面只是它的一个消费者 —— 设置页的「导出数据」也读同一份。
 */
import { useEffect, useMemo, useState } from "preact/hooks";

import {
  allCustomHabits,
  deleteCustomHabit,
  getSetting,
  putCustomHabit,
  setSetting,
  type CustomHabit,
} from "./db.ts";
import {
  habitToCard,
  newHabitId,
  type HabitSlot,
} from "../domain/custom.ts";
import {
  firstRunOnLoad,
  initialRoutine,
  mergeWithDefault,
  moveInRoutine,
  removeFromRoutine,
  starterPack,
} from "../domain/daily.ts";
import type { Card } from "../domain/routine.ts";
import { defaultCadenceOf, type Cadence } from "../domain/cadence.ts";

export interface RoutineStore {
  /** 清单里的卡 id —— 次序即显示次序 */
  ids: string[];
  /** 清单从库里读回来了没有（没回来之前不许说「你把动作都移出去了」） */
  ready: boolean;
  /** 首启刚放好的那一次 —— 说明要给用户看，用户一动手就撤掉 */
  firstRun: boolean;
  /** 用户自己加的习惯（数据层就是卡） */
  habits: Card[];
  /** 「放回默认」要放的那几张 */
  restoreIds: string[];
  /** 用户动手了：首启说明撤掉并记住（盖印也算） */
  acknowledgeFirstRun: () => Promise<void>;

  /** 改清单（次序即显示次序） */
  set: (next: string[]) => Promise<void>;
  /** 把一张卡放进清单 */
  add: (cardId: string) => Promise<void>;
  /** 把一组卡一次放进清单；返回真正新加的张数 */
  addMany: (cardIds: string[]) => Promise<number>;
  /** 从清单里移走 */
  takeOut: (cardId: string) => Promise<void>;
  /** 挪一位 */
  move: (cardId: string, dir: -1 | 1) => Promise<void>;
  /** 放回默认的那几张（自己加的留着） */
  restoreDefault: () => Promise<void>;
  /** 加一条自己的习惯：建卡 + 放进清单 */
  addHabit: (name: string, text: string, slot: HabitSlot) => Promise<string>;
  /** 改一条自己的习惯 */
  editHabit: (
    id: string,
    patch: { name?: string; text?: string; slot?: HabitSlot },
  ) => Promise<void>;
  /** 删掉一条自己的习惯（连同它在清单里的位置） */
  removeHabit: (id: string) => Promise<void>;
  /** 这张卡多久做一次：用户改过的优先，否则按卡片自己的提醒语判断 */
  cadenceOf: (cardId: string) => Cadence;
  setCadence: (cardId: string, cadence: Cadence) => Promise<void>;
}

export interface UseRoutineOptions {
  /** 内容层的卡（用来算起步包） */
  cards: Card[];
  /** 内容层的默认清单 */
  defaultRoutine: string[];
  /** 卡片数据还在加载 —— 加载中不读清单（起步包要卡片） */
  loading: boolean;
  /**
   * 变了就重新从库里读一次清单。
   *
   * 清单这个 hook 挂在 App 层（不随页签重挂载），所以「别处把清单换了」
   * （导入备份）它不会自己知道 —— 界面还摆着旧的清单，用户改一下就把
   * 刚导入的那份盖掉了。
   */
  refreshKey?: number;
}

export function useRoutine({
  cards,
  defaultRoutine,
  loading,
  refreshKey = 0,
}: UseRoutineOptions): RoutineStore {
  const [ids, setIds] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [habits, setHabits] = useState<Card[]>([]);
  /** 用户改过的频率；没改过的走 defaultCadenceOf（不把默认值写进库） */
  const [cadenceOverrides, setCadenceOverrides] = useState<Record<string, Cadence>>({});

  /** 「放回默认」放哪几张：内容层的默认清单优先，空了才回落到起步包 */
  const restoreIds = useMemo(
    () => (defaultRoutine.length ? [...defaultRoutine] : starterPack(cards)),
    [defaultRoutine, cards],
  );

  // 自定义习惯与频率覆盖：读回来
  // （refreshKey 变了也要重读：导入备份会换掉习惯，跟清单一样）
  useEffect(() => {
    void (async () => {
      const [list, cadence] = await Promise.all([
        allCustomHabits(),
        getSetting<Record<string, Cadence>>("cadence", {}),
      ]);
      setHabits(list.map(habitToCard));
      setCadenceOverrides(cadence ?? {});
    })();
  }, [refreshKey]);

  /**
   * 清单：等卡片到了再读。
   *
   * 「没设置过」与「自己清空过」要分得开（domain/daily.ts 的 initialRoutine）：
   * 前者给默认的那几张，后者尊重用户，不自动塞回去。
   *
   * 为什么等卡片到了再做：卡片数据是异步取来的，cards 还是空数组时
   * 起步包也是空的 —— 那时候把空数组写进设置，首启就永远空着了。
   */
  useEffect(() => {
    if (loading) return;
    void (async () => {
      const saved = await getSetting<string[] | undefined>("myRoutine", undefined);
      const pending = await getSetting<boolean>("firstRunPending", false);
      const next = initialRoutine(saved, defaultRoutine, cards);
      // 只在真的放得出东西时写设置：卡片还没到（空数组）就别把「空」定成用户的意愿。
      // pending 只在「App 刚替新用户放好清单」时写；它跨刷新活着，用户一动手就清掉。
      if (saved === undefined && next.length) {
        await setSetting("myRoutine", next);
        await setSetting("firstRunPending", true);
        setFirstRun(true);
      } else {
        setFirstRun(firstRunOnLoad(saved, pending));
      }
      setIds(next);
      setReady(true);
    })();
  }, [cards, loading, defaultRoutine, refreshKey]);

  async function acknowledgeFirstRun(): Promise<void> {
    setFirstRun(false);
    await setSetting("firstRunPending", false);
  }

  /** 改清单。任何改动都算「用户动手了」—— 首启那行说明该撤。 */
  async function set(next: string[]): Promise<void> {
    setIds(next);
    await acknowledgeFirstRun();
    await setSetting("myRoutine", next);
  }

  async function add(cardId: string): Promise<void> {
    await addMany([cardId]);
  }

  async function addMany(cardIds: string[]): Promise<number> {
    const next = [...ids];
    let added = 0;
    for (const id of cardIds) {
      if (next.includes(id)) continue;
      next.push(id);
      added++;
    }
    if (added) await set(next);
    return added;
  }

  async function takeOut(cardId: string): Promise<void> {
    await set(removeFromRoutine(ids, cardId));
  }

  async function move(cardId: string, dir: -1 | 1): Promise<void> {
    await set(moveInRoutine(ids, cardId, dir));
  }

  async function restoreDefault(): Promise<void> {
    // 自己加的留着：重置的是「App 给的那几张」，不是用户自己加的那些
    // （判据在 domain/daily.ts 的 mergeWithDefault —— 只有一处）
    await set(mergeWithDefault(restoreIds, ids));
  }

  async function addHabit(
    name: string,
    text: string,
    slot: HabitSlot,
  ): Promise<string> {
    const habit: CustomHabit = {
      id: newHabitId(),
      name: name.trim(),
      text: text.trim(),
      slot,
      createdAt: new Date().toISOString(),
    };
    await putCustomHabit(habit);
    setHabits((h) => [...h, habitToCard(habit)]);
    await set([...ids, habit.id]);
    return habit.id;
  }

  async function editHabit(
    id: string,
    patch: { name?: string; text?: string; slot?: HabitSlot },
  ): Promise<void> {
    const all = await allCustomHabits();
    const prev = all.find((h) => h.id === id);
    if (!prev) return;
    const habit: CustomHabit = {
      ...prev,
      name: (patch.name ?? prev.name).trim(),
      text: (patch.text ?? prev.text).trim(),
      slot: patch.slot ?? prev.slot,
    };
    await putCustomHabit(habit);
    setHabits((h) => h.map((c) => (c.id === id ? habitToCard(habit) : c)));
    await acknowledgeFirstRun();
  }

  async function removeHabit(id: string): Promise<void> {
    await deleteCustomHabit(id);
    setHabits((h) => h.filter((c) => c.id !== id));
    await set(removeFromRoutine(ids, id));
  }

  function cadenceOf(cardId: string): Cadence {
    const override = cadenceOverrides[cardId];
    if (override === "daily" || override === "weekly" || override === "monthly") {
      return override;
    }
    const card = cards.find((c) => c.id === cardId) ?? habits.find((c) => c.id === cardId);
    return card ? defaultCadenceOf(card) : "daily";
  }

  async function setCadence(cardId: string, cadence: Cadence): Promise<void> {
    const next = { ...cadenceOverrides, [cardId]: cadence };
    setCadenceOverrides(next);
    await setSetting("cadence", next);
    await acknowledgeFirstRun();
  }

  return {
    ids,
    ready,
    firstRun,
    habits,
    restoreIds,
    acknowledgeFirstRun,
    set,
    add,
    addMany,
    takeOut,
    move,
    restoreDefault,
    addHabit,
    editHabit,
    removeHabit,
    cadenceOf,
    setCadence,
  };
}
