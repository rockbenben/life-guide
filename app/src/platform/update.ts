/**
 * 自动更新：平台层（跟 notify.ts 一个套路 —— 上层只跟状态说话）。
 *
 * 桌面端才有自动更新：主进程那边查 GitHub Releases 的更新清单，
 * 这边只把状态转过去。浏览器与手机走的是各自的更新办法
 * （浏览器更新 PWA 本身，手机更新 APK），不归这里管。
 */
import type { UpdateStatus } from "../domain/update.ts";

/** Electron 预加载脚本暴露的那条缝（见 desktop/preload.cjs）。 */
interface DesktopUpdateBridge {
  isDesktop?: boolean;
  updateStatus?: () => Promise<UpdateStatus>;
  checkForUpdate?: () => Promise<UpdateStatus>;
  downloadUpdate?: () => Promise<UpdateStatus>;
  installUpdate?: () => Promise<UpdateStatus>;
  onUpdateChanged?: (cb: (s: UpdateStatus) => void) => void;
}

function bridge(): DesktopUpdateBridge | undefined {
  const w = window as unknown as { lifeGuide?: DesktopUpdateBridge };
  return w.lifeGuide;
}

/** 这个形态有没有自动更新这一说。 */
export function hasUpdater(): boolean {
  return !!bridge()?.updateStatus;
}

/** 现在的状态。 */
export async function updateStatus(): Promise<UpdateStatus> {
  const b = bridge();
  if (!b?.updateStatus) {
    return { state: "unsupported", note: "这个形态不自动更新" };
  }
  try {
    return await b.updateStatus();
  } catch (err) {
    return {
      state: "error",
      error: `桌面端的更新服务没应答（${err instanceof Error ? err.message : String(err)}）`,
    };
  }
}

/** 查一次有没有新版本。 */
export async function checkForUpdate(): Promise<UpdateStatus> {
  const b = bridge();
  if (!b?.checkForUpdate) return updateStatus();
  try {
    return await b.checkForUpdate();
  } catch (err) {
    return {
      state: "error",
      error: `桌面端的更新服务没应答（${err instanceof Error ? err.message : String(err)}）`,
    };
  }
}

/** 下载新版本（不自动下，得用户点了才下）。 */
export async function downloadUpdate(): Promise<UpdateStatus> {
  const b = bridge();
  if (!b?.downloadUpdate) return updateStatus();
  try {
    return await b.downloadUpdate();
  } catch (err) {
    return {
      state: "error",
      error: `桌面端的更新服务没应答（${err instanceof Error ? err.message : String(err)}）`,
    };
  }
}

/** 下载好了，重启装上。 */
export async function installUpdate(): Promise<UpdateStatus> {
  const b = bridge();
  if (!b?.installUpdate) return updateStatus();
  try {
    return await b.installUpdate();
  } catch (err) {
    return {
      state: "error",
      error: `桌面端的更新服务没应答（${err instanceof Error ? err.message : String(err)}）`,
    };
  }
}

/** 状态变了就通知一下（主进程推过来的）。 */
export function onUpdateChanged(cb: (s: UpdateStatus) => void): void {
  bridge()?.onUpdateChanged?.(cb);
}
