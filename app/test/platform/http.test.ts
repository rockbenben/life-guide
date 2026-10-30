/**
 * 平台层的 HTTP 路由（platform/http.ts）。
 *
 * 这一层是**局域网 WebDAV 能不能用**的关键：渲染层（app:// 与 https://localhost）
 * 跨源请求要过 CORS，而自建 WebDAV 默认不发 `Access-Control-Allow-Origin`
 * —— 实测 Electron 45 直接 "blocked by CORS policy"。
 * 所以桌面端走主进程、手机端走原生 HTTP，只有浏览器还走 fetch。
 *
 * 这里钉住的是**路由**：谁该走哪条通道、参数怎么传、回来的东西怎么整形。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { httpRequest } from "../../src/platform/http.ts";

const g = globalThis as unknown as {
  lifeGuide?: unknown;
  Capacitor?: unknown;
};

afterEach(() => {
  delete g.lifeGuide;
  delete g.Capacitor;
  vi.unstubAllGlobals();
});

describe("平台层的 HTTP 路由", () => {
  it("桌面端：走主进程那条缝，不碰 fetch", async () => {
    const davRequest = vi.fn(async (req: { url: string }) => ({
      status: 200,
      headers: { etag: '"v1"' },
      body: `via-main:${req.url}`,
    }));
    g.lifeGuide = { isDesktop: true, davRequest };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await httpRequest({ url: "http://192.168.1.9:5006/dav/x.json" });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(davRequest).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe('"v1"');
    expect(res.body).toContain("via-main:");
  });

  it("桌面端：那条缝没接上就明说，不静默退回 fetch", async () => {
    g.lifeGuide = { isDesktop: true };
    await expect(httpRequest({ url: "http://192.168.1.9/x" })).rejects.toThrow(/没接上/);
  });

  it("手机端：走原生 HTTP（CapacitorHttp），不过 fetch", async () => {
    const nativePromise = vi.fn(async () => ({
      status: 201,
      headers: { etag: '"v2"' },
      data: "native-body",
    }));
    g.Capacitor = { isNativePlatform: () => true, nativePromise };
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await httpRequest({
      url: "http://192.168.1.9:5006/dav/x.json",
      method: "PUT",
      headers: { authorization: "Basic x" },
      body: "{\"v\":1}",
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(nativePromise).toHaveBeenCalledTimes(1);
    const [plugin, method, options] = nativePromise.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(plugin).toBe("CapacitorHttp");
    expect(method).toBe("request");
    expect(options.method).toBe("PUT");
    expect(options.data).toBe("{\"v\":1}");
    expect(res.status).toBe(201);
    expect(res.body).toBe("native-body");
  });

  it("手机端：原生那边回的是对象时，序列回字符串", async () => {
    g.Capacitor = {
      isNativePlatform: () => true,
      nativePromise: async () => ({ status: 200, headers: {}, data: { iv: "aXY=" } }),
    };
    const res = await httpRequest({ url: "http://192.168.1.9/x" });
    expect(res.body).toBe("{\"iv\":\"aXY=\"}");
  });

  it("iOS 没有那个原生插件 → 退回 fetch，不当成故障", async () => {
    g.Capacitor = {
      isNativePlatform: () => true,
      nativePromise: async () => {
        throw new Error("CapacitorHttp not implemented");
      },
    };
    const fetchSpy = vi.fn(async () => new Response("from-web", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await httpRequest({ url: "https://dav.example/x" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(res.body).toBe("from-web");
  });

  it("手机端：原生那边报的是别的错（连不上）→ 如实抛出去", async () => {
    g.Capacitor = {
      isNativePlatform: () => true,
      nativePromise: async () => {
        throw new Error("connect ECONNREFUSED 192.168.1.9:5006");
      },
    };
    await expect(httpRequest({ url: "http://192.168.1.9:5006/x" })).rejects.toThrow(
      /ECONNREFUSED/,
    );
  });

  it("浏览器：只有 fetch 这条路，头统一小写", async () => {
    const fetchSpy = vi.fn(
      async () =>
        // 304 是「没有正文」的状态，Response 构造器不许带 body
        new Response(null, {
          status: 304,
          headers: { ETag: '"v3"', "Last-Modified": "Wed, 29 Oct 2026 12:00:00 GMT" },
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);

    const res = await httpRequest({
      url: "https://dav.example/x",
      method: "GET",
      headers: { "if-none-match": '"v1"' },
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((fetchSpy.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe(
      "https://dav.example/x",
    );
    expect(res.status).toBe(304);
    expect(res.headers.etag).toBe('"v3"');
    expect(res.headers["last-modified"]).toBe("Wed, 29 Oct 2026 12:00:00 GMT");
    expect(res.body).toBe("");
  });
});
