/**
 * 验证桌面端：真的把 Electron 拉起来，截图。
 *
 * 桌面壳最怕「装得上、起不来」—— 协议没注册对、路径算错，
 * 表现都是一片白屏。跑一次就知道。
 *
 * 用法：node scripts/desktop-check.mjs [输出目录]
 */
import { _electron as electron } from "playwright";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = process.argv[2] ?? path.join(root, "tmp-shots");
fs.mkdirSync(outDir, { recursive: true });

if (!fs.existsSync(path.join(root, "app", "dist", "index.html"))) {
  console.error("先跑 npm run app:build");
  process.exit(2);
}

const app = await electron.launch({
  // 单独的 profile 目录：桌面端是单实例的（第二次启动会把已有窗口叫到前面），
  // 用户正开着应用时，这次检查会被单实例锁挡掉，直接退出。
  args: [
    path.join(root, "desktop"),
    `--user-data-dir=${path.join(os.tmpdir(), "life-guide-desktop-check")}`,
  ],
  cwd: root,
});

const page = await app.firstWindow();
await page.waitForLoadState("domcontentloaded");

const errors = [];
/** 穿越探针那一下会故意拿到一个 404 —— 那不是错误 */
let probing = false;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error" && !probing) errors.push(m.text());
});

await page.waitForTimeout(1500);

/**
 * 量「首启」：这个 profile 是历次检查留下来的，里面存着上一版的日常清单，
 * 量到的不是新用户看到的东西。清掉设置重载一次，等于一个全新用户。
 */
await page.evaluate(async () => {
  await new Promise((res) => {
    const req = indexedDB.deleteDatabase("life-guide");
    req.onsuccess = req.onerror = req.onblocked = () => res();
  });
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const title = await page.title();
// 按语义定位，不靠 CSS 类名：类名随时可能改，<article> 才是「一张卡」这件事本身
const cards = await page.locator("article").count();
const bodyText = (await page.locator("body").innerText()).slice(0, 120).replace(/\n/g, " / ");
// 首启有多少动作（页边那个数）
const overview = await page
  .locator(".lg-overview")
  .first()
  .innerText()
  .catch(() => "");

/**
 * app:// 只能伺服构建目录里的东西。
 *
 * 这条要真的造一个「构建目录的兄弟目录」才测得出来：用 startsWith 比路径的话，
 * 「…/app/dist-probe/x」也是「…/app/dist」的前缀，于是构建目录外面的文件
 * 会被端出去 —— 平时看不出来，出了事才知道。
 */
const probeDir = path.join(root, "app", "dist-probe");
fs.mkdirSync(probeDir, { recursive: true });
fs.writeFileSync(path.join(probeDir, "probe.txt"), "PROBE-SECRET");
let probeLeak = "";
try {
  probing = true;
  probeLeak = await page.evaluate(async () => {
    const res = await fetch("app://bundle/%2e%2e/dist-probe/probe.txt");
    return res.ok ? await res.text() : "";
  });
} finally {
  probing = false;
  fs.rmSync(probeDir, { recursive: true, force: true });
}

const file = path.join(outDir, "desktop-electron.png");
await page.screenshot({ path: file });

// 提醒通道：桌面端靠主进程的定时器与原生通知，页面只管把时刻递过去。
// 这里验的是**整条回路**：页面把时刻递过去 → 主进程到点弹通知 →
// 主进程回头问渲染层要下一次（life-guide:reminder-due）。三段都通才算通。
const bridge = await page.evaluate(() => {
  const lg = window.lifeGuide;
  if (!lg) return { ok: false, why: "预加载脚本没暴露 lifeGuide" };
  if (
    typeof lg.setReminders !== "function" ||
    typeof lg.notifyNow !== "function" ||
    typeof lg.onReminderDue !== "function"
  ) {
    return { ok: false, why: "lifeGuide 上没有提醒相关的方法" };
  }
  // 三秒后响：主进程得自己数到点，不靠页面再推一次
  const at = new Date(Date.now() + 3000).toISOString();
  lg.setReminders([
    { id: "check", at, title: "桌面端检查", body: "只排程，不等它响", after: [] },
  ]);
  lg.notifyNow("桌面端检查", "这条通知能弹出来，说明主进程的通知通道是通的。");
  window.__due = null;
  lg.onReminderDue((id) => {
    window.__due = id;
  });
  return { ok: true, why: "" };
});

// 等主进程到点后回头问（最多 20 秒）
let due = null;
if (bridge.ok) {
  for (let i = 0; i < 40 && due === null; i++) {
    await page.waitForTimeout(500);
    due = await page.evaluate(() => window.__due);
  }
}

console.log(`窗口标题：${title}`);
console.log(`卡片数：${cards}`);
console.log(`首启动作数：${overview.replace(/\n/g, " ")}`);
console.log(`正文开头：${bodyText}`);
console.log(
  `提醒通道：${bridge.ok && due ? "通（到点弹了通知，主进程也回头问了渲染层）" : `不通（${bridge.why || "主进程到点没回头问渲染层"}）`}`,
);
console.log(
  `目录穿越：${probeLeak ? `漏了（返回了 ${probeLeak}）` : "挡住了（app:// 伺服不到构建目录之外）"}`,
);
console.log(`控制台错误：${errors.length ? errors.join(" | ") : "无"}`);
console.log(`已保存 ${file}`);

// 有托盘：关窗口只是藏到托盘，进程还活着 —— 得明说「要退出」，
// 否则这个检查会一直等着（进程不退，Playwright 也不结束）。
await app.evaluate(({ app: electronApp }) => {
  electronApp.isQuitting = true;
  electronApp.quit();
});
await app.close().catch(() => {});

if (cards === 0) {
  console.error("窗口起来了但没有卡片 —— 协议或路径有问题");
  process.exit(1);
}
if (!bridge.ok || !due) {
  console.error("提醒通道不通 —— 桌面端到点不会响");
  process.exit(1);
}
if (errors.length) {
  console.error("有控制台错误");
  process.exit(1);
}
if (probeLeak) {
  console.error("app:// 把构建目录外面的文件端出去了 —— 目录穿越没挡住");
  process.exit(1);
}
