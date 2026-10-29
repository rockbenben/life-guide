/**
 * 旧 id 的迁移：内容层合并了卡之后，把用户数据里的旧 id 换成新 id。
 *
 * **为什么要在 App 里做**：用户的盖章记录、日常清单里存的是卡 id。
 * 那些 id 是内容层定的（内容层合并 → id 变），但数据在用户这台设备上 ——
 * 内容层碰不到，只能 App 自己认领（靠卡里的 `formerIds`）。
 *
 * **什么时候跑**：卡片加载完之后跑一次（main.tsx）。
 * 跑多少遍都一样 —— 迁完的 id 已经不是旧 id 了，再跑是空操作。
 */
import {
  allEvents,
  getSetting,
  migrateEventCardId,
  setSetting,
} from "./db.ts";
import {
  migrateIdMap,
  migrateIds,
  resolveFormerId,
  type FormerCard,
} from "../domain/former.ts";

export interface MigrationResult {
  /** 认领回来的盖章记录条数 */
  events: number;
  /** 清单里改掉的 id 个数 */
  routine: number;
  /** 频率覆盖改掉的项数 */
  cadence: number;
  /** 「今天不做」改掉的项数 */
  skipToday: number;
}

/** 两个表一样吗（键与值都逐个比）。 */
function sameRecord(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => a[k] === b[k]);
}

/**
 * 把用户数据里的旧卡 id 换成新 id。
 *
 * 没有旧 id 的卡（绝大多数）走一遍也是空操作 —— 但**别在每次渲染时跑**：
 * 记录有几千条时那是一次全表扫描。要跑就在卡片加载完之后跑一次。
 */
export async function migrateUserData(cards: FormerCard[]): Promise<MigrationResult> {
  const result: MigrationResult = { events: 0, routine: 0, cadence: 0, skipToday: 0 };

  /*
   * 没有任何卡带 formerIds → 不用扫。
   *
   * 扫一次是**全表读**（几千条记录）。每次启动都扫一遍是白花 ——
   * 绝大多数时候根本没有卡被合并过。
   */
  const map = new Map<string, string>();
  for (const c of cards) {
    for (const old of c.formerIds ?? []) {
      if (old !== c.id) map.set(old, c.id);
    }
  }
  if (!map.size) return result;

  /* 盖章记录：卡 id 换了，记录认领回去 */
  for (const e of await allEvents()) {
    const next = resolveFormerId(map, e.cardId);
    if (next !== e.cardId) {
      await migrateEventCardId(e.ts, next);
      result.events++;
    }
  }

  /* 日常清单：换 id 并去重（合并后两张卡会变成同一个 id） */
  const routine = await getSetting<string[]>("myRoutine", []);
  const nextRoutine = migrateIds(map, routine);
  if (
    nextRoutine.length !== routine.length ||
    nextRoutine.some((id, i) => id !== routine[i])
  ) {
    await setSetting("myRoutine", nextRoutine);
    result.routine = routine.filter((id) => resolveFormerId(map, id) !== id).length;
  }

  /* 频率覆盖：键是卡 id */
  const cadence = await getSetting<Record<string, string>>("cadence", {});
  const nextCadence = migrateIdMap(map, cadence);
  if (!sameRecord(cadence, nextCadence)) {
    await setSetting("cadence", nextCadence);
    result.cadence = Object.keys(cadence).filter((k) => resolveFormerId(map, k) !== k).length;
  }

  /* 「今天不做」：键是卡 id */
  const skipToday = await getSetting<Record<string, string>>("skipToday", {});
  const nextSkip = migrateIdMap(map, skipToday);
  if (!sameRecord(skipToday, nextSkip)) {
    await setSetting("skipToday", nextSkip);
    result.skipToday = Object.keys(skipToday).filter((k) => resolveFormerId(map, k) !== k).length;
  }

  return result;
}
