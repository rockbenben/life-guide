/**
 * 一次 HTTP 请求：跨三端的统一入口。
 *
 * **为什么不直接用 fetch**：渲染层在两种壳里都被同源策略管着 ——
 * 桌面端是 `app://` 源，手机端是 `https://localhost` 源，两者跨源请求都要过 CORS。
 * 而自建 WebDAV（nginx 的 dav 模块、Apache mod_dav、NAS 自带的那些）
 * **默认不发 `Access-Control-Allow-Origin`** —— 实测 Electron 45：
 * 不发就是 "blocked by CORS policy"，发了才通。
 * 于是「家里那台 WebDAV」用 fetch 是连不上的。
 *
 * **三条路**：
 *   · 桌面端 → 主进程（Node 的 http，不受同源策略管；`desktop/lib/dav-client.mjs`）
 *   · 手机端（Android）→ 原生 HTTP（CapacitorHttp 插件，WebView 之外的请求，
 *     既不过 CORS 也不受混合内容限制）
 *   · 浏览器 → 只有 fetch（CORS 与混合内容都管着，这条路走不通 WebDAV）
 *
 * **谁在用**：目前只有网盘（WebDAV）那个落点走这里。
 * GitHub 与自建 Worker 用 https，服务器自己会发 CORS 头，fetch 直接够用 ——
 * 能少走一条路就少走一条。
 */

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** 桌面端 preload 暴露的那条缝 */
interface DesktopBridge {
  isDesktop?: boolean;
  davRequest?: (req: HttpRequest) => Promise<HttpResponse>;
}

/** Capacitor 的原生桥 */
interface CapacitorBridge {
  isNativePlatform?: () => boolean;
  nativePromise?: (plugin: string, method: string, options: unknown) => Promise<unknown>;
}

function desktopBridge(): DesktopBridge | undefined {
  // 用 globalThis 而不是 window：单元测试跑在 node 环境里（那里没有 window）
  const w = globalThis as unknown as { lifeGuide?: DesktopBridge };
  return w.lifeGuide;
}

function capacitor(): CapacitorBridge | undefined {
  const w = globalThis as unknown as { Capacitor?: CapacitorBridge };
  return w.Capacitor;
}

/** 桌面端：交给主进程发 */
async function desktopRequest(req: HttpRequest): Promise<HttpResponse> {
  const bridge = desktopBridge();
  if (!bridge?.davRequest) throw new Error("桌面端那条缝没接上");
  const res = await bridge.davRequest(req);
  return { status: res?.status ?? 0, headers: res?.headers ?? {}, body: res?.body ?? "" };
}

/**
 * 手机端（Android）：走原生 HTTP。
 *
 * Capacitor 的 `CapacitorHttp` 插件由 Bridge 自动注册，
 * 用 `nativePromise` 就能调到 —— 不需要在页面里 import @capacitor/core
 * （那会把 Capacitor 运行时塞进 PWA 的包里，白白变大）。
 */
async function nativeRequest(req: HttpRequest): Promise<HttpResponse> {
  const cap = capacitor();
  if (!cap?.nativePromise) throw new Error("原生桥没接上");
  const res = (await cap.nativePromise("CapacitorHttp", "request", {
    url: req.url,
    method: req.method ?? "GET",
    headers: req.headers ?? {},
    data: req.body ?? "",
    // 明确要文本：载荷是 JSON 字符串，原生那边按 text 回来最省事
    responseType: "text",
  })) as { status?: number; headers?: Record<string, string>; data?: unknown };

  const raw = res?.data;
  return {
    status: res?.status ?? 0,
    headers: res?.headers ?? {},
    // 原生那边一般回字符串；万一回的是对象（JSON 被解过）就再序列化回去
    body: typeof raw === "string" ? raw : raw === undefined ? "" : JSON.stringify(raw),
  };
}

/** 浏览器：只有 fetch 这条路 */
async function webRequest(req: HttpRequest): Promise<HttpResponse> {
  const res = await fetch(req.url, {
    method: req.method ?? "GET",
    headers: req.headers,
    body: req.body,
  });
  const headers: Record<string, string> = {};
  res.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });
  return { status: res.status, headers, body: await res.text() };
}

/**
 * 发一次请求。
 *
 * @throws 请求发不出去时（连不上、超时）会抛错，错误文案是给人看的
 */
export async function httpRequest(req: HttpRequest): Promise<HttpResponse> {
  const desktop = desktopBridge();
  // 桌面端只有主进程这一条路（fetch 在 app:// 下会被 CORS 拦，退回去也没用）
  if (desktop?.isDesktop) {
    if (!desktop.davRequest) throw new Error("桌面端那条缝没接上");
    return desktopRequest(req);
  }

  const cap = capacitor();
  const isNative = cap?.isNativePlatform?.() ?? false;
  if (isNative && cap?.nativePromise) {
    try {
      return await nativeRequest(req);
    } catch (err) {
      // iOS 那边没有 CapacitorHttp 这个插件（只有 Android 有）——
      // 这种「插件不存在」不算故障，退回 fetch（那条路受 CORS 限制，如实失败）。
      const msg = err instanceof Error ? err.message : String(err);
      if (!/not implemented|unavailable/i.test(msg)) throw err;
      return webRequest(req);
    }
  }

  return webRequest(req);
}
