import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import { handleRequest } from "./worker.ts";
import { SyncSpace } from "./space.ts";

export { SyncSpace };

export interface Env {
  SYNC_SPACES: DurableObjectNamespace<SyncSpace>;
  /** 逗号分隔的浏览器来源白名单，空值表示不限。 */
  ALLOWED_ORIGINS?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const allowed = (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return handleRequest(request, env.SYNC_SPACES, { allowedOrigins: allowed });
  },
};
