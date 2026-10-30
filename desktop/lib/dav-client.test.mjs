/**
 * 主进程那个 WebDAV 客户端（dav-client.mjs）。
 *
 * 为什么要有它：渲染层是 `app://` 源，跨源请求要过 CORS，
 * 而自建 WebDAV 默认**不发** `Access-Control-Allow-Origin` ——
 * 实测 Electron 45："blocked by CORS policy"。主进程用 Node 的 http，不受这条管。
 *
 * 这里用一台本机的假 WebDAV 验：它**故意不发 CORS 头**（跟真实自建服务器一样），
 * 免得测出一个「加了 CORS 头才能通」的假结论。
 */
import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { davRequest, readableError } from "./dav-client.mjs";

/** 起一台假 WebDAV：记下收到的请求，按脚本回话。 */
async function startServer(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      seen.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      });
      handler(req, res, seen);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  return { server, seen, base: `http://127.0.0.1:${server.address().port}` };
}

test("GET：请求发出去，状态、头、正文都带回来", async () => {
  const { server, seen, base } = await startServer((req, res) => {
    // 故意不发 access-control-allow-origin —— 真实自建 WebDAV 就是这样
    res.writeHead(200, { "content-type": "application/json", etag: '"v1"' });
    res.end('{"v":1,"iv":"aXY=","ciphertext":"Y2lwaGVy"}');
  });

  const res = await davRequest({ url: `${base}/dav/life-guide-space1.json` });

  assert.equal(res.status, 200);
  assert.equal(res.headers.etag, '"v1"');
  assert.equal(res.body, '{"v":1,"iv":"aXY=","ciphertext":"Y2lwaGVy"}');
  assert.equal(seen[0].method, "GET");
  assert.equal(seen[0].url, "/dav/life-guide-space1.json");
  server.close();
});

test("PUT：请求头与正文原样送到服务器", async () => {
  const { server, seen, base } = await startServer((req, res) => {
    res.writeHead(201, { etag: '"v2"' });
    res.end();
  });

  const res = await davRequest({
    url: `${base}/dav/life-guide-space1.json`,
    method: "PUT",
    headers: { authorization: "Basic dTpw", "if-match": '"v1"' },
    body: '{"v":1}',
  });

  assert.equal(res.status, 201);
  assert.equal(seen[0].method, "PUT");
  assert.equal(seen[0].headers.authorization, "Basic dTpw");
  assert.equal(seen[0].headers["if-match"], '"v1"');
  assert.equal(seen[0].body, '{"v":1}');
  server.close();
});

test("404 与 304 都如实带回来（不是错）", async () => {
  const { server, base } = await startServer((req, res) => {
    if (req.url.endsWith("/missing.json")) {
      res.writeHead(404).end();
    } else {
      res.writeHead(304).end();
    }
  });

  assert.equal((await davRequest({ url: `${base}/missing.json` })).status, 404);
  assert.equal((await davRequest({ url: `${base}/same.json` })).status, 304);
  server.close();
});

test("只放 http 与 https —— 别的协议不走这条缝", async () => {
  await assert.rejects(() => davRequest({ url: "file:///C:/Windows/x" }), /只支持 http/);
  await assert.rejects(() => davRequest({ url: "data:text/plain,x" }), /只支持 http/);
  await assert.rejects(() => davRequest({ url: "not-a-url" }), /地址不合法/);
  await assert.rejects(() => davRequest({ url: "" }), /请求没有地址/);
});

test("连不上：说清楚是连接问题，不吞掉", async () => {
  // 先占一个端口再放掉 —— 那个端口没人听
  const { server, base } = await startServer(() => {});
  const port = new URL(base).port;
  server.close();
  await new Promise((r) => server.close(r));

  await assert.rejects(
    () => davRequest({ url: `http://127.0.0.1:${port}/x.json` }),
    (err) => err instanceof Error && /ECONNREFUSED|ECONNRESET|EPIPE/.test(err.message),
  );
});

test("超时：到点就断开，不吊着", async () => {
  const { server, base } = await startServer(() => {
    // 什么都不回 —— 让它挂着
  });

  await assert.rejects(
    () => davRequest({ url: `${base}/slow.json` }, { timeoutMs: 150 }),
    /超时/,
  );
  server.close();
});

test("自签证书：说清楚是证书不被信任，不丢一堆 OpenSSL 术语", () => {
  const err = readableError(
    Object.assign(new Error("self-signed certificate"), { code: "DEPTH_ZERO_SELF_SIGNED_CERT" }),
  );
  assert.match(err.message, /证书不被信任/);
  assert.match(err.message, /http:\/\//);
});

test("别的错误原样留着（别把技术细节洗没了）", () => {
  const original = Object.assign(new Error("connect ECONNREFUSED 192.168.1.9:5006"), {
    code: "ECONNREFUSED",
  });
  assert.equal(readableError(original), original);
});
