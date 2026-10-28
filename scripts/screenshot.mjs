/**
 * 截图看布局：桌面宽屏与手机窄屏各一张。
 *
 * 用途是「眼见为实」—— 桌面端的问题（导航条满宽、内容缩在中间）就是靠看出来的，
 * 不是靠读 CSS 想出来的。
 *
 * 用法：node scripts/screenshot.mjs [输出目录]
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { startServer } from "./acceptance/server.mjs";

const outDir = process.argv[2] ?? "tmp-shots";
const distDir = path.resolve("app", "dist");
if (!fs.existsSync(path.join(distDir, "index.html"))) {
  console.error("先跑 npm run app:build");
  process.exit(2);
}
fs.mkdirSync(outDir, { recursive: true });

const server = await startServer(distDir, 5301);
const browser = await chromium.launch({ channel: "chrome" });

const shots = [
  { name: "desktop-today", width: 1440, height: 900, tab: "今天" },
  { name: "desktop-manual", width: 1440, height: 900, tab: "手册" },
  { name: "mobile-today", width: 390, height: 844, tab: "今天" },
];

for (const s of shots) {
  const page = await browser.newPage({ viewport: { width: s.width, height: s.height } });
  await page.goto(server.origin, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: s.tab, exact: true }).click();
  await page.waitForTimeout(600);
  // 首启引导要先走完：新profile 会在今天页顶部挂一块「先选年龄段」，
  // README 里那张图要的是**用户已经用了一阵子**的样子，不是第一次打开的样子。
  const skip = page.locator(".lg-ageask-skip");
  if (await skip.count()) {
    await skip.first().click();
    await page.waitForTimeout(400);
  }
  // 首启说明（清单是 App 替你放的……）在「用户动手」后撤掉。盖一次印又取消，
  // 就等于「用过一阵子但今天还没盖印」的样子 —— 画面干净，说明也不在了。
  const stamp = page.locator(".lg-seal").first();
  if (await stamp.count()) {
    await stamp.click();
    await page.waitForTimeout(300);
    await stamp.click();
    await page.waitForTimeout(300);
  }
  // 鼠标要移开：刚才点过印，鼠标还停在那儿，截出来会带着 hover 高亮。
  await page.mouse.move(2, 2);
  await page.waitForTimeout(200);
  const file = path.join(outDir, `${s.name}.png`);
  await page.screenshot({ path: file });
  console.log(`已保存 ${file}`);
  await page.close();
}

await browser.close();
await server.close();
