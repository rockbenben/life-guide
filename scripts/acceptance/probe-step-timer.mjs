/**
 * 分步计时器的实测脚本（`npm run probe:step-timer`）。
 *
 * **为什么单独写一个**：验收项（`checkStepTimer`）只看一张卡（血管拉伸），
 * 验的是「读数在走、暂停能停、归零跳步」。但**别的卡上显示成什么样**，
 * 验收项看不见 —— 而实测就是这么找出两个问题的：
 *   · 冷藏 5 小时那一步走正计时，读数起手是 `00:00`，看着像坏了
 *   · 「等约 5 小时 0 分」里的「0 分」是多余的
 *
 * 它把清单换成一张指定卡、展开、读出计时器实际显示的东西。
 * **只读不改**（除了往 IndexedDB 里写 myRoutine —— 那是验收脚本的老办法）。
 */
import { startServer } from "./acceptance/server.mjs";
import { launchBrowser, gotoTab, waitForCards, seedToday, expandCard } from "./acceptance/helpers.mjs";

const PORT = Number(process.env.PROBE_PORT ?? 5313);

/** 要看的卡：每张写清楚「在验什么」。 */
const CASES = [
  ["vascular-stretch", "正常串行：5 个动作各 30 秒"],
  ["bath-temperature-duration", "警示步不该计时"],
  ["anterior-abdominal-core", "重复步不该数两遍"],
  ["miso-basque-cheesecake", "冷藏 5 小时 → 正计时 → 要说清等多久"],
  ["make-tender-chicken-breast", "冷藏与煎是并行"],
  ["milk-boil-ripening", "煮 10 分钟 → 冷藏 20 分钟"],
  ["avocado-hamburger-patty", "煎 3 分钟 → 再煎 5～6 分钟"],
  ["slow-first-drink", "同一件事的两种说法不该数两遍"],
];

const srv = await startServer("app/dist", PORT);
const { browser } = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1180, height: 1000 } });
const page = await context.newPage();

/** 把「我的日常」换成指定的那几张（直接写库，定得下来）。 */
async function setRoutine(ids) {
  await page.evaluate(
    (ids) =>
      new Promise((res, rej) => {
        const r = indexedDB.open("life-guide");
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction("settings", "readwrite");
          const store = tx.objectStore("settings");
          const g = store.get("myRoutine");
          g.onsuccess = () => {
            store.put({ key: "myRoutine", value: ids, updatedAt: g.result?.updatedAt ?? Date.now() });
            tx.oncomplete = () => { db.close(); res(); };
            tx.onerror = () => rej(tx.error);
          };
          g.onerror = () => rej(g.error);
        };
        r.onerror = () => rej(r.error);
      }),
    ids,
  );
  await page.reload({ waitUntil: "load" });
  await waitForCards(page);
  await gotoTab(page, "今天");
  await page.waitForTimeout(350);
}

await page.goto(`http://localhost:${PORT}/`, { waitUntil: "load" });
await waitForCards(page);
await seedToday(page);

for (const [id, why] of CASES) {
  await setRoutine([id]);
  const card = page.locator(`article.lg-card[data-card-unit="${id}"]`).first();
  if ((await card.count()) === 0) {
    console.log(`\n=== ${id}：今天页里找不到这张卡`);
    continue;
  }
  await expandCard(card);
  await page.waitForTimeout(250);

  const timer = card.locator(".lg-steptimer").first();
  console.log(`\n=== ${id}  ${why}`);
  if ((await timer.count()) === 0) {
    console.log("   卡上没有分步计时器（没有一步带时长）");
    continue;
  }

  const num = (await timer.locator(".lg-steptimer-num").first().innerText()).trim();
  const at = (await timer.locator(".lg-steptimer-at").first().innerText()).trim();
  const what = (await timer.locator(".lg-steptimer-what").first().innerText().catch(() => "")).trim();
  const wait = (await timer.locator(".lg-steptimer-wait").first().innerText().catch(() => "")).trim();
  const title = (await timer.locator(".lg-steptimer-btn").first().getAttribute("title").catch(() => "")).trim();

  console.log(`   起手 ${num}   ${at}`);
  console.log(`   当前步: ${what.slice(0, 50)}`);
  console.log(`   形态: ${title || "（无）"}   等待: ${wait || "（无）"}`);

  const steps = await page.evaluate(async (id) => {
    const b = await (await fetch("cards.json")).json();
    const c = b.cards.find((x) => x.id === id);
    return (c?.steps ?? []).map((s) => ({ text: s.text, sec: s.duration?.sec ?? null }));
  }, id);
  console.log("   各步时长:");
  for (const s of steps) {
    console.log(`      ${s.sec != null ? String(s.sec).padStart(6) + "s" : "     -"}  ${s.text.slice(0, 44)}`);
  }
}

await browser.close();
await srv.close();
