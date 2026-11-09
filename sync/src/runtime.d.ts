// 将 Workers 的模块类型限定在同步服务，避免覆盖前端的 DOM 全局类型。
declare module "cloudflare:workers" {
  import { CloudflareWorkersModule } from "@cloudflare/workers-types";
  export = CloudflareWorkersModule;
}
