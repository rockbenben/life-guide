/**
 * 校验发版草稿里的资产，并生成 SHA256SUMS。
 *
 * **为什么不用 artifact 中转**：
 * Actions 的 artifact 存储是**账户级共享**的配额（GitHub Free 500 MB，与
 * Packages 共用），而这一版要发的产物约 1.6 GB —— 走 artifact 中转必然撑爆配额
 * （2026-10-28 实测：账户已用 11.5 GB，CI 连 157 MB 都传不上去）。
 * 所以构建 job 直接把产物传到这个 release 草稿上，publish 只读 API。
 *
 * **为什么校验和不用再下一遍文件**：
 * GitHub 的 release 资产 API 每个资产都带 `digest`（sha256:…），
 * 那是服务端算的，和用户下载下来算的同一个值 —— 直接拿来拼 SHA256SUMS，
 * 不用把 1.6 GB 再下一遍。输出格式与 `sha256sum` 一致（两格空格），
 * 用户的 `sha256sum -c SHA256SUMS` 能直接用。
 *
 * 用法：
 *   REPO=owner/name RELEASE_ID=123 VERSION=0.1.1 node scripts/release-assets.mjs [输出目录]
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.env.REPO;
const releaseId = process.env.RELEASE_ID;
const version = process.env.VERSION;
const token = process.env.GH_TOKEN;
const outDir = path.resolve(process.argv[2] ?? ".");
let missingEnv = false;

if (!repo || !releaseId || !version || !token) {
  // 不在这里退出：单元测试要 import 里面的纯函数，不能被环境变量卡住。
  missingEnv = true;
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};
const api = (p, init) => fetch(`https://api.github.com${p}`, { headers, ...init });

/** 四条更新清单：electron-updater 靠它们找产物。 */
export const MANIFESTS = [
  "latest.yml",
  "latest-mac.yml",
  "latest-linux.yml",
  "latest-linux-arm64.yml",
];

/** 必须发出去的产物（少了任何一个，用户拿到的就是半套发布）。 */
export function expectedFiles(v) {
  return [
    `LifeGuide-Setup-${v}.exe`,
    `LifeGuide-Setup-${v}.exe.blockmap`,
    `LifeGuide-Portable-${v}-x64.exe`,
    `LifeGuide-Portable-${v}-arm64.exe`,
    `LifeGuide-${v}-x64.dmg`,
    `LifeGuide-${v}-arm64.dmg`,
    `LifeGuide-${v}-x64.zip`,
    `LifeGuide-${v}-arm64.zip`,
    `LifeGuide-${v}-x86_64.AppImage`,
    `LifeGuide-${v}-arm64.AppImage`,
    `LifeGuide-${v}-amd64.deb`,
    `LifeGuide-${v}-arm64.deb`,
    `LifeGuide-${v}-x86_64.rpm`,
    `LifeGuide-${v}-aarch64.rpm`,
    `LifeGuide-${v}.apk`,
  ];
}

/** 每条清单得指向哪些载体 —— 清单指错了，更新器就找不到包。 */
export function expectedCarriers(v) {
  return {
    "latest.yml": [`LifeGuide-Setup-${v}.exe`],
    "latest-mac.yml": [`LifeGuide-${v}-x64.zip`, `LifeGuide-${v}-arm64.zip`],
    "latest-linux.yml": [`LifeGuide-${v}-x86_64.AppImage`],
    "latest-linux-arm64.yml": [`LifeGuide-${v}-arm64.AppImage`],
  };
}

/** 解析一条 electron-builder 的更新清单：版本 + 它指向的文件。 */
export function parseManifest(text) {
  const version = /^version:\s*(.+?)\s*$/m.exec(text)?.[1] ?? "";
  const urls = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*-?\s*url:\s*(.+?)\s*$/.exec(line);
    if (m) urls.push(m[1]);
  }
  return { version, urls };
}

/**
 * 校验：产物齐不齐、清单版本对不对、清单指向的文件在不在、载体对不对。
 * 返回问题清单（空数组 = 一切正常）。
 */
export function verifyAssets({ assets, manifests, version, required, carriers }) {
  const problems = [];
  const names = new Set(assets.map((a) => a.name));

  for (const f of required) {
    if (!names.has(f)) problems.push(`缺少 ${f}`);
  }
  for (const m of Object.keys(manifests)) {
    if (!names.has(m)) {
      problems.push(`缺少更新清单 ${m}`);
      continue;
    }
    const parsed = manifests[m];
    if (parsed.version !== version) {
      problems.push(`${m} 的版本是 ${parsed.version || "?"}，不是 ${version}`);
    }
    for (const u of parsed.urls) {
      if (!names.has(u)) problems.push(`${m} 指向了不存在的 ${u}`);
    }
    for (const c of carriers[m] ?? []) {
      if (!parsed.urls.includes(c)) problems.push(`${m} 没指向 ${c}`);
    }
  }
  return problems;
}

/** SHA256SUMS：格式与 `sha256sum` 一致（两格空格），按文件名排序。 */
export function buildChecksums(assets) {
  const rows = assets
    .filter((a) => a.digest && a.digest.startsWith("sha256:"))
    .map((a) => ({ hash: a.digest.slice("sha256:".length), name: a.name }))
    .sort((x, y) => (x.name < y.name ? -1 : x.name > y.name ? 1 : 0));
  if (!rows.length) return "";
  return rows.map((r) => `${r.hash}  ${r.name}`).join("\n") + "\n";
}

// ------------------------------------------------------------------ 主流程
//
// 外面套一层「是不是直接跑的」判断：这样单元测试可以 import 里面的纯函数，
// 而不会一 import 就去连 API 跑一遍。
const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  await main();
}

async function main() {
  if (missingEnv) {
    console.error("需要 REPO / RELEASE_ID / VERSION / GH_TOKEN 四个环境变量");
    process.exit(2);
  }

  const assets = await api(`/repos/${repo}/releases/${releaseId}/assets?per_page=100`)
    .then((r) => r.json())
    .then((r) => (Array.isArray(r) ? r : []));

  if (!assets.length) {
    console.error("这个 release 草稿上一个资产都没有 —— 构建 job 传失败了吧？");
    process.exit(1);
  }

  // 清单要读内容，所以单独取下来（很小）。
  // **要带 Accept: application/octet-stream** —— 默认的 vnd.github+json 返回的是
  // 资产元数据（JSON），不是文件本身，读出来自然找不到 version 那行。
  const manifests = {};
  for (const m of MANIFESTS) {
    const asset = assets.find((a) => a.name === m);
    if (!asset) continue;
    const res = await api(`/repos/${repo}/releases/assets/${asset.id}`, {
      headers: { ...headers, Accept: "application/octet-stream" },
    });
    if (!res.ok) {
      console.error(`取 ${m} 失败：${res.status}`);
      process.exit(1);
    }
    const buf = Buffer.from(await res.arrayBuffer());
    manifests[m] = parseManifest(buf.toString("utf8"));
  }

  const problems = verifyAssets({
    assets,
    manifests,
    version,
    required: expectedFiles(version),
    carriers: expectedCarriers(version),
  });

  if (problems.length) {
    console.error("发布资产校验没过：");
    for (const p of problems) console.error(`  ✗ ${p}`);
    process.exit(1);
  }

  const sums = buildChecksums(assets);
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, "SHA256SUMS");
  fs.writeFileSync(outFile, sums, "utf8");

  console.log(`✓ ${assets.length} 个资产，版本 ${version}，清单与载体都对得上`);
  console.log(`  SHA256SUMS：${outFile}（${sums.trim().split("\n").length} 行）`);
}
