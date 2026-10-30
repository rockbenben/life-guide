/**
 * 预加载脚本：在页面与 Node 之间开一条极窄的缝。
 *
 * 只暴露三件事：提醒（页面要的就是「到点弹通知」）、自动更新、
 * WebDAV 请求（局域网自建的那台服务器）。别的能力主进程自己就能做
 * （站外链接走窗口的 open handler，导出目录走系统 API），不必在页面里开权限。
 * contextIsolation 是开的，页面拿不到 require / process。
 *
 * 提醒为什么要走这条缝：主进程才有系统级的定时器与原生通知。
 * 页面里的 setTimeout 在窗口关掉就没了，而「关掉窗口也该响」正是桌面端的用处。
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("lifeGuide", {
  /** 页面靠它认出自己跑在桌面壳里 */
  isDesktop: true,
  /** 排程提醒：交给主进程的定时器，到点发原生通知 */
  setReminders: (specs) => ipcRenderer.send("life-guide:set-reminders", specs),
  /** 立刻发一条（设置页的「试一下」） */
  notifyNow: (title, body) => ipcRenderer.send("life-guide:notify-now", title, body),
  /** 这个系统有没有可用的通知通道 */
  reminderSupport: () => ipcRenderer.sendSync("life-guide:reminder-support"),
  /**
   * 提醒到点了：主进程问渲染层要下一次。
   * 渲染层答了（重新排一份）才会一直响下去 —— 别当成单向通知。
   */
  onReminderDue: (cb) => ipcRenderer.on("life-guide:reminder-due", (_e, id) => cb(id)),
  /**
   * 自动更新：查、下载、重启装上。
   *
   * 同样是极窄的一条缝：主进程负责去 GitHub Releases 读更新清单，
   * 页面只管说「查一下 / 下载 / 装上」。
   */
  updateStatus: () => ipcRenderer.invoke("life-guide:update-status"),
  checkForUpdate: () => ipcRenderer.invoke("life-guide:update-check"),
  downloadUpdate: () => ipcRenderer.invoke("life-guide:update-download"),
  installUpdate: () => ipcRenderer.invoke("life-guide:update-install"),
  /** 状态变了：主进程推过来 */
  onUpdateChanged: (cb) => ipcRenderer.on("life-guide:update-changed", (_e, s) => cb(s)),
  /**
   * WebDAV 请求：交给主进程发。
   *
   * 为什么不放在渲染层直接 fetch：渲染层是 `app://` 源，跨源请求要过 CORS，
   * 而自建 WebDAV（nginx dav、mod_dav、NAS 自带的）**默认不发**
   * `Access-Control-Allow-Origin` —— 实测 Electron 45 直接 "blocked by CORS policy"。
   * 主进程用 Node 的 http，不受同源策略管，局域网里的 `http://192.168.x.x` 因此能用。
   */
  davRequest: (req) => ipcRenderer.invoke("life-guide:dav-request", req),
});
