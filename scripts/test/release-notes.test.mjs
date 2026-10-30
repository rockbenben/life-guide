import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

import {
  notesFileFor,
  readNotes,
  readNotesAtRef,
  buildBody,
  missingNotesMessage,
  isWritten,
  TEMPLATE_MARKER,
  NOTES_DIR,
} from "../release-notes.mjs";

/**
 * 这些是发版的闸门，得有测试守着 ——
 * v0.2.0 就是因为「说明在哪」这件事没守住，把一句占位符发到了公开页面上。
 */

let dir;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rel-notes-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function writeNotes(tag, text) {
  const file = path.join(dir, notesFileFor(tag));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
  return file;
}

describe("notesFileFor", () => {
  it("在 docs/发布说明/ 下面，按 tag 命名", () => {
    expect(notesFileFor("v0.3.0")).toBe(path.join(NOTES_DIR, "v0.3.0.md"));
  });
});

describe("isWritten", () => {
  it("空的算没写", () => {
    expect(isWritten("")).toBe(false);
    expect(isWritten("   \n  ")).toBe(false);
  });

  it("模板还在的算没写（文件非空不等于写过了）", () => {
    expect(isWritten(`${TEMPLATE_MARKER}\n\n这一版加了什么`)).toBe(false);
  });

  it("写过的算写了", () => {
    expect(isWritten("这一版加了什么。")).toBe(true);
  });
});

describe("readNotes", () => {
  it("文件不在 → found 为 false", () => {
    const notes = readNotes("v0.3.0", { cwd: dir, fallbackRef: null });
    expect(notes.found).toBe(false);
    expect(notes.written).toBe(false);
  });

  it("工作区里有 → 读到，并说清是从哪儿来的", () => {
    writeNotes("v0.3.0", "这一版加了什么。");
    const notes = readNotes("v0.3.0", { cwd: dir, fallbackRef: null });
    expect(notes.found).toBe(true);
    expect(notes.written).toBe(true);
    expect(notes.text).toContain("这一版加了什么");
    expect(notes.source).toBe("工作区");
  });

  it("工作区里是模板 → 找到但没写", () => {
    writeNotes("v0.3.0", `${TEMPLATE_MARKER}\n\n还没写`);
    const notes = readNotes("v0.3.0", { cwd: dir, fallbackRef: null });
    expect(notes.found).toBe(true);
    expect(notes.written).toBe(false);
  });
});

describe("buildBody", () => {
  it("正文 + 固定告知", () => {
    const body = buildBody("这一版加了什么。");
    expect(body).toContain("这一版加了什么。");
    expect(body).toContain("三件要知道的事");
    expect(body.endsWith("\n")).toBe(true);
  });

  it("固定告知在正文后面，不在前面", () => {
    const body = buildBody("正文");
    expect(body.indexOf("正文")).toBeLessThan(body.indexOf("三件要知道的事"));
  });

  it("正文首尾的空白被去掉（说明文件里常留空行）", () => {
    const body = buildBody("\n\n这一版加了什么。\n\n");
    expect(body.startsWith("这一版加了什么。")).toBe(true);
  });
});

describe("missingNotesMessage", () => {
  it("文件不在 → 说清去哪儿写、怎么写", () => {
    const msg = missingNotesMessage("v0.3.0", { found: false, written: false });
    expect(msg).toContain("v0.3.0.md");
    expect(msg).toContain("还没有");
    expect(msg).toContain("set-version.mjs");
  });

  it("是模板 → 说清那行标记还在", () => {
    const msg = missingNotesMessage("v0.3.0", { found: true, written: false });
    expect(msg).toContain(TEMPLATE_MARKER);
  });

  it("两种情况都说得出「为什么不能自动生成」", () => {
    const a = missingNotesMessage("v0.3.0", { found: false, written: false });
    const b = missingNotesMessage("v0.3.0", { found: true, written: false });
    expect(a).toContain("只有作者知道");
    expect(b).toContain(TEMPLATE_MARKER);
  });
});

/**
 * 从 git ref 读文件那条路。
 *
 * **为什么单独测**（2026-10-30 实测踩过）：`path.join` 在 Windows 上给的是
 * 反斜杠，而 git 的对象写法只认正斜杠 —— 写成 `docs\发布说明\v7.7.7.md`
 * 时 `git show` 报「path not found」，**静默地读不到**（返回 null，
 * 看起来像「这个版本没有说明」）。这条兜底路是给「tag 推出去之后才发现
 * 漏写说明」用的，读不到就等于那道兜底没有。
 */
describe("readNotesAtRef", () => {
  const git = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  beforeEach(() => {
    // 一个本地仓库，带中文目录与一份说明
    git("init", "--quiet", "--initial-branch=main");
    git("config", "user.email", "t@example.com");
    git("config", "user.name", "t");
    const file = path.join(dir, notesFileFor("v7.7.7.md".replace(/\.md$/, "")));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "这一版只有远端分支上有说明。\n", "utf8");
    git("add", "-A");
    git("commit", "--quiet", "-m", "notes");
  });

  it("能从 ref 读到文件", () => {
    const text = readNotesAtRef("HEAD", notesFileFor("v7.7.7"), dir);
    expect(text).toContain("这一版只有远端分支上有说明");
  });

  it("路径带反斜杠也读得到（git 的对象写法只认正斜杠）", () => {
    // 复现那个 bug：把反斜杠路径直接当对象名。
    //
    // **这里显式写死反斜杠，不看 path.join 的结果** ——
    // path.join 在 Windows 上给反斜杠、在 Linux 上给正斜杠，
    // 断言「结果里有没有反斜杠」就只在 Windows 上成立（2026-10-30 实测：
    // 本地全绿、CI 红了）。要钉住的是「反斜杠路径也能读到」这件事，
    // 那在任何平台上都该成立。
    const withBackslash = "docs\\发布说明\\v7.7.7.md";
    expect(readNotesAtRef("HEAD", withBackslash, dir)).toContain("这一版只有远端分支上有说明");
  });

  it("ref 上没这个文件 → null（不是抛错）", () => {
    expect(readNotesAtRef("HEAD", notesFileFor("v9.9.9"), dir)).toBeNull();
  });
});
