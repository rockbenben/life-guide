/**
 * 菜单模板的测试（纯函数，不碰 electron）。
 *
 * 盯的是两件事：
 *   1. **Windows / Linux 上没有菜单** —— 换页靠窗口里那排导航
 *      （app/src/main.tsx 的 `.lg-nav`，三种形态都摆它）。
 *      原来菜单里有一组「页面」，桌面窗口把导航藏了：菜单成了唯一一条路，
 *      从手册回主页就没有一条看得见的路了。
 *   2. macOS 上留最小的一组：系统的复制粘贴与 Cmd+Q 要有地方挂，
 *      「退出」还得走自己的回调（角色的 quit 会被「关窗口=藏到托盘」拦下）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildMenuTemplate } from "./menu-template.mjs";

test("Windows / Linux：没有菜单（换页走窗口里那排导航）", () => {
  assert.deepEqual(buildMenuTemplate({ isMac: false }), []);
});

test("macOS：留着最小的一组，退出走自己的回调", () => {
  const tpl = buildMenuTemplate({ isMac: true, quit: () => {} });
  const app = tpl.find((m) => m.role === "appMenu");
  assert.ok(app, "macOS 上没有 appMenu");
  const quitItem = app.submenu.find((i) => i.label === "退出");
  assert.ok(quitItem, "没有「退出」这一项");
  assert.equal(quitItem.role, undefined, "「退出」不该用角色的 quit");

  // 编辑组：复制粘贴的快捷键全靠它
  const edit = tpl.find((m) => m.label === "编辑");
  assert.ok(edit, "没有「编辑」这一组");
  const roles = edit.submenu.filter((i) => i.role).map((i) => i.role);
  for (const r of ["copy", "paste", "cut", "selectAll"]) {
    assert.ok(roles.includes(r), `「编辑」里少了 ${r}`);
  }
});

test("「退出」真的会被调用", () => {
  let called = 0;
  const tpl = buildMenuTemplate({ isMac: true, quit: () => called++ });
  const app = tpl.find((m) => m.role === "appMenu");
  app.submenu.find((i) => i.label === "退出").click();
  assert.equal(called, 1);
});
