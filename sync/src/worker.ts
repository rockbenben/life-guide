/**
 * 同步服务：只当"密文的存放处"。
 *
 * **它读不到内容**。App 推上来的是 AES-GCM 密文，
 * 服务端没有口令，也就没有密钥 —— 拿到存储里的东西也解不开。
 *
 * ## 协议
 *
 * ```
 *   GET  /blob/{spaceId}              → { iv, ciphertext, rev, updatedAt }，没有就 404
 *   PUT  /blob/{spaceId}  {iv, ciphertext, baseRev}
 *        → 200 { ok: true, rev }；版本对不上就 409 + 当前那份（退回去让客户端重试）
 * ```
 *
 * `rev` 是服务端给每次写入编的号。客户端推的时候带上"我读到的是第几版"
 * （baseRev）：两台设备同时同步时，后推的那份会发现版本变了，
 * 于是拿回对方那份、合完再推 —— 不会把对方刚同步的数据盖掉。
 *
 * ## 为什么不写成一整份"合并后的数据库"
 *
 * 因为服务端看不到内容，也就不该做合并 —— 合并要用到「谁新谁赢」，
 * 而那个判断要靠明文里的时刻。客户端各自合并，服务端只存字节，
 * 责任最清楚。
 */

/** 一个空间只对应一个 Durable Object，条件写入由对象内部原子完成。 */
export interface SpaceStore {
  read(): Promise<StoredBlob | null>;
  write(input: BlobWrite): Promise<WriteResult>;
}

export interface SpaceNamespace {
  getByName(spaceId: string): SpaceStore;
}

export interface BlobWrite {
  iv: string;
  ciphertext: string;
  baseRev: number | null;
}

export type WriteResult =
  { ok: true; rev: number } | { ok: false; current: StoredBlob | null };

/** 存着的一条记录。 */
export type StoredBlob = {
  iv: string;
  ciphertext: string;
  /** 第几版（每次写入 +1） */
  rev: number;
  /** 写入时刻（毫秒） */
  updatedAt: number;
};

/** 允许哪些来源（浏览器会带 Origin 头）。空数组 = 全放行。 */
export interface WorkerOptions {
  /** 允许的来源；空 = 不限 */
  allowedOrigins?: string[];
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/**
 * 跨域头：App 的页面在别处（life.newzone.top / 镜像站 / 本机开发）。
 *
 * **这不是身份验证**：非浏览器的客户端（curl、脚本）照样能直接调。
 * 它挡的是"任意网页顺手往这个服务写东西"—— 写的是密文，
 * 但那也会占服务端的写入配额。
 */
function corsHeaders(
  origin: string | null,
  allowed: string[],
): Record<string, string> {
  const ok = !allowed.length || (origin !== null && allowed.includes(origin));
  return {
    ...(ok && origin ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-methods": "GET, PUT, OPTIONS",
    "access-control-allow-headers": "content-type, if-none-match",
    "access-control-max-age": "86400",
    vary: "origin",
  };
}

function json(
  data: unknown,
  status: number,
  headers: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...headers, ...JSON_HEADERS, "cache-control": "no-store" },
  });
}

/** 从地址里取出空间 id：`/blob/abc` → `abc`。 */
export function spaceIdFromPath(pathname: string): string | null {
  const m = /^\/blob\/([A-Za-z0-9_-]{8,128})$/.exec(pathname);
  return m ? m[1] : null;
}

/**
 * 处理一次请求。
 *
 * 逻辑与平台无关（只用 Request / Response / SpaceNamespace），
 * 所以能直接单测 —— 真的部署时才碰到 Cloudflare 的运行时。
 */
export async function handleRequest(
  request: Request,
  spaces: SpaceNamespace,
  options: WorkerOptions = {},
): Promise<Response> {
  const allowed = options.allowedOrigins ?? [];
  const origin = request.headers.get("origin");
  const cors = corsHeaders(origin, allowed);

  try {
    // 预检请求
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...cors, "cache-control": "no-store" },
      });
    }

    const spaceId = spaceIdFromPath(new URL(request.url).pathname);
    if (!spaceId) {
      return json({ error: "地址不对" }, 404, cors);
    }

    if (request.method === "GET") {
      const record = await spaces.getByName(spaceId).read();
      if (!record) return json({ error: "还没有这一份" }, 404, cors);
      /*
       * 条件请求：客户端问「还是那一版吗」。
       * 没变就回 304，**body 都不发** —— 省的是下载流量
       * （客户端每隔几分钟就问一次，全量回一次是白花流量）。
       */
      const asked = request.headers.get("if-none-match");
      if (asked && asked === String(record.rev)) {
        return new Response(null, {
          status: 304,
          headers: { ...cors, "cache-control": "no-store" },
        });
      }
      return json(record, 200, cors);
    }

    if (request.method === "PUT") {
      let body: { iv?: unknown; ciphertext?: unknown; baseRev?: unknown };
      try {
        body = (await request.json()) as typeof body;
      } catch {
        return json({ error: "请求体不是 JSON" }, 400, cors);
      }
      if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body) ||
        typeof body.iv !== "string" ||
        typeof body.ciphertext !== "string"
      ) {
        return json({ error: "缺 iv 或 ciphertext" }, 400, cors);
      }

      if (
        body.baseRev !== null &&
        (typeof body.baseRev !== "number" ||
          !Number.isSafeInteger(body.baseRev) ||
          body.baseRev < 1)
      ) {
        return json({ error: "baseRev 必须是 null 或正整数版本号" }, 400, cors);
      }

      const result = await spaces.getByName(spaceId).write({
        iv: body.iv,
        ciphertext: body.ciphertext,
        baseRev: body.baseRev,
      });
      if (!result.ok) {
        if (!result.current)
          return json({ error: "还没有这一份，请重新同步" }, 404, cors);
        return json(result.current, 409, cors);
      }
      return json({ ok: true, rev: result.rev }, 200, cors);
    }

    return json({ error: "方法不对" }, 405, cors);
  } catch {
    return json({ error: "同步存储暂时不可用，请稍后重试" }, 503, cors);
  }
}
