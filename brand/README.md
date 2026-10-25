# 品牌资产

生活指南的标记与社交预览。**源文件在这里，产物是从源文件渲出来的** ——
改设计改这里，然后重跑下面的命令，别直接改 PNG。

引擎是 [html-shot](https://github.com/rockbenben/aishort-skills/tree/main/skills/html-shot)
技能（`render.mjs` 渲染一张图，`icons.mjs` 把一个标记铺成一整套图标）。

## 设计

**标记 = 一张卡 + 一颗印。**

- **卡**：三行横线就是 App 的三行契约（名 / 做什么 / 剂量）。
- **印**：右下角那颗朱红方块，是 App 里每天盖的那一颗（空框 → 盖上日期）。
- 配色取自 `app/src/style.css`：朱 `#a82a24`、纸 `#fbf6ec`。
- 纯几何、不含文字：图标在任何尺寸、任何平台上都一样（不依赖系统字体）。

| 文件 | 是什么 |
| --- | --- |
| `mark.svg` | 标记母版（带圆角的方块） |
| `mark-small.svg` | 小尺寸简版：完整标记在 16px 上会糊成一团，缩略图要另画 —— 这里只留最认得出的两笔：纸卡 + 一颗盖好的印 |
| `icon-only.svg` | 启动图标（不透明、整块）：手机桌面的圆角由系统切，画了会被再切一次 |
| `icon-foreground.svg` / `icon-background.svg` | Android 自适应图标的前景/背景层（前景要缩进安全区） |
| `og.html` | 社交预览（1200×630） |
| `splash.html` | 启动画面（2732×2732） |
| `marks.html` | 候选对照页（定稿时挑标记用的，不参与构建） |

## 重新生成

```bash
SKILL=<html-shot 技能目录>

# 网页图标：favicon.ico / favicon.svg / apple-touch-icon.png
node $SKILL/icons.mjs brand/mark.svg app/public --only ico,svg,apple --bg "#a82a24" \
  --small brand/mark-small.svg

# PWA 图标：app/public/icons/icon-192.png、icon-512.png
node $SKILL/icons.mjs brand/mark.svg app/public/icons --only pwa

# 社交预览：量化过（平面美术，256 色足够），少 130 KB 的离线包
node $SKILL/render.mjs brand/og.html app/public/og.png --palette --colors 256

# 桌面端图标：icon.ico / icon.icns / icon.png（electron-builder 直接认 build/）
node $SKILL/icons.mjs brand/mark.svg desktop/build --preset electron

# 手机端：Capacitor 的资源生成器（读 mobile/assets/）
node $SKILL/render.mjs brand/icon-only.svg mobile/assets/icon-only.png --width 1024
node $SKILL/render.mjs brand/icon-foreground.svg mobile/assets/icon-foreground.png --width 1024 --transparent
node $SKILL/render.mjs brand/icon-background.svg mobile/assets/icon-background.png --width 1024
node $SKILL/render.mjs brand/splash.html mobile/assets/splash.png --width 2732
cd mobile && npx capacitor-assets generate --android --ios
```

渲完**看一眼图**再提交：字被裁了、字形回退了、某个资源 404 了，都只有看图才发现得了。
