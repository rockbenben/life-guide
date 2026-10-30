/**
 * 桌面端冒烟检查：**真的把应用起起来**，看窗口出不出来。
 *
 * 为什么单独有这个：`npm run desktop:build` 只打「装得上」，
 * 验不出「起不来」——主进程加载失败时 Electron 只会弹一个错误框，
 * 打包照样成功，CI 全绿，用户装完才发现是坏的。
 *
 * 实测踩过：`import { autoUpdater } from "electron-updater"` 这类写法
 * （CommonJS 包用 defineProperty 定义导出，ESM 具名导入认不出来）
 * 会在主进程加载时抛错，整个应用起不来 —— 打包与单测都发现不了，只有这一关能。
 *
 * 用法：node scripts/desktop-smoke.mjs [打包产物的 exe 路径]
 *        不给路径就从源码起（开发模式）。
 */
import { _electron as electron } from "playwright";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

const exe = process.argv[2];
const packaged = exe && fs.existsSync(exe);
if (exe && !packaged) {
  console.error("找不到打包产物：", exe);
  process.exit(2);
}

const app = await electron.launch({
  ...(packaged ? { executablePath: exe } : {}),
  args: [
    ...(packaged ? [] : [path.join(root, "desktop")]),
    `--user-data-dir=${path.join(os.tmpdir(), "life-guide-smoke")}`,
  ],
  cwd: root,
  timeout: 30000,
});

const page = await app.firstWindow({ timeout: 20000 });

const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

await page.waitForLoadState("domcontentloaded");

// **等卡片出现，而不是死等一个固定时长**：卡片要走 app:// 协议取 cards.json
// 再渲染，CI 的 runner 慢一点就可能超过固定等待 —— 那样会误判成
// 「窗口起来了但没有卡片」（2026-10-28 实测踩过一次：同一份代码重跑就过了）。
// 这里改成轮询：最多等 20 秒，出现了就收工。
// 按语义定位，不靠 CSS 类名：类名随时可能改，<article> 才是「一张卡」这件事本身
const deadline = Date.now() + 20000;
let cards = 0;
while (Date.now() < deadline) {
  cards = await page.locator("article").count();
  if (cards > 0) break;
  await page.waitForTimeout(500);
}

const title = await page.title();

/**
 * **WebDAV 那条缝**：局域网里自建的服务器默认**不发 CORS 头**，
 * 渲染层自己 fetch 连不上（真应用里 CSP 先拦一道，https:// 的自建服务器则是 CORS 拦）。
 * 所以 WebDAV 的请求交给主进程发（Node 的 http，不受同源策略管）。
 *
 * 这里真的发一次：起一台本机的假 WebDAV（**故意不发 CORS 头**，
 * 跟真实自建服务器一样），从渲染层里走那条缝 GET 一次、PUT 一次。
 * 单测只能验主进程那个客户端，**这条缝本身**（preload ↔ IPC ↔ 主进程）
 * 只有真把应用起起来才验得到。
 *
 * **不在这里故意发一次会被拦的直连**：那会在控制台留下 CSP/跨源的报错，
 * 而「控制台零错误」正是这道闸要守的东西。
 */
const davServer = http.createServer((req, res) => {
  if (req.method === "PUT") {
    res.writeHead(201, { etag: '"v2"' });
    res.end();
    return;
  }
  res.writeHead(200, { "content-type": "application/json", etag: '"v1"' });
  res.end('{"v":1,"iv":"aXY=","ciphertext":"Y2lwaGVy"}');
});
await new Promise((r) => davServer.listen(0, "127.0.0.1", r));
const davUrl = `http://127.0.0.1:${davServer.address().port}/dav/life-guide-space1.json`;

const dav = await page.evaluate(async (target) => {
  const out = { hasBridge: typeof window.lifeGuide?.davRequest === "function" };
  try {
    const r = await window.lifeGuide.davRequest({ url: target });
    out.get = { status: r.status, body: r.body };
  } catch (e) {
    out.get = `threw: ${e.message}`;
  }
  try {
    const r = await window.lifeGuide.davRequest({
      url: target,
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: '{"v":1}',
    });
    out.put = { status: r.status };
  } catch (e) {
    out.put = `threw: ${e.message}`;
  }
  return out;
}, davUrl);
davServer.close();

console.log(`模式：${packaged ? "打包产物" : "源码"}`);
console.log(`窗口标题：${title}`);
console.log(`卡片数：${cards}`);
console.log(`WebDAV：桥=${dav.hasBridge} 经主进程=${JSON.stringify(dav.get)} PUT=${JSON.stringify(dav.put)}`);
console.log(`控制台错误：${errors.length ? errors.join(" | ") : "无"}`);

await app.evaluate(({ app: electronApp }) => {
  electronApp.isQuitting = true;
  electronApp.quit();
});
await app.close().catch(() => {});

if (title !== "生活指南") {
  console.error("窗口标题不对 —— 主进程可能没跑起来");
  process.exit(1);
}
if (cards === 0) {
  console.error("窗口起来了但没有卡片 —— 协议或路径有问题");
  process.exit(1);
}
if (!dav.hasBridge) {
  console.error("渲染层里没有那条 WebDAV 缝 —— preload 没接上");
  process.exit(1);
}
if (typeof dav.get !== "object" || dav.get.status !== 200) {
  console.error("主进程代发 WebDAV 不通 —— 局域网那台服务器连不上");
  process.exit(1);
}
if (typeof dav.put !== "object" || dav.put.status !== 201) {
  console.error("主进程代发 WebDAV 的写不通");
  process.exit(1);
}
if (errors.length) {
  console.error("有控制台错误");
  process.exit(1);
}
console.log("桌面端冒烟检查通过。");
