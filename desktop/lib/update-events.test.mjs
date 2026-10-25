/**
 * 自动更新的状态机（node --test）。
 *
 * 这一层是纯函数，不 import electron，起来就能跑。
 *
 * 钉住的是「上一轮留下的东西会不会挂到下一轮」——
 * 比如下载到 42% 时出错了，界面上不能还显示「正在下载：42%」，
 * 那种对不上的话会让人以为还在下。
 *
 * 跑法：npm run test:desktop
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { initialUpdateStatus, reduceUpdate, friendlyUpdateError } from "./update-events.mjs";

test("一开始是「不支持」——形态没认出来之前不许说能更新", () => {
  assert.equal(initialUpdateStatus().state, "unsupported");
  assert.equal(initialUpdateStatus("免安装版不能自动更新").note, "免安装版不能自动更新");
});

test("查 → 有新版本 → 下载 → 下好了", () => {
  let s = { state: "idle" };
  s = reduceUpdate(s, { type: "checking" });
  assert.equal(s.state, "checking");

  s = reduceUpdate(s, { type: "available", version: "0.1.2" });
  assert.equal(s.state, "available");
  assert.equal(s.version, "0.1.2");

  s = reduceUpdate(s, { type: "progress", percent: 42 });
  assert.equal(s.state, "downloading");
  assert.equal(s.progress, 42);

  s = reduceUpdate(s, { type: "downloaded", version: "0.1.2" });
  assert.equal(s.state, "ready");
  assert.equal(s.progress, 100);
});

test("出错时把上一轮的东西清干净（不能还挂着 42%）", () => {
  let s = reduceUpdate({ state: "idle" }, { type: "progress", percent: 42 });
  s = reduceUpdate(s, { type: "error", message: "连不上更新源" });
  assert.equal(s.state, "error");
  assert.equal(s.error, "连不上更新源");
  assert.equal(s.progress, undefined);
});

test("出错时也有话可说", () => {
  const s = reduceUpdate({ state: "idle" }, { type: "error" });
  assert.ok(s.error && s.error.length > 0);
});

test("百分比夹在 0～100 之间", () => {
  assert.equal(reduceUpdate({ state: "idle" }, { type: "progress", percent: -3 }).progress, 0);
  assert.equal(reduceUpdate({ state: "idle" }, { type: "progress", percent: 180 }).progress, 100);
  assert.equal(reduceUpdate({ state: "idle" }, { type: "progress", percent: 41.6 }).progress, 42);
});

test("已经是最新：版本号留着", () => {
  const s = reduceUpdate({ state: "checking" }, { type: "latest", version: "0.1.2" });
  assert.equal(s.state, "latest");
  assert.equal(s.version, "0.1.2");
});

test("不认识的事件不动状态（别把界面弄乱）", () => {
  const before = { state: "idle" };
  assert.equal(reduceUpdate(before, { type: "whatever" }), before);
});

test("错误翻成人话：只说能说清的，不把原始报错漏出去", () => {
  // 404：私有仓库取不到更新清单（实测就是这个）
  assert.equal(
    friendlyUpdateError({ statusCode: 404 }),
    "找不到更新源（仓库是私有的，或者还没有发过版本）",
  );
  // 别的状态码
  assert.equal(friendlyUpdateError({ statusCode: 500 }), "更新源返回了 500");
  // 网络问题
  assert.equal(
    friendlyUpdateError(new Error("getaddrinfo ENOTFOUND github.com")),
    "连不上更新源",
  );
  // 证书问题
  assert.equal(
    friendlyUpdateError(new Error("self signed certificate in chain")),
    "更新源的证书有问题",
  );
  // 签名问题（electron-updater 的 ERR_UPDATER_INVALID_SIGNATURE）
  assert.equal(
    friendlyUpdateError(new Error("New version 0.1.2 is not signed by the application owner")),
    "新版本没有签名，不敢装",
  );
  // 说不出来的就一句「出了点问题」
  assert.equal(friendlyUpdateError(new Error("什么怪事")), "出了点问题");
  assert.equal(friendlyUpdateError(undefined), "出了点问题");
});

test("原始报错里的响应头与 Cookie 不能漏到界面上", () => {
  // 真实报错长这样：状态行 + 响应头 + Cookie
  const raw = new Error(
    '404 "method: GET url: https://github.com/o/r/releases.atom\\n\\nHeaders: { "set-cookie": [ "_gh_sess=abc123" ] }"',
  );
  const text = friendlyUpdateError(raw);
  assert.ok(!/cookie/i.test(text), "漏了 Cookie");
  assert.ok(!/header/i.test(text), "漏了响应头");
  assert.ok(!/https?:/.test(text), "漏了 URL");
});
