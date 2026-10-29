#!/usr/bin/env node
/**
 * P2 验收脚本（AGENTS.md §7 的 P2 退出条件）。
 *
 * 有几条退出条件单元测试验不了，必须真跑一个浏览器：
 *   - 断网可完整使用一天（Service Worker 预缓存 + 断网重载后卡片与步骤图还在）
 *   - .ics 导入后按时提醒（真机导入没法自动化，但文件本身可以验：
 *     两条定时重复事件、带 VALARM、URL 带 slot、每行 ≤ 75 字节）
 *   - 导出 → 清空 → 导入后事件日志逐条一致（可以在浏览器里端到端跑）
 *
 * 用法：
 *   npm run acceptance                       复用已有的 app/dist
 *   ACCEPTANCE_REBUILD=1 npm run acceptance  强制重新构建
 *   ACCEPTANCE_PORT=5200 npm run acceptance  换端口（默认 5199）
 *   ACCEPTANCE_INSTALL_BROWSER=1 npm run acceptance
 *                                            浏览器起不来时下载 Playwright 自带的 chromium
 *
 * 直接跑 node scripts/acceptance/run.mjs --rebuild --port=5200 也行。
 * （注意：npm 11 不把 `--` 后面的参数转给脚本，所以走 npm 时用环境变量。）
 *
 * **验收真实部署**（发到自定义域名后用这个）：
 *   ACCEPTANCE_URL=https://life.newzone.top npm run acceptance:url
 *   node scripts/acceptance/run.mjs --url=https://life.newzone.top
 * 同一套检查直接跑在那个地址上，不起本地服务器 —— 「断网可完整使用一天」
 * 这种只有真域名才说得清的（证书、SW scope、预缓存）才能验到。
 * 注意：**要填根路径部署的地址**（子路径部署会让检查里的路径断言对不上）。
 *
 * 退出码：有检查失败则非零。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "./server.mjs";
import { launchBrowser } from "./helpers.mjs";
import {
  checkCardCollapse,
  checkCardReminder,
  checkEventsRoundTrip,
  checkIcs,
  checkImportRefreshesRoutine,
  checkNavigation,
  checkOffline,
  checkReminderLifecycle,
  checkSkipToday,
} from "./checks.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");
const distDir = path.join(repoRoot, "app", "dist");

const argv = process.argv.slice(2);
const forceRebuild =
  process.env.ACCEPTANCE_REBUILD === "1" || argv.includes("--rebuild");
const installBrowser =
  process.env.ACCEPTANCE_INSTALL_BROWSER === "1" ||
  argv.includes("--install-browser");
const portArg = argv.find((a) => a.startsWith("--port="));
const PORT = Number(
  portArg
    ? portArg.slice("--port=".length)
    : (process.env.ACCEPTANCE_PORT ?? 5199),
);
/**
 * 验收真实部署时要用的地址（根路径部署）。
 * 给了就不起本地服务器，直接拿它当 baseURL。
 */
const urlArg = argv.find((a) => a.startsWith("--url="));
const TARGET_URL = (urlArg ? urlArg.slice("--url=".length) : process.env.ACCEPTANCE_URL) || null;

function ensureBuild() {
  const indexHtml = path.join(distDir, "index.html");
  if (existsSync(indexHtml) && !forceRebuild) {
    console.log(
      "· 复用已有的 app/dist（要强制重建：ACCEPTANCE_REBUILD=1 npm run acceptance）",
    );
    return;
  }
  console.log(
    forceRebuild
      ? "· 强制重建：npm run app:build …"
      : "· app/dist/index.html 不存在，先跑 npm run app:build …",
  );
  const r = spawnSync("npm run app:build", {
    cwd: repoRoot,
    stdio: "inherit",
    shell: true,
  });
  if (r.status !== 0) {
    throw new Error(`npm run app:build 失败（退出码 ${r.status}）`);
  }
  if (!existsSync(indexHtml)) {
    throw new Error("构建完了 app/dist/index.html 还是不在");
  }
}

function report(result) {
  const ok = result.failures.length === 0;
  console.log(`${ok ? "✓" : "✗"} ${result.title}`);
  for (const d of result.details) {
    console.log(`    · ${d}`);
  }
  for (const f of result.failures) {
    console.log(`    ! ${f}`);
  }
  console.log("");
  return ok;
}

async function main() {
  console.log("P2 验收（AGENTS.md §7）");
  console.log("──────────────────────────────");

  // 验真实部署：不需要本地产物，也不起服务器。
  let server = null;
  if (TARGET_URL) {
    console.log(`· 验收真实部署：${TARGET_URL}`);
  } else {
    ensureBuild();
    server = await startServer(distDir, PORT).catch((err) => {
      throw new Error(
        `静态服务器起不来（端口 ${PORT}）：${err?.message ?? err}\n` +
          `换一个端口：ACCEPTANCE_PORT=5200 npm run acceptance`,
      );
    });
    console.log(`· 静态服务器：${server.origin}（伺服 app/dist）`);
  }

  if (installBrowser) {
    console.log("· 下载 Playwright 自带的 chromium（体积较大）…");
    const r = spawnSync("npx playwright install chromium", {
      cwd: repoRoot,
      stdio: "inherit",
      shell: true,
    });
    if (r.status !== 0) {
      console.log("  （下载失败，继续尝试用系统 Chrome）");
    }
  }

  const { browser, via } = await launchBrowser();
  console.log(`· 浏览器：${via}`);

  const baseURL = TARGET_URL ?? server.origin;
  const results = [];
  try {
    results.push(await checkOffline({ browser, baseURL }));
    results.push(await checkIcs({ browser, baseURL }));
    results.push(await checkEventsRoundTrip({ browser, baseURL }));
    results.push(await checkCardReminder({ browser, baseURL }));
    results.push(await checkReminderLifecycle({ browser, baseURL }));
    results.push(await checkSkipToday({ browser, baseURL }));
    results.push(await checkCardCollapse({ browser, baseURL }));
    results.push(await checkNavigation({ browser, baseURL }));
    results.push(await checkImportRefreshesRoutine({ browser, baseURL }));
  } finally {
    await browser.close();
    await server?.close();
  }

  console.log("──────────────────────────────");
  let passed = 0;
  let failed = 0;
  for (const r of results) {
    if (report(r)) passed += 1;
    else failed += 1;
  }
  console.log(`结果：${passed} 通过 · ${failed} 失败`);
  console.log(
    "注：真机安装（iOS/Android）与两个日历 App 的实际导入提醒仍需人工验收。",
  );

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error("");
  console.error("验收脚本自身出错：");
  console.error(err?.stack ?? String(err));
  process.exitCode = 1;
});
