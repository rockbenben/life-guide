/**
 * 默认清单：App 第一次打开时放进「我的日常」的那几张。
 *
 * 为什么放在内容层而不是写死在 App 里：这份清单是**策展**，不是功能。
 * App 不该自己编「该做哪几件」—— 它只负责把内容层给的次序摆出来，用户随时能改。
 * 清单的来源是快照的目录页（README「每天固定做的几件事」），见 default-routine.yaml。
 *
 * R15 守三件事：id 都存在、都已签字（草稿卡不进 App，签了字才算）、不重复。
 * 少一个，首启就少一张 —— 所以这是 error 不是 warning。
 */
import fs from "node:fs";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import type { ArticleCards } from "./cards/load.ts";
import type { Finding } from "./rules/index.ts";

export interface DefaultRoutine {
  /** 清单的出处（快照里的哪篇） */
  source: string;
  /** 出处里的哪一节 */
  section: string;
  /** 卡 id 与次序（次序即显示次序） */
  cards: { id: string; why?: string }[];
}

export const DEFAULT_ROUTINE_FILE = "default-routine.yaml";

/** 读默认清单；文件不在或读不了时返回 null（由调用方决定报不报错）。 */
export function loadDefaultRoutine(contentDir: string): DefaultRoutine | null {
  const p = path.join(contentDir, DEFAULT_ROUTINE_FILE);
  if (!fs.existsSync(p)) return null;
  const raw = parseYaml(fs.readFileSync(p, "utf8")) as Partial<DefaultRoutine>;
  const cards = Array.isArray(raw.cards) ? raw.cards : [];
  return {
    source: String(raw.source ?? ""),
    section: String(raw.section ?? ""),
    cards: cards
      .filter((c) => c && typeof c.id === "string" && c.id.length > 0)
      .map((c) => ({ id: c.id, why: c.why ? String(c.why) : undefined })),
  };
}

/** 清单里的卡 id（按次序）。 */
export function defaultRoutineIds(contentDir: string): string[] {
  return loadDefaultRoutine(contentDir)?.cards.map((c) => c.id) ?? [];
}

/**
 * R15：默认清单里的每张卡都要在、都已签字、都不重复。
 *
 * 为什么要查「已签字」：构建产物只收签字有效的卡，草稿卡不会进 App ——
 * 清单里写着一个草稿 id，首启就会少一张，而且没有任何症状。
 */
export function checkDefaultRoutine(contentDir: string, all: ArticleCards[]): Finding[] {
  const out: Finding[] = [];
  const file = path.join(contentDir, DEFAULT_ROUTINE_FILE);
  const routine = loadDefaultRoutine(contentDir);
  if (!routine) {
    out.push({
      rule: "R15",
      level: "error",
      file,
      message: "默认清单不存在 —— App 第一次打开就没有东西可放",
    });
    return out;
  }
  if (!routine.cards.length) {
    out.push({
      rule: "R15",
      level: "error",
      file,
      message: "默认清单是空的",
    });
    return out;
  }

  const byId = new Map<string, { card: ArticleCards["cards"][number]; article: string }>();
  for (const a of all) {
    for (const c of a.cards) byId.set(c.id, { card: c, article: a.article });
  }

  const seen = new Set<string>();
  for (const entry of routine.cards) {
    if (seen.has(entry.id)) {
      out.push({
        rule: "R15",
        level: "error",
        file,
        cardId: entry.id,
        message: "默认清单里同一个卡出现了两次",
      });
      continue;
    }
    seen.add(entry.id);
    const hit = byId.get(entry.id);
    if (!hit) {
      out.push({
        rule: "R15",
        level: "error",
        file,
        cardId: entry.id,
        message: "默认清单里的卡不存在（写错 id，或那张卡被删了）",
      });
      continue;
    }
    if (hit.card.status !== "reviewed") {
      out.push({
        rule: "R15",
        level: "error",
        file,
        cardId: entry.id,
        message: `默认清单里的卡还没签字（${hit.article}）—— 草稿卡不进 App，首启会少这一张`,
      });
    }
  }
  return out;
}
