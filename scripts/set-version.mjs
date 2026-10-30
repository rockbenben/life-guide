/**
 * 发版前的版本同步：一条命令把所有地方的版本改成同一个数。
 *
 * 改的地方：
 *   · 5 个 package.json（根 / app / content / desktop / mobile）
 *   · package-lock.json 里的版本字段（只改版本，不重新解析依赖 ——
 *     `npm install --package-lock-only` 会把已测过的依赖漂到最新版本）
 *   · mobile/android/app/build.gradle 的 versionName 与 versionCode
 *     （versionCode 必须递增，否则系统会认为没变，新包装不上）
 *   · docs/发布说明/<版本>.md（这一版的发布说明模板，**已存在就不覆盖**）
 *
 * 用法：node scripts/set-version.mjs 0.1.1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { syncAndroidVersion } from "./sync-android-version.mjs";
import { notesFileFor, TEMPLATE_MARKER } from "./release-notes.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

const version = process.argv[2];
if (!version) {
  console.error("用法：node scripts/set-version.mjs <x.y.z>");
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(`版本不是 x.y.z：${version}`);
  process.exit(1);
}

/**
 * 发布说明的模板。
 *
 * **只写「这一版特有的内容」**：一直如此的事实（未签名、哪些形态能自动
 * 更新、关窗口只是收进托盘）由 `scripts/release-notices.mjs` 的
 * STANDING_NOTICES 每次自动附在正文后面 —— 在这里重复写，发布页上会出现两遍。
 *
 * **模板里那行标记不能留**：`scripts/release-notes.mjs` 见到它就当这一版
 * 还没写，发版会停下来。
 */
const NOTES_TEMPLATE = `${TEMPLATE_MARKER}

这一版的说明（写给用这个 App 的人看）：

- 这一版加了什么、为什么
- 有什么改动会影响已有习惯
- 这一版有哪些产物、怎么用

写完把上面那行 \`${TEMPLATE_MARKER}\` 删掉，再跟代码一起提交、打 tag。

<!--
  这一份只写「这一版特有的内容」。
  未签名、哪些形态能自动更新这些一直如此的事实，由
  scripts/release-notices.mjs 的 STANDING_NOTICES 每次自动附在正文后面 ——
  别在这儿重复写，重复了发布页上会出现两遍。
-->
`;

const manifests = [
  "package.json",
  "app/package.json",
  "content/package.json",
  "desktop/package.json",
  "mobile/package.json",
];

for (const rel of manifests) {
  const file = path.join(root, rel);
  const raw = fs.readFileSync(file, "utf8");
  const data = JSON.parse(raw);
  if (data.version === version) {
    console.log(`  ${rel}：已经是 ${version}`);
    continue;
  }
  console.log(`  ${rel}：${data.version} → ${version}`);
  data.version = version;
  // 保留原来的缩进与换行，别把整个文件重排一遍
  const text = raw.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`);
  fs.writeFileSync(file, text, "utf8");
}

const lockFile = path.join(root, "package-lock.json");
const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
let lockChanged = false;
for (const key of ["", "app", "content", "desktop", "mobile"]) {
  const entry = lock.packages[key];
  if (!entry) {
    console.error(`锁文件里没有：${key || "(根)"}`);
    process.exit(1);
  }
  if (entry.version !== version) {
    console.log(`  锁文件 ${key || "(根)"}：${entry.version} → ${version}`);
    entry.version = version;
    lockChanged = true;
  }
}
if (lock.version && lock.version !== version) {
  console.log(`  锁文件 lock.version：${lock.version} → ${version}`);
  lock.version = version;
  lockChanged = true;
}
if (lockChanged) {
  fs.writeFileSync(lockFile, JSON.stringify(lock, null, 2) + "\n", "utf8");
}

const android = syncAndroidVersion(version, root);
console.log(
  android.changed
    ? `  Android：versionName ${version}，versionCode ${android.versionCode}`
    : `  Android：已经是 ${version}（versionCode ${android.versionCode}）`,
);

// 这一版的发布说明：放一份模板，作者在上面写。
//
// **为什么在这里生成**：发版说明是发版的一部分，而发版是从这条命令开始的
// —— 让模板在「改版本」这一步就出现在眼前，比让人记得去别处写要靠得住。
//
// **已存在就不覆盖**：重跑这条命令（版本已经改过了）不能把作者写好的
// 说明冲掉。
const notesFile = path.join(root, notesFileFor(`v${version}`));
if (fs.existsSync(notesFile)) {
  console.log(`  发布说明：已经有 ${notesFileFor(`v${version}`)}，不动它。`);
} else {
  fs.mkdirSync(path.dirname(notesFile), { recursive: true });
  fs.writeFileSync(notesFile, NOTES_TEMPLATE, "utf8");
  console.log(`  发布说明：放了模板 ${notesFileFor(`v${version}`)} —— 写完这一版改了什么，再打 tag。`);
}

console.log(`\n版本已统一为 ${version}。接着：写发布说明、提交、推送、打 tag（见 AGENTS.md §4.5）。`);
