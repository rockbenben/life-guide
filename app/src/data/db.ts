/**
 * IndexedDB：事件日志、设置、我的日常、删除标记。
 *
 * 为什么不用 localStorage：容量小（几 MB）、同步阻塞主线程，而且事件日志
 * 是会持续增长的追加型数据，不适合塞进键值对。
 *
 * 事件日志从第一天就开始记：历史数据事后补不回来，而界面什么时候做是另一回事
 * （AGENTS.md §4.4）。
 *
 * **多设备同步需要的三样东西**（AGENTS.md §4.6）：
 *   · 每条记录带 `updatedAt`（最后改动的时刻）—— 合并时"谁新谁赢"看它；
 *   · 删除要留墓碑（tombstones）—— 删掉的东西不能在对面的设备上复活；
 *   · 每台设备一个 deviceId —— 同一份数据从哪台机器来的，要分得清。
 */
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { CustomHabit } from "../domain/custom.ts";
import { TickClock } from "../domain/clock.ts";

export type { CustomHabit };

/**
 * 本机时钟（单调）。
 *
 * 合并靠 `updatedAt` 比大小，所以"本机写出来的时刻"必须**单调**、
 * 并且在收到远端数据时**吸收**远端的时间戳 —— 见 domain/clock.ts 的说明。
 */
const clock = new TickClock();

/** 本机此刻的时间戳（单调递增）。 */
export function nowTick(): number {
  return clock.now();
}

/** 并进一个远端的时间戳（收到别人的数据时调用）。 */
export function absorbTick(ts: number): void {
  clock.absorb(ts);
}

/** 当前时钟值。 */
export function clockValue(): number {
  return clock.value;
}

/**
 * 把时钟读回来（启动时调一次）。
 *
 * 不读的话，本机时钟从 0 起 —— 时钟往回走过的那次重启之后，
 * "单调"就断了（虽然墙上时钟正常时看不出差别）。
 */
export async function initClock(): Promise<void> {
  const saved = await getSetting<number>("syncClock", 0);
  clock.absorb(saved);
}

/** 把时钟存下来（下一次启动接着用）。 */
export async function saveClock(): Promise<void> {
  await setSettingAt("syncClock", clock.value, clock.value);
}

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
  /**
   * 最后一次改动的时刻（毫秒）。
   *
   * 旧日志没有这个字段（undefined）—— 合并时按 0 算，即"比有值的老"。
   */
  updatedAt?: number;
}

/** 删除标记（墓碑）：记录「这个东西被删掉了」这件事本身。 */
export interface Tombstone {
  /** `${kind}:${id}` */
  key: string;
  kind: "event" | "custom";
  /** 事件的 ts（字符串）或习惯的 id */
  id: string;
  updatedAt: number;
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
  /** 今天不做的卡：cardId → 逻辑日期（YYYY-MM-DD）。只影响那一天，不改日常 */
  skipToday?: Record<string, string>;
}

/** 设置的一行：值 + 它是什么时候写的。 */
export interface SettingRow {
  key: string;
  value: unknown;
  /** 旧行没有这个字段（undefined）—— 合并时按 0 算 */
  updatedAt?: number;
}

interface LifeDB extends DBSchema {
  events: {
    key: number;
    value: DoneEvent;
    indexes: { "by-card": string; "by-date": string };
  };
  settings: {
    key: string;
    value: SettingRow;
  };
  /** 用户自己加的习惯（v2 起） */
  custom: {
    key: string;
    value: CustomHabit;
  };
  /** 删除标记（v3 起）：多设备同步时，删掉的东西不能在对面的设备上复活 */
  tombstones: {
    key: string;
    value: Tombstone;
  };
}

let dbPromise: Promise<IDBPDatabase<LifeDB>> | null = null;

function db(): Promise<IDBPDatabase<LifeDB>> {
  if (!dbPromise) {
    dbPromise = openDB<LifeDB>("life-guide", 3, {
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
        if (oldVersion < 3) {
          d.createObjectStore("tombstones", { keyPath: "key" });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * 事件写入：ts 是它的身份，同一毫秒里盖两张卡也不会互相顶掉。
 *
 * **为什么会撞**：ts = Date.now()，而 events 表的主键就是 ts。
 * 同一毫秒里写两条 → 后一条把前一条盖掉（用户会发现少了一条记录）。
 * 撞上了就把 ts 往后挪，直到空着为止。
 *
 * **但"撤销"不能挪**：撤销是改同一条记录（periodDone 从 true 变 false），
 * 挪了 ts 就变成"多了一条新的"，原来那条还在 —— 界面会显示"已完成"。
 * 所以：同一条（ts、卡、日期都一样）当成更新，别的才挪。
 *
 * 返回**实际用掉的 ts** —— 挪过的话调用方得知道（同步时身份要跟着改）。
 */
export async function addEvent(e: DoneEvent): Promise<number> {
  const d = await db();
  const existing = await d.get("events", e.ts);
  const sameEvent = existing && existing.cardId === e.cardId && existing.date === e.date;
  let ts = e.ts;
  if (!sameEvent) {
    while (await d.get("events", ts)) ts += 1;
  }
  await d.put("events", { ...e, ts, updatedAt: e.updatedAt ?? nowTick() });
  return ts;
}

/**
 * 一次事务写完一批事件。
 *
 * **为什么不能一条一条写**：同步时要把合并后的全部事件落回本地 ——
 * 一年下来几千条记录，逐条 `put` 就是几千个事务（手机上更慢），
 * 每次同步白等好几秒，还把磁盘写得一团乱。
 * 一个 readwrite 事务里全写完，快一个量级。
 */
export async function putEvents(events: DoneEvent[]): Promise<number[]> {
  if (!events.length) return [];
  const d = await db();
  const tx = d.transaction("events", "readwrite");
  const store = tx.objectStore("events");
  const used: number[] = [];
  for (const e of events) {
    const existing = await store.get(e.ts);
    const sameEvent = existing && existing.cardId === e.cardId && existing.date === e.date;
    let ts = e.ts;
    if (!sameEvent) {
      // ts 撞了（同一毫秒里写了两条）→ 往后挪，直到空着
      while (await store.get(ts)) ts += 1;
    }
    await store.put({ ...e, ts, updatedAt: e.updatedAt ?? nowTick() });
    used.push(ts);
  }
  await tx.done;
  return used;
}

/**
 * 改一条已有的记录（撤销周期完成）。
 *
 * 与 addEvent 的区别：**updatedAt 一定要刷新** ——
 * 合并时"谁新谁赢"看的就是它，不刷新的话对面设备永远看不到这次撤销。
 */
export async function updateEvent(e: DoneEvent): Promise<void> {
  await (await db()).put("events", { ...e, updatedAt: nowTick() });
}

/** 取一条记录。 */
export async function getEvent(ts: number): Promise<DoneEvent | undefined> {
  return (await db()).get("events", ts);
}

/**
 * 把一条记录的卡 id 换成新的（内容层合并了卡，旧 id 要认领回去）。
 *
 * **不刷新 updatedAt**：这是机械迁移，不是用户改了什么 ——
 * 刷新了会让这条记录在下一次同步里"看起来刚被改过"，压过别的设备上的同一份。
 * 也不动 ts：那是记录的身份（次序、周期判定都靠它）。
 */
export async function migrateEventCardId(ts: number, cardId: string): Promise<void> {
  const d = await db();
  const e = await d.get("events", ts);
  if (!e || e.cardId === cardId) return;
  await d.put("events", { ...e, cardId });
}

/**
 * 删一条记录。
 *
 * 默认留下墓碑（不然对面的设备会把它带回来）。
 * 同步时把墓碑一起搬过来 —— 那时**不用再留一个**（墓碑已经在手里了）。
 */
export async function removeEvent(ts: number, opts?: { tombstone?: boolean }): Promise<void> {
  const d = await db();
  await d.delete("events", ts);
  if (opts?.tombstone !== false) {
    await putTombstone({ kind: "event", id: String(ts), updatedAt: nowTick() });
  }
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

/**
 * 读一项设置，连同它是什么时候写的。
 *
 * 合并时要用：同一个键两边都有时，谁写的晚谁说了算。
 */
export async function getSettingMeta<T>(key: string): Promise<{ value: T; updatedAt: number }> {
  const row = await (await db()).get("settings", key);
  return { value: row?.value as T, updatedAt: row?.updatedAt ?? 0 };
}

/** 全部设置项（同步时只取白名单里的那几项）。 */
export async function allSettings(): Promise<SettingRow[]> {
  return (await db()).getAll("settings");
}

/** 写一项设置，顺带记下写入时刻。 */
export async function setSetting(key: string, value: unknown): Promise<void> {
  await (await db()).put("settings", { key, value, updatedAt: nowTick() });
}

/**
 * 按**指定的时刻**写一项设置。
 *
 * 同步时用：远端来的设置带着它自己的 updatedAt ——
 * 不能在这里盖成"现在"，盖了就变成"刚刚改的"，下一次合并会一直赢过别人。
 */
export async function setSettingAt(
  key: string,
  value: unknown,
  updatedAt: number,
): Promise<void> {
  await (await db()).put("settings", { key, value, updatedAt });
}

export async function clearEvents(): Promise<void> {
  const d = await db();
  await d.clear("events");
  // 清记录的同时清掉与记录相关的墓碑：
  // 墓碑是"这条被删了"，记录都没了还留着墓碑是自相矛盾。
  const all = await d.getAll("tombstones");
  for (const t of all) {
    if (t.kind === "event") await d.delete("tombstones", t.key);
  }
}

/* ------------------------------------------------------------ 自定义习惯 */

/** 全部自定义习惯（按创建时间排：先加的在前）。 */
export async function allCustomHabits(): Promise<CustomHabit[]> {
  const all = await (await db()).getAll("custom");
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * 写一条习惯。
 *
 * `updatedAt` 给了就留着（同步时远端来的记录带着它自己的时刻，
 * 不能在这里刷新 —— 刷新了就变成"刚刚改的"，下一次合并会把它盖过别人）；
 * 没给才盖上当前时刻。
 */
export async function putCustomHabit(habit: CustomHabit): Promise<void> {
  await (await db()).put("custom", {
    ...habit,
    updatedAt: habit.updatedAt ?? nowTick(),
  });
}

/**
 * 删一条习惯。
 *
 * 默认留下墓碑（不然对面的设备会把它带回来）；同步时墓碑已经在手里了，
 * 那时不用再留一个。
 */
export async function deleteCustomHabit(
  id: string,
  opts?: { tombstone?: boolean },
): Promise<void> {
  const d = await db();
  await d.delete("custom", id);
  if (opts?.tombstone !== false) {
    await putTombstone({ kind: "custom", id, updatedAt: nowTick() });
  }
}

/** 取一条习惯。 */
export async function getCustomHabit(id: string): Promise<CustomHabit | undefined> {
  return (await db()).get("custom", id);
}

/**
 * 清空全部习惯，**不留墓碑**。
 *
 * 导入备份时用：导入是"整份换掉"，不是"逐条删掉" ——
 * 逐条删会留下一堆墓碑（比备份里的习惯还新），下一次合并就把它们全删了。
 */
export async function clearCustomHabits(): Promise<void> {
  await (await db()).clear("custom");
}

/* ------------------------------------------------------------ 删除标记 */

/** 记一个墓碑。 */
export async function putTombstone(t: { kind: "event" | "custom"; id: string; updatedAt: number }): Promise<void> {
  await (await db()).put("tombstones", { ...t, key: `${t.kind}:${t.id}` });
}

/** 全部墓碑。 */
export async function allTombstones(): Promise<Tombstone[]> {
  return (await db()).getAll("tombstones");
}

/** 清掉全部墓碑（导入备份时用：备份里带的墓碑才算数）。 */
export async function clearTombstones(): Promise<void> {
  await (await db()).clear("tombstones");
}

/* ------------------------------------------------------------ 设备身份 */

/**
 * 这台设备的 id。
 *
 * 有了它才知道"这份数据是哪台机器写的"。第一次问的时候生成一个，存进设置。
 * **不跟着同步走**（不在白名单里）—— 每台设备该有自己的身份。
 */
export async function getDeviceId(): Promise<string> {
  const existing = await getSetting<string>("deviceId", "");
  if (existing) return existing;
  const rand = Math.random().toString(36).slice(2, 10);
  const id = `dev-${Date.now().toString(36)}-${rand}`;
  await setSetting("deviceId", id);
  return id;
}
