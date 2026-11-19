import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { stringify } from "yaml";
import { expect, it, vi } from "vitest";
import { loadAllCards } from "../src/cards/load.ts";
import { parseDraft } from "../src/extract/parse.ts";
import { parseMarkdown } from "../src/source/parse.ts";

it("加载多份 YAML 和草稿只编译一次 schema，诊断归属各自文件", () => {
  const Ajv = createRequire(import.meta.url)("ajv") as typeof import("ajv").default;
  const compile = vi.spyOn(Ajv.prototype, "compile");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "life-guide-schema-"));
  try {
    const article = {
      article: "test.md", kind: "practice", coverage: "complete",
      cards: [{
        id: "read", status: "draft", source: { anchor: "读书" },
        remind: { text: "打开书。", quote: "打开书。" },
        steps: [{ id: "open", text: "打开书。", quote: "打开书。" }],
      }],
    };
    fs.writeFileSync(path.join(root, "a.yaml"), stringify({ ...article, extraFirst: true }));
    fs.writeFileSync(path.join(root, "b.yaml"), stringify(article));
    const [invalid, valid] = loadAllCards(root);
    expect(invalid.schemaErrors.join()).toContain("extraFirst");
    expect(valid.schemaErrors).toEqual([]);

    const draft = parseDraft(stringify({ ...article, extraDraft: true }), {
      file: "draft.yaml", source: parseMarkdown("## 读书\n\n打开书。"),
    });
    expect(draft.findings).toContainEqual(expect.objectContaining({
      rule: "SCHEMA", message: expect.stringContaining("extraDraft"),
    }));
    expect(invalid.schemaErrors.join()).not.toContain("extraDraft");
    expect(compile).toHaveBeenCalledTimes(1);
  } finally {
    compile.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
