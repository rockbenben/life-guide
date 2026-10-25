/**
 * 应用菜单。
 *
 * 单独一个文件：菜单是「界面的一部分」，跟主进程的调度逻辑无关，
 * 混在一起会让 main.mjs 看不出主线。
 *
 * 模板在 menu-template.mjs（纯函数，能单测）；这一层才碰 electron。
 *
 * Windows / Linux 上模板是空的 —— 返回 null，主进程就会把菜单栏整个撤掉
 * （`Menu.setApplicationMenu(null)`）。macOS 上留最小的一组，系统的复制粘贴与
 * Cmd+Q 才有地方挂。
 */
import { Menu } from "electron";

import { buildMenuTemplate } from "./menu-template.mjs";

export function buildMenu(options = {}) {
  const isMac = process.platform === "darwin";
  const tpl = buildMenuTemplate({ ...options, isMac });
  return tpl.length ? Menu.buildFromTemplate(tpl) : null;
}
