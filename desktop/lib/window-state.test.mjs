/**
 * 窗口状态记忆的测试（node --test）。
 *
 * 假窗口 + 内存 store：不需要 Electron，也不需要真的拖窗口。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createWindowStateKeeper, DEFAULT_BOUNDS } from "./window-state.mjs";

function memStore(init = {}) {
  const data = { ...init };
  return {
    get: (k, fb) => (data[k] !== undefined ? data[k] : fb),
    set: (k, v) => {
      data[k] = v;
    },
    raw: () => data,
  };
}

function fakeWindow({ bounds = { x: 10, y: 20, width: 900, height: 700 }, maximized = false } = {}) {
  const handlers = {};
  return {
    bounds,
    maximized,
    maximizeCalled: false,
    on(ev, fn) {
      handlers[ev] = handlers[ev] || [];
      handlers[ev].push(fn);
    },
    _fire(ev) {
      for (const fn of handlers[ev] || []) fn();
    },
    isMaximized: () => maximized,
    getBounds: () => bounds,
    getNormalBounds: () => bounds,
    maximize() {
      this.maximizeCalled = true;
    },
  };
}

test("没存过时用默认尺寸", () => {
  const saved = createWindowStateKeeper(memStore()).saved;
  assert.equal(saved.width, DEFAULT_BOUNDS.width);
  assert.equal(saved.height, DEFAULT_BOUNDS.height);
});

test("改大小会存下来", () => {
  const store = memStore();
  const win = fakeWindow();
  createWindowStateKeeper(store).track(win);
  win._fire("resize");
  const s = store.raw().windowState;
  assert.equal(s.width, 900);
  assert.equal(s.height, 700);
  assert.equal(s.maximized, false);
});

test("最大化时记的是普通尺寸（不然下次开出来回不去）", () => {
  const store = memStore();
  const win = fakeWindow({ maximized: true });
  createWindowStateKeeper(store).track(win);
  win._fire("resize");
  const s = store.raw().windowState;
  assert.equal(s.maximized, true);
  assert.equal(s.width, 900); // 不是 undefined
});

test("存过「最大化」的话，下次开出来就是最大化", () => {
  const win = fakeWindow();
  const keeper = createWindowStateKeeper(
    memStore({ windowState: { width: 800, height: 600, maximized: true } }),
  );
  keeper.track(win);
  assert.equal(win.maximizeCalled, true);
});
