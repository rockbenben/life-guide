import assert from "node:assert/strict";
import test from "node:test";

import { CSP, responseHeaders } from "./protocol-headers.mjs";

test("HTML 带上 CSP 与 nosniff", () => {
  const h = responseHeaders(".html");
  assert.equal(h["content-type"], "text/html; charset=utf-8");
  assert.equal(h["x-content-type-options"], "nosniff");
  assert.equal(h["content-security-policy"], CSP);
});

test("脚本 / 样式 / 图片不重复带 CSP", () => {
  for (const ext of [".js", ".css", ".png", ".json", ".woff2"]) {
    assert.equal(responseHeaders(ext)["content-security-policy"], undefined, ext);
    assert.equal(responseHeaders(ext)["x-content-type-options"], "nosniff", ext);
  }
});

test("CSP 只允许 self 脚本，样式允许内联（Preact 的 style 属性）", () => {
  const script = CSP.match(/script-src ([^;]+)/)?.[1] ?? "";
  assert.equal(script.trim(), "'self'");
  assert.doesNotMatch(script, /unsafe-inline|unsafe-eval/);

  const style = CSP.match(/style-src ([^;]+)/)?.[1] ?? "";
  assert.match(style, /'self'/);
  assert.match(style, /'unsafe-inline'/);

  assert.match(CSP, /object-src 'none'/);
  assert.match(CSP, /base-uri 'none'/);
  assert.match(CSP, /frame-ancestors 'none'/);
});

test("未知扩展名回退成二进制流", () => {
  assert.equal(responseHeaders(".bin")["content-type"], "application/octet-stream");
});

test("connect-src 放行 https：同步服务是用户自己填的地址", () => {
  // 收紧成 'self' 的话，桌面端连不上同步服务（多设备同步，AGENTS.md §4.6）。
  const connect = CSP.match(/connect-src ([^;]+)/)?.[1] ?? "";
  assert.match(connect, /'self'/);
  assert.match(connect, /https:/);
  // 但不放行明文 http：局域网里的 http 服务连不上（要连自己套 https）
  assert.doesNotMatch(connect, /(^|\s)http:/);
  // 远程脚本仍然不放行 —— 渲染层只跑自己构建出来的那份代码
  assert.doesNotMatch(CSP.match(/script-src ([^;]+)/)?.[1] ?? "", /https?:/);
});
