import { beforeAll, afterAll } from "vitest";
import { createTestHarness } from "wrangler";

/** 用实际部署配置运行本地 workerd，存储仅在本次测试会话中存在。 */
export function testServer() {
  const server = createTestHarness({
    workers: [
      {
        configPath: new URL("../wrangler.toml", import.meta.url),
        vars: { ALLOWED_ORIGINS: "https://life.newzone.top" },
      },
    ],
  });
  beforeAll(async () => {
    await server.listen();
  }, 60_000);
  afterAll(async () => {
    await server.close();
  }, 30_000);
  return server;
}
