import { defineConfig, type Plugin } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";
import fs from "node:fs";
import path from "node:path";

/**
 * 社交预览那张图的绝对地址 + 卡片张数。
 *
 * og:image 只认**绝对 URL** —— 相对路径在分享出去时是坏的。
 * 部署时用环境变量给（OG_IMAGE_URL=https://…/og.png）；
 * 本地/桌面/手机这三个壳里没有域名，相对路径就够（./og.png）。
 *
 * 卡片张数在构建时现算：写死在文案里的话，每签一轮字就又是一个假数字。
 */
function shareMeta(): Plugin {
  return {
    name: "share-meta",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        let count = 0;
        try {
          const raw = fs.readFileSync(
            path.resolve(import.meta.dirname, "public", "cards.json"),
            "utf8",
          );
          count = (JSON.parse(raw).cards ?? []).length;
        } catch {
          // 内容层还没构建（dev 模式）就用 0，不让构建挂掉
        }
        return html
          .replaceAll("%OG_IMAGE%", process.env.OG_IMAGE_URL || "./og.png")
          .replaceAll("%CARDS_COUNT%", String(count));
      },
    },
  };
}

export default defineConfig({
  // 相对 base：同一份产物在任何路径下都能用 ——
  // 浏览器部署在子路径（https://…/045/）、桌面端在 app://bundle/、
  // 手机端在 capacitor://localhost/。写死 "/" 的话，子路径部署会全白。
  base: "./",
  plugins: [
    preact(),
    // Tailwind v4 的官方 Vite 插件：负责扫描源码里的类名并生成 CSS。
    // 它只是构建期的东西，产物里没有运行时 —— PWA / Electron / Capacitor 三处同一份 CSS。
    tailwindcss(),
    shareMeta(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "favicon.svg", "favicon.ico", "apple-touch-icon.png"],
      manifest: {
        name: "生活指南",
        short_name: "生活指南",
        description: "把《生活手册》变成能照着做的卡片",
        lang: "zh-CN",
        theme_color: "#a82a24",
        background_color: "#fbf6ec",
        display: "standalone",
        // 相对 start_url：装到主屏后从任意路径打开都回到 App 自己
        start_url: ".",
        icons: [
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
        ],
      },
      workbox: {
        // 卡片数据与图片都要预缓存：图片已经进了 content/media/ 并被拷到
        // app/public/media/，与 App 同源，可以正常缓存。
        // 跨域图片只存不透明响应、配额占用还大，离线就不可用——
        // 所以图片进快照这件事不只是为了防链接失效。
        globPatterns: ["**/*.{js,css,html,json,png,jpg,jpeg,webp,svg,woff2}"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5180, host: "127.0.0.1" },
});
