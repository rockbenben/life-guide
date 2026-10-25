/**
 * 提醒的纯逻辑：下一次是哪一刻、怎么排、响过之后往哪挪。
 *
 * **这个文件不能 import electron** —— 纯逻辑要在 `node --test` 里能直接跑
 * （require("electron") 出了 Electron 运行时就会抛）。
 * Electron 那边的事（弹通知、IPC）在 reminders.mjs。
 */

/**
 * setTimeout 的上限（约 24.8 天）。超了 Node 会**立刻**触发并打警告 ——
 * 「每隔 30 天」那种提醒就会当场响一次（然后再补几次，然后哑掉）。
 * 所以定时器只排到上限，醒来发现还没到点就再排一次。
 */
export const MAX_DELAY = 2 ** 31 - 1;

/** 把一条排程整理成干净的样子（坏值丢掉）。 */
export function normalizeSpecs(list) {
  return (Array.isArray(list) ? list : [])
    .filter((s) => s && typeof s.id === "string" && Number.isFinite(Date.parse(s.at)))
    .map((s) => ({
      id: s.id,
      at: s.at,
      title: String(s.title ?? ""),
      body: String(s.body ?? ""),
      after: Array.isArray(s.after)
        ? s.after.filter((x) => Number.isFinite(Date.parse(x)))
        : [],
    }));
}

/**
 * 待响里最早的那一个。
 *
 * @param {Array<{at: string}>} specs
 * @param {number} now 毫秒
 */
export function nextSpec(specs, now = Date.now()) {
  return (
    specs
      .filter((s) => Date.parse(s.at) > now)
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0] ?? null
  );
}

/**
 * 这一条响过之后，它自己队列里的下一次是哪一刻。
 *
 * 渲染层算好时刻时顺手带了几次备用（after）：渲染层不在时，主进程靠它接着响。
 *
 * @returns {{spec: object|null, index: number}} 新的一条与它在列表里的位置
 */
export function advance(specs, spec) {
  const i = specs.indexOf(spec);
  if (i < 0) return { spec: null, index: -1 };
  const after = Array.isArray(spec.after) ? spec.after : [];
  if (after.length) {
    return { spec: { ...spec, at: after[0], after: after.slice(1) }, index: i };
  }
  return { spec: null, index: i };
}

/**
 * 排一次要等多久（封顶）。
 *
 * @returns {number} 毫秒；0 表示不用排
 */
export function delayUntil(at, now = Date.now()) {
  const target = Date.parse(at);
  if (!Number.isFinite(target)) return 0;
  const delay = target - now;
  if (delay <= 0) return 0;
  return Math.min(delay, MAX_DELAY);
}
