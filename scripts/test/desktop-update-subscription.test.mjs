import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it("preload 退订只移除自己的更新监听器", () => {
  const ipcRenderer = new EventEmitter();
  const contextBridge = { exposeInMainWorld: vi.fn() };
  const preload = readFileSync(new URL("../../desktop/preload.cjs", import.meta.url), "utf8");
  runInNewContext(preload, { require: () => ({ contextBridge, ipcRenderer }) });
  const [, bridge] = contextBridge.exposeInMainWorld.mock.calls[0];
  const onFirst = vi.fn();
  const onSecond = vi.fn();
  const offFirst = bridge.onUpdateChanged(onFirst);
  const offSecond = bridge.onUpdateChanged(onSecond);
  const channel = "life-guide:update-changed";

  offFirst();
  offFirst();
  expect(ipcRenderer.listenerCount(channel)).toBe(1);
  const status = { state: "available", version: "9.8.7" };
  ipcRenderer.emit(channel, {}, status);
  expect(onFirst).not.toHaveBeenCalled();
  expect(onSecond).toHaveBeenCalledExactlyOnceWith(status);
  offSecond();
  expect(ipcRenderer.listenerCount(channel)).toBe(0);
});
