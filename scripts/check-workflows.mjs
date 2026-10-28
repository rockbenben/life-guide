/**
 * 校验所有工作流文件：YAML 能解析，且每个 shell 脚本语法没问题。
 *
 * **为什么自己查**：GitHub 对工作流文件的语法错误只会说一句
 * 「This run likely failed because of a workflow file issue」——
 * 整个文件直接被拒绝，CI 一个 job 都不跑（本仓就踩过：
 * 步骤名里写了一个没加引号的「冒号+空格」，YAML 解析器直接报
 * bad indentation of a mapping entry，而本地什么提示都没有）。
 *
 * shell 那一半同样重要：写错了要等跑到那一步才炸 —— 那是发版的时候，不是现在。
 *
 * 还有一条 GitHub 特有的语义：**env 里某个键引用自己**（`TAG: ${{ env.TAG }}`）
 * 是循环引用，GitHub 会**整个文件拒绝**——症状和 YAML 语法错误一模一样，
 * 只说一句「likely failed because of a workflow file issue」，一个 job 都不跑。
 * 本地 YAML 解析器不报这个（2026-10-28 实测踩过一次）。
 * 正确写法是别重复定义：workflow 级 `env.TAG` 本来就在每个 step 的环境里，
 * 下游直接用 `$TAG` 就行。
 *
 * 用法：node scripts/check-workflows.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml");

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const dir = path.join(root, ".github", "workflows");

if (!fs.existsSync(dir)) {
  console.error("没有 .github/workflows 目录");
  process.exit(1);
}

/** Windows 上也能找到的 bash（Git Bash）。找不到就跳过 shell 检查。 */
const bash = [
  "C:\\Program Files\\Git\\bin\\bash.exe",
  "C:\\Program Files\\Git\\usr\\bin\\bash.exe",
].find((p) => fs.existsSync(p));

let bad = 0;

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))) {
  const rel = path.join(".github", "workflows", file);
  const text = fs.readFileSync(path.join(root, rel), "utf8");

  let doc;
  try {
    doc = yaml.load(text);
    console.log(`✓ ${rel} 解析正常（${Object.keys(doc?.jobs ?? {}).length} 个 job）`);
  } catch (err) {
    bad++;
    console.error(`✗ ${rel} 解析失败：${String(err.message).split("\n")[0]}`);
    continue;
  }

  if (!bash) continue;
  let n = 0;
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (typeof step.run !== "string") continue;
      n++;
      const tmp = path.join(os.tmpdir(), `wf-${jobName}-${n}.sh`);
      fs.writeFileSync(tmp, step.run, "utf8");
      try {
        execFileSync(bash, ["-n", tmp], { encoding: "utf8" });
      } catch (err) {
        bad++;
        console.error(`✗ ${rel} / ${step.name ?? "(无名)"}：\n${err.stderr}`);
      } finally {
        fs.rmSync(tmp, { force: true });
      }
    }
  }
  if (n) console.log(`  ${n} 段 shell 语法正常`);

  // env 里的键引用自己 = 循环引用，GitHub 会拒绝整个文件。
  for (const [where, scope] of envScopes(doc)) {
    for (const [key, value] of Object.entries(scope)) {
      if (typeof value !== "string") continue;
      if (!value.includes(`env.${key}`)) continue;
      bad++;
      console.error(
        `✗ ${rel} / ${where}：env.${key} 引用了自己（"${value}"）—— 循环引用，GitHub 会拒绝整个文件。`,
      );
    }
  }
}

/**
 * 找出所有 env 映射：workflow 级、job 级、step 级。
 * 返回 [说明, 映射] 的列表。
 */
function envScopes(doc) {
  const out = [["workflow", doc.env]];
  for (const [jobName, job] of Object.entries(doc.jobs ?? {})) {
    if (job?.env) out.push([`job ${jobName}`, job.env]);
    for (const [i, step] of (job?.steps ?? []).entries()) {
      if (step?.env) out.push([`job ${jobName} / step ${i + 1}（${step.name ?? "无名"}）`, step.env]);
    }
  }
  return out.filter(([, m]) => m && typeof m === "object");
}

if (bad) {
  console.error(`\n${bad} 处有问题。`);
  process.exit(1);
}
console.log("\n工作流都过了。");
