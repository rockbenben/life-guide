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
