/**
 * 自动更新：主进程这一侧。
 *
 * 用 electron-updater（electron-builder 自带的更新器）：
 * 打包时 electron-builder 把 app-update.yml 写进产物，里面记着更新源
 * （GitHub Releases）与当前版本；运行时它去 releases/latest/download/latest.yml
 * 读新版本清单。清单里的 sha512 会拿来核对下载到的文件。
 *
 * 三条规矩（每条都有原因）：
 *
 *   1. **不自动下载**。安装包 110 MB，用户没说要更新就先下 110 MB 是不礼貌的。
 *      所以启动时只**查**，下不下载由用户点。
 *   2. **免安装版不参与**。portable 那一版没有安装目录，
 *      而 electron-updater 的安装动作依赖安装布局 —— 硬跑会把应用装到别处。
 *      免安装版的 SFX 会设 PORTABLE_EXECUTABLE_DIR，靠它认出来。
 *   3. **签了名才验签**。app-update.yml 里没有 publisherName 时，
 *      electron-updater 会**跳过**签名校验（这正是未签名应用的正常路径）。
 *      完整性靠清单里的 sha512 核对下载到的文件。
 */
import { app, Notification, ipcMain } from "electron";
import { createRequire } from "node:module";

import { initialUpdateStatus, reduceUpdate, friendlyUpdateError } from "./update-events.mjs";

/**
 * electron-updater 是 CommonJS 包，而 autoUpdater 是用 defineProperty 定义的 getter ——
 * ESM 的具名导入靠静态分析（cjs-module-lexer）认出导出，认不出来就会抛
 * 「does not provide an export named 'autoUpdater'」，**整个应用加载失败**。
 * 所以走 require：拿到 module.exports，再取属性。
 */
const require = createRequire(import.meta.url);
const { autoUpdater } = require("electron-updater");

/**
 * 这个形态能不能自动更新。不能的话给一句**照实说**的理由（界面上会显示）。
 *
 * @returns {{ ok: true } | { ok: false, note: string }}
 */
export function updateSupport() {
  if (!app.isPackaged) {
    return { ok: false, note: "开发时不检查更新" };
  }
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return { ok: false, note: "免安装版不能自动更新，用安装版才有" };
  }
  // macOS 的 Squirrel.Mac 只接受签过名的应用；现在还没有 Developer ID，
  // 所以构建出来的 macOS 版只能手动换新包。签名接上后再放开这里。
  if (process.platform === "darwin") {
    return { ok: false, note: "macOS 版还没签名，不能自动更新；请手动下载新版" };
  }
  if (process.platform !== "win32") {
    return { ok: false, note: "这个平台暂时不能自动更新" };
  }
  return { ok: true };
}

/**
 * 装上更新这条链。
 *
 * @param {(status: {state:string, version?:string, progress?:number, error?:string, note?:string}) => void} onStatus 状态变了
 * @param {(event: object) => boolean} isTrusted IPC 是不是来自我们自己的页面
 * @returns {{ status: () => object, dispose: () => void }}
 */
export function installUpdateBridge({ onStatus, isTrusted = () => false }) {
  const requireTrusted = (event) => {
    if (!isTrusted(event)) throw new Error("untrusted sender");
  };
  const support = updateSupport();
  let status = support.ok
    ? { state: "idle" }
    : initialUpdateStatus(support.note);

  const push = (event) => {
    status = reduceUpdate(status, event);
    onStatus(status);
    return status;
  };

  /** 启动时查一次：查到了就弹一条系统通知（用户没开设置页也能知道）。 */
  const notifyAvailable = (version) => {
    if (!Notification.isSupported()) return;
    const n = new Notification({
      title: "生活指南有新版本",
      body: `${version} —— 到「设置」里就能更新`,
    });
    n.show();
  };

  if (support.ok) {
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on("checking-for-update", () => push({ type: "checking" }));
    autoUpdater.on("update-available", (info) => {
      push({ type: "available", version: info?.version });
      notifyAvailable(info?.version ?? "");
    });
    autoUpdater.on("update-not-available", (info) =>
      push({ type: "latest", version: info?.version }),
    );
    autoUpdater.on("download-progress", (p) =>
      push({ type: "progress", percent: p?.percent }),
    );
    autoUpdater.on("update-downloaded", (info) =>
      push({ type: "downloaded", version: info?.version }),
    );
    autoUpdater.on("error", (err) =>
      push({
        type: "error",
        message: friendlyUpdateError(err),
      }),
    );
  }

  ipcMain.handle("life-guide:update-status", (event) => {
    requireTrusted(event);
    return status;
  });

  ipcMain.handle("life-guide:update-check", async (event) => {
    requireTrusted(event);
    if (!support.ok) return status;
    push({ type: "checking" });
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      push({ type: "error", message: friendlyUpdateError(err) });
    }
    return status;
  });

  ipcMain.handle("life-guide:update-download", async (event) => {
    requireTrusted(event);
    if (!support.ok) return status;
    push({ type: "checking" });
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      push({ type: "error", message: friendlyUpdateError(err) });
    }
    return status;
  });

  ipcMain.handle("life-guide:update-install", async (event) => {
    requireTrusted(event);
    if (!support.ok) return status;
    push({ type: "updating" });
    // isSilent=false：让安装器按正常样子跑（用户看得见它在做什么）
    // isForceRunAfter=true：装完自动把应用再打开
    autoUpdater.quitAndInstall(false, true);
    return status;
  });

  // 启动后查一次。查不到也不打扰用户 —— 只有真查到新版本才弹通知。
  if (support.ok) {
    setTimeout(() => {
      void autoUpdater.checkForUpdates().catch(() => {
        // 连不上更新源（比如仓库还没公开）不是错误状态，
        // 界面上的「检查更新」按钮会自己再说一遍。
      });
    }, 5000);
  }

  return {
    status: () => status,
    dispose() {
      ipcMain.removeHandler("life-guide:update-status");
      ipcMain.removeHandler("life-guide:update-check");
      ipcMain.removeHandler("life-guide:update-download");
      ipcMain.removeHandler("life-guide:update-install");
    },
  };
}
