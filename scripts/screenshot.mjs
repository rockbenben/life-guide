/**
 * 截图看布局：桌面宽屏与手机窄屏各一张。
 *
 * 用途是「眼见为实」—— 桌面端的问题（导航条满宽、内容缩在中间）就是靠看出来的，
 * 不是靠读 CSS 想出来的。
 *
 * 用法：
 *   node scripts/screenshot.mjs [输出目录]
 *   node scripts/screenshot.mjs --hero      # 顺带重拍 README 首屏图（docs/images/today.png）
 *
 * **README 首屏图为什么要专门拍**（`--hero`）：
 * 首屏图是 README 里最先过期的东西 —— 界面改了就没人记得回头重拍，
 * 读者照着图去找一个已经改掉的控件，就此不再信任那张图。
 * 所以它有个专门的入口：跑一次 `--hero` 就按当前界面重拍，
 * 不用临时手搓。
 *
 * 为什么是 1600×440（3.6:1）而不是常见的一块屏：
 * GitHub 仓库页的 README 栏宽 928px，标题 + 一句话 + 徽章 + 入口行先吃掉约 200px，
 * 首屏只剩约 470px —— 图再高，正文第一段就被顶到折线以下（实测 1440×720 时
 * 首段 Y=675，掉出首屏）。1600×440 缩到栏宽是 928×255，首段落在 Y≈466 之内。
 * 代价是手机上更看不清字（手机栏宽约 353px，等比缩到 0.22 倍）——
 * 认得出「这是个列清单的界面」就够了，卡片上的字在正文里另有一张图说明。
 */
import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs";
import { startServer } from "./acceptance/server.mjs";

const argv = process.argv.slice(2);
const withHero = argv.includes("--hero");
const outDir = argv.find((a) => !a.startsWith("--")) ?? "tmp-shots";
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
  // README 首屏图：宽扁，正文首段才留得住（见文件头）
  { name: "readme-hero", width: 1600, height: 440, tab: "今天", out: "docs/images/today.png" },
];

for (const s of shots) {
  if (s.out && !withHero) continue; // 首屏图只在 --hero 时重拍
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
  const file = s.out
    ? path.resolve(s.out)
    : path.join(outDir, `${s.name}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await page.screenshot({ path: file });
  console.log(`已保存 ${file}`);
  await page.close();
}

await browser.close();
await server.close();
