/**
 * 提醒：主进程的定时器 + 原生通知。
 *
 * 为什么不在页面里排：页面关了（或标签页被浏览器节流）就不响了。
 * 主进程是常驻的 —— 窗口关掉、App 还在，提醒照样到点弹出来。
 *
 * 排的是**渲染层算好的时刻**：日期算法只有一处（app/src/domain/reminders.ts），
 * 主进程不另写一份「下一次是几点」的算法（两处各写一份必然分叉）。
 * 响过之后主进程问渲染层要下一次（life-guide:reminder-due），
 * 渲染层不在时用随排程一起送来的备用几次（after）接着响。
 *
 * 「下一次是哪一刻、怎么排」这些纯逻辑在 reminder-timing.mjs（不 import electron，
 * 能用 node --test 直接跑）；这里只管 Electron 那边的事。
 */
import { BrowserWindow, Notification, ipcMain } from "electron";

import { advance, delayUntil, nextSpec, normalizeSpecs } from "./reminder-timing.mjs";

/**
 * 装上提醒这条链。
 *
 * @param {(id: string) => void} onDue 到点了：主进程问渲染层要下一次
 * @param {(event: object) => boolean} isTrusted IPC 是不是来自我们自己的页面
 * @returns {{ dispose: () => void }}
 */
export function installReminderBridge({ onDue, isTrusted = () => false }) {
  /** 待响的提醒（渲染层算好的时刻） */
  let specs = [];
  let timer = null;
  /** 活着的通知对象：被 GC 掉的话点击事件就不触发了（Electron 的老坑） */
  const shown = new Set();

  function showNotification(title, body) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body });
    shown.add(n);
    // 点通知就把窗口叫到前面
    n.on("click", () => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    });
    n.on("close", () => shown.delete(n));
    n.show();
  }

  /** 排下一次：所有提醒里最早的那一个。 */
  function arm() {
    if (timer) clearTimeout(timer);
    timer = null;
    const next = nextSpec(specs);
    if (!next) return;
    timer = setTimeout(() => {
      timer = null;
      // 到点了就响；没到点（定时器被上限截断了）就再排一次
      if (Date.parse(next.at) > Date.now()) {
        arm();
        return;
      }
      fire(next);
    }, delayUntil(next.at));
  }

  function fire(spec) {
    showNotification(spec.title, spec.body);
    // 这一条的下一次：先用自己的备用队列挪一位，再问渲染层要一份新的
    const { spec: next, index } = advance(specs, spec);
    if (index >= 0) {
      if (next) specs[index] = next;
      else specs.splice(index, 1);
    }
    arm();
    onDue(spec.id);
  }

  const onSet = (e, list) => {
    if (!isTrusted(e)) return;
    specs = normalizeSpecs(list);
    arm();
  };

  const onNotifyNow = (e, title, body) => {
    if (!isTrusted(e)) return;
    showNotification(String(title ?? ""), String(body ?? ""));
  };

  const onSupport = (e) => {
    e.returnValue = isTrusted(e) && Notification.isSupported();
  };

  ipcMain.on("life-guide:set-reminders", onSet);
  ipcMain.on("life-guide:notify-now", onNotifyNow);
  ipcMain.on("life-guide:reminder-support", onSupport);

  return {
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
      ipcMain.off("life-guide:set-reminders", onSet);
      ipcMain.off("life-guide:notify-now", onNotifyNow);
      ipcMain.off("life-guide:reminder-support", onSupport);
    },
  };
}
