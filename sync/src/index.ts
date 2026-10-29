/**
 * Cloudflare Worker 的入口。
 *
 * 逻辑都在 worker.ts 里（那儿能直接单测），这一层只负责把
 * Cloudflare 的 env 递进去。
 */
import { handleRequest, type KvStore } from "./worker.ts";

export interface Env {
  /** 存密文的 KV 命名空间 */
  SYNC_KV: KvStore;
  /**
   * 允许的来源，逗号分隔。
   *
   * 不配就全放行。**建议配上**：放行的话，任意网页都能往这个服务写东西
   *（写的是密文，但照样占 KV 的写入配额）。空间 id 是 128 位派生的，
   *猜不到 —— 只是配额这一层值得防。
   */
  ALLOWED_ORIGINS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return handleRequest(request, env.SYNC_KV, { allowedOrigins: allowed });
  },
};
