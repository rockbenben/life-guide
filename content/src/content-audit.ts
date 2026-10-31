/**
 * 内容层全面审计（`npm run content:audit-content`）。
 *
 * **为什么要有**：校验器（R1～R17）守的是「引文逐字、数字一致、签字有效」，
 * 但有几类错它看不见：
 *   · 两步的 text 与 quote 逐字一样（抽卡时抽重了）—— 步骤 id 不同，R5 抓不到
 *   · 时长挂在不该计时的步上（警示步、同一件事的两种说法）
 *   · 卡级 duration 漏了某一段（步级合计远超卡级）
 *   · 名字缺失 / 超长 / 同篇撞车
 *   · 默认清单里有疾病类卡（D8 说它们不进今日清单）
 *
 * 这些都是**内容判断**，校验器不会替人做 —— 但「有没有」是机器能查的。
 * 这个工具只报，不改；改是人的活（改完要重签）。
 *
 * **它自己的两个坑**（2026-10-31 实测）：
 *   · 指纹要比对**内容层自己的加载结果**（`loadAllCards`），不是 YAML 原始对象 ——
 *     直接拿 YAML 对象算 `fingerprint()` 会全表失配（491 张全「失效」），看着像大事
 *   · `yaml` 的 `Document.get("x")` 拿的是**值**，`node.get("x")` 才是节点
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "yaml";

import { fingerprint } from "./cards/fingerprint.ts";
import { loadAllCards } from "./cards/load.ts";

const CARDS_DIR = "content/cards/the-savvy-life-manual";
const NAME_MAX = 16;

export interface AuditFinding {
  kind: string;
  detail: string;
  ids: string[];
}

export interface AuditResult {
  total: number;
  reviewed: number;
  draft: number;
  named: number;
  steps: number;
  stepsWithDuration: number;
  findings: AuditFinding[];
}

/**
 * 卡级时长与引文里的时长对不上（分钟被写成秒这类）。
 *
 * **判据与 R2 同一套**：引文里要有「数字 + 单位」的完整词组，换算后等于 sec。
 * 只比裸数字会误报一堆（引文里任何地方出现这个数就算）——
 * 「1 组 = 5 秒 × 10 次」里的 5 是次数不是时长，「3 分钟 + 2 分钟」的和也不等于单段。
 *
 * **`derived` 的时长不查引文**：它的秒数是**多段之和**
 * （「中火煮 10 分钟 + 冷藏 20 分钟」→ 1800 秒），引文里当然找不到单个等于它的数。
 * 那种要查的是**算式**（R6 守着公式在不在，R2 守着秒数在不在算式里）。
 */
function durationMismatch(
  cards: {
    id: string;
    duration?: {
      sec?: number;
      basis?: string;
      quote?: string | string[];
      formula?: string;
    } | null;
  }[],
): AuditFinding {
  const bad: string[] = [];
  for (const c of cards) {
    const d = c.duration;
    if (!d || d.sec == null) continue;
    // 推算值：查算式里有没有这个秒数
    if (d.basis === "derived") {
      const formula = d.formula ?? "";
      const inFormula = [...formula.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
      if (!inFormula.includes(d.sec)) bad.push(c.id);
      continue;
    }
    const quotes = Array.isArray(d.quote) ? d.quote : d.quote ? [d.quote] : [];
    const blob = quotes.join(" ");
    // 「数字 + 单位」与「数字～数字 + 单位」（范围取下限：1～2 分钟 → 60 与 120 都算）
    const hits: { v: number; sec: number }[] = [];
    for (const m of blob.matchAll(/(\d+(?:\.\d+)?)\s*(?:[～\-~至到]\s*(\d+(?:\.\d+)?)\s*)?(秒|分钟|分鐘|小时|小時)/g)) {
      const unit = m[3];
      const mul = unit.includes("秒") ? 1 : unit.includes("分") ? 60 : 3600;
      hits.push({ v: Number(m[1]), sec: Number(m[1]) * mul });
      if (m[2] != null) hits.push({ v: Number(m[2]), sec: Number(m[2]) * mul });
    }
    if (!hits.length) continue;
    if (hits.some((h) => h.sec === d.sec)) continue;
    // **范围取下限**：引文写「1～2 分钟」、卡上取 60 秒（下限）——
    // 60 就是那个范围的下限，正经做法（AGENTS.md §5.1h：宁可早提醒）。
    if (hits.some((h) => d.sec! >= h.sec && d.sec! <= h.sec * 1.05)) continue;
    bad.push(c.id);
  }
  return { kind: "卡级时长与引文对不上", detail: "引文里的时长换算后不等于卡上的秒数", ids: bad };
}

/** 同一张卡里两步的 text 与 quote 逐字一样 —— 抽卡时抽重了。 */
function duplicatedSteps(cards: { id: string; steps: { id: string; text: string; quote?: string | string[] }[] }[]): AuditFinding {
  const bad: string[] = [];
  for (const c of cards) {
    for (let i = 0; i < c.steps.length; i++) {
      for (let j = i + 1; j < c.steps.length; j++) {
        if ((c.steps[i].text ?? "").trim() && c.steps[i].text === c.steps[j].text) {
          bad.push(`${c.id}(${c.steps[i].id}=${c.steps[j].id})`);
          break;
        }
      }
    }
  }
  return { kind: "步骤逐字重复", detail: "两步的 text 与 quote 完全一样（id 不同，R5 抓不到）", ids: bad };
}

/** 步级时长挂在不该计时的步上。 */
function mistimedSteps(
  cards: {
    id: string;
    steps: {
      id: string;
      text: string;
      quote?: string | string[];
      duration?: { sec?: number } | null;
    }[];
  }[],
): AuditFinding {
  const bad: string[] = [];
  for (const c of cards) {
    const timed = c.steps.filter((s) => s.duration?.sec != null);
    if (timed.length < 2) continue;
    for (let k = 1; k < timed.length; k++) {
      const a = quoteText(timed[k - 1].text, timed[k - 1].quote);
      const b = quoteText(timed[k].text, timed[k].quote);
      const [short, long] = a.length <= b.length ? [a, b] : [b, a];
      if (short.length >= 8 && long.includes(short)) {
        bad.push(`${c.id}(${timed[k - 1].id}=${timed[k].id})`);
        break;
      }
    }
  }
  return { kind: "步级时长可能重复计数", detail: "相邻两步的引文重叠 —— 同一件事会被数两次", ids: bad };
}

/** 一步的正文 + 引文拼成一段（引文可能是数组）。 */
function quoteText(text: string, quote?: string | string[]): string {
  const quotes = Array.isArray(quote) ? quote : quote ? [quote] : [];
  return [text, ...quotes].join("");
}

export function auditContent(cardsDir = CARDS_DIR): AuditResult {
  const loaded = loadAllCards(cardsDir);
  const findings: AuditFinding[] = [];

  // 1. 签字指纹
  const stale: string[] = [];
  for (const l of loaded) {
    for (const c of l.data.cards) {
      if (!c.review) continue;
      if (c.review.hash !== fingerprint(c)) stale.push(c.id);
    }
  }
  findings.push({ kind: "签字指纹失效", detail: "改过但没重签", ids: stale });

  // 2. 名字
  const noName: string[] = [];
  const longName: string[] = [];
  const perFile = new Map<string, Map<string, string[]>>();
  for (const l of loaded) {
    for (const c of l.data.cards) {
      if (c.status !== "reviewed") continue;
      if (!c.name?.trim()) noName.push(c.id);
      else if ([...c.name].length > NAME_MAX) longName.push(`${c.id}(${[...c.name].length})`);
      const key = c.name?.trim() || c.source?.anchor || "";
      const m = perFile.get(l.file) ?? new Map<string, string[]>();
      m.set(key, [...(m.get(key) ?? []), c.id]);
      perFile.set(l.file, m);
    }
  }
  findings.push({ kind: "已签字但没有 name", detail: "屏上靠原文小节名回落显示", ids: noName });
  findings.push({ kind: `名字超过 ${NAME_MAX} 字`, detail: "收起态一行放不下", ids: longName });
  const collide: string[] = [];
  for (const m of perFile.values()) {
    for (const [key, ids] of m) {
      if (ids.length > 1) collide.push(`「${key}」→ ${ids.join(", ")}`);
    }
  }
  findings.push({ kind: "同一篇里同名", detail: "屏上并排两行一样", ids: collide });

  // 3. 时长
  findings.push(durationMismatch(loaded.flatMap((l) => l.data.cards)));
  findings.push(duplicatedSteps(loaded.flatMap((l) => l.data.cards)));
  findings.push(mistimedSteps(loaded.flatMap((l) => l.data.cards)));

  // 4. 默认清单
  const routineFile = path.join("content", "default-routine.yaml");
  const routineIds = [...fs.readFileSync(routineFile, "utf8").matchAll(/id:\s*([a-z0-9-]+)/g)].map((m) => m[1]);
  const byId = new Map(loaded.flatMap((l) => l.data.cards).map((c) => [c.id, c]));
  const routineBad: string[] = [];
  const seen = new Set<string>();
  for (const id of routineIds) {
    if (seen.has(id)) routineBad.push(`${id}(重复)`);
    seen.add(id);
    const c = byId.get(id);
    if (!c) routineBad.push(`${id}(不存在)`);
    else if (c.status !== "reviewed") routineBad.push(`${id}(没签字)`);
    else if (l0kind(loaded, id) === "condition") routineBad.push(`${id}(疾病类，不该进今日清单)`);
  }
  findings.push({ kind: "默认清单有问题", detail: "不存在 / 没签字 / 重复 / 疾病类", ids: routineBad });

  const all = loaded.flatMap((l) => l.data.cards);
  const steps = all.reduce((a, c) => a + c.steps.length, 0);
  const stepsWithDuration = all.reduce((a, c) => a + c.steps.filter((s) => s.duration?.sec != null).length, 0);

  return {
    total: all.length,
    reviewed: all.filter((c) => c.status === "reviewed").length,
    draft: all.filter((c) => c.status === "draft").length,
    named: all.filter((c) => c.status === "reviewed" && c.name?.trim()).length,
    steps,
    stepsWithDuration,
    findings: findings.filter((f) => f.ids.length),
  };
}

/** 那张卡属于保健还是疾病类（按它所在的文章）。 */
function l0kind(loaded: ReturnType<typeof loadAllCards>, cardId: string): string {
  for (const l of loaded) {
    if (l.data.cards.some((c) => c.id === cardId)) return l.data.kind;
  }
  return "practice";
}
