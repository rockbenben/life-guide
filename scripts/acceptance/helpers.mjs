/**
 * 浏览器与页面操作helpers。
 *
 * 原则：按**文字内容**找元素（getByText / getByRole），不靠 CSS 类名——
 * 界面类名随时可能改，而「导出数据」「清空记录」这样的文案是用户真正看见的东西。
 * 只有少数结构性定位（`[role="button"]`、`input[type=file]`）用了属性选择器，
 * 那是语义契约，不随改版而变。
 */
import { chromium } from "playwright";

function firstLine(err) {
  return String(err?.message ?? err).split("\n")[0];
}

/**
 * 起浏览器。优先用本机已装的 Google Chrome（channel: "chrome"），
 * 免去下载几百 MB 的 Playwright 自带浏览器；起不来再退回去。
 */
export async function launchBrowser() {
  const notes = [];

  try {
    const browser = await chromium.launch({ channel: "chrome" });
    return { browser, via: "系统已安装的 Google Chrome（channel: chrome）" };
  } catch (err) {
    notes.push("channel=chrome 起不来：" + firstLine(err));
  }

  try {
    const browser = await chromium.launch();
    return { browser, via: "Playwright 自带的 chromium" };
  } catch (err) {
    notes.push("自带 chromium 起不来：" + firstLine(err));
  }

  throw new Error(
    "没有可用的浏览器。\n    " +
      notes.join("\n    ") +
      "\n    下载 Playwright 自带的浏览器：npx playwright install chromium（体积较大），" +
      "或者用 --install-browser 让本脚本自动下载。",
  );
}

/** 切页签。按文字找，找不到就报错。 */
export async function gotoTab(page, label) {
  for (const role of ["button", "tab", "link"]) {
    const loc = page.getByRole(role, { name: label, exact: true });
    if ((await loc.count()) > 0) {
      await loc.first().click();
      return;
    }
  }
  const byText = page.getByText(label, { exact: true });
  if ((await byText.count()) > 0) {
    await byText.first().click();
    return;
  }
  throw new Error(`找不到「${label}」页签`);
}

/** 等今天的卡片渲染出来（App 加载 cards.json 是异步的）。 */
export async function waitForCards(page, timeout = 20000) {
  try {
    await page.waitForFunction(
      (t) => {
        const body = document.body.innerText || "";
        if (/读不到 cards\.json/.test(body)) return true;
        const mains = [...document.querySelectorAll("main")].filter(
          (m) => m.getClientRects().length > 0,
        );
        const main = mains[0];
        if (!main) return false;
        const text = main.innerText || "";
        if (/加载中/.test(text)) return false;
        return text.trim().length > 0;
      },
      timeout,
      { timeout },
    );
  } catch {
    const body = await page.locator("body").innerText();
    throw new Error(
      `等卡片渲染超时（${timeout}ms）。页面当前内容：\n${body.slice(0, 400)}`,
    );
  }

  const body = await page.locator("body").innerText();
  if (/读不到 cards\.json/.test(body)) {
    throw new Error("App 读不到 cards.json —— 先跑 npm run content:build 生成产物");
  }
}

/**
 * 让「今天」有内容可验。
 *
 * 首启已经有动作了：App 第一次打开会自己放几张起步的（早 / 日 / 晚 / 随时各最多 3 张）。
 * 验收要跑的是「做了动作之后会怎样」，所以先确认清单非空；
 * 万一某个环境里设置早就写过（清单被清空过），再走一遍真用户路径：
 * 点空态那个「放回起步的那几张」。
 */
export async function seedToday(page) {
  const seals = page.getByRole("button", { name: /盖上今天这一格|标记完成/ });
  if ((await seals.count()) > 0) return await seals.count();
  const pack = page.getByRole("button", { name: /放回默认|放回默认的那几张|放回起步的那几张|先放几张进今天|先按时段放几张起步/ });
  if ((await pack.count()) === 0) {
    throw new Error("今天既没有现成的卡，也没有起步按钮 —— 首启那几张没放出来？");
  }
  await pack.first().click();
  await page.waitForFunction(
    () => document.querySelectorAll(".lg-seal").length > 0,
    null,
    { timeout: 10000 },
  );
  return await seals.count();
}

/** 卡片头部（点它展开）。勾选按钮是它的一部分，所以要避开。 */
async function cardHead(article) {
  // 手帖行：卡片头就是那颗名字键
  const named = article.locator(".lg-name-btn");
  if ((await named.count()) > 0) return named.first();
  const explicit = article.locator('[role="button"]');
  if ((await explicit.count()) > 0) return explicit.first();
  // 卡片头若是真 <button>，就挑那个没有 aria-label 的（勾选按钮有 aria-label）
  const fallback = article.locator("button:not([aria-label])");
  if ((await fallback.count()) > 0) return fallback.first();
  throw new Error("卡片里找不到可点击的卡片头");
}

/**
 * 展开一张卡。
 * 勾选按钮固定在卡片头左上角，点歪了会变成「标记完成」而不是展开，
 * 所以点击位置取勾选按钮右边一点。
 */
export async function expandCard(article) {
  const head = await cardHead(article);
  const box = await head.boundingBox();
  if (!box) throw new Error("卡片头部没有布局盒（不可见？）");

  let x = box.width / 2;
  const check = article.getByRole("button", { name: /标记完成|取消完成|盖上今天这一格|取消今天这一格/ });
  if ((await check.count()) > 0) {
    const cb = await check.first().boundingBox();
    if (cb) {
      x = Math.min(
        Math.max(cb.x + cb.width - box.x + 30, 4),
        Math.max(box.width - 4, 4),
      );
    }
  }
  await head.click({ position: { x, y: Math.max(4, Math.min(box.height / 2, 24)) } });
}

/** 真的加载出来了的图片张数（naturalWidth > 0 才算加载成功）。 */
export async function countLoadedImages(scope) {
  return await scope.evaluate((root) => {
    const imgs = Array.from(root.querySelectorAll("img"));
    return imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
  });
}

/** 等图片加载稳定（连续两轮读数相同就认为稳了）。 */
export async function settleImages(page, scope, { timeout = 8000 } = {}) {
  // 步骤图是 loading="lazy"，不滚进视口就不会加载 —— 先把图片滚进视口再等
  const imgs = scope.locator("img");
  const n = await imgs.count().catch(() => 0);
  for (let i = 0; i < n; i++) {
    await imgs.nth(i).scrollIntoViewIfNeeded().catch(() => {});
  }
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)).catch(() => {});

  const deadline = Date.now() + timeout;
  let last = -1;
  let stable = 0;
  while (Date.now() < deadline) {
    const cur = await countLoadedImages(scope);
    if (cur === last) {
      stable += 1;
      if (stable >= 2) return cur;
    } else {
      stable = 0;
      last = cur;
    }
    await page.waitForTimeout(250);
  }
  return last;
}

/** 设置页里的「当前记录 N 条」。 */
export async function readRecordCount(page) {
  const texts = await page.getByText(/当前记录/).allInnerTexts();
  for (const t of texts) {
    const m = t.match(/当前记录\s*(\d+)\s*条/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** 导入用的 <input type=file>。优先从「导入数据」这个标签里找。 */
export async function findFileInput(page) {
  // 设置页是按需加载的（路由拆包）：切过去的那一下可能还在加载 chunk。
  // 等它出现，别把「还没画完」当成「没有导入按钮」。
  await page
    .locator('input[type="file"]')
    .first()
    .waitFor({ timeout: 10000 })
    .catch(() => {});
  const label = page.getByText("导入数据", { exact: true });
  if ((await label.count()) > 0) {
    const input = label.first().locator('input[type="file"]');
    if ((await input.count()) > 0) return input.first();
  }
  const any = page.locator('input[type="file"]');
  if ((await any.count()) > 0) return any.first();
  throw new Error("设置页里找不到导入用的 <input type=file>");
}

/** 读缓存清单（Cache Storage），用来确认 Service Worker 预缓存了什么。 */
export async function readCacheEntries(page) {
  return await page.evaluate(async () => {
    const names = await caches.keys();
    const urls = [];
    for (const name of names) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        urls.push(new URL(req.url).pathname);
      }
    }
    return urls;
  });
}
