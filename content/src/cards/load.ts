/**
 * 卡片文件读取与结构校验。
 *
 * 结构校验用 JSON Schema（ajv），类型由 schema 派生 —— 语言中立，
 * blog 那边的 CI 不必装 TypeScript 也能用同一份 schema。
 */
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { parse as parseYaml } from "yaml";

// ajv / ajv-formats 是 CJS 包，但 .d.ts 写成 ESM 风格（export default）。
// NodeNext 下 TS 会把默认导出算成命名空间类型，而运行时 module.exports 才是类本身。
// 用 createRequire 显式加载，类型与运行时都对得上。
const require = createRequire(import.meta.url);
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as typeof import("ajv-formats").default;

export interface Segment {
  id: string;
  /** 人群标签，AND 语义 */
  when: string[];
  action?: { text: string; quote: string | string[] };
  dose?: { text: string; quote: string | string[] };
  avoid?: { text: string; quote: string | string[] }[];
}

/** 疾病类卡片的提示分级（AGENTS.md §5.4）。与动作禁忌 cautions 分开。 */
export interface Notice {
  level: "seek-care" | "with-doctor" | "info";
  text: string;
  quote: string | string[];
}

export interface Card {
  id: string;
  status: "draft" | "reviewed";
  /**
   * 这张卡用过的旧 id。
   *
   * 合并或改名时写在这里：用户的盖章记录、日常清单里存的是旧 id，
   * App 靠这一项认回来 —— 不写就等于丢历史（AGENTS.md §5）。
   */
  formerIds?: string[];
  source: { anchor: string };
  /** 屏上显示的动作名（≤16 字）。不填就用原文小节名 */
  name?: string;
  review?: { by: string; date: string; hash: string } | null;
  slot?: "morning" | "daytime" | "evening" | "anytime";
  images?: string[];
  remind: { text: string; quote: string | string[] };
  effect?: { text: string; quote: string | string[] } | null;
  dose?: {
    value: number;
    valueMax?: number;
    unit: string;
    what: string;
    /** 原文写的是「约 / 大约 / 左右」这一类近似值 —— 屏上要显示「约」 */
    approximate?: boolean;
    /** 这一行的数是换算来的（1/2 勺 → 0.5 勺）—— 记算式，界面标「推算」 */
    derived?: { formula: string };
    quote: string | string[];
  }[];
  duration?: {
    basis: "quote" | "derived" | "unknown";
    sec?: number;
    quote?: string | string[];
    formula?: string;
  } | null;
  steps: { id: string; text: string; quote: string | string[]; images?: string[] }[];
  cautions?: { level: "stop" | "with-doctor" | "info"; text: string; quote: string | string[] }[];
  /** 疾病类卡片的提示分级；practice 卡不用这个字段 */
  notices?: Notice[];
  derived?: { label: string; value: number; unit?: string; formula: string }[];
  variants?: {
    busy?: { include?: string[]; replace?: { text: string; quote: string | string[] }; skip?: boolean };
    travel?: { include?: string[]; replace?: { text: string; quote: string | string[] }; skip?: boolean };
    sick?: { include?: string[]; replace?: { text: string; quote: string | string[] }; skip?: boolean };
  };
  segments?: Segment[];
}

export interface ArticleCards {
  article: string;
  kind: "practice" | "condition";
  coverage: "partial" | "complete";
  ignore?: {
    images?: { all: true; reason: string } | { url: string; reason: string }[];
    sections?: { anchor: string; reason: string }[];
  } | null;
  cards: Card[];
}

export interface LoadedArticle {
  file: string;
  data: ArticleCards;
  /** schema 校验错误（结构层面） */
  schemaErrors: string[];
}

function schemaPath(): string {
  // content/src/cards/load.ts -> 仓库根
  return path.resolve(import.meta.dirname, "../../../schema/cards.schema.json");
}

export function loadSchema(): object {
  return JSON.parse(fs.readFileSync(schemaPath(), "utf8"));
}

export function makeValidator(): (data: unknown) => { valid: boolean; errors: string[] } {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(loadSchema());
  return (data: unknown) => {
    const valid = validate(data) as boolean;
    const errs = (validate.errors ?? []) as {
      instancePath?: string;
      message?: string;
      params?: Record<string, unknown>;
    }[];
    return {
      valid,
      errors: valid
        ? []
        : errs.map((e) => {
            // 「must NOT have additional properties」不说是哪个字段，人没法排查。
            // ajv 把它放在 params.additionalProperty 里，这里补出来。
            const extra =
              e.params && typeof e.params.additionalProperty === "string"
                ? `（多了字段：${e.params.additionalProperty}）`
                : "";
            return `${e.instancePath || "/"} ${e.message ?? ""}${extra}`.trim();
          }),
    };
  };
}

export function loadArticleFile(file: string): LoadedArticle {
  const raw = fs.readFileSync(file, "utf8");
  let data: ArticleCards;
  try {
    data = parseYaml(raw) as ArticleCards;
  } catch (e) {
    // yaml 根本解析不了（人手改坏了一格缩进）：报出来，别让所有命令带着栈崩掉
    // （栈只指向 node_modules/yaml，看不出是哪个卡片文件坏了）。
    return {
      file,
      data: { article: "", kind: "practice", coverage: "partial", cards: [] },
      schemaErrors: [`yaml 解析失败：${e instanceof Error ? e.message : String(e)}`],
    };
  }
  const { valid, errors } = makeValidator()(data);
  return { file, data, schemaErrors: valid ? [] : errors };
}

/** 递归读取 cards/ 下的所有 yaml（按相对路径排序，保证输出稳定）。 */
export function loadAllCards(cardsDir: string): LoadedArticle[] {
  if (!fs.existsSync(cardsDir)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml")) {
        files.push(full);
      }
    }
  };
  walk(cardsDir);
  files.sort();
  return files.map((f) => loadArticleFile(f));
}
