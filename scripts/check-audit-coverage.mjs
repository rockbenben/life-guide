import fs from "node:fs";
import path from "node:path";

function walk(d) {
  return fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)],
  );
}

const articles = new Set();
for (const f of walk("content/cards").filter((f) => f.endsWith(".yaml"))) {
  const t = fs.readFileSync(f, "utf8");
  const m = /^article:\s*(.+)$/m.exec(t);
  const draft = /^    status: draft/m.test(t);
  if (m && draft) articles.add(m[1].trim().replace(/^["']|["']$/g, ""));
}

const state = JSON.parse(fs.readFileSync("content/audit-state.json", "utf8"));
const done = new Set(state.articles.map((a) => a.article));
console.log("draft articles:", articles.size, "| audited:", done.size);
console.log("missing:", [...articles].filter((a) => !done.has(a)).join(", ") || "(none)");
