/**
 * 应用菜单（只在 macOS 上有）。
 *
 * **Windows / Linux：没有菜单栏。** 换页靠窗口里那排导航（app/src/main.tsx 的
 * `.lg-nav`），菜单栏那种东西藏得深、又像另一个应用，用户在窗口里找不到路。
 * （macOS 例外：系统的复制粘贴、Cmd+Q 都挂在菜单上，抽掉菜单那些快捷键就废了，
 * 所以那边留最小的一组。）
 *
 * 单独一个文件是为了能单测：electron 包在普通 node 运行时里 require 会抛，
 * 所以「纯逻辑」和「碰 electron 的那一层」必须分开（electron 打包技能里的老规矩）。
 *
 * **「退出」得自己写**：角色的 quit 会被「关窗口=藏到托盘」那段拦住
 * （close 事件里 preventDefault 了），应用退不掉。退出要先把 app.isQuitting 置上。
 */
export function buildMenuTemplate({ isMac = false, quit = () => {} } = {}) {
  // Windows / Linux：不要菜单
  if (!isMac) return [];

  return [
    {
      role: "appMenu",
      submenu: [
        { label: "退出", accelerator: "CmdOrCtrl+Q", click: () => quit() },
      ],
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" },
      ],
    },
  ];
}
