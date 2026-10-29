/**
 * 旧 id 的认领：卡改了名或被合并之后，用户的记录还指着旧 id。
 *
 * **为什么需要它**：卡片 id 是发布后不改的（AGENTS.md §5）——
 * 用户攒下来的盖章记录、日常清单里存的都是 id。
 * 内容层要合并两张卡（"这件事拆得太散了"）就得换 id，
 * 换了 id 而不留一手，用户那几十天的记录就悬空了。
 *
 * 内容层在合并后把旧 id 写进新卡的 `formerIds`，这里负责：
 *   · 建一张「旧 id → 现在这张卡」的表；
 *   · 把用户数据里的旧 id 换成新 id（记录、清单、频率、跳过）。
 *
 * 纯函数，不碰存储 —— 存储那半在 data/migrate.ts。
 */

/** 一张卡最少要有的东西（这里只用到 id 与 formerIds）。 */
export interface FormerCard {
  id: string;
  formerIds?: string[];
}

/**
 * 旧 id → 现在的卡 id。
 *
 * **链式也要解开**：A 合并进 B，后来 B 又合并进 C，
 * 表里是 A→B、B→C；查 A 要一路走到 C。
 * 环不会发生（内容层不会把卡并进自己的旧 id），但仍然防一手：
 * 最多走 10 步，走不完就按原样返回（宁可认不回来，也别绕死）。
 */
export function buildFormerMap(cards: FormerCard[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const c of cards) {
    for (const old of c.formerIds ?? []) {
      if (old === c.id) continue; // 自己指向自己是写错了，忽略
      map.set(old, c.id);
    }
  }
  return map;
}

/** 旧 id 换成新 id；不是旧 id 就原样返回。 */
export function resolveFormerId(map: Map<string, string>, id: string): string {
  let cur = id;
  for (let i = 0; i < 10; i++) {
    const next = map.get(cur);
    if (!next || next === cur) break;
    cur = next;
  }
  return cur;
}

/**
 * 一串 id 迁移（旧 id → 新 id），并去掉重复。
 *
 * 去重是必须的：两张卡合并后，清单里会出现两个同一个 id ——
 * 清单的次序是用户排的，重复项会让同一张卡在今天页出现两遍。
 * **保留第一次出现的次序**（用户排的顺序不能乱）。
 */
export function migrateIds(map: Map<string, string>, ids: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    const next = resolveFormerId(map, id);
    if (seen.has(next)) continue;
    seen.add(next);
    out.push(next);
  }
  return out;
}

/**
 * 一个「旧 id → 新 id」的映射表迁移（频率覆盖、今天不做都是这种表）。
 *
 * 键迁过去之后可能撞车（两张卡合并，两边都设过频率）：
 * **保留后写的那个**（映射表的迭代顺序 = 写入顺序，后写的赢），
 * 这与合并规则「谁新谁赢」是同一条口径。
 */
export function migrateIdMap(
  map: Map<string, string>,
  record: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    const next = resolveFormerId(map, key);
    // 后写的赢：同 key 再写一次就覆盖
    out[next] = value;
  }
  return out;
}
