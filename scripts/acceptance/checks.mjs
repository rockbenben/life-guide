/**
 * 浏览器级验收（共 8 项）：
 *
 *   1. 断网可完整使用一天        → checkOffline
 *   2. .ics 导入后按时提醒        → checkIcs（真机导入没法自动化，只能验文件本身对不对）
 *   3. 导出 → 清空 → 导入逐条一致 → checkEventsRoundTrip
 *   4. 卡片上设的提醒存得住       → checkCardReminder
 *   5. 移出/放回默认/周期撤销/批量撤销 → checkReminderLifecycle
 *   6. 今天不做只跳过当天，可撤销，移出日常才是永久 → checkSkipToday
 *   7. 导航去哪一页              → checkNavigation
 *   8. 导入备份后清单跟着换       → checkImportRefreshesRoutine
 *
 * 每项检查都用自己的浏览器 context，互不污染（事件日志存在 IndexedDB 里）。
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { validateIcs } from "./ics-rules.mjs";
import {
  countLoadedImages,
  expandCard,
  findFileInput,
  gotoTab,
  readCacheEntries,
  readRecordCount,
  seedToday,
  settleImages,
  waitForCards,
} from "./helpers.mjs";

/* ------------------------------------------------------------------ */
/* 工具                                                                */
/* ------------------------------------------------------------------ */

function normalize(text) {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

/** 页面上可见的 <main>（今天视图的卡片区）的文字。 */
async function mainText(page) {
  return await page.getByRole("main").first().innerText();
}

/** 每张卡（<article>）的文字，顺序与页面一致。 */
async function readArticles(page) {
  const articles = page.getByRole("article");
  const n = await articles.count();
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(normalize(await articles.nth(i).innerText()));
  }
  return out;
}

/**
 * 逐张展开卡片，数一数步骤图。
 * 步骤图只在展开态出现（Card.tsx 里只有 steps[].images 会被渲染），
 * 所以必须真的点开。
 */
async function measureCardImages(page) {
  const articles = page.getByRole("article");
  const n = await articles.count();
  let total = 0;
  let loaded = 0;
  let cardsWithImages = 0;

  for (let i = 0; i < n; i++) {
    const card = articles.nth(i);
    await card.scrollIntoViewIfNeeded().catch(() => {});
    await expandCard(card);
    const imgs = await card.locator("img").count();
    if (imgs === 0) continue;
    cardsWithImages += 1;
    total += imgs;
    loaded += await settleImages(page, card);
  }
  return { cards: n, cardsWithImages, total, loaded };
}

/* ------------------------------------------------------------------ */
/* 1. 断网可完整使用一天                                               */
/* ------------------------------------------------------------------ */

export async function checkOffline({ browser, baseURL }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const details = [];
  const failures = [];

  try {
    await page.goto(baseURL + "/", { waitUntil: "load" });
    await waitForCards(page);
    const seeded = await seedToday(page);
    details.push(`在线首次加载成功，今天放了 ${seeded} 张`);

    // Service Worker 必须真的激活并接管页面，否则断网重载就是白屏
    const sw = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) {
        return { ok: false, reason: "浏览器不支持 Service Worker" };
      }
      const timeout = new Promise((r) =>
        setTimeout(() => r({ ok: false, reason: "等 Service Worker 激活超时（20s）" }), 20000),
      );
      const ready = navigator.serviceWorker.ready.then(async (reg) => {
        // ready 解析时 worker 可能还停在 activating —— 预缓存没做完，
        // 必须等到 activated 才算稳
        const worker = reg.active;
        if (worker && worker.state !== "activated") {
          await new Promise((res) => {
            const onChange = () => {
              if (worker.state === "activated") res();
            };
            worker.addEventListener("statechange", onChange);
            setTimeout(res, 15000);
          });
        }
        return {
          ok: true,
          state: reg.active?.state ?? "none",
          scope: reg.scope,
        };
      });
      return Promise.race([ready, timeout]);
    });
    if (!sw.ok) throw new Error(sw.reason);
    if (sw.state !== "activated") {
      throw new Error(`Service Worker 状态是 ${sw.state}，不是 activated（预缓存可能没做完）`);
    }
    details.push(`Service Worker 已激活（state=${sw.state}，scope=${sw.scope}）`);

    // reload 一次让页面被 SW 接管
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
      timeout: 20000,
    });
    await waitForCards(page);
    details.push("页面已被 Service Worker 接管");

    // 预缓存里必须有卡片数据与图片
    const cached = await readCacheEntries(page);
    const cachedImages = cached.filter((u) => u.startsWith("/media/"));
    if (!cached.includes("/cards.json")) {
      failures.push("预缓存里没有 /cards.json，断网后拿不到卡片数据");
    }
    if (cachedImages.length === 0) {
      failures.push("预缓存里没有任何 /media/ 图片，断网后步骤图出不来");
    }
    details.push(
      `预缓存 ${cached.length} 项（其中 /media/ 图片 ${cachedImages.length} 张）`,
    );

    // 在线基线
    const onlineMain = normalize(await mainText(page));
    const onlineArticles = await readArticles(page);
    if (onlineArticles.length === 0) {
      throw new Error(
        "今天一张卡都没有（cards.json 可能是空的，或者 App 没渲染卡片）——基线无从谈起",
      );
    }
    const onlineImages = await measureCardImages(page);
    details.push(
      `在线：${onlineArticles.length} 张卡，步骤图 ${onlineImages.loaded}/${onlineImages.total} 张加载成功`,
    );

    // 断网重载
    await context.setOffline(true);
    try {
      try {
        await page.reload({ waitUntil: "load", timeout: 20000 });
      } catch (err) {
        throw new Error(
          `断网后重载失败：${err?.message ?? err}\n` +
            "      （Service Worker 没接管这次导航，navigateFallback 可能没生效）",
        );
      }
      await waitForCards(page);
      const offlineMain = normalize(await mainText(page));
      const offlineArticles = await readArticles(page);
      const offlineImages = await measureCardImages(page);
      details.push(
        `断网：${offlineArticles.length} 张卡，步骤图 ${offlineImages.loaded}/${offlineImages.total} 张加载成功`,
      );

      // 卡片文字（含标题、剂量、禁忌）要跟在线时一致
      if (offlineArticles.length !== onlineArticles.length) {
        failures.push(
          `断网后卡片数量变了：在线 ${onlineArticles.length} 张，断网 ${offlineArticles.length} 张`,
        );
      } else {
        for (let i = 0; i < onlineArticles.length; i++) {
          if (offlineArticles[i] !== onlineArticles[i]) {
            failures.push(
              `断网后第 ${i + 1} 张卡的文字变了。\n      在线：${onlineArticles[i].slice(0, 120)}\n      断网：${offlineArticles[i].slice(0, 120)}`,
            );
            break;
          }
        }
      }
      if (onlineMain !== offlineMain) {
        failures.push("断网后卡片区的文字与在线时不一致（卡片标题/剂量/禁忌没原样渲染）");
      }

      // 步骤图必须真的加载出来（naturalWidth > 0，不是占位）
      if (offlineImages.loaded < 1) {
        failures.push(
          `断网后没有任何步骤图加载成功（${offlineImages.loaded}/${offlineImages.total}）`,
        );
      } else if (offlineImages.loaded < onlineImages.loaded) {
        failures.push(
          `断网后加载成功的步骤图比在线时少：在线 ${onlineImages.loaded} 张，断网 ${offlineImages.loaded} 张`,
        );
      }

      // 手册也要能离线翻：目录来自 cards.json 索引，全文与图片在预缓存里。
      // 这条同时守着「路由拆包后的 Manual chunk 必须进预缓存」。
      await gotoTab(page, "手册");
      await page.waitForSelector(".lg-arts", { timeout: 20000 });
      const listText = normalize(await page.locator(".lg-arts").innerText());
      if (listText.length < 10) failures.push("断网后手册目录是空的");
      await page.locator(".lg-art").first().click();
      await page.waitForSelector(".lg-sec-h", { timeout: 20000 });
      const articleText = normalize(await page.locator(".lg-read").innerText());
      if (articleText.length < 50) {
        failures.push("断网后手册文章正文没有渲染出来");
      } else {
        details.push("断网：手册目录与文章都能打开");
      }
    } finally {
      await context.setOffline(false);
    }
  } catch (err) {
    failures.push(String(err?.message ?? err));
  } finally {
    await context.close();
  }

  return { id: "offline", title: "断网可完整使用一天", details, failures };
}

/* ------------------------------------------------------------------ */
/* 2. .ics 文件本身对不对                                               */
/* ------------------------------------------------------------------ */

export async function checkIcs({ browser, baseURL }) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const details = [];
  const failures = [];

  try {
    await page.goto(baseURL + "/", { waitUntil: "load" });
    await waitForCards(page);
    await gotoTab(page, "设置");

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.getByRole("button", { name: /导出日历/ }).first().click(),
    ]);
    const file = await download.path();
    if (!file) throw new Error("点「导出日历（.ics）」没有产生下载");
    details.push(`下载到 ${download.suggestedFilename()}`);

    const text = await readFile(file, "utf8");
    const verdict = validateIcs(text);
    details.push(...verdict.details);
    failures.push(...verdict.failures);
  } catch (err) {
    failures.push(String(err?.message ?? err));
  } finally {
    await context.close();
  }

  return { id: "ics", title: ".ics 导出为两条定时重复事件", details, failures };
}

/* ------------------------------------------------------------------ */
/* 3. 导出 → 清空 → 导入，逐条一致                                      */
/* ------------------------------------------------------------------ */

function eventKey(e) {
  return JSON.stringify([e.date, e.cardId, e.variant, e.ts]);
}

function sortedEvents(events) {
  return (events ?? []).map(eventKey).sort();
}

export async function checkEventsRoundTrip({ browser, baseURL }) {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const details = [];
  const failures = [];

  try {
    await page.goto(baseURL + "/", { waitUntil: "load" });
    await waitForCards(page);
    await seedToday(page);

    // 勾 2～3 张卡
    const available = await page.getByRole("button", { name: /盖上今天这一格|标记完成/ }).count();
    if (available < 2) {
      throw new Error(`今天只看到 ${available} 张可勾选的卡，不足以做往返验证`);
    }
    const n = Math.min(3, available);
    for (let i = 0; i < n; i++) {
      await page.getByRole("button", { name: /盖上今天这一格|标记完成/ }).first().click();
      await page
        .getByRole("button", { name: /取消今天这一格|取消完成/ })
        .nth(i)
        .waitFor({ timeout: 10000 });
    }
    details.push(`在「今天」页勾选了 ${n} 张卡`);

    await gotoTab(page, "设置");
    await page.getByText(/当前记录/).first().waitFor({ timeout: 10000 });

    const before = await readRecordCount(page);
    if (before !== n) {
      failures.push(`勾选后「当前记录」是 ${before} 条，期望 ${n} 条`);
    }

    // 导出
    const [dl1] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.getByRole("button", { name: "导出数据", exact: true }).click(),
    ]);
    const file1 = await dl1.path();
    if (!file1) throw new Error("点「导出数据」没有产生下载文件");
    const backup1 = JSON.parse(await readFile(file1, "utf8"));
    if (!Array.isArray(backup1.events)) {
      failures.push("导出的 JSON 里没有 events 数组");
    }
    if (backup1.events?.length !== n) {
      failures.push(
        `导出的 JSON 里有 ${backup1.events?.length} 条记录，期望 ${n} 条`,
      );
    }
    details.push(`导出 ${dl1.suggestedFilename()}（${backup1.events?.length ?? 0} 条）`);

    // 清空
    // 清空是不可撤销的，App 会先问一句（window.confirm）—— 这里替用户答「是」。
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "清空记录", exact: true }).click();
    await page.getByText(/已清空/).first().waitFor({ timeout: 10000 });
    const cleared = await readRecordCount(page);
    if (cleared !== 0) {
      failures.push(`点「清空记录」后仍是 ${cleared} 条，期望 0 条`);
    }
    details.push("清空记录 → 0 条");

    // 导入刚导出的那份
    // 导入是替换不是合并，App 会先问一句（window.confirm）—— 这里替用户答「是」。
    page.once("dialog", (d) => d.accept());
    const input = await findFileInput(page);
    await input.setInputFiles(file1);
    await page.getByText(/已导入\s*\d+\s*条记录/).first().waitFor({ timeout: 10000 });
    const after = await readRecordCount(page);
    if (after !== n) {
      failures.push(`导入后「当前记录」是 ${after} 条，期望 ${n} 条`);
    }
    details.push(`导入 → ${after} 条`);

    // 再导出一次，逐条比对
    const [dl2] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.getByRole("button", { name: "导出数据", exact: true }).click(),
    ]);
    const file2 = await dl2.path();
    if (!file2) throw new Error("第二次点「导出数据」没有产生下载文件");
    const backup2 = JSON.parse(await readFile(file2, "utf8"));

    const a = sortedEvents(backup1.events);
    const b = sortedEvents(backup2.events);
    if (a.length !== b.length) {
      failures.push(`导入前后记录条数不一致：导出时 ${a.length} 条，再导出 ${b.length} 条`);
    } else {
      for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
          failures.push(
            `第 ${i + 1} 条记录导入前后不一致：\n      导出时 ${a[i]}\n      导入后 ${b[i]}`,
          );
          break;
        }
      }
    }
    if (a.length === b.length && a.every((x, i) => x === b[i])) {
      details.push(`逐条比对：${a.length} 条记录（date/cardId/variant/ts）完全一致`);
    }
  } catch (err) {
    failures.push(String(err?.message ?? err));
  } finally {
    await context.close();
  }

  return { id: "events", title: "导出 → 清空 → 导入后事件日志逐条一致", details, failures };
}

/* ------------------------------------------------------------------ */
/* 4. 卡片上设的提醒：存得住、看得见、删得掉                            */
/* ------------------------------------------------------------------ */

export async function checkCardReminder({ browser, baseURL }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const details = [];
  const failures = [];

  try {
    await page.goto(baseURL + "/", { waitUntil: "load" });
    await waitForCards(page);
    await seedToday(page);

    // 展开第一张卡，在卡上设一条「每周 08:30」的提醒
    const card = page.getByRole("article").first();
    await expandCard(card);
    await card.getByRole("button", { name: "设提醒" }).click();
    await card.getByRole("radio", { name: "每周" }).click();
    await card.getByLabel("提醒时刻").fill("08:30");
    await card.getByRole("button", { name: "保存" }).click();

    const row = await card.innerText();
    if (!/每周/.test(row) || !/08:30/.test(row)) {
      failures.push(`保存之后卡上那一行没显示时间（当前文字：${row.slice(0, 400)}）`);
    } else {
      details.push("卡上那一行显示了：每周… 08:30");
    }

    // 重开 App：提醒得还在（存在 IndexedDB 里）
    await page.reload({ waitUntil: "load" });
    await waitForCards(page);
    const again = page.getByRole("article").first();
    await expandCard(again);
    const row2 = await again.innerText();
    if (!/08:30/.test(row2)) {
      failures.push("重开 App 后那条提醒没了（没存住）");
    } else {
      details.push("重开 App 后提醒还在");
    }

    // 设置页要看得见它
    await gotoTab(page, "设置");
    await page.getByText(/绑在卡上的提醒/).first().waitFor({ timeout: 10000 });
    details.push("设置页列出了绑在卡上的提醒");

    // 删掉它
    await page.getByRole("button", { name: "删掉" }).first().click();
    await page
      .getByText(/绑在卡上的提醒/)
      .first()
      .waitFor({ state: "detached", timeout: 10000 })
      .catch(() => {});
    const stillThere = await page.getByText(/绑在卡上的提醒/).count();
    if (stillThere > 0) {
      failures.push("在设置页删掉了，但列表还在");
    } else {
      details.push("在设置页删掉了");
    }

    // 删了之后重开也不能回来
    await page.reload({ waitUntil: "load" });
    // 刷新后停在原来那一页（页面跟着地址栏走，见 app/src/main.tsx 的 tabFromHash），
    // 所以先回到今天页，等卡片渲染出来再去看设置页
    await gotoTab(page, "今天");
    await waitForCards(page);
    await gotoTab(page, "设置");
    await page.getByText(/绑在卡上的提醒/).first().waitFor({ timeout: 5000 }).catch(() => {});
    const back = await page.getByText(/绑在卡上的提醒/).count();
    if (back > 0) {
      failures.push("删掉之后重开 App，那条提醒又回来了");
    } else {
      details.push("删掉之后重开也没回来");
    }
  } catch (err) {
    failures.push(String(err?.message ?? err));
  } finally {
    await context.close();
  }

  return { id: "card-reminder", title: "卡片上设的提醒存得住、也删得掉", details, failures };
}

/* ------------------------------------------------------------------ */
/* 5. 提醒生命周期：调顺序移出、放回默认、周期撤销、批量撤销             */
/* ------------------------------------------------------------------ */

async function writeSettings(page, entries) {
  await page.evaluate(
    (entries) =>
      new Promise((res, rej) => {
        const r = indexedDB.open("life-guide");
        r.onsuccess = () => {
          const tx = r.result.transaction("settings", "readwrite");
          const store = tx.objectStore("settings");
          for (const [key, value] of Object.entries(entries)) store.put({ key, value });
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        };
        r.onerror = () => rej(r.error);
      }),
    entries,
  );
}

async function readSettings(page, keys) {
  return await page.evaluate(
    (keys) =>
      new Promise((res, rej) => {
        const r = indexedDB.open("life-guide");
        r.onsuccess = () => {
          const store = r.result.transaction("settings", "readonly").objectStore("settings");
          const out = {};
          let left = keys.length;
          for (const key of keys) {
            const req = store.get(key);
            req.onsuccess = () => {
              out[key] = req.result?.value;
              if (--left === 0) res(out);
            };
            req.onerror = () => rej(req.error);
          }
        };
        r.onerror = () => rej(r.error);
      }),
    keys,
  );
}

async function readEvents(page) {
  return await page.evaluate(
    () =>
      new Promise((res, rej) => {
        const r = indexedDB.open("life-guide");
        r.onsuccess = () => {
          const req = r.result.transaction("events", "readonly").objectStore("events").getAll();
          req.onsuccess = () => res(req.result);
          req.onerror = () => rej(req.error);
        };
        r.onerror = () => rej(r.error);
      }),
  );
}

async function writeEvents(page, events) {
  await page.evaluate(
    (events) =>
      new Promise((res, rej) => {
        const r = indexedDB.open("life-guide");
        r.onsuccess = () => {
          const tx = r.result.transaction("events", "readwrite");
          const store = tx.objectStore("events");
          store.clear();
          for (const e of events) store.put(e);
          tx.oncomplete = () => res();
          tx.onerror = () => rej(tx.error);
        };
        r.onerror = () => rej(r.error);
      }),
    events,
  );
}

const CARD_REMINDER_BASES = [
  { id: "morning", cardId: null, label: "早晨", mode: "daily", time: "07:00", slot: "morning", on: true },
  { id: "evening", cardId: null, label: "晚间", mode: "daily", time: "21:00", slot: "evening", on: true },
];

export async function checkReminderLifecycle({ browser, baseURL }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const details = [];
  const failures = [];
  const fail = (m) => failures.push(m);

  try {
    await page.goto(baseURL + "/", { waitUntil: "load" });
    await waitForCards(page);
    const bundle = await page.evaluate(async () => await (await fetch("cards.json")).json());
    const defaults = bundle.defaultRoutine;
    const named = defaults
      .map((id) => bundle.cards.find((c) => c.id === id))
      .filter((c) => c?.name);
    if (named.length < 2) throw new Error("默认清单里找不到两张有名卡的卡，无法测调顺序");
    const [a, b] = named;
    const baseReminders = [
      ...CARD_REMINDER_BASES,
      { id: `card:${a.id}`, cardId: a.id, label: a.name, mode: "daily", time: "09:00", on: true },
      { id: `card:${b.id}`, cardId: b.id, label: b.name, mode: "daily", time: "09:00", on: true },
    ];
    const seed = async (routine, reminders = CARD_REMINDER_BASES) => {
      await writeSettings(page, {
        myRoutine: routine,
        tags: ["age:adult"],
        firstRunPending: false,
        reminders,
        cadence: {},
      });
      await page.reload({ waitUntil: "load" });
      await waitForCards(page);
      await gotoTab(page, "今天");
    };

    // 调顺序：有提醒先问；取消 / 只移卡 / 一起删
    await seed(defaults, baseReminders);
    await page.getByRole("button", { name: "调顺序" }).click();
    await page.locator(".lg-sort").waitFor({ timeout: 10000 });
    let row = page.locator(".lg-sortlist li").filter({ hasText: a.name }).first();
    await row.getByRole("button", { name: /移出日常/ }).click();
    let ask = row.locator(".lg-sort-ask");
    await ask.waitFor({ timeout: 5000 });
    if (!/这张卡有提醒/.test(await ask.innerText())) fail("调顺序移出时没有显示提醒询问");
    await ask.getByRole("button", { name: "取消" }).click();
    let s = await readSettings(page, ["myRoutine", "reminders"]);
    if (!s.myRoutine.includes(a.id) || !s.reminders.some((r) => r.cardId === a.id)) {
      fail("调顺序取消后卡片或提醒被改动");
    }
    row = page.locator(".lg-sortlist li").filter({ hasText: a.name }).first();
    await row.getByRole("button", { name: /移出日常/ }).click();
    await row.getByRole("button", { name: "只移卡" }).click();
    await page.waitForTimeout(150);
    s = await readSettings(page, ["myRoutine", "reminders"]);
    if (s.myRoutine.includes(a.id) || !s.reminders.some((r) => r.cardId === a.id)) {
      fail("只移卡后：卡应移出、提醒应保留");
    }
    row = page.locator(".lg-sortlist li").filter({ hasText: b.name }).first();
    await row.getByRole("button", { name: /移出日常/ }).click();
    await row.getByRole("button", { name: "一起删" }).click();
    await page.waitForTimeout(150);
    s = await readSettings(page, ["reminders"]);
    if (s.reminders.some((r) => r.cardId === b.id)) fail("一起删后提醒仍在");
    details.push("调顺序：取消 / 只移卡 / 一起删三条分支正确");

    // 放回默认：确认文案与提示条都要说明提醒会被删
    const extra = bundle.cards.find(
      (c) => c.articleKind !== "condition" && !defaults.includes(c.id) && c.name,
    );
    if (!extra) throw new Error("找不到默认清单外的卡，无法测放回默认");
    const extraReminders = [
      ...CARD_REMINDER_BASES,
      { id: `card:${extra.id}`, cardId: extra.id, label: extra.name, mode: "daily", time: "09:00", on: true },
    ];
    await seed([...defaults, extra.id], extraReminders);
    let msg = "";
    page.once("dialog", async (d) => {
      msg = d.message();
      await d.accept();
    });
    await page.getByRole("button", { name: "放回默认" }).click();
    await page.waitForTimeout(300);
    if (!/有提醒/.test(msg)) fail(`放回默认确认没提提醒：${msg}`);
    s = await readSettings(page, ["myRoutine", "reminders"]);
    if (s.myRoutine.includes(extra.id)) fail("放回默认后额外卡还在");
    if (s.reminders.some((r) => r.cardId === extra.id)) fail("放回默认后额外卡的提醒还在");
    const flash = await page.locator(".lg-flash").innerText().catch(() => "");
    if (!/提醒也删了|提醒/.test(flash)) fail(`放回默认提示条没提提醒：${flash}`);
    details.push("放回默认：确认文案、提示条、提醒清理都正确");

    // 周期撤销：只降级完成标记，不删历史事件
    const weekly = bundle.cards.find(
      (c) => c.articleKind !== "condition" && /每周/.test(c.remind?.text ?? ""),
    );
    if (!weekly) {
      fail("找不到周卡，无法测周期撤销");
    } else {
      const dates = await page.evaluate(() => {
        const now = new Date();
        // 与 App 的 04:00 日界线一致：凌晨仍算前一天所在周
        const logical = new Date(now);
        if (now.getHours() < 4) logical.setDate(logical.getDate() - 1);
        const iso = (d) =>
          `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const today = iso(logical);
        const monday = new Date(logical);
        monday.setDate(logical.getDate() - ((logical.getDay() + 6) % 7));
        const week = [];
        for (let i = 0; i < 7; i++) {
          const d = new Date(monday);
          d.setDate(monday.getDate() + i);
          const date = iso(d);
          // 测试不要在“今天”留旧事件：撤回后印章应为空，才能测重新盖章
          if (date !== today) week.push(date);
        }
        return week.slice(0, 2);
      });
      const events = dates.map((date, i) => ({
        date,
        cardId: weekly.id,
        variant: "normal",
        ts: Date.now() + i,
      }));
      await seed([...defaults, weekly.id], CARD_REMINDER_BASES);
      // seed 会 reload；写入事件要在 reload 之后做，否则工作区被替换
      await writeEvents(page, events);
      await page.reload({ waitUntil: "load" });
      await waitForCards(page);
      await gotoTab(page, "今天");
      const doneButton = page
        .locator(".lg-perioddone button")
        .filter({ hasText: weekly.name ?? weekly.id })
        .first();
      await doneButton.waitFor({ timeout: 10000 });
      await doneButton.click();
      await page.waitForTimeout(200);
      const after = await readEvents(page);
      if (after.length !== 2) fail(`周期撤销后事件数变了：${after.length}（应保留 2 条的）`);
      if (!after.some((e) => e.periodDone === false)) {
        fail("周期撤销没有把完成标记降级为 false");
      }
      if (after.some((e) => e.periodDone === true)) {
        fail("周期撤销后还留着完成标记");
      }
      if (!after.some((e) => e.periodDone === false && e.periodCadence === "weekly")) {
        fail("周期撤销没有记下当时的每周频率");
      }
      if (await page.locator(".lg-perioddone").count()) fail("周期撤销后「本周期已完成」还在");

      // 再盖一次：新盖章要写入 periodDone: true；再撤销仍不能删历史
      const weekCard = page
        .locator("article.lg-card")
        .filter({ hasText: weekly.name ?? weekly.id })
        .first();
      await weekCard.getByRole("button", { name: "盖上今天这一格" }).click();
      await page.waitForTimeout(200);
      const restamped = await readEvents(page);
      if (!restamped.some((e) => e.periodDone === true)) {
        fail("周期卡新盖章没有写入 periodDone:true");
      }
      if (!restamped.some((e) => e.periodDone === true && e.periodCadence === "weekly")) {
        fail("周期卡新盖章没有写入 periodCadence:weekly");
      }
      const again = page.locator(".lg-perioddone button").filter({ hasText: weekly.name ?? weekly.id }).first();
      await again.waitFor({ timeout: 5000 });
      await again.click();
      await page.waitForTimeout(200);
      const secondUndo = await readEvents(page);
      if (secondUndo.length !== 3 || secondUndo.some((e) => e.periodDone === true)) {
        fail("周期卡第二次撤销又删了事件或没降级标记");
      }
      if (!secondUndo.some((e) => e.periodDone === false)) {
        fail("周期卡第二次撤销没有留下 false 标记");
      }
      details.push("周期撤销：历史事件保留，完成标记降级，卡片回到今天（新盖章再撤销也保留 3 条）");
    }

    // 批量加入撤销：只撤回本次加入的卡
    const byPath = new Map();
    for (const c of bundle.cards) {
      if (c.articleKind === "condition") continue;
      const p = String(c.articlePath ?? "").replace(/^the-savvy-life-manual\//, "");
      if (!p) continue;
      if (!byPath.has(p)) byPath.set(p, []);
      byPath.get(p).push(c);
    }
    const top = [...byPath.entries()].sort((x, y) => y[1].length - x[1].length)[0];
    const topArticle = bundle.articles.find((a) => a.path === top?.[0]);
    const newIds = top ? top[1].filter((c) => !defaults.includes(c.id)) : [];
    if (!top || !topArticle || newIds.length < 2) {
      fail("找不到至少两张新动作的文章，无法测批量撤销");
    } else {
      await seed(defaults, CARD_REMINDER_BASES);
      const before = await readSettings(page, ["myRoutine"]);
      await gotoTab(page, "手册");
      const search = page.locator('input[type="search"]');
      await search.fill(topArticle.title);
      const art = page.locator(".lg-art").filter({ hasText: topArticle.title }).first();
      await art.waitFor({ timeout: 15000 });
      await art.click();
      const bulk = page.getByRole("button", { name: new RegExp(`把这一篇的 ${newIds.length} 个动作一起放进日常`) });
      await bulk.waitFor({ timeout: 15000 });
      await bulk.click();
      const note = page.locator("p[role=status]").filter({ hasText: "一起放进日常" }).first();
      await note.waitFor({ timeout: 5000 });
      await page.waitForTimeout(250); // setSetting 是异步的，别在写库前读
      const afterBulk = await readSettings(page, ["myRoutine"]);
      if (afterBulk.myRoutine.length !== before.myRoutine.length + newIds.length) {
        fail("批量加入没有加满文章里的动作");
      }
      await note.getByRole("button", { name: "撤销" }).click();
      await page.waitForTimeout(250);
      const afterUndo = await readSettings(page, ["myRoutine"]);
      if (afterUndo.myRoutine.length !== before.myRoutine.length) {
        fail("批量撤销后日常数量没有回到原值");
      }
      details.push(`批量加入撤销：${newIds.length} 张加入后撤销回到原数量`);
    }
  } catch (err) {
    failures.push(String(err?.message ?? err));
  } finally {
    await context.close();
  }

  return {
    id: "reminder-lifecycle",
    title: "移出/放回默认/周期撤销/批量撤销的提醒生命周期",
    details,
    failures,
  };
}

/* ------------------------------------------------------------------ */
/* 5b. 今天不做：只跳过当天，不改日常；可撤销，次日自动回来              */
/* ------------------------------------------------------------------ */

export async function checkSkipToday({ browser, baseURL }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const details = [];
  const failures = [];
  const fail = (m) => failures.push(m);

  try {
    await page.goto(baseURL + "/", { waitUntil: "load" });
    await waitForCards(page);
    const bundle = await page.evaluate(async () => await (await fetch("cards.json")).json());

    await writeSettings(page, {
      myRoutine: bundle.defaultRoutine,
      tags: ["age:adult"],
      firstRunPending: false,
      reminders: CARD_REMINDER_BASES,
      cadence: {},
      skipToday: {},
    });
    await page.reload({ waitUntil: "load" });
    await waitForCards(page);
    await gotoTab(page, "今天");

    const article = page.getByRole("article").first();
    await article.waitFor({ timeout: 10000 });
    const name = normalize(await article.locator(".lg-name").innerText());
    await expandCard(article);
    // 「跳到本卡末尾（今天不做 · 移出日常）」也是一个按钮，名字里含这几个字；
    // 要点的是展开态页脚里的那颗，exact 必须开。
    await page
      .locator(".lg-rowfoot")
      .getByRole("button", { name: "今天不做", exact: true })
      .click();
    await page.waitForTimeout(300);

    if ((await page.getByRole("article").filter({ hasText: name }).count()) !== 0) {
      fail(`点「今天不做」后「${name}」还在今天清单里`);
    }
    const s1 = await readSettings(page, ["skipToday", "myRoutine"]);
    const cardId = Object.keys(s1.skipToday ?? {})[0];
    if (!cardId) fail("「今天不做」没有写入 skipToday");
    if (!s1.myRoutine.includes(cardId)) fail("「今天不做」不该改动 myRoutine");
    const undo = page
      .locator(".lg-skipped .lg-skipitem")
      .filter({ hasText: name })
      .getByRole("button", { name: "撤销", exact: true });
    if ((await undo.count()) !== 1) fail("没有出现「今天不做」的撤销入口");
    details.push(`「${name}」今天不做：从清单消失，日常未动`);

    await undo.click();
    await page.waitForTimeout(300);
    if ((await page.getByRole("article").filter({ hasText: name }).count()) < 1) {
      fail("撤销后卡没有回到今天");
    }
    const s2 = await readSettings(page, ["skipToday"]);
    if (Object.keys(s2.skipToday ?? {}).length) fail("撤销后 skipToday 没有清空");
    details.push("撤销后回到今天");

    // 模拟「昨天跳过」：日期对不上，今天必须自然回来
    await writeSettings(page, { skipToday: { [cardId]: "2000-01-01" } });
    await page.reload({ waitUntil: "load" });
    await waitForCards(page);
    await gotoTab(page, "今天");
    if ((await page.getByRole("article").filter({ hasText: name }).count()) < 1) {
      fail("昨天的跳过记录把今天的卡藏掉了");
    }
    details.push("跨天后旧跳过记录不生效");

    // 永久移出：从日常消失，并清掉这张卡的跳过记录
    const back = page.getByRole("article").filter({ hasText: name }).first();
    await expandCard(back);
    await page
      .locator(".lg-rowfoot")
      .getByRole("button", { name: "移出日常", exact: true })
      .click();
    await page.waitForTimeout(300);
    const s3 = await readSettings(page, ["skipToday", "myRoutine"]);
    if (s3.myRoutine.includes(cardId)) fail("「移出日常」后卡还在 myRoutine 里");
    if (cardId in (s3.skipToday ?? {})) fail("「移出日常」后 skipToday 里还留着旧记录");
    details.push("永久移出会清掉跳过记录");
  } catch (err) {
    failures.push(String(err?.message ?? err).split("\n")[0]);
  } finally {
    await context.close();
  }

  return {
    id: "skip-today",
    title: "今天不做只跳过当天，可撤销，移出日常才是永久",
    details,
    failures,
  };
}

/* ------------------------------------------------------------------ */
/* 6. 导航：点哪个键，就得去那个地方                                    */
/* ------------------------------------------------------------------ */

/**
 * 这条盯的是「点导航的「手册」到哪」。
 *
 * 出过这样的事：手册页记着上次打开的那一篇，于是点导航的「手册」，
 * 用户被丢进一篇（多半是三天前读的）文章，而不是手册的列表 ——
 * 标签写「手册」，去的地方却是某一篇。打开某篇有两条明明白白的路：
 * 列表里点它，或卡片里的「出自〈那一篇〉」。
 */
export async function checkNavigation({ browser, baseURL }) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const details = [];
  const failures = [];

  const where = async () =>
    await page.evaluate(() => ({
      isArticle: !!document.querySelector(".lg-read"),
      isList: !!document.querySelector(".lg-art"),
    }));

  try {
    await page.goto(baseURL + "/", { waitUntil: "load" });
    await waitForCards(page);

    await gotoTab(page, "手册");
    await page.locator(".lg-art").first().waitFor({ timeout: 10000 });
    let w = await where();
    if (!w.isList) {
      failures.push("点导航的「手册」没有到手册列表");
    } else {
      details.push("点「手册」到手册列表");
    }

    // 打开一篇
    await page.locator(".lg-art").first().click();
    await page.locator(".lg-read").first().waitFor({ timeout: 10000 });
    w = await where();
    if (!w.isArticle) {
      failures.push("点了文章，进去的不是文章");
    } else {
      details.push("点列表里的一篇，进了那篇");
    }

    // 从今天页再点「手册」：该回列表，不是回到上次那篇
    await gotoTab(page, "今天");
    await waitForCards(page);
    await gotoTab(page, "手册");
    await page.waitForTimeout(400);
    w = await where();
    if (!w.isList) {
      failures.push("从今天再点「手册」，没有回到手册列表（还是上次那篇？）");
    } else {
      details.push("从今天再点「手册」，回到手册列表");
    }
  } catch (err) {
    failures.push(String(err?.message ?? err));
  } finally {
    await context.close();
  }

  return { id: "navigation", title: "点导航就到该去的地方", details, failures };
}

/* ------------------------------------------------------------------ */
/* 6. 导入备份：清单要跟着换                                            */
/* ------------------------------------------------------------------ */

/**
 * 这条盯的是「换设备」那条路：把旧设备的备份导进新设备。
 *
 * 清单这个 hook 挂在 App 层，不随页签重挂载 —— 导入之后它不知道库里的清单换了，
 * 界面还摆着导入前的那份；用户改一下（加一条自己的习惯、移出一张、调顺序），
 * 就用旧清单把刚导入的那份盖掉了，导入等于没做。
 */
export async function checkImportRefreshesRoutine({ browser, baseURL }) {
  const context = await browser.newContext({ viewport: { width: 1180, height: 900 } });
  const page = await context.newPage();
  const details = [];
  const failures = [];
  const tmp = path.join(os.tmpdir(), `life-guide-import-check-${Date.now()}.json`);

  const routineInDb = async () =>
    await page.evaluate(async () => {
      const req = indexedDB.open("life-guide", 2);
      const db = await new Promise((res, rej) => {
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
      });
      const row = await new Promise((res, rej) => {
        const r = db.transaction("settings", "readonly").objectStore("settings").get("myRoutine");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
      db.close();
      return row?.value ?? null;
    });

  try {
    await page.goto(baseURL + "/", { waitUntil: "load" });
    await waitForCards(page);
    await seedToday(page);
    const before = await page.locator("div.lg-log").first().locator("article").count();

    // 一份「另一台设备导出的」备份：清单一张卡 + 一条自己的习惯
    // 习惯的时段写 anytime：「随时」的那几张每个时段都在，
    // 检查不该依赖「现在几点」—— 否则中午跑和早上跑结果不一样。
    const backup = {
      schemaVersion: 2,
      exportedAt: new Date().toISOString(),
      events: [],
      settings: { tags: [], mode: "normal", myRoutine: ["morning-light", "my-imported-habit"] },
      custom: [
        {
          id: "my-imported-habit",
          name: "从旧设备带来的习惯",
          text: "每天做一点",
          slot: "anytime",
          createdAt: "2026-10-20T09:00:00.000Z",
        },
      ],
    };
    await writeFile(tmp, JSON.stringify(backup, null, 2), "utf8");

    await gotoTab(page, "设置");
    // 导入会替换现有数据，App 先弹确认 —— 这里替用户答「是」。
    page.once("dialog", (d) => d.accept());
    const input = await findFileInput(page);
    await input.setInputFiles(tmp);
    await page.getByText(/已导入\s*\d+\s*条记录/).first().waitFor({ timeout: 10000 });

    await gotoTab(page, "今天");
    await page.waitForTimeout(400);
    const names = await page.locator("div.lg-log").first().locator(".lg-name").allInnerTexts();
    // 界面上能看到的只有那条「随时」的习惯（手册卡属于早晨，
    // 中午看的是日间那一段）；清单里有没有它，看库里的那份。
    if (!names.some((n) => n.includes("从旧设备带来的习惯"))) {
      failures.push(
        `导入后今天页是 ${JSON.stringify(names)}（里面没有备份带来的那条习惯）`,
      );
    } else {
      details.push("导入后今天页出现了备份带来的那条习惯");
    }

    // 再动一下清单：应该接在导入的那份后面，而不是回到导入前的默认清单
    await page.getByRole("button", { name: "加自己的习惯" }).first().click();
    await page.locator(".lg-habitform input[type=text]").first().fill("验收用习惯");
    await page.getByRole("button", { name: "保存" }).first().click();
    await page.waitForTimeout(800);
    const db = await routineInDb();
    // 导入的两条（手册卡 + 自己的习惯）+ 刚加的那一条 = 三条
    if (!Array.isArray(db) || db.length !== 3 || !db.includes("morning-light")) {
      failures.push(
        `导入的清单被改动了：库里现在是 ${JSON.stringify(db)}（应该是导入的两条 + 新加的一条）`,
      );
    } else {
      details.push("之后的改动接在导入的那份后面，没有把导入结果盖掉");
    }
    if (before <= 1) {
      details.push(`（导入前清单是 ${before} 张，本来就少，说明不了问题）`);
    }
  } catch (err) {
    failures.push(String(err?.message ?? err));
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
    await context.close();
  }

  return { id: "import-routine", title: "导入备份后清单跟着换", details, failures };
}
