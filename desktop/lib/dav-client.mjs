/**
 * WebDAV 请求：主进程里用 Node 的 http/https 发。
 *
 * **为什么不在渲染层直接 fetch**：渲染层的源是 `app://`，跨源请求要过 CORS。
 * 实测（Electron 45，app:// → http://127.0.0.1）：
 * 服务器不给 `Access-Control-Allow-Origin` 就是 "blocked by CORS policy"，
 * 给了才通。而自建 WebDAV（nginx 的 dav 模块、Apache mod_dav、NAS 自带的那些）
 * **默认不发这个头** —— 于是「家里那台 WebDAV」在渲染层里连都连不上。
 *
 * 主进程用 Node 的 http，不受同源策略管 → 局域网里的 `http://192.168.x.x` 直接能用。
 *
 * 这里只做一件事：把一次请求原样送出去、把响应原样带回来。
 * 条件头（If-Match / If-None-Match）与认证头都是渲染层算好了传进来的，主进程不解释。
 */
import http from "node:http";
import https from "node:https";

/** 默认超时：局域网的东西不该让人等太久 */
const DEFAULT_TIMEOUT_MS = 30_000;

/** 头名统一小写 —— HTTP 头大小写不敏感，但两边对不上就难查了 */
function normalizeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (v === undefined || v === null) continue;
    out[String(k).toLowerCase()] = String(v);
  }
  return out;
}

/** 响应头：同名多个值时用逗号连起来（set-cookie 那种，WebDAV 用不上但别丢） */
function flattenHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    if (v === undefined) continue;
    out[k.toLowerCase()] = Array.isArray(v) ? v.join(", ") : String(v);
  }
  return out;
}

/**
 * 把技术错误翻译成能照着做的话。
 *
 * 自签证书是最容易撞上的一个：局域网里那台服务器多半没有公网证书，
 * 而 Node 不像浏览器那样会先弹一个「要不要继续」的框 —— 它直接失败。
 */
export function readableError(err) {
  const code = err?.code ?? "";
  if (
    code === "DEPTH_ZERO_SELF_SIGNED_CERT" ||
    code === "SELF_SIGNED_CERT_IN_CHAIN" ||
    code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
  ) {
    return new Error(
      "服务器的证书不被信任（多半是自签证书）—— 局域网里可以改用 http://，或者把那张证书装进系统信任库",
    );
  }
  return err;
}

/**
 * 发一次 HTTP 请求。
 *
 * @param {{url: string, method?: string, headers?: Record<string,string>, body?: string}} req
 * @param {{timeoutMs?: number}} [opts]
 * @returns {Promise<{status: number, headers: Record<string,string>, body: string}>}
 */
export function davRequest(req, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const { url, method = "GET", headers, body } = req ?? {};

  if (!url) return Promise.reject(new Error("请求没有地址"));
  let target;
  try {
    target = new URL(url);
  } catch {
    return Promise.reject(new Error(`地址不合法：${url}`));
  }
  // 只放 http/https —— file:、data: 这些不该从这条缝里走
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return Promise.reject(new Error(`只支持 http 与 https，收到的是 ${target.protocol}`));
  }

  const transport = target.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const r = transport.request(
      target,
      { method, headers: normalizeHeaders(headers) },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode ?? 0,
            headers: flattenHeaders(res.headers),
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
        res.on("error", reject);
      },
    );
    r.setTimeout(timeoutMs, () => {
      r.destroy(new Error(`请求超时（${timeoutMs / 1000} 秒）`));
    });
    r.on("error", (err) => reject(readableError(err)));
    if (body !== undefined && body !== null && body !== "") r.write(body);
    r.end();
  });
}
