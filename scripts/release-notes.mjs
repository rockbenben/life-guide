/**
 * 这一版的发布说明从哪儿来。
 *
 * **为什么正文不再由人在草稿页上现写**（2026-10-30）：
 *
 *   原来 publish 走 `release` environment（人工审批），作者在放行之前
 *   到 GitHub 的发布草稿页上把「这一版改了什么」写进去。这条路有个
 *   已经翻过车的地方：**正文在草稿页上，不在版本库里** ——
 *   v0.2.0 发布出去的那一页上写的仍是占位符（见 62d66de 与 affa93c）：
 *   正文要等审批前才写，而审批常常来不及。
 *
 *   审批拆掉之后这条路整个没有了。正文改成**版本库里的一个文件**：
 *   `docs/发布说明/<tag>.md`，跟那一版的代码在同一个提交里。
 *
 * **去哪儿找这个文件**：
 *
 *   先看工作区（流水线里就是被打 tag 的那个提交），再看默认分支。
 *   两个地方都没有就是「这一版没写说明」，直接报错，不编一段占位符。
 *
 *   为什么还要看默认分支：tag 是推上去之后才发现漏写说明的时候，
 *   已经不能改 tag 了（产物是按那个提交打的）。这时候把说明提交到
 *   默认分支、重跑失败的 job 就行，不必动 tag。
 *
 * **为什么缺了就报错，不自动生成一段**：
 *
 *   这一版的说明是作者写的，不是机器能推出来的。机器能推的是「提交里
 *   改了什么」，那是给开发者看的，不是给用这个 App 的人看的。
 *   宁可发不出去，也不要发一页占位符 —— v0.2.0 已经证明占位符会被发出去。
 *
 * 用法：
 *   TAG=v0.1.1 node scripts/release-notes.mjs            # 打印正文
 *   TAG=v0.1.1 node scripts/release-notes.mjs --check    # 只查在不在（缺了退出码非 0）
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { STANDING_NOTICES } from "./release-notices.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

/** 版本说明放哪儿：跟当年 v0.1.1 / v0.2.0 用的是同一个位置。 */
export const NOTES_DIR = path.join("docs", "发布说明");

/**
 * 模板里那一行标记 —— 它还在，就说明这一版还没写。
 *
 * **为什么用标记而不是「文件非空」**：`set-version.mjs` 会先生成一份
 * 模板，作者在它上面改。文件非空不代表写过了 —— 模板本身就不空。
 */
export const TEMPLATE_MARKER = "<!-- 待写 -->";

/** 这一版的说明文件在哪儿（相对仓库根）。 */
export function notesFileFor(tag) {
  return path.join(NOTES_DIR, `${tag}.md`);
}

/** 文件在，但内容还是模板 → 算没写。 */
export function isWritten(text) {
  return text.trim().length > 0 && !text.includes(TEMPLATE_MARKER);
}

/**
 * 从一个 git ref 读文件（不落盘）。
 *
 * 用 `git show` 而不是 GitHub API：路径里有中文，API 那边要自己编码，
 * 而 git 直接按 UTF-8 路径取，省掉一层容易出错的东西。
 *
 * **路径要换成正斜杠**：git 的对象写法只认正斜杠，而路径可能来自任何地方
 * —— `path.join` 在 Windows 上给的是反斜杠（`docs\发布说明\v7.7.7.md`），
 * 写成反斜杠时 `git show` 报「path not found」，**静默地读不到**。
 *
 * **两种分隔符都要换**（`/[\\/]/`，不是 `path.sep`）：只按当前平台的分隔符切，
 * 在 Linux 上收到反斜杠路径就原样放过了 —— 同一份代码在两个平台上行为不一样。
 */
export function readNotesAtRef(ref, relPath, cwd = root) {
  const gitPath = relPath.split(/[\\/]/).join("/");
  try {
    return execFileSync("git", ["show", `${ref}:${gitPath}`], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return null;
  }
}

/**
 * 那个 ref 在本地吗？不在就浅拉一下（只拉一次，不改工作区）。
 *
 * `ref` 写成 `origin/main` 这种形式：本地检查用 `refs/remotes/origin/main`，
 * 拉取时用远端那边的短名 `main` —— `git fetch origin origin/main` 找不到
 * 那个 ref（远端上叫 `main`）。
 */
export function ensureRef(ref, cwd = root) {
  const local = ref.startsWith("origin/")
    ? `refs/remotes/${ref}`
    : ref;
  const remote = ref.startsWith("origin/") ? ref.slice("origin/".length) : ref;

  try {
    execFileSync("git", ["rev-parse", "--verify", `${local}^{commit}`], {
      cwd,
      stdio: "ignore",
    });
    return true;
  } catch {
    /* 本地没有这个 ref */
  }
  try {
    // 显式 refspec：不然 `git fetch origin main` 只更新 FETCH_HEAD，
    // `refs/remotes/origin/main` 未必跟着动（浅拉时尤其容易）。
    execFileSync(
      "git",
      ["fetch", "--no-tags", "--depth=1", "origin", `+refs/heads/${remote}:refs/remotes/origin/${remote}`],
      { cwd, stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * 读这一版的说明。
 *
 * 先工作区，后默认分支（`fallbackRef`）。
 * 返回里的 `source` 说明是从哪儿找到的 —— 排查「为什么这版没有说明」时要看它。
 */
export function readNotes(tag, { cwd = root, fallbackRef = "origin/main" } = {}) {
  const rel = notesFileFor(tag);
  const file = path.join(cwd, rel);

  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, "utf8");
    return { found: true, written: isWritten(text), text, source: "工作区", file };
  }

  if (fallbackRef && ensureRef(fallbackRef, cwd)) {
    const text = readNotesAtRef(fallbackRef, rel, cwd);
    if (text !== null) {
      return { found: true, written: isWritten(text), text, source: fallbackRef, file };
    }
  }

  return { found: false, written: false, text: "", source: null, file };
}

/**
 * 正文 = 这一版特有的内容 + 一直如此的那几条告知。
 *
 * 固定告知（未签名、哪些形态能自动更新、关窗口只是收进托盘）由
 * `scripts/release-notices.mjs` 提供，**不要在说明文件里重复写** ——
 * 重复了发布页上会出现两遍。
 */
export function buildBody(notesText, notices = STANDING_NOTICES) {
  return `${notesText.trim()}\n\n${notices}\n`;
}

/**
 * 作者没写说明时，给出能照着做的那几句话。
 *
 * 措辞要具体到「做什么、在哪一步」：这是发版时最常卡住的地方，
 * 一句「说明待补」让人不知道该动哪个文件。
 */
export function missingNotesMessage(tag, notes) {
  const where = notesFileFor(tag);
  if (!notes.found) {
    return [
      `这一版的发布说明还没有：${where}`,
      "",
      "写法：在仓库里写这个文件，然后跟那一版的代码一起提交。",
      "  node scripts/set-version.mjs 会先放一份模板进去。",
      "",
      "如果 tag 已经推出去了 —— 说明提交到默认分支，再重跑失败的 job，",
      "不用动 tag（产物是按那个提交打的）。",
      "",
      "为什么不自动生成一段：这一版的说明是给用这个 App 的人看的，",
      "只有作者知道这一版该说什么；机器能推的「提交里改了什么」是另一回事。",
    ].join("\n");
  }
  return [
    `这一版的发布说明还是模板：${where}`,
    "",
    `模板里那行 \`${TEMPLATE_MARKER}\` 还在 —— 把这一版改了什么写进去，`,
    "并删掉那一行，然后跟代码一起提交、再打 tag。",
  ].join("\n");
}

/**
 * 这一版的正文（缺说明时报错退出，不给占位符）。
 */
export function releaseBodyFor(tag, options = {}) {
  const notes = readNotes(tag, options);
  if (!notes.written) {
    console.error(missingNotesMessage(tag, notes));
    process.exit(1);
  }
  return buildBody(notes.text);
}

// ------------------------------------------------------------------ 命令行
const isMain =
  process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  const tag = process.env.TAG;
  if (!tag) {
    console.error("需要 TAG 环境变量（如 TAG=v0.1.1）");
    process.exit(1);
  }
  if (process.argv.includes("--check")) {
    const notes = readNotes(tag);
    if (!notes.written) {
      console.error(missingNotesMessage(tag, notes));
      process.exit(1);
    }
    console.log(`✓ 这一版的发布说明在（${notes.source}）：${notesFileFor(tag)}`);
  } else {
    process.stdout.write(releaseBodyFor(tag));
  }
}
