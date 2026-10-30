/**
 * 步级时长补录：从卡片的步骤里认出「这一步做多久」，写进 steps[].duration。
 *
 * 为什么要有这个工具：
 *   步级时长得**逐字引文**（R1），秒数还得跟引文对得上（R2）。
 *   手写 YAML 很容易两处不一致 —— 引文抄了一句不含那个数的话，
 *   或者秒数自己换算错了而引文里看不出来。校验器会拦，但拦的是结果，
 *   改的时候要一份一份对。工具把「认出时长」与「引文一致」分开：
 *   认出结果由人（或模型）判定，引文一致由机器保证。
 *
 * 认定的判据（**只认「这一步本身持续多久」**）：
 *   ✓ 「保持 10 秒」「抬起 3 秒后放回」「烤 15 分钟」—— 这一步的持续时间
 *   ✓ 「小火煮 5 分钟」—— 这一步的持续时间
 *   ✗ 「整套做完大约 90 秒」—— 那是**整组**的量，属于卡级 duration
 *   ✗ 「每天 50 次」「1 天 1 轮」—— 那是频次，不是时长
 *   ✗ 「走了 5 分钟小腿肚就开始痛」—— 那是症状描述，不是做法
 *   ✗ 「睡前 1-2 小时」「饭后 30 分钟」—— 那是**什么时候**做，不是做多久
 *
 * 写盘用 Document API（保留注释），并只碰 steps[] 下的一处。
 */
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";
import {
  STEP_DURATION_REJECTED,
  STEP_DURATION_VERDICTS,
} from "./step-duration-verdicts.ts";

/** 时长的单位换算：秒 / 分钟 / 小时。 */
const UNIT_SEC: Record<string, number> = { 秒: 1, 分钟: 60, 分: 60, 小时: 3600, 小時: 3600 };

/** 中文口语的时长词。 */
const CN_NUM: Record<string, number> = {
  一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
  半: 0.5,
};

/**
 * 从一段话里找出所有「数字 + 时长单位」，返回秒数候选。
 *
 * 返回的每一项都带 `raw`：原话里那一片。调用方拿它当引文。
 */
export interface DurationHit {
  sec: number;
  raw: string;
  /** 原文写的是近似值（「约 15 分钟」）→ 屏上要显示「约」 */
  approximate: boolean;
}

const HIT_RE = /(\d+(?:\.\d+)?)\s*(秒|分钟|分鐘|小时|小時)|([一二两三四五六七八九十半])\s*(分半|秒|分钟)/g;

/** 近似词：贴着数字才算近似。 */
const APPROX_RE = /(约|大约|差不多|左右|前后|上下)/;

export function findDurations(text: string): DurationHit[] {
  const out: DurationHit[] = [];
  for (const m of text.matchAll(HIT_RE)) {
    const raw = m[0];
    const unit = m[2] ?? m[4];
    let n: number;
    if (m[1] != null) {
      n = Number(m[1]);
    } else {
      const cn = CN_NUM[m[3]];
      if (cn == null) continue;
      if (m[4] === "分半") {
        out.push({
          sec: cn * 60 + 30,
          raw,
          approximate: APPROX_RE.test(text.slice(Math.max(0, m.index! - 4), m.index! + raw.length + 2)),
        });
        continue;
      }
      n = cn;
    }
    const k = UNIT_SEC[unit];
    if (!k) continue;
    const sec = Math.round(n * k);
    if (sec <= 0) continue;
    // 「分」在阿拉伯数字下是分数/评分（「4 分」= 4 points），不是分钟。
    // 中文「X 分半」在前面单列了，这里不再处理单独的「分」。
    if (unit === "分" && m[1] != null) continue;
    // 数字**前面**紧跟量词或单位 → 那不是时长（「4 分」前面若是「计」就更是评分）。
    // 判据：这个时间片之前 1 个字符不能是汉字量词（分/个/次/克/g/分…），
    // 也不能是数字（避免把「200g6 分钟」里的 6 当时长）。
    const before = text.slice(Math.max(0, m.index! - 1), m.index!);
    if (before && /[0-9a-zA-Z]/.test(before)) continue;
    // 「时间」二字：前面是「X 时间」时，数字是时间点不是时长
    const pre2 = text.slice(Math.max(0, m.index! - 2), m.index!);
    if (/(小时|分钟|秒钟|时间)/.test(pre2) && unit !== "秒") continue;
    // 近似词要贴着这个数：取前后各 4 个字
    const around = text.slice(Math.max(0, m.index! - 4), m.index! + raw.length + 3);
    out.push({ sec, raw, approximate: APPROX_RE.test(around) });
  }
  return out;
}

/**
 * 这一步的时长是不是「这一步本身持续多久」。
 *
 * 判据不是「句子里有没有时间」—— 那会把「睡前 1-2 小时」「饭后 30 分钟」
 * 也算进去（那是**什么时候**做），也要把「整套 90 秒」排除（那是整组的量）。
 */
export function isStepDuration(text: string): boolean {
  // 「以内 / 以上」—— 那是**上限或范围**，不是这一步实际做多久。
  // 「5 分钟以内缓解」说的是症状多久缓解，不是做法持续 5 分钟。
  if (/\d+\s*(秒|分钟|分鐘|小时|小時)\s*(以内|以上|以下|前后|上下|之间)/.test(text)) return false;
  // 「什么时候做」：时间点 / 时段 / 间隔
  if (/(睡前|饭前|饭后|洗澡前|起床后|两餐|之间|之前|之后|以后|间隔|每\s*\d+\s*(小时|天|周|月|年))/u.test(text)) {
    // 但「保持 10 秒」在「抬起一条腿的膝盖，保持 10 秒后放回」里也有「后」——
    // 所以先看有没有**动作持续**的说法，有就不算「什么时候」。
    if (!/(保持|持续|维持|浸|泡|煮|烤|加热|蒸|焯|晾|放|烘|煎|炒|熬|炖|数|画|念|下沉|抬起)/u.test(text)) {
      return false;
    }
  }
  // 「整套 / 全部 / 总共 / 一次做完」—— 那是整组的量
  if (/(整套|全部做完|全部做|总共|整体|一次做完|连贯做完|全部动作)/u.test(text)) return false;
  // 症状描述：「走了 5 分钟就痛」—— 是**发生了什么**，不是做法
  if (/(就开始|感觉|出现|感到|是否|有没有|看看|自检|自查|警惕|信号)/u.test(text)) return false;
  // 频次：「每天 50 次」「1 天 1 轮」—— 不是时长
  if (/(每天\s*\d|每天\s*[一二三四五六七八九十]|次为\s*1\s*组|1\s*天\s*\d|\d\s*天\s*\d|\d\s*周\s*\d|每月|每年|回が目安)/u.test(text)) {
    if (!/(保持|持续|维持)/u.test(text)) return false;
  }
  // 症状 / 检查 / 评分 —— 这些步骤在**描述或评估**，不是在「做一件事」。
  // 它们的时长是「症状多久出现」「检查要多久」「这一项占几分」，不是动作时长。
  if (/(以内缓解|以内消失|概率|评分|得分|分数|风险计分|计分表|复发|缓解时间|症状|注视时间|程度的运动|以内)/u.test(text)) {
    if (!/(保持|持续|维持)/u.test(text)) return false;
  }
  // 频次 / 节奏 / 间隔 —— 「每 2～3 小时补涂」「每 50 次涂满 1 格」「睡眠不足 5 小时」
  // 这些数字说的是**多久一次**或**多久累计**，不是这一步做多久。
  if (/(每\s*\d|每[一二三四五六七八九十]|\d+\s*～\s*\d+\s*小时.*(补涂|持续|有效)|填满|涂满|累计|一组\s*=|一组是|连续做|每周|每天)/u.test(text)) {
    // 「一组 = 5 秒 × 10 次」—— 这里的 5 秒是**单次动作**的时长，可以用
    if (!/(保持\s*\d|持续\s*\d|维持\s*\d|=\s*\d+\s*秒|做\s*\d+\s*次)/u.test(text)) return false;
  }
  // 「第 N 次：…后开始」—— 那是**节奏**（什么时候做），不是这一步多久
  if (/第\s*\d+\s*次/.test(text)) {
    if (!/(保持|持续|维持)/u.test(text)) return false;
  }
  // 「效果持续 X 小时」—— 那是**有效时长**，不是这一步做多久。
  // 「防晒霜的高效效果只持续 2～3 小时」说的是涂完之后能撑多久，
  // 这一步本身（补涂）是瞬间的事。
  //
  // 区分点：**小时**级的「持续」多半是有效时长或等待（「冷藏 1 小时」「等 2 小时」），
  // 秒/分钟级的「保持」才是动作本身（拉伸保持 30 秒）。
  if (/(效果|效力|作用|功效).{0,8}(持续|维持|保持)\s*[\d～\-~]+\s*(小时|小時)/u.test(text)) {
    return false;
  }
  return true;
}

/**
 * 这张卡该不该有步级时长。
 *
 * **自查表 / 症状描述 / 评分表**这类卡不该有 —— 它们的步骤是「问一句」或
 * 「对一下表」，不是「照着做一个动作」。给它们加步级计时器是添乱：
 * 屏上会摆一个「这一步 30 分钟」，而那一步其实不花时间。
 *
 * 判据看这张卡的**内容形状**，不看标题：
 *   · 步骤大半是「判断 / 对照 / 记下 / 数着」→ 不加
 *   · 步骤是「做这个动作」→ 加
 */
export function cardTakesStepTiming(
  steps: { id: string; text: string }[],
  kind: string,
): boolean {
  // 疾病类（kind=condition）本来就不进「今日清单」，不必做步级计时
  if (kind === "condition") return false;
  let actionable = 0;
  for (const s of steps) {
    const t = s.text;
    // 判断 / 对照 / 记下 —— 不是动作
    if (/^(判断|对照|记下|核对|检查|查看|确认|如果|问|自检|自查|填写|数一下|记录)/.test(t)) continue;
    if (/(以内|概率|评分|得分|风险计分|注视时间|程度的运动|每周不到|以上|以下)/.test(t) && !/保持|持续|维持/.test(t)) continue;
    actionable++;
  }
  return actionable > 0;
}

/** 一步的时长判定结果。 */
export type Confidence = "sure" | "unsure";

export interface StepDurationPick {
  sec: number;
  quote: string;
  approximate: boolean;
  confidence: Confidence;
  /** 为什么机器拿不准 —— 人工核对时先看这条 */
  note?: string;
}

/**
 * 一张卡里某个步骤的 duration 应该是多少 —— 从它自己的引文里取。
 *
 * 返回 confidence：
 *   sure   —— 原文明写这一步持续多久，且没有别的时长候选
 *   unsure —— 有多个候选，或原文的时长是「以内 / 以上 / 程度」这类，
 *             机器判不准 —— **要人看一眼**
 */
export function durationForStep(
  stepText: string,
  quotes: string[],
  cardId?: string,
  stepId?: string,
): StepDurationPick | null {
  // 人工裁定优先：机器拿不准的地方由人定了，这里照办。
  if (cardId && stepId) {
    const v = STEP_DURATION_VERDICTS.find((x) => x.id === cardId && x.step === stepId);
    if (v) {
      return { sec: v.sec, quote: v.quote, approximate: !!v.approximate, confidence: "sure" };
    }
    // 人工明确排除的步 —— 机器别再把它捡回来
    if (STEP_DURATION_REJECTED.some((x) => x.id === cardId && x.step === stepId)) {
      return null;
    }
  }
  const haystacks = [stepText, ...quotes];
  for (const h of haystacks) {
    if (!isStepDuration(h)) continue;
    const hits = findDurations(h);
    if (!hits.length) continue;
    // 多个候选时取最像「这一步」的：正文里第一个
    const hit = hits[0];
    const notes: string[] = [];
    if (hits.length > 1) {
      notes.push(`这句里有 ${hits.length} 个时长（${hits.map((h) => `${h.sec}秒`).join("、")}），取了第一个`);
    }
    // 「以内 / 以上 / 程度 / 以内」—— 那是**上限或范围**，不是这一步的时长
    if (/(以内|以内|以上|以下|上下|前后|不超过|至少|超过)/.test(h.slice(Math.max(0, h.indexOf(hit.raw) - 3), h.indexOf(hit.raw) + hit.raw.length + 2))) {
      notes.push("原文写的是上限/范围（「以内」「以上」），这个数未必是这一步的实际时长");
    }
    // 引文用哪一句：要含那个数，且是快照的逐字子串 —— 用 step 自己的引文里
    // 含有那个数的那一句（引文本身就是逐字子串，抄它就对了）。
    let quote = quotes.find((q) => findDurations(q).some((x) => x.sec === hit.sec)) ?? "";
    if (!quote) {
      // step 引文里没有就退回引文数组整体（多句）—— 由 R1 兜底
      quote = quotes.join("");
    }
    return {
      sec: hit.sec,
      quote,
      approximate: hit.approximate,
      confidence: notes.length ? "unsure" : "sure",
      note: notes.join("；") || undefined,
    };
  }
  return null;
}

/**
 * 写进 YAML 文件。只碰指定卡片的指定步骤。
 *
 * 用 Document API 而不是 parse + stringify：后者会把文件里的注释全部丢掉，
 * 而 ignore 清单里「为什么不抽这条」的理由全靠注释记录。
 */
export function writeStepDuration(
  file: string,
  cardId: string,
  stepId: string,
  d: { sec: number; quote: string; approximate: boolean },
): boolean {
  const doc = parseDocument(fs.readFileSync(file, "utf8"));
  // yaml 的 Document.get 返回的是 YAMLSeq / YAMLMap，**不是**普通数组 ——
  // 直接 .find 会报「cards.find is not a function」。用 items 取出真正的节点。
  const cards = doc.get("cards");
  if (!cards || typeof (cards as any).items === "undefined") return false;
  const card = (cards as any).items.find((c: any) => c?.get?.("id") === cardId);
  if (!card) return false;
  const steps = card.get("steps");
  if (!steps || typeof (steps as any).items === "undefined") return false;
  const step = (steps as any).items.find((s: any) => s?.get?.("id") === stepId);
  if (!step) return false;
  const value: Record<string, unknown> = { basis: "quote", sec: d.sec, quote: d.quote };
  if (d.approximate) value.approximate = true;
  step.set("duration", value);
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }), "utf8");
  return true;
}
