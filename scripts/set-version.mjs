/**
 * 发版前的版本同步：一条命令把所有地方的版本改成同一个数。
 *
 * 改的地方：
 *   · 5 个 package.json（根 / app / content / desktop / mobile）
 *   · package-lock.json 里的版本字段（只改版本，不重新解析依赖 ——
 *     `npm install --package-lock-only` 会把已测过的依赖漂到最新版本）
 *   · mobile/android/app/build.gradle 的 versionName 与 versionCode
 *     （versionCode 必须递增，否则系统会认为没变，新包装不上）
 *
 * 用法：node scripts/set-version.mjs 0.1.1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { syncAndroidVersion } from "./sync-android-version.mjs";

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

console.log(`\n版本已统一为 ${version}。接着：提交、推送、打 tag（见 AGENTS.md §4.5）。`);
