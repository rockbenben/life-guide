/**
 * 桌面端主进程：只管生命周期。
 *
 * 界面是同一份 PWA 构建产物（app/dist），这边只提供三样东西：
 *   1. 一个窗口（app:// 伺服构建产物，origin 稳定，IndexedDB 不会丢）
 *   2. 一条提醒通道（主进程定时器 + 原生通知，窗口关了也响）
 *   3. 一个托盘（关窗口 = 藏起来，不是退出 —— 退了提醒就跟着没了）
 *
 * 拆开的几块在 lib/ 下：协议、提醒、托盘、菜单、纯逻辑（提醒时刻 / 窗口状态 / 存储）。
 *
 * 安全口径：渲染层不开 nodeIntegration、contextIsolation 打开、
 * sandbox 打开 —— 页面里跑的是我们自己构建的静态资源，没有理由给更高权限。
 */
import { app, BrowserWindow, Menu, shell } from "electron";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

import { registerAppScheme, serveBundle } from "./lib/protocol.mjs";
import { installReminderBridge } from "./lib/reminders.mjs";
import { installUpdateBridge } from "./lib/updater.mjs";
import { navigationDecision, isTrustedSender } from "./lib/navigation.mjs";
import { setupTray } from "./lib/tray.mjs";
import { buildMenu } from "./lib/menu.mjs";
import { createStore } from "./lib/store.mjs";
import { createWindowStateKeeper } from "./lib/window-state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Electron 自带的那些菜单（文件 / 编辑 / 窗口）跟着这个开关变语言。
 *
 * 不设的话它们跟着系统语言走 —— 界面是中文、菜单是英文，一眼就看出是两套东西。
 * 要在 ready 之前设（Electron 读它来挑内置菜单的字符串）。
 */
app.commandLine.appendSwitch("lang", "zh-CN");

/**
 * 构建产物在哪：
 *   开发时 —— 仓库里的 app/dist
 *   打包后 —— resources/app（electron-builder 的 extraResources）
 */
const bundleDir = app.isPackaged
  ? path.join(process.resourcesPath, "app")
  : path.join(here, "..", "app", "dist");
const devServer = process.env.LIFE_GUIDE_DEV_SERVER;

/** 开发时按 X 键要能结束进程（别把开发进程孤零零留在托盘里） */
const isDev = Boolean(devServer);

/** 纸色（app/src/style.css 的 --lg-paper）：窗口刚开出来时那一下的颜色要对 */
const PAPER = "#fbf6ec";

/** 图标（brand/mark.svg 那张，打包时 electron-builder 也用 build/ 里那份） */
function iconPath(name = "icon.png") {
  const p = path.join(here, "build", name);
  return fs.existsSync(p) ? p : undefined;
}

// 声明 scheme 的特权必须在 ready 之前
registerAppScheme();

/** 单实例：第二次启动就把已有窗口叫到前面。 */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      if (!win.isVisible()) win.show();
      win.focus();
    }
  });
}

/** 窗口上次的样子（大小、位置） */
const store = createStore(app.getPath("userData"));
const windowState = createWindowStateKeeper(store);

/** @type {import("electron").BrowserWindow|null} */
let win = null;
/** 托盘：必须留着一个变量持有它，被 GC 掉图标就消失 */
let tray = null;

function createWindow() {
  const bounds = windowState.saved;
  const w = new BrowserWindow({
    width: bounds.width ?? 1180,
    height: bounds.height ?? 860,
    x: bounds.x,
    y: bounds.y,
    minWidth: 480,
    minHeight: 520,
    backgroundColor: PAPER,
    title: "生活指南",
    show: false,
    icon: iconPath(),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win = w;

  w.once("ready-to-show", () => w.show());
  windowState.track(w);

  // 站外链接交给系统浏览器，别在应用窗口里打开
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (navigationDecision(url, devServer) === "external") shell.openExternal(url);
    return { action: "deny" };
  });

  // 同窗口导航也守着：内容里的相对链接已经由应用自己处理，
  // 剩下能走到这里的只该是站外地址 —— 交系统浏览器，窗口本身不许离开 app://。
  const guardNavigation = (event, url) => {
    const decision = navigationDecision(url, devServer);
    if (decision === "allow") return;
    event.preventDefault();
    if (decision === "external") void shell.openExternal(url);
  };
  w.webContents.on("will-navigate", guardNavigation);
  w.webContents.on("will-redirect", guardNavigation);

  // 关窗口 = 藏到托盘 —— 除非真的要退出、托盘没起来、或在开发
  w.on("close", (e) => {
    if (!isDev && !app.isQuitting && tray) {
      e.preventDefault();
      w.hide();
    }
  });

  if (devServer) {
    void w.loadURL(devServer);
  } else {
    void w.loadURL("app://bundle/index.html");
  }
  return w;
}

/**
 * 提醒通道：主进程定时器到点弹原生通知，并回头问渲染层要下一次。
 * 「问渲染层」这条在 lib/reminders.mjs 里，这里只把它接到窗口上。
 */
const reminders = installReminderBridge({
  onDue: (id) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.isDestroyed()) {
      w.webContents.send("life-guide:reminder-due", id);
    }
  },
  isTrusted: (event) => isTrustedSender(event, devServer),
});

/**
 * 自动更新：主进程去读更新清单，状态推给渲染层（设置页里显示）。
 *
 * 只有打包后的应用才参与；开发时与免安装版自动退化成「不支持」，
 * 界面上照实说明理由。
 */
const updater = installUpdateBridge({
  onStatus: (status) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w && !w.isDestroyed()) {
      w.webContents.send("life-guide:update-changed", status);
    }
  },
  isTrusted: (event) => isTrustedSender(event, devServer),
});

app.whenReady().then(() => {
  serveBundle(bundleDir);
  /**
   * 菜单：Windows / Linux 上没有菜单栏（换页靠窗口里那排导航），
   * macOS 上留最小的一组。buildMenu 在该没有的平台返回 null，
   * `setApplicationMenu(null)` 就是把菜单栏整个撤掉。
   */
  Menu.setApplicationMenu(
    buildMenu({
      /**
       * 退出：先把 app.isQuitting 置上。
       *
       * 「关窗口 = 藏到托盘」那段在 close 事件里 preventDefault 了，
       * 不置这个标志的话 quit() 会被它拦下 —— 点了退出，应用还活着。
       */
      quit: () => {
        app.isQuitting = true;
        app.quit();
      },
    }),
  );
  createWindow();

  // 托盘起不来就别装样子：起不来就退（免得有个关不掉的僵尸进程）
  const trayIcon = iconPath("tray.png") ?? iconPath();
  if (trayIcon) {
    try {
      tray = setupTray({
        app,
        getWindow: () => win,
        iconPath: trayIcon,
      });
    } catch (err) {
      console.error("托盘初始化失败，关窗口会直接退出：", err);
      tray = null;
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  // 有托盘就留在后台（提醒还得响）；没托盘或开发模式才退出
  if (isDev || !tray) app.quit();
});

app.on("will-quit", () => {
  reminders.dispose();
  updater.dispose();
});
