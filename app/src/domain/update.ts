/**
 * 自动更新：这一层只管「现在什么状态、界面上该说什么、能做什么」。
 *
 * 怎么查、怎么下载是平台层的事（app/src/platform/update.ts），
 * 主进程那边还有一份状态机（desktop/lib/update-events.mjs）——
 * 两边的状态名必须一致，界面上认的是下面这组。
 */

export type UpdateState =
  /** 这个形态不支持自动更新 */
  | "unsupported"
  /** 还没查过 */
  | "idle"
  /** 正在查 */
  | "checking"
  /** 有新版本 */
  | "available"
  /** 正在下载 */
  | "downloading"
  /** 下载好了，等着重启装上 */
  | "ready"
  /** 正在重启安装 */
  | "updating"
  /** 已经是最新 */
  | "latest"
  /** 出错了 */
  | "error";

export interface UpdateStatus {
  state: UpdateState;
  /** 新版本号（如 0.1.2） */
  version?: string;
  /** 下载进度（0～100） */
  progress?: number;
  /** 出错时的原因 */
  error?: string;
  /** 不支持的时候，照实说的理由 */
  note?: string;
}

/**
 * 状态 → 一句人话。
 *
 * 界面不出现内部词（electron-updater、feed、SHA512 那些），
 * 也不出现英文缩写；版本号是数字，直接写。
 */
export function describeUpdate(s: UpdateStatus): string {
  switch (s.state) {
    case "unsupported":
      return s.note || "这个形态不自动更新";
    case "idle":
      return "还没检查过更新";
    case "checking":
      return "正在检查更新…";
    case "available":
      return s.version ? `有新版本：${s.version}` : "有新版本";
    case "downloading":
      return s.progress === undefined
        ? "正在下载…"
        : `正在下载：${s.progress}%`;
    case "ready":
      return "下载好了，重启后装上";
    case "updating":
      return "正在重启安装…";
    case "latest":
      return "已经是最新版本";
    case "error":
      return s.error ? `检查更新失败：${s.error}` : "检查更新失败";
    default:
      return "";
  }
}

/**
 * 这一刻是不是正在忙（按钮该禁用）。
 *
 * 「最新」与「出错」都不忙 —— 用户随时能再查一次。
 */
export function updateBusy(s: UpdateStatus): boolean {
  return s.state === "checking" || s.state === "downloading" || s.state === "updating";
}
