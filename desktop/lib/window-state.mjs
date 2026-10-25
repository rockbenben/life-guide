/**
 * 记住窗口上次的样子（大小、位置、是否最大化）。
 *
 * 纯逻辑：不 import electron（win 由外面传进来），所以能在 node --test 里跑。
 */
export const DEFAULT_BOUNDS = { width: 1180, height: 860 };

/**
 * @param {{get: (key: string, fallback: any) => any, set: (key: string, value: any) => void}} store
 */
export function createWindowStateKeeper(store) {
  const saved = store.get("windowState", { ...DEFAULT_BOUNDS });

  function track(win) {
    let last = null;
    const save = () => {
      const maximized = win.isMaximized();
      // 最大化时记的是**普通状态**的尺寸：否则下次开出来就是全屏大小，
      // 再也回不去原来的样子了
      const bounds = maximized ? win.getNormalBounds?.() ?? saved : win.getBounds();
      const next = {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width || saved.width || DEFAULT_BOUNDS.width,
        height: bounds.height || saved.height || DEFAULT_BOUNDS.height,
        maximized,
      };
      // 拖一次窗口会连着来几十个 move 事件 —— 位置没变就别写盘
      if (
        last &&
        last.x === next.x &&
        last.y === next.y &&
        last.width === next.width &&
        last.height === next.height &&
        last.maximized === next.maximized
      ) {
        return;
      }
      last = next;
      store.set("windowState", next);
    };
    win.on("resize", save);
    win.on("move", save);
    win.on("maximize", save);
    win.on("unmaximize", save);
    if (saved.maximized) win.maximize();
    return save;
  }

  return { saved, track };
}
