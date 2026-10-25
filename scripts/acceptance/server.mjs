/**
 * 静态文件服务器：伺服 app/dist/。
 *
 * 为什么自己写而不用 vite preview / serve-handler：验收脚本只依赖仓库里已有的
 * 东西，不为跑一次检查新增依赖。功能只需要三件事——
 *   1. 正确的 MIME（Service Worker 必须以 JS 类型下发，否则浏览器拒绝注册）
 *   2. 目录 → index.html
 *   3. 不许走出 dist 目录
 *
 * 绑定 127.0.0.1：Service Worker 只在「安全上下文」里可用，localhost 属于
 * 安全上下文，所以 http 就够了，不需要证书。
 */
import http from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function contentType(file) {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

/**
 * 起一个静态服务器。
 * @param {string} rootDir 要伺服的目录（app/dist）
 * @param {number} port 端口
 * @returns {Promise<{origin: string, close: () => Promise<void>}>}
 */
export function startServer(rootDir, port) {
  const root = path.resolve(rootDir);

  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://127.0.0.1");
        let pathname = decodeURIComponent(url.pathname);
        if (pathname.endsWith("/")) pathname += "index.html";

        const file = path.resolve(root, "." + pathname);
        // 防目录穿越
        if (file !== root && !file.startsWith(root + path.sep)) {
          res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("403 forbidden");
          return;
        }

        const info = await stat(file).catch(() => null);
        if (!info || !info.isFile()) {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("404 not found: " + pathname);
          return;
        }

        res.writeHead(200, {
          "Content-Type": contentType(file),
          "Content-Length": info.size,
          // 每次跑验收都拿到最新产物，不吃浏览器缓存
          "Cache-Control": "no-cache",
        });
        createReadStream(file).pipe(res);
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("500 " + String(err));
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      resolve({
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections?.();
            server.close(() => done());
          }),
      });
    });
  });
}
