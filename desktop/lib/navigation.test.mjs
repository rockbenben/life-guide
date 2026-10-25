import assert from "node:assert/strict";
import test from "node:test";

import {
  isTrustedSender,
  isTrustedSenderUrl,
  navigationDecision,
} from "./navigation.mjs";

test("应用内导航放行，且只认 app://bundle", () => {
  assert.equal(navigationDecision("app://bundle/index.html"), "allow");
  assert.equal(navigationDecision("app://bundle/#manual"), "allow");
  assert.equal(navigationDecision("app://evil/index.html"), "deny");
  assert.equal(navigationDecision("app://bundle.evil/index.html"), "deny");
});

test("开发服务器只放行同源", () => {
  const dev = "http://localhost:5173";
  assert.equal(navigationDecision("http://localhost:5173/", dev), "allow");
  assert.equal(navigationDecision("http://localhost:5173/#manual", dev), "allow");
  assert.equal(navigationDecision("http://localhost.evil.com:5173/", dev), "external");
  assert.equal(navigationDecision("http://localhost:5174/", dev), "external");
});

test("站外 http(s) 交系统浏览器，其他协议拒绝", () => {
  assert.equal(navigationDecision("https://example.com/a"), "external");
  assert.equal(navigationDecision("http://example.com/a"), "external");
  assert.equal(navigationDecision("file:///C:/Windows/notepad.exe"), "deny");
  assert.equal(navigationDecision("javascript:alert(1)"), "deny");
  assert.equal(navigationDecision("data:text/html,<script></script>"), "deny");
  assert.equal(navigationDecision(""), "deny");
  assert.equal(navigationDecision(null), "deny");
});

test("IPC sender：senderFrame 优先，取不到退回 webContents URL", () => {
  assert.equal(isTrustedSenderUrl("app://bundle/index.html"), true);
  assert.equal(isTrustedSenderUrl("https://example.com"), false);

  const trusted = { senderFrame: { url: "app://bundle/index.html" } };
  const untrusted = { senderFrame: { url: "https://example.com" } };
  assert.equal(isTrustedSender(trusted), true);
  assert.equal(isTrustedSender(untrusted), false);

  const fallback = { senderFrame: null, sender: { getURL: () => "app://bundle/index.html" } };
  assert.equal(isTrustedSender(fallback), true);

  assert.equal(isTrustedSender({}), false);
});

test("开发模式下的 IPC sender 也认 dev server", () => {
  const dev = "http://localhost:5173";
  assert.equal(
    isTrustedSender({ senderFrame: { url: "http://localhost:5173/index.html" } }, dev),
    true,
  );
  assert.equal(
    isTrustedSender({ senderFrame: { url: "http://localhost.evil.com:5173/" } }, dev),
    false,
  );
});
