/**
 * 设置页：源码入口。
 *
 * 钉的是三件事：
 *   1. 「关于」里有一条链到源码仓库 —— 公开仓之后，陌生人能看见的入口就这一处；
 *   2. 链是**站外**的：target=_blank，浏览器开新标签、桌面端交给系统浏览器
 *      （desktop/main.mjs 的 setWindowOpenHandler）；
 *   3. 链接文字是给读屏的 —— 图标是 aria-hidden 的，名字得在文字上。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { Settings } from "../../src/ui/Settings.tsx";

beforeEach(() => {
  // 设置页渲染时会问桌面桥「有没有更新服务」（platform/update.ts 与 notify.ts
  // 都读 window）。这里没有桌面端，给一个空的 window —— 桥问不到就是「没有」。
  (globalThis as unknown as { window: unknown }).window = {};
});

function aboutSection(): string {
  const html = render(<Settings />);
  // 「关于」是最后一个 section；截出来单独看，免得别处的链接混进来
  const at = html.indexOf("关于");
  return at < 0 ? html : html.slice(at);
}

describe("设置页的源码入口", () => {
  it("「关于」里链到 GitHub 仓库", () => {
    const html = aboutSection();
    expect(html).toContain("https://github.com/rockbenben/life-guide");
    expect(html).toContain("源码在 GitHub");
  });

  it("是站外链接：新标签打开，别把应用窗口带走", () => {
    const html = aboutSection();
    expect(html).toMatch(/<a[^>]*href="https:\/\/github\.com\/rockbenben\/life-guide"[^>]*>/);
    expect(html).toMatch(/target="_blank"/);
    // rel=noreferrer：别把 referrer 带给第三方
    expect(html).toMatch(/rel="noreferrer"/);
  });

  it("图标是装饰，名字在文字上（读屏读到的是「源码在 GitHub」）", () => {
    const html = aboutSection();
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("源码在 GitHub");
  });
});

describe("多设备同步（默认关着）", () => {
  it("页首说的是「只在本机，不上传」—— 同步没开的时候这话是真的", () => {
    const html = render(<Settings />);
    expect(html).toContain("只在本机，不上传");
  });

  it("同步那一节在，但默认没开：不出现地址与口令的输入框", () => {
    const html = render(<Settings />);
    expect(html).toContain("多设备同步");
    expect(html).toContain("开启同步");
    // 没开 → 不该摆输入框（摆出来会让用户以为已经配好了）
    expect(html).not.toContain("https://你的同步服务地址");
    expect(html).not.toContain('type="password"');
  });

  it("说清楚上传的是密文、服务器读不到", () => {
    const html = render(<Settings />);
    expect(html).toContain("加密");
    expect(html).toContain("密文");
  });
});
