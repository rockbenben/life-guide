/**
 * 把 Android 的版本号接到同一个版本源上（tag → version）。
 *
 * **为什么**：Android 的 versionCode 必须是**递增的整数**，装的时候靠它判断新旧。
 * 手写在 build.gradle 里的话，迟早会出现「发了新版但装不上」——
 * 因为新旧两个包的 versionCode 一样，系统会认为没变。
 *
 * 映射规则：major×10000 + minor×100 + patch
 *   0.1.1 → 101 · 0.2.0 → 200 · 0.3.0 → 300 · 1.0.0 → 10000
 * 版本号只增不减，这个映射也跟着只增不减。
 *
 * 用法：node scripts/sync-android-version.mjs 0.1.1
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/**
 * 把 build.gradle 里的 versionCode / versionName 改成给定的版本。
 * @param {string} version x.y.z
 * @param {string} [repoRoot]
 * @returns {{ changed: boolean, versionCode: number }}
 */
export function syncAndroidVersion(version, repoRoot = root) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!m) {
    throw new Error(`版本不是 x.y.z：${version}`);
  }
  const [, major, minor, patch] = m;
  const versionCode = Number(major) * 10000 + Number(minor) * 100 + Number(patch);

  const gradleFile = path.join(repoRoot, "mobile", "android", "app", "build.gradle");
  const src = fs.readFileSync(gradleFile, "utf8");
  const next = src
    .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);

  if (next === src) return { changed: false, versionCode };
  fs.writeFileSync(gradleFile, next, "utf8");
  return { changed: true, versionCode };
}

/* 直接当命令跑的时候 */
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const version = process.argv[2];
  if (!version) {
    console.error("用法：node scripts/sync-android-version.mjs <版本>");
    process.exit(1);
  }
  const { changed, versionCode } = syncAndroidVersion(version);
  console.log(
    changed
      ? `Android 版本已同步：${version}（versionCode ${versionCode}）`
      : `已经是 ${version}（versionCode ${versionCode}），没改。`,
  );
}
