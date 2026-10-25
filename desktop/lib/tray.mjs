/**
 * 托盘：窗口关掉之后 App 还活着，提醒才响得出来。
 *
 * 没有托盘的话，关掉窗口 = 进程退出 = 提醒跟着没了 ——
 * 那「窗口关了也响」就只是句空话（AGENTS.md §4.2 承诺过这件事）。
 *
 * 坑：Tray 必须留着一个变量持有它 —— 被 GC 掉的 Tray 图标会消失（Electron 老坑）。
 */
import { Menu, Tray, nativeImage } from "electron";

/**
 * @param {{app: any, getWindow: () => any, iconPath: string}} deps
 */
export function setupTray({ app, getWindow, iconPath }) {
  const tray = new Tray(nativeImage.createFromPath(iconPath));
  tray.setToolTip("生活指南");

  const show = () => {
    const win = getWindow();
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  };

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开生活指南", click: show },
      { type: "separator" },
      // 菜单栏撤了之后，这两件事挪到托盘里 —— 否则就真没地方了
      {
        label: "重新加载",
        click: () => {
          const win = getWindow();
          if (win && !win.isDestroyed()) win.webContents.reload();
        },
      },
      {
        label: "开发者工具",
        click: () => {
          const win = getWindow();
          if (win && !win.isDestroyed()) win.webContents.toggleDevTools();
        },
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on("click", show);
  return tray;
}
