/**
 * 多设备同步：**两份数据怎么合成一份**。
 *
 * 这一层是纯函数：不碰网络、不碰 IndexedDB、不碰平台 API。
 * 为什么单独拆一层：三处要用同一套合并规则 —— 同步时（data/sync.ts）、
 * 单元测试、以及将来任何「两份备份并成一份」的场合。
 * 规则散到两处就必然分叉，分叉的结果是设备之间越同步越乱。
 *
 * ## 合并的三个前提
 *
 * 1. **幂等**：同一对输入合并几次都得到同一个结果。
 * 2. **与顺序无关**：merge(a, b) 与 merge(b, a) 必须一样。
 *    不然两台设备各自算一遍会得出两份不同的真相，然后来回覆盖。
 * 3. **不丢数据**：除非明确标了删除，否则并集。
 *
 * ## 各类数据的合并策略
 *
 * | 数据 | 身份 | 冲突怎么办 |
 * | --- | --- | --- |
 * | 盖章记录（events） | `ts`（本地写入时保证唯一） | 同一条取 `updatedAt` 新的 |
 * | 自定义习惯（custom） | `id` | 同一条取 `updatedAt` 新的 |
 * | 设置（settings） | 键名 | 整项取 `updatedAt` 新的（清单是有序的，合并顺序反而更乱） |
 * | 删除（tombstones） | `kind:id` | 取 `updatedAt` 新的 |
 *
 * **删除要单独记**：A 设备上把一条记录删了，B 设备上那条还在 ——
 * 不传删除标记，B 会把它又带回来（"复活"）。所以删除也进同步，
 * 只是一条墓碑（tombstone），不是数据本身。
 *
 * **同分怎么办**：`updatedAt` 一样时（同一毫秒里改的），按内容逐字比大小。
 * 这是为了满足上面的第 2 条：谁来比都一样，结果才一样。
 */
import type { HabitSlot } from "./custom.ts";

/** 同步载荷的版本。改了形状就 +1，旧版本按 v1 兼容读。 */
export const SYNC_PAYLOAD_VERSION = 1;

/**
 * 跟着同步走的设置项。
 *
 * **白名单，不是黑名单**：新增一个设置项时默认不同步，
 * 要同步得显式写进这里 —— 否则「同步口令」这类东西会被一起传走。
 */
export const SYNCED_SETTING_KEYS = [
  "tags",
  "mode",
  "myRoutine",
  "cadence",
  "skipToday",
  "reminders",
] as const;

/** 一条盖章记录（同步时的形状）。 */
export interface SyncEvent {
  /** 逻辑日期 YYYY-MM-DD */
  date: string;
  cardId: string;
  /** 当时用的模式 */
  variant: string;
  /**
   * 事件身份。本地写入时保证唯一（同一毫秒里盖两张卡也不会撞）。
   *
   * 用 ts 当身份而不是另发一个 id：撤销周期完成是**改同一条**
   * （periodDone 从 true 变 false），身份不变才能把改动传出去。
   */
  ts: number;
  /** 周期卡：true = 算完成，false = 用户撤销过 */
  periodDone?: boolean;
  periodCadence?: "weekly" | "monthly";
  /** 最后一次改动的时刻（毫秒）。合并时谁新谁赢。 */
  updatedAt: number;
}

/** 删除标记（墓碑）。 */
export interface SyncTombstone {
  kind: "event" | "custom";
  /** 事件的 ts（字符串形式）或习惯的 id */
  id: string;
  updatedAt: number;
}

/** 一项设置。 */
export interface SyncSetting {
  key: string;
  value: unknown;
  updatedAt: number;
}

/** 一条自定义习惯（同步时的形状）。 */
export interface SyncCustom {
  id: string;
  name: string;
  text: string;
  slot: HabitSlot;
  createdAt: string;
  updatedAt: number;
}

/** 一份完整的同步载荷。 */
export interface SyncPayload {
  /** 载荷格式版本 */
  v: number;
  /** 写这份载荷的设备（合并后由上传方改写） */
  deviceId: string;
  /** 这份载荷写出的时刻 */
  updatedAt: number;
  events: SyncEvent[];
  tombstones: SyncTombstone[];
  settings: SyncSetting[];
  custom: SyncCustom[];
}

/** 空载荷（新设备还没有任何数据时用）。 */
export function emptyPayload(deviceId: string, now: number = Date.now()): SyncPayload {
  return {
    v: SYNC_PAYLOAD_VERSION,
    deviceId,
    updatedAt: now,
    events: [],
    tombstones: [],
    settings: [],
    custom: [],
  };
}

/**
 * 键序稳定的 JSON 字符串。
 *
 * 合并要比"两份内容谁大"（见 pickNewer），而 JSON.stringify 按插入顺序输出 ——
 * 同一份内容、不同来源的键顺序可能不同，比出来的结果就不稳。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(obj)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
      .join(",") +
    "}"
  );
}

/**
 * 两份同身份的数据里留哪一份。
 *
 * 先比 `updatedAt`；一样时按内容逐字比大小 —— **不能看谁在左边**，
 * 否则 merge(a,b) 与 merge(b,a) 会得出不同结果（两台设备就分叉了）。
 */
export function pickNewer<T extends { updatedAt: number }>(
  a: T | undefined,
  b: T | undefined,
): T | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  const sa = stableStringify(a);
  const sb = stableStringify(b);
  return sa >= sb ? a : b;
}

/** 事件的同步身份。 */
export function eventKey(e: { ts: number }): string {
  return `event:${e.ts}`;
}

/** 习惯的同步身份。 */
export function customKey(id: string): string {
  return `custom:${id}`;
}

/** 墓碑的身份。 */
export function tombstoneKey(t: { kind: string; id: string }): string {
  return `${t.kind}:${t.id}`;
}

/** 合并的统计：界面上要说清"这次同步动了什么"。 */
export interface MergeStats {
  /** 远端有、本地没有的记录 */
  eventsAdded: number;
  /** 两边都有、远端更新的记录 */
  eventsUpdated: number;
  /** 被远端的删除标记删掉的记录 */
  eventsRemoved: number;
  /** 被远端覆盖的设置项 */
  settingsChanged: number;
  /** 远端有、本地没有的习惯 */
  customAdded: number;
  /** 两边都有、远端更新的习惯 */
  customUpdated: number;
  /** 被远端的删除标记删掉的习惯 */
  customRemoved: number;
}

export interface MergeResult {
  payload: SyncPayload;
  stats: MergeStats;
}

function emptyStats(): MergeStats {
  return {
    eventsAdded: 0,
    eventsUpdated: 0,
    eventsRemoved: 0,
    settingsChanged: 0,
    customAdded: 0,
    customUpdated: 0,
    customRemoved: 0,
  };
}

/**
 * 合成两份载荷。
 *
 * @param local  这台设备现在有的
 * @param remote 远端（另一台设备或服务器上）有的
 * @param deviceId 上传方（合并后由它写出去）
 */
export function mergePayloads(
  local: SyncPayload,
  remote: SyncPayload,
  deviceId: string = local.deviceId,
): MergeResult {
  const stats = emptyStats();

  /* 墓碑：并集，同一条取新的 */
  const tombs = new Map<string, SyncTombstone>();
  for (const t of [...local.tombstones, ...remote.tombstones]) {
    const key = tombstoneKey(t);
    const prev = tombs.get(key);
    const next = pickNewer(prev, t);
    if (next) tombs.set(key, next);
  }

  /*
   * 记录：并集，同一条取新的。
   *
   * 两边各建一张表再对，而不是混在一起逐条塞 ——
   * 混着塞分不清"这条只远端有"还是"两边都有"（统计会算重）。
   */
  const events = new Map<string, SyncEvent>();
  const localEvents = new Map(local.events.map((e) => [eventKey(e), e] as const));
  const remoteEvents = new Map(remote.events.map((e) => [eventKey(e), e] as const));
  for (const [key, l] of localEvents) {
    const r = remoteEvents.get(key);
    // 只本地有：原样留着（并集）
    if (!r) {
      events.set(key, l);
      continue;
    }
    const next = pickNewer(l, r);
    if (!next) continue;
    if (stableStringify(next) !== stableStringify(l)) stats.eventsUpdated++;
    events.set(key, next);
  }
  for (const [key, r] of remoteEvents) {
    if (localEvents.has(key)) continue;
    events.set(key, r);
    stats.eventsAdded++;
  }

  /* 删除标记压过记录：墓碑比记录新（或同刻）就删掉 */
  for (const [key, e] of [...events]) {
    const tomb = tombs.get(eventKey(e));
    if (tomb && tomb.updatedAt >= e.updatedAt) {
      events.delete(key);
      stats.eventsRemoved++;
    }
  }

  /* 设置：逐项后写为准 */
  const settings = new Map<string, SyncSetting>();
  const localSettings = new Map(local.settings.map((s) => [s.key, s] as const));
  const remoteSettings = new Map(remote.settings.map((s) => [s.key, s] as const));
  for (const [key, l] of localSettings) {
    const r = remoteSettings.get(key);
    if (!r) {
      settings.set(key, l);
      continue;
    }
    const next = pickNewer(l, r);
    if (!next) continue;
    if (stableStringify(next) !== stableStringify(l)) stats.settingsChanged++;
    settings.set(key, next);
  }
  for (const [key, r] of remoteSettings) {
    if (localSettings.has(key)) continue;
    settings.set(key, r);
    stats.settingsChanged++;
  }

  /* 习惯：并集，同一条取新的 */
  const customs = new Map<string, SyncCustom>();
  const localCustom = new Map(local.custom.map((c) => [customKey(c.id), c] as const));
  const remoteCustom = new Map(remote.custom.map((c) => [customKey(c.id), c] as const));
  for (const [key, l] of localCustom) {
    const r = remoteCustom.get(key);
    if (!r) {
      customs.set(key, l);
      continue;
    }
    const next = pickNewer(l, r);
    if (!next) continue;
    if (stableStringify(next) !== stableStringify(l)) stats.customUpdated++;
    customs.set(key, next);
  }
  for (const [key, r] of remoteCustom) {
    if (localCustom.has(key)) continue;
    customs.set(key, r);
    stats.customAdded++;
  }

  for (const [key, c] of [...customs]) {
    const tomb = tombs.get(customKey(c.id));
    if (tomb && tomb.updatedAt >= c.updatedAt) {
      customs.delete(key);
      stats.customRemoved++;
    }
  }

  return {
    payload: {
      v: SYNC_PAYLOAD_VERSION,
      deviceId,
      updatedAt: Math.max(local.updatedAt, remote.updatedAt),
      events: [...events.values()].sort((a, b) => a.ts - b.ts),
      tombstones: [...tombs.values()].sort((a, b) => a.updatedAt - b.updatedAt),
      settings: [...settings.values()].sort((a, b) => a.key.localeCompare(b.key)),
      custom: [...customs.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    },
    stats,
  };
}

/**
 * 把远端载荷并进本地载荷之前，先看一眼版本。
 *
 * 远端版本比本地新（对方 App 更新过）时不能硬合 —— 形状可能变了，
 * 合出来的数据是坏的。这种情况要如实告诉用户"对方版本更新了"。
 */
export function payloadVersionIssue(
  remote: SyncPayload,
  supported: number = SYNC_PAYLOAD_VERSION,
): string | null {
  if (typeof remote?.v !== "number") return "对方发来的数据没有版本号";
  if (remote.v > supported) return `对方的数据版本是 ${remote.v}，这台设备只认到 ${supported}`;
  return null;
}
