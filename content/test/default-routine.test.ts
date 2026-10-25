/**
 * R15：默认清单的单元测试。
 *
 * 这条规则守的是「App 首启要放的那几张，都得真的在产物里」——
 * 清单里写一个草稿 id，首启就会少一张，而且**没有任何症状**：
 * 界面照常显示，只是少了一张卡。所以它必须是 error。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { checkDefaultRoutine, defaultRoutineIds, loadDefaultRoutine } from "../src/default-routine.ts";
import type { ArticleCards, Card } from "../src/cards/load.ts";

const tmpDirs: string[] = [];

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "life-guide-r15-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function card(id: string, status: Card["status"] = "reviewed"): Card {
  return {
    id,
    status,
    source: { anchor: "小节" },
    remind: { text: `做 ${id}`, quote: `做 ${id}` },
    steps: [],
  };
}

function article(cards: Card[]): ArticleCards {
  return { article: "the-savvy-life-manual/body-care/x.md", kind: "practice", coverage: "complete", cards };
}

/** 造一个 content 目录，里面有 default-routine.yaml。 */
function fixture(yaml?: string): string {
  const root = tmp();
  if (yaml !== undefined) {
    fs.writeFileSync(path.join(root, "default-routine.yaml"), yaml, "utf8");
  }
  return root;
}

describe("R15 默认清单", () => {
  it("清单里的卡都存在、都已签字 → 没有问题", () => {
    const dir = fixture("cards:\n  - { id: a }\n  - { id: b }\n");
    const findings = checkDefaultRoutine(dir, [article([card("a"), card("b")])]);
    expect(findings.filter((f) => f.level === "error")).toEqual([]);
  });

  it("写错 id → 报错（首启会少一张，而且没症状）", () => {
    const dir = fixture("cards:\n  - { id: a }\n  - { id: nope }\n");
    const findings = checkDefaultRoutine(dir, [article([card("a")])]);
    expect(findings.some((f) => f.level === "error" && f.cardId === "nope")).toBe(true);
  });

  it("卡还没签字 → 报错（草稿卡不进 App）", () => {
    const dir = fixture("cards:\n  - { id: a }\n  - { id: b }\n");
    const findings = checkDefaultRoutine(dir, [article([card("a"), card("b", "draft")])]);
    expect(findings.some((f) => f.level === "error" && f.cardId === "b")).toBe(true);
  });

  it("同一个卡写了两遍 → 报错", () => {
    const dir = fixture("cards:\n  - { id: a }\n  - { id: a }\n");
    const findings = checkDefaultRoutine(dir, [article([card("a")])]);
    expect(findings.some((f) => f.level === "error" && f.cardId === "a")).toBe(true);
  });

  it("清单文件不在 → 报错", () => {
    const findings = checkDefaultRoutine(fixture(), [article([card("a")])]);
    expect(findings.some((f) => f.level === "error")).toBe(true);
  });

  it("清单是空的 → 报错", () => {
    const dir = fixture("cards: []\n");
    const findings = checkDefaultRoutine(dir, [article([card("a")])]);
    expect(findings.some((f) => f.level === "error")).toBe(true);
  });

  it("读出来的是有次序的 id 列表（次序即显示次序）", () => {
    const dir = fixture("cards:\n  - { id: a }\n  - { id: b }\n  - { id: c }\n");
    expect(defaultRoutineIds(dir)).toEqual(["a", "b", "c"]);
    expect(loadDefaultRoutine(dir)?.section).toBe("");
  });
});

describe("仓库里那份默认清单", () => {
  it("就是《每天固定做的几件事》那几张，且都排在「随时」的前面", () => {
    const dir = path.resolve(import.meta.dirname, "..");
    const routine = loadDefaultRoutine(dir);
    expect(routine).not.toBeNull();
    expect(routine!.source).toContain("README");
    // 刷牙、洗脸是有时点的（早晨），默认要在「随时」那几张前面
    const ids = routine!.cards.map((c) => c.id);
    expect(ids).toContain("brush-teeth");
    expect(ids).toContain("face-wash");
    expect(ids.indexOf("brush-teeth")).toBeLessThan(ids.indexOf("floss"));
    expect(ids.indexOf("face-wash")).toBeLessThan(ids.indexOf("floss"));
  });
});
