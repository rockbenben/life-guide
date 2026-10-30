/**
 * 给缺名的卡补上动作名。
 *
 * 2026-10-24 那轮改名（239 张）漏了 78 张 —— 那些卡在屏上靠原文小节名回落显示，
 * 而小节名是**文章的骨架**，不是**这张卡在做什么**（「检查、治疗与就诊」
 * 那种同一篇里好几张同名，屏上并排两行一模一样）。
 *
 * 名册在 `card-names.ts`（人写的，每条一个名字 + 规矩见那里的注释）。
 * 这个工具只做一件事：**把名册里的名字写进 YAML**，
 * 写盘用 Document API（保留注释），并检查三件事：
 *   · 长度 ≤ `NAME_MAX`（16）—— 收起态一行放不下
 *   · 同一篇里不撞名 —— 撞了屏上看着像出了错
 *   · 名册里的 id 都对得上（写错 id 的话静默跳过最坏）
 */
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "yaml";

import { CARD_NAMES } from "./card-names.ts";

/** 名字最长多少字（跟 app/src/domain/lines.ts 的 NAME_MAX 一致）。 */
export const NAME_MAX = 16;

export interface NameProblem {
  id: string;
  problem: string;
}

/**
 * 检查名册本身：长度、撞名、对得上吗。
 *
 * **对不上也要报**：名册里写了一个不存在的 id，就是名册错了 ——
 * 静默跳过的话，那张卡永远补不上名，而报告看起来一切正常。
 */
export function checkNameList(
  cardsById: Map<string, { file: string; name?: string; anchor: string }>,
  names: Record<string, string> = CARD_NAMES,
): NameProblem[] {
  const problems: NameProblem[] = [];
  const seenName = new Map<string, string>(); // 名字 → id
  const seenPerFile = new Map<string, Map<string, string>>(); // 文件 → 名字 → id

  for (const [id, name] of Object.entries(names)) {
    if ([...name].length > NAME_MAX) {
      problems.push({ id, problem: `名字 ${[...name].length} 字，超过 ${NAME_MAX}` });
    }
    if (!cardsById.has(id)) {
      problems.push({ id, problem: "名册里有这个 id，但卡片里找不到" });
      continue;
    }
    const prev = seenName.get(name);
    if (prev) {
      problems.push({ id, problem: `名字与 ${prev} 重复（屏上会并排两行一样）` });
    }
    seenName.set(name, id);

    const card = cardsById.get(id)!;
    const perFile = seenPerFile.get(card.file) ?? new Map<string, string>();
    const sameFile = perFile.get(name);
    if (sameFile) {
      problems.push({ id, problem: `同一篇里与 ${sameFile} 同名` });
    }
    perFile.set(name, id);
    seenPerFile.set(card.file, perFile);
  }
  return problems;
}

/**
 * 把名册里的名字写进 YAML。
 *
 * 只碰 `name` 字段，其它一律不动（步骤、引文、剂量、签字都不动）。
 */
export function applyNames(
  file: string,
  cardId: string,
  name: string,
): boolean {
  const doc = parseDocument(fs.readFileSync(file, "utf8"));
  const cards = doc.get("cards");
  if (!cards || typeof (cards as any).items === "undefined") return false;
  const card = (cards as any).items.find((c: any) => c?.get?.("id") === cardId);
  if (!card) return false;
  card.set("name", name);
  fs.writeFileSync(file, doc.toString({ lineWidth: 0 }), "utf8");
  return true;
}
