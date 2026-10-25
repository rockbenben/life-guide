/**
 * 导航与 IPC 的白名单。
 *
 * 桌面窗口只该在两种地方活着：打包后的 `app://bundle/`，或开发时的 dev server。
 * 其他 http(s) 链接交给系统浏览器；`file:`、`javascript:` 之类一律拒绝。
 *
 * 做成纯函数是为了能单测：`will-navigate` 与 IPC sender 用的是同一套判据，
 * 两处各写一份必然会分叉。
 */

/**
 * @param {string} rawUrl 要去的地址
 * @param {string|null} devServer 开发时的 Vite 地址（打包后为 null）
 * @returns {"allow" | "external" | "deny"}
 */
export function navigationDecision(rawUrl, devServer = null) {
  let url;
  try {
    url = new URL(String(rawUrl ?? ""));
  } catch {
    return "deny";
  }

  if (url.protocol === "app:" && url.host === "bundle") return "allow";

  if (devServer) {
    try {
      if (url.origin === new URL(devServer).origin) return "allow";
    } catch {
      // dev server 配错不应放宽任何东西
    }
  }

  if (url.protocol === "http:" || url.protocol === "https:") return "external";
  return "deny";
}

/**
 * 这个 URL 是不是我们自己的页面。
 * @param {string} rawUrl
 * @param {string|null} devServer
 */
export function isTrustedSenderUrl(rawUrl, devServer = null) {
  return navigationDecision(rawUrl, devServer) === "allow";
}

/**
 * IPC 事件是不是来自我们自己的页面。
 * senderFrame 是首选；老版本/特殊时机拿不到时退回 webContents 当前 URL。
 * @param {{ senderFrame?: { url?: string }, sender?: { getURL?: () => string } }} event
 * @param {string|null} devServer
 */
export function isTrustedSender(event, devServer = null) {
  const url =
    event?.senderFrame?.url ??
    (typeof event?.sender?.getURL === "function" ? event.sender.getURL() : "");
  return isTrustedSenderUrl(url, devServer);
}
