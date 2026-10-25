/**
 * 生成原生应用图标。
 *
 * Capacitor 自带的图标是它的 logo，装到手机上认不出来。
 * 这里拿自己的 favicon.svg 渲染成 1024×1024 的源图，再交给 @capacitor/assets
 * 铺满 Android 的 mipmap 与 iOS 的 AppIcon。
 *
 * 用法：node scripts/make-app-icons.mjs
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const svg = path.join(root, "app", "public", "favicon.svg");
const outDir = path.join(root, "mobile", "assets");
fs.mkdirSync(outDir, { recursive: true });

const source = path.join(outDir, "logo.png");
const svgText = fs.readFileSync(svg, "utf8");

// 用浏览器把 SVG 渲染成 PNG —— 机器上不一定有 ImageMagick / rsvg
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.setContent(
  `<html><body style="margin:0">${svgText.replace(
    'viewBox="0 0 512 512"',
    'viewBox="0 0 512 512" width="1024" height="1024"',
  )}</body></html>`,
);
await page.locator("svg").screenshot({ path: source, omitBackground: true });
await browser.close();

console.log(`已生成图标源图 ${source}`);

// 交给 @capacitor/assets 铺到两个平台（Easy Mode：一张 logo + 背景色）
const { execFileSync } = await import("node:child_process");
const cli = path.join(root, "node_modules", "@capacitor", "assets", "bin", "capacitor-assets");
execFileSync(
  process.execPath,
  [
    cli,
    "generate",
    "--android",
    "--ios",
    "--iconBackgroundColor",
    "#a72b2a",
    "--iconBackgroundColorDark",
    "#a72b2a",
    "--splashBackgroundColor",
    "#faf6ef",
    "--splashBackgroundColorDark",
    "#faf6ef",
  ],
  { cwd: path.join(root, "mobile"), stdio: "inherit" },
);

console.log("图标已铺到 mobile/android 与 mobile/ios");
