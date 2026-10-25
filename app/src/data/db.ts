/**
 * IndexedDB：事件日志、设置、我的日常。
 *
 * 为什么不用 localStorage：容量小（几 MB）、同步阻塞主线程，而且事件日志
 * 是会持续增长的追加型数据，不适合塞进键值对。
 *
 * 事件日志从第一天就开始记：历史数据事后补不回来，而界面什么时候做是另一回事
 * （AGENTS.md §4.4）。
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { CustomHabit } from "../domain/custom.ts";

export type { CustomHabit };

export interface DoneEvent {
  date: string;
  cardId: string;
  variant: string;
  ts: number;
  /**
   * 周期卡的一次完成标记。
   *
   * true = 这次盖章算「本周 / 本月完成」；
   * false = 用户撤销过这次周期完成，事件仍留在历史里；
   * undefined = 旧日志（没有周期概念时）的事件，按旧规则兼容。
   */
  periodDone?: boolean;
  /** 这次周期完成是按哪种频率算的；改频率后旧完成不会冒充新频率 */
  periodCadence?: "weekly" | "monthly";
}

export interface Settings {
  /** 用户画像标签，用于匹配 segments */
  tags: string[];
  /** 当前模式 */
  mode: string;
  /** 加入「我的日常」的卡 id */
  myRoutine: string[];
  /** 用户改过的「多久做一次」；没写的按卡片自己的提醒语判断 */
  cadence?: Record<string, string>;
}

interface LifeDB extends DBSchema {
  events: {
    key: number;
    value: DoneEvent;
    indexes: { "by-card": string; "by-date": string };
  };
  settings: {
    key: string;
    value: { key: string; value: unknown };
  };
  /** 用户自己加的习惯（v2 起） */
  custom: {
    key: string;
    value: CustomHabit;
  };
}

let dbPromise: Promise<IDBPDatabase<LifeDB>> | null = null;

function db(): Promise<IDBPDatabase<LifeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LifeDB>("life-guide", 2, {
      upgrade(d, oldVersion) {
        // 按版本分批建表：v1 的表在 v2 里已经存在了，
        // 不看版本就建会抛 "Object store already exists"（升级直接失败）。
        if (oldVersion < 1) {
          const e = d.createObjectStore("events", { keyPath: "ts", autoIncrement: true });
          e.createIndex("by-card", "cardId");
          e.createIndex("by-date", "date");
          d.createObjectStore("settings", { keyPath: "key" });
        }
        if (oldVersion < 2) {
          d.createObjectStore("custom", { keyPath: "id" });
        }
      },
    });
  }
  return dbPromise;
}

export async function addEvent(e: DoneEvent): Promise<void> {
  await (await db()).put("events", e);
}

export async function removeEvent(ts: number): Promise<void> {
  await (await db()).delete("events", ts);
}

export async function allEvents(): Promise<DoneEvent[]> {
  return (await db()).getAll("events");
}

/** 某张卡在某天是否已完成（周期撤销过的记录不算）。 */
export async function isDone(cardId: string, date: string): Promise<boolean> {
  const all = await allEvents();
  return all.some(
    (e) => e.cardId === cardId && e.date === date && e.periodDone !== false,
  );
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await (await db()).get("settings", key);
  return (row?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put("settings", { key, value });
}

export async function clearEvents(): Promise<void> {
  await (await db()).clear("events");
}

/* ------------------------------------------------------------ 自定义习惯 */

/** 全部自定义习惯（按创建时间排：先加的在前）。 */
export async function allCustomHabits(): Promise<CustomHabit[]> {
  const all = await (await db()).getAll("custom");
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function putCustomHabit(habit: CustomHabit): Promise<void> {
  await (await db()).put("custom", habit);
}

export async function deleteCustomHabit(id: string): Promise<void> {
  await (await db()).delete("custom", id);
}
