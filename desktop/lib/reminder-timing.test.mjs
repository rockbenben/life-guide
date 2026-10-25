/**
 * 提醒的纯逻辑测试（node --test）。
 *
 * 为什么单独测：这些是「什么时候该响」的判断 —— 出错的话要么不响、
 * 要么响个没完。而且它们不 import electron，所以不用起一个 Electron 进程就能跑。
 *
 * 跑法：npm run test:desktop
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_DELAY,
  advance,
  delayUntil,
  nextSpec,
  normalizeSpecs,
} from "./reminder-timing.mjs";

test("坏排程丢掉，好的留下", () => {
  const specs = normalizeSpecs([
    { id: "a", at: "2026-10-22T07:00:00Z", title: "t", body: "b", after: [] },
    { id: "bad", at: "not-a-date" },
    null,
    { id: "b", at: "2026-10-23T07:00:00Z" },
  ]);
  assert.deepStrictEqual(
    specs.map((s) => s.id),
    ["a", "b"],
  );
});

test("下一次是待响里最早的那一个（过点的不要）", () => {
  const now = Date.parse("2026-10-21T09:00:00Z");
  const specs = [
    { id: "late", at: "2026-10-22T07:00:00Z" },
    { id: "soon", at: "2026-10-21T21:00:00Z" },
    { id: "past", at: "2026-10-21T07:00:00Z" },
  ];
  assert.equal(nextSpec(specs, now).id, "soon");
  assert.equal(nextSpec([], now), null);
});

test("响过之后挪到备用队列的下一个", () => {
  const spec = { id: "a", at: "2026-10-21T09:00:00Z", after: ["2026-10-22T09:00:00Z", "2026-10-23T09:00:00Z"] };
  const specs = [spec];
  const { spec: next, index } = advance(specs, spec);
  assert.equal(index, 0);
  assert.equal(next.at, "2026-10-22T09:00:00Z");
  assert.deepStrictEqual(next.after, ["2026-10-23T09:00:00Z"]);
});

test("备用队列空了就把这条撤掉", () => {
  const spec = { id: "a", at: "2026-10-21T09:00:00Z", after: [] };
  const { spec: next, index } = advance([spec], spec);
  assert.equal(next, null);
  assert.equal(index, 0);
});

test("延时封顶在 24.8 天以内（超了 Node 会立刻触发）", () => {
  const now = Date.parse("2026-10-21T09:00:00Z");
  assert.equal(delayUntil("2026-10-21T09:00:30Z", now), 30_000);
  // 三十天后
  const far = delayUntil("2026-11-20T09:00:00Z", now);
  assert.equal(far, MAX_DELAY);
  assert.ok(far < 2 ** 31);
});

test("已经到点的排程不用再等", () => {
  const now = Date.parse("2026-10-21T09:00:00Z");
  assert.equal(delayUntil("2026-10-21T08:00:00Z", now), 0);
  assert.equal(delayUntil("不是日期", now), 0);
});
