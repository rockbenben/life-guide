/**
 * 决策门检查（AGENTS.md §7）。
 *
 * 门槛就一句话：**连续用两周，第 2 周打开 ≥ 4 天，而且早晚两个时段都有记录。**
 * 记录存在浏览器的 IndexedDB 里，导出成一个 JSON —— 但 JSON 是给机器看的，
 * 「第 2 周打开几天」「哪些天只记了早上」得自己数。
 *
 * 这个脚本替人数一遍，并给出结论：过了没过、差在哪。
 *
 * 用法：
 *   node scripts/decision-gate.mjs <备份.json>
 *   （备份在 App 的「设置 → 导出数据」里生成）
 */
import fs from "node:fs";

/** 与 App 相同的时段划分（app/src/domain/day.ts）。 */
function slotOf(ts) {
  const h = new Date(ts).getHours();
  if (h < 12) return "morning";
  if (h < 18) return "daytime";
  return "evening";
}

const SLOT_NAME = { morning: "早晨", daytime: "日间", evening: "晚间" };

function parseArgs() {
  const file = process.argv[2];
  if (!file) {
    console.error("用法：node scripts/decision-gate.mjs <备份.json>");
    console.error("备份在 App 的「设置 → 导出数据」里生成。");
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error(`找不到文件：${file}`);
    process.exit(2);
  }
  return file;
}

const file = parseArgs();
let backup;
try {
  backup = JSON.parse(fs.readFileSync(file, "utf8"));
} catch (err) {
  console.error(`读不了这个文件：${err.message}`);
  process.exit(2);
}

// 撤销过的周期完成仍在备份里，但不算一次使用记录
const events = Array.isArray(backup.events)
  ? backup.events.filter((e) => e?.periodDone !== false)
  : [];
if (!events.length) {
  console.log("这份备份里一条记录都没有 —— 还没有使用痕迹，决策门无从谈起。");
  process.exit(0);
}

// 按「天」归拢：一天里有几次、分别在哪个时段
const days = new Map();
let skipped = 0;
for (const e of events) {
  // 日期坏了就跳过，别让它把后面的统计也带偏（备份是手改过的）
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? "") || Number.isNaN(Date.parse(e.date))) {
    skipped++;
    continue;
  }
  const d = days.get(e.date) ?? { count: 0, slots: new Set(), cards: new Set() };
  d.count++;
  d.slots.add(slotOf(e.ts));
  d.cards.add(e.cardId);
  days.set(e.date, d);
}

const dates = [...days.keys()].sort();
if (!dates.length) {
  console.log("这份备份里的日期都读不出来 —— 没法算。");
  process.exit(0);
}
const first = dates[0];
const firstDay = new Date(`${first}T00:00:00`);
const dayIndex = (d) =>
  Math.round((new Date(`${d}T00:00:00`) - firstDay) / 86400000);

// 以第一天为起点，每 7 天一个「周」
const weeks = new Map();
for (const d of dates) {
  const w = Math.floor(dayIndex(d) / 7) + 1;
  const wk = weeks.get(w) ?? { days: 0, morning: 0, evening: 0, dates: [] };
  wk.days++;
  wk.dates.push(d);
  const slots = days.get(d).slots;
  if (slots.has("morning")) wk.morning++;
  if (slots.has("evening")) wk.evening++;
  weeks.set(w, wk);
}

console.log("决策门检查（AGENTS.md §7）");
console.log("─".repeat(46));
console.log(
  `数据：${file} · ${events.length} 条记录 · 覆盖 ${dates.length} 天（${dates[0]} ~ ${dates[dates.length - 1]}）`,
);
if (skipped) console.log(`（另有 ${skipped} 条记录的日期读不出来，已跳过）`);
console.log("");

for (const [w, wk] of [...weeks.entries()].sort((a, b) => a[0] - b[0])) {
  const start = wk.dates[0];
  const end = wk.dates[wk.dates.length - 1];
  console.log(
    `第 ${w} 周（${start} ~ ${end}）：打开 ${wk.days} 天 · 早晨 ${wk.morning} 天 · 晚间 ${wk.evening} 天`,
  );
}

console.log("");
const second = weeks.get(2);
if (!second) {
  console.log("第 2 周还没有数据 —— 用满两周再说。");
  process.exit(0);
}

const openOk = second.days >= 4;
const slotOk = second.morning > 0 && second.evening > 0;
console.log(`第 2 周门槛：`);
console.log(`  打开 ≥ 4 天：${second.days} 天 ${openOk ? "✅" : "❌"}`);
console.log(
  `  早晚都有记录：早晨 ${second.morning} 天 / 晚间 ${second.evening} 天 ${slotOk ? "✅" : "❌"}`,
);

if (openOk && slotOk) {
  console.log("");
  console.log("结论：过了。第 2 周既用得够勤，早晚也都碰过 —— P3 的规模可以往上推。");
} else {
  console.log("");
  console.log("结论：还没过。");
  if (!openOk) console.log(`  还差 ${4 - second.days} 天。`);
  if (!slotOk) {
    const missing = second.dates.filter((d) => {
      const s = days.get(d).slots;
      return !s.has("morning") || !s.has("evening");
    });
    console.log(`  早晚没都记到的日子：${missing.join("、")}`);
  }
}
