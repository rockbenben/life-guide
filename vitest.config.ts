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
    ],
  },
});
