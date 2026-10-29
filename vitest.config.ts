import { defineConfig } from "vitest/config";

export default defineConfig({
  // app/test/ui 下的 .tsx 测试要按 Preact 的 JSX 语义编译。
  // 根配置没有用 @preact/preset-vite，所以这里显式指明。
  esbuild: { jsx: "automatic", jsxImportSource: "preact" },
  test: {
    include: [
      "content/test/**/*.test.ts",
      "app/test/**/*.test.ts",
      "app/test/**/*.test.tsx",
      // 同步服务（Worker）：纯逻辑，跟平台无关
      "sync/test/**/*.test.ts",
      // 发版校验脚本的纯逻辑（scripts/release-assets.mjs）——
      // 它是发版的闸门，得有测试守着。
      "scripts/test/**/*.test.mjs",
    ],
  },
});
