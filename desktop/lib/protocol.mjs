/**
 * app:// 协议：把构建产物目录当成一个站点来伺服。
 *
 * 为什么不用 file://：渲染层要 `fetch("cards.json")` 与 `fetch("manual.json")`。
 * file:// 下 fetch 本地文件会被浏览器拦掉；自定义协议注册成
 * standard + secure 之后，相对路径的 fetch 正常工作，
 * 而且 origin 稳定（app://bundle），IndexedDB 里的记录不会丢。
 *
 * 这个模块只管「一个 URL 怎么变成一个响应」，别的什么都不管。
 */
import { protocol } from "electron";
import fs from "node:fs/promises";
import path from "node:path";

/** 按扩展名给 MIME —— 自己读文件自己给类型，不依赖 net.fetch 对 file:// 的支持。 */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest; charset=utf-8",
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
 * 声明 app:// 的特权。
 *
 * 必须在 app ready **之前**调用 —— 晚一步 Chromium 就不会把它当标准 scheme，
 * 相对路径的 fetch 随之失效（表现为卡片数据读不出来）。
 */
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
    },
  ]);
}

/**
 * 目标是不是在 root 之内。
 *
 * **不能用 startsWith** —— 「…/app/dist-evil/x」也是「…/app/dist」的前缀，
 * 那样等于给构建目录外面的文件开了个后门。用 relative 比。
 */
export function insideRoot(root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * 把 app:// 接到构建产物目录上（app ready 之后调用）。
 *
 * @param {string} bundleDir 构建产物目录
 */
export function serveBundle(bundleDir) {
  const root = path.resolve(bundleDir);

  protocol.handle("app", async (request) => {
    const url = new URL(request.url);
    // pathname 形如 /cards.json、/media/xxx.png
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const resolved = path.resolve(root, rel);

    if (process.env.LIFE_GUIDE_DEBUG) {
      console.error(`[app://] ${request.url} → ${resolved}`);
    }

    if (!insideRoot(root, resolved)) {
      return new Response("forbidden", { status: 403 });
    }

    try {
      const data = await fs.readFile(resolved);
      const type = MIME[path.extname(resolved).toLowerCase()] ?? "application/octet-stream";
      return new Response(data, { headers: { "content-type": type } });
    } catch {
      return new Response("not found", { status: 404 });
    }
  });
}
