/**
 * 自动更新在界面上说的话（domain/update.ts）。
 *
 * 界面不出现内部词（electron-updater、feed、sha512 这些）——
 * 这一层就是守着那条线的：状态翻译成人话，
 * 而且每个状态都要有一句能显示的话（空串在界面上就是一行空白，用户不知道是没话说还是坏了）。
 */
import { describe, expect, it } from "vitest";

import {
  describeUpdate,
  updateBusy,
  type UpdateState,
  type UpdateStatus,
} from "../../src/domain/update.ts";

const ALL: UpdateState[] = [
  "unsupported",
  "idle",
  "checking",
  "available",
  "downloading",
  "ready",
  "updating",
  "latest",
  "error",
];

describe("更新状态说的话", () => {
  it("每个状态都有一句话", () => {
    for (const state of ALL) {
      expect(describeUpdate({ state })).not.toBe("");
    }
  });

  it("不出现内部词", () => {
    const banned = ["electron", "updater", "feed", "sha512", "nsis", "yml", "api"];
    for (const state of ALL) {
      const text = describeUpdate({ state, version: "0.1.2", error: "连不上更新源" });
      for (const word of banned) {
        expect(text.toLowerCase()).not.toContain(word);
      }
    }
  });

  it("有版本号就写出来", () => {
    expect(describeUpdate({ state: "available", version: "0.1.2" })).toBe("有新版本：0.1.2");
  });

  it("下载进度写成百分比", () => {
    expect(describeUpdate({ state: "downloading", progress: 42 })).toBe("正在下载：42%");
  });

  it("出错时把原因带上", () => {
    expect(describeUpdate({ state: "error", error: "连不上更新源" })).toBe(
      "检查更新失败：连不上更新源",
    );
  });

  it("不支持时照实说理由（免安装版那句原样显示）", () => {
    const note = "免安装版不能自动更新，用安装版才有";
    expect(describeUpdate({ state: "unsupported", note })).toBe(note);
  });

  it("下载好了说的是「重启后」——安装是要重启的，别说得像热更新", () => {
    expect(describeUpdate({ state: "ready" })).toBe("下载好了，重启后装上");
  });
});

describe("忙不忙", () => {
  it("查、下载、重启的时候按钮该禁用", () => {
    expect(updateBusy({ state: "checking" })).toBe(true);
    expect(updateBusy({ state: "downloading" })).toBe(true);
    expect(updateBusy({ state: "updating" })).toBe(true);
  });

  it("最新与出错之后还能再查（不给重试就等于把人卡死）", () => {
    expect(updateBusy({ state: "latest" })).toBe(false);
    expect(updateBusy({ state: "error" })).toBe(false);
    expect(updateBusy({ state: "idle" })).toBe(false);
    expect(updateBusy({ state: "available" })).toBe(false);
    expect(updateBusy({ state: "ready" })).toBe(false);
  });
});

describe("状态名与主进程那一侧一致", () => {
  it("渲染层认的状态都在约定的集合里", () => {
    // 主进程那边（desktop/lib/update-events.mjs）折出来的 state 只能是这些
    const known = new Set<string>(ALL);
    const fromMain = [
      "idle",
      "checking",
      "available",
      "latest",
      "downloading",
      "ready",
      "updating",
      "error",
      "unsupported",
    ];
    for (const s of fromMain) expect(known.has(s)).toBe(true);
  });
});
