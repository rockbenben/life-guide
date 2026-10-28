/**
 * 自动更新的状态机：纯逻辑，不 import electron。
 *
 * 主进程那边（updater.mjs）把 electron-updater 的事件翻成这里的 event，
 * 再用 reduceUpdate 折成一份状态发给渲染层。
 *
 * 拆出来是为了能 `node --test` 直接跑 —— 界面上的字不在这里
 * （那是 app/src/domain/update.ts 的事：这一层只管「现在处于什么状态」）。
 */

/** 状态取值。渲染层认这几个，别的值一律当 unsupported 处理。 */
export const UPDATE_STATES = [
  /** 这个形态不支持自动更新（浏览器 / 手机 / 免安装版） */
  "unsupported",
  /** 还没查过 */
  "idle",
  /** 正在查 */
  "checking",
  /** 有新版本 */
  "available",
  /** 正在下载 */
  "downloading",
  /** 下载好了，等着重启装上 */
  "ready",
  /** 正在重启安装 */
  "updating",
  /** 已经是最新 */
  "latest",
  /** 出错了 */
  "error",
];

/**
 * @typedef {{ state: string, version?: string, progress?: number, error?: string, note?: string }} UpdateStatus
 * @typedef {{ type: string, version?: string, percent?: number, message?: string, note?: string }} UpdateEvent
 */

/** 初始状态。默认是「不支持」—— 形态没认出来之前不许说能更新。 */
export function initialUpdateStatus(note) {
  return { state: "unsupported", note: note ?? "" };
}

/**
 * 这个形态能不能自动更新。不能的话给一句**照实说**的理由（界面上会显示）。
 *
 * 纯逻辑：不 import electron，起来就能跑（node --test 直接跑）。
 *
 * 各平台为什么这样：
 *   · **Windows**：NSIS 安装版能自动更新。免安装版不行 —— 它没有安装目录，
 *     安装动作会装到别处去。
 *   · **macOS**：Squirrel.Mac 只接受签过名的应用；现在没有 Developer ID，
 *     所以 macOS 版只能手动换新包。
 *   · **Linux**：electron-updater 走 AppImage 更新器，**只认 AppImage 本身**
 *     （它要替换 APPIMAGE 指的那个文件）。deb / rpm 装的没有那个文件，
 *     硬跑会把应用装到别处 —— 所以只有 AppImage 版能自动更新。
 *
 * @param {{ platform: string, packaged: boolean, portableDir?: string, appImage?: string }} env
 * @returns {{ ok: true } | { ok: false, note: string }}
 */
export function updateSupportFor(env) {
  if (!env.packaged) return { ok: false, note: "开发时不检查更新" };
  if (env.portableDir) {
    return { ok: false, note: "免安装版不能自动更新，用安装版才有" };
  }
  if (env.platform === "darwin") {
    return { ok: false, note: "macOS 版还没签名，不能自动更新；请手动下载新版" };
  }
  if (env.platform === "linux") {
    if (!env.appImage) {
      return { ok: false, note: "deb / rpm 装的版本不能自动更新，用 AppImage 版才有" };
    }
    return { ok: true };
  }
  if (env.platform !== "win32") return { ok: false, note: "这个平台暂时不能自动更新" };
  return { ok: true };
}

function clampPercent(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * 把错误翻成人话。
 *
 * **为什么不能直接显示原始错误**：electron-updater 抛的错里带着完整的 HTTP 响应
 * ——状态行、响应头、甚至 Cookie。直接显示在界面上，
 * 一是没人看得懂，二是把会话信息漏给了用户。
 * 所以只挑能说清原因的那部分。
 *
 * @param {any} err
 * @returns {string}
 */
export function friendlyUpdateError(err) {
  const code = typeof err?.statusCode === "number" ? err.statusCode : err?.status;
  if (code === 404) {
    // 仓库已公开（2026-10-28），所以 404 更可能是「这个版本还没发过」
    // 或更新地址不对，而不是「仓库是私有的」。
    return "找不到更新源（还没有发过版本，或更新地址不对）";
  }
  if (typeof code === "number") {
    return `更新源返回了 ${code}`;
  }
  const msg = String(err?.message ?? "");
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|EAI_AGAIN|getaddrinfo/i.test(msg)) {
    return "连不上更新源";
  }
  if (/certificate|TLS|SSL|self.signed/i.test(msg)) {
    return "更新源的证书有问题";
  }
  if (/not signed|signature|ERR_UPDATER_INVALID_SIGNATURE/i.test(msg)) {
    return "新版本没有签名，不敢装";
  }
  return "出了点问题";
}

/**
 * 折一次。
 *
 * 每个分支都**重新造一个对象**，不往旧对象上补字段 ——
 * 上一轮留下的 progress / error 挂在下一轮的状态里，界面上就会显示
 * 「下载 42%」配着「检查更新失败」这种对不上的话。
 *
 * @param {UpdateStatus} prev
 * @param {UpdateEvent} event
 * @returns {UpdateStatus}
 */
export function reduceUpdate(prev, event) {
  switch (event.type) {
    case "idle":
      return { state: "idle" };
    case "checking":
      return { state: "checking", version: prev.version };
    case "available":
      return { state: "available", version: event.version ?? prev.version };
    case "latest":
      return { state: "latest", version: event.version ?? prev.version };
    case "progress":
      return {
        state: "downloading",
        version: prev.version,
        progress: clampPercent(event.percent),
      };
    case "downloaded":
      return {
        state: "ready",
        version: event.version ?? prev.version,
        progress: 100,
      };
    case "error":
      return {
        state: "error",
        version: prev.version,
        error: event.message ?? "不知道是哪一步出的问题",
      };
    case "unsupported":
      return { state: "unsupported", note: event.note ?? "" };
    default:
      return prev;
  }
}
