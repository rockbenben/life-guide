import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { stringify } from "yaml";
import { fingerprint } from "../src/cards/fingerprint.ts";
import type { Card } from "../src/cards/load.ts";

it("check 和 build 拒绝分布在两份 YAML 中的已签同 ID 卡", () => {
  const repo = path.resolve(import.meta.dirname, "../..");
  const root = fs.mkdtempSync(path.join(repo, ".card-id-test-"));
  try {
    const content = path.join(root, "content");
    fs.cpSync(path.join(repo, "content/src"), path.join(content, "src"), { recursive: true });
    fs.cpSync(path.join(repo, "schema"), path.join(root, "schema"), { recursive: true });
    const cards = path.join(content, "cards");
    const source = path.join(content, "source");
    const article = "the-savvy-life-manual/test.md";
    fs.mkdirSync(cards);
    fs.mkdirSync(path.dirname(path.join(source, article)), { recursive: true });
    const markdown = "## 读书\n\n打开书。\n";
    fs.writeFileSync(path.join(source, article), markdown);
    fs.writeFileSync(path.join(source, "SOURCE.lock"), JSON.stringify({
      files: { [article]: createHash("sha256").update(markdown).digest("hex") },
    }));
    const card: Card = {
      id: "open-a-book", status: "reviewed", source: { anchor: "读书" },
      remind: { text: "打开书。", quote: "打开书。" },
      steps: [{ id: "open", text: "打开书。", quote: "打开书。" }],
    };
    card.review = { by: "test", date: "2026-11-19", hash: fingerprint(card) };
    fs.writeFileSync(path.join(content, "default-routine.yaml"), stringify({ cards: [{ id: card.id }] }));
    const original = path.join(cards, "original.yaml");
    fs.writeFileSync(original, stringify({ article, kind: "practice", coverage: "complete", cards: [card] }));
    const run = (command: string) => spawnSync(
      process.execPath, [path.join(content, "src", "cli.ts"), command],
      { cwd: root, encoding: "utf8" },
    );
    for (const command of ["check", "build"]) {
      const result = run(command);
      expect(result.status, result.stderr || result.stdout).toBe(0);
    }
    const output = path.join(root, "app", "public", "cards.json");
    const before = fs.readFileSync(output, "utf8");
    fs.copyFileSync(original, path.join(cards, "copy.yaml"));
    for (const command of ["check", "build"]) {
      const result = run(command);
      const output = result.stdout + result.stderr;
      expect(result.status).toBe(1);
      expect(output).toContain("[CARD_ID]");
      expect(output).toContain("original.yaml#cards[0]");
      expect(output).toContain("copy.yaml#cards[0]");
    }
    expect(fs.readFileSync(output, "utf8")).toBe(before);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
