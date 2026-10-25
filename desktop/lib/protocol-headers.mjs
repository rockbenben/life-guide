/**
 * app:// 响应的头。
 *
 * 单独放一个不 import electron 的模块：这些值要能被 `node --test` 直接钉住。
 * CSP 只加在 HTML 文档上——脚本、样式、图片各自的响应不需要重复带策略头。
 */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * 渲染层只加载自己构建的静态资源，所以脚本、连接、图片都只放 self。
 *
 * `style-src` 需要 `'unsafe-inline'`：Preact 里有几处 `style="…"` 属性，
 * 不是脚本注入面；`script-src` 没有这一项。
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "media-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * @param {string} ext 带点的扩展名（小写）
 * @returns {Record<string, string>}
 */
export function responseHeaders(ext) {
  const type = MIME[ext] ?? "application/octet-stream";
  const headers = {
    "content-type": type,
    "x-content-type-options": "nosniff",
  };
  if (ext === ".html") headers["content-security-policy"] = CSP;
  return headers;
}
