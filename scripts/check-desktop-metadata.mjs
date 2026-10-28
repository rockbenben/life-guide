/**
 * 检查桌面端打包需要的元数据齐不齐。
 *
 * **为什么单独查**：Linux 的 deb / rpm 有额外的元数据要求，而 CI 的桌面打包
 * 只在 Windows 上跑（只打 dir），所以这类问题要到真发版的 Linux runner 上才炸。
 * 2026-10-28 实测：desktop/package.json 少一个 homepage，
 * Linux 打包直接报 "Please specify project homepage" —— 整条发版流水线停在那儿。
 *
 * electron-builder 要的：
 *   · homepage —— deb/rpm 的项目网址。它会回退到 package.json 的 repository，
 *     但那是「解析出来才知道」的隐式行为，显式写 homepage 更省事。
 *   · 作者邮箱 —— 没有它，deb 的 maintainer 字段填不出来。
 *     `build.linux.maintainer` 已经写了的话就不用管作者字段。
 *
 * 用法：node scripts/check-desktop-metadata.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "desktop", "package.json"), "utf8"),
);

const problems = [];
if (!pkg.homepage && !pkg.repository) {
  problems.push("homepage（deb/rpm 的项目网址；repository 也可以代替）");
}
if (!pkg.build?.linux?.maintainer && !(pkg.author?.name && pkg.author?.email)) {
  problems.push("作者邮箱（build.linux.maintainer 或 author.email 至少要有一个）");
}

if (problems.length) {
  console.error("desktop/package.json 少了打包需要的元数据：");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error("  → 补上就能打 deb / rpm；Linux 目标不会报「Please specify project homepage」。");
  process.exit(1);
}

console.log("✓ 桌面端打包元数据齐全（homepage、作者邮箱）");
