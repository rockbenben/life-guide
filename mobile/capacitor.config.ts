import type { CapacitorConfig } from "@capacitor/cli";

/**
 * 手机端配置。
 *
 * webDir 指向 app/dist —— 和桌面端（Electron）、浏览器（PWA）**同一份构建产物**。
 * 三种形态不各自维护一套界面：改了 Preact 代码，三端一起变。
 *
 * appId 一旦发布就不能改（应用商店按它认应用），跟卡片的 id 一个道理。
 */
const config: CapacitorConfig = {
  // Android 的包名每段必须以字母开头（"045" 不行），iOS 也就用同一个
  appId: "top.newzone.lifeguide",
  appName: "生活指南",
  webDir: "../app/dist",
  android: {
    // 内容是中文，界面跟随系统语言
    allowMixedContent: false,
  },
  ios: {
    contentInset: "always",
    backgroundColor: "#faf6ef",
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
