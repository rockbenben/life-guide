# ARCHITECTURE.md

045 的工程结构。原则：**单仓库、自包含；内容管线和 App 之间只隔一个 `cards.json`。**

```
blog 仓库（某个 commit）
        │  content import（一次性，手动）
        ▼
content/source/ + media/   快照（正文 + 图片）  ←  content/cards/*.yaml（卡片，人 + LLM 编写）
        │  解析 → 校验 → 覆盖报告 → 构建
        ▼
app/public/cards.json   （只含签字有效的 reviewed 卡）
app/public/manual.json  （手册全文，供「手册」页浏览）
        ▼
app/dist/                同一份构建产物，三处复用
        ├── 浏览器：PWA（可装可离线）
        ├── 桌面：Electron 壳（desktop/）
        └── 手机：Capacitor 壳（mobile/）
```

045 运行时与 CI **都不访问 blog 仓库，也不访问 `img.newzone.top`**。两者只在 `content import` 那一刻被读取；CI 不联网下载任何内容。

## 1. 目录

```
life-guide/
├── AGENTS.md                 项目约定（先读）
├── ARCHITECTURE.md           本文件
├── package.json              npm workspaces: ["content", "app", "desktop", "mobile"]
├── tsconfig.json / vitest.config.ts
├── schema/
│   └── cards.schema.json     JSON Schema；content 与 app 共用
├── content/                  内容管线（Node CLI，无 UI）
│   ├── source/               blog 正文快照（由 import 生成；只允许勘误修改）
│   │   ├── SOURCE.lock       commit、日期、每个文件的 sha256
│   │   ├── ERRATA.md         对快照的修改记录
│   │   └── the-savvy-life-manual/*.md   113 篇（+ 目录页 README，不算一篇）
│   ├── media/                快照引用的全部图片，<sha256>.<ext>
│   │   └── media.lock        原 URL → 文件、sha256、bytes、fetchedAt
│   ├── cards/                每篇文章一个 yaml（104 个文件，一个文件可含多张卡）
│   ├── busy-budget.yaml
│   ├── src/
│   │   ├── source/
│   │   │   ├── import.ts     复制指定 commit 的文章 + 下载全部图片，写两份 lock
│   │   │   ├── parse.ts      remark(+gfm) 解析：小节、段落、图片、表格
│   │   │   ├── normalize.ts  引文比对归一化；数字归一化（中文 / 全角 / 范围）
│   │   │   └── errata.ts     R13：快照 sha256 ↔ SOURCE.lock ↔ ERRATA.md；media.lock 完整性
│   │   ├── cards/
│   │   │   ├── load.ts       读 yaml，按 schema 校验结构
│   │   │   └── fingerprint.ts 卡片内容指纹（排除 review 字段本身）
│   │   ├── rules/index.ts    R1–R6、R8–R10、R14、R16、R17 都在这一个文件里
│   │   ├── budget.ts         R7 忙档预算 + R12 审阅签字
│   │   ├── review.ts         人工签字：写入 { by, date, hash }（用 Document API，保留注释）
│   │   ├── default-routine.ts R15 默认清单：卡在、已签字、不重复
│   │   ├── slot.ts           时段复查证据表（content:slot-check）
│   │   ├── build.ts          签字有效的 reviewed 卡 → cards.json；全文 → manual.json；
│   │   │                     图片 URL 重写为本地路径，并只拷贝用到的图片到 app/public/media/
│   │   ├── signing-list.ts   把「机器没挑出毛病」的卡排成待签字清单
│   │   ├── repair-quotes.ts  把引文漏掉的原文段补进去（只动 draft）
│   │   ├── media-optimize.ts 构建时按显示尺寸重编码 app/public/media 副本
│   │   ├── extract/          P3：LLM 起草（只产出 draft）—— llm.ts / prompt.ts / parse.ts / draft.ts
│   │   ├── audit/            审阅辅助：机械检查 + 语义检查 + 报告/状态
│   │   └── cli.ts            import | check | build | review | draft | audit | signing-list |
│   │                         slot-check | approx-check | repair-quotes
│   └── test/                 rules · build · errata · extract · audit · default-routine ·
│                             signing-list · repair-quotes · media-optimize 的单元测试
├── app/                      PWA
│   ├── index.html            入口 HTML，指向 /src/index.tsx
│   ├── vite.config.ts
│   ├── public/
│   │   ├── cards.json        构建产物，不进 git
│   │   ├── manual.json       构建产物，不进 git
│   │   ├── media/            构建产物，不进 git
│   │   ├── icons/            PWA 图标
│   │   └── favicon.svg
│   ├── src/
│   │   ├── index.tsx         渲染入口（挂载 App）
│   │   ├── main.tsx          App 组件、页签 / 文章历史状态、cards.json 与 manual.json 加载
│   │   ├── domain/           纯函数，无 DOM、无存储，全部单测
│   │   │   ├── day.ts        04:00 日界线、时段判定（00–04 算前一天的晚间）
│   │   │   ├── routine.ts    模式 → 做哪几步（filterByMode）；耗时 basis（quote / derived / unknown）
│   │   │   ├── segments.ts   人群分档 → 换动作/剂量/禁忌
│   │   │   ├── conditions.ts 模式 + 人群标签（年龄档单选、状态多选）
│   │   │   ├── cadence.ts    每天 / 每周 / 每月；周期键与「本周期已完成」
│   │   │   ├── manual.ts     手册搜索 / 分类 / 内链与文章索引
│   │   │   ├── markdown.ts   markdown 渲染 + 内链解析
│   │   │   ├── notices.ts    疾病卡判定与提示分级
│   │   │   ├── reminders.ts  提醒规则、下一次时刻、默认模式、「今天不做」只跳这一次
│   │   │   ├── daily.ts      今天只放自己挑的（todaysCards / starterPack / 轮换一张）
│   │   │   ├── skip.ts        「今天不做」：只跳当天，可撤销，次日自然回来
│   │   │   ├── lines.ts      收起态三行契约：名取内容层动作名、数字不重复、耗时四态如实
│   │   │   ├── custom.ts     用户自己加的习惯 → 一张卡
│   │   │   ├── progress.ts   事件日志 → 累计天数与页边的 14 格印迹
│   │   │   ├── update.ts     更新状态 → 人话
│   │   │   └── ics.ts        生成日历文件（定时事件 + 卡片提醒 + VALARM + EXDATE）
│   │   ├── data/
│   │   │   ├── db.ts         IndexedDB：events、settings、custom
│   │   │   ├── useRoutine.ts 「我的日常」与习惯（清单只有这一份）
│   │   │   └── backup.ts     JSON 导出 / 导入（带版本号）
│   │   ├── platform/         notify.ts（三端通知）/ update.ts（桌面更新桥）
│   │   ├── ui/               Today / TodaySidebar / TodayLog / Card / Manual / Settings /
│   │   │                     Conditions / DiscoverPanel / SortPanel / SortableRow / Reminder /
│   │   │                     HabitForm / Disclaimer（手帖行 + 用法用量表）
│   │   └── style.css         设计令牌（和紙 / 夜紙）+ 自写的组件层（lg- 前缀）
│   └── test/
│       ├── domain/*.test.ts   纯函数
│       ├── platform/*.test.ts
│       ├── data/*.test.ts
│       └── ui/*.test.tsx      组件渲染 / 对比度 / 可访问性 / R11（收起态的 stop 禁忌）
├── desktop/                  桌面端：Electron 壳（跑同一份 app/dist）
│   ├── main.mjs              生命周期、窗口、托盘、导航守卫
│   ├── preload.cjs           页面与 Node 之间那条极窄的缝
│   ├── lib/                  protocol · navigation · reminders · updater · tray · menu
│   │                         （reminder-timing / update-events / window-state 是纯逻辑，可单测）
│   ├── lib/*.test.mjs        纯逻辑的 node --test（npm run test:desktop）
│   └── build/                打包与托盘用的图标
├── mobile/                   手机端：Capacitor 壳（跑同一份 app/dist）
│   ├── capacitor.config.ts
│   ├── android/ · ios/       原生工程（cap add 生成）
│   └── assets/               图标与启动图的源
├── brand/                    品牌资产：标记母版（SVG）· 社交预览 · 启动画面
│   └── README.md             改设计改这里，重跑渲染命令出图
├── docs/                     使用指南 · 部署 · 发布说明 · README 用的截图
├── scripts/                  acceptance/（浏览器级验收）· set-version · release-draft
│                             · decision-gate · desktop-smoke · screenshot 等
├── .desktop-policy.json      桌面端已登记的取舍（带 reason + revisitWhen）
└── .github/workflows/        ci.yml（校验）/ deploy.yml（PWA 发布）/ release.yml（tag 发版）
```

PWA 的 `manifest.webmanifest` 由 vite-plugin-pwa 在构建时生成，不在 `public/` 里。
R11、R13、R15、R16、R17 都已实现：R11 在 `app/test/ui/card.test.tsx`，R13 在
`content/src/source/errata.ts`，R15 在 `content/src/default-routine.ts`，R16 与 R17 在
`content/src/rules/index.ts`。R11 是**组件渲染级**测试，不需要浏览器；浏览器能验的那几条由
`npm run acceptance` 覆盖，真实设备上的 e2e 验收仍未做（见 AGENTS.md §7.1）。

原型 `verify.js` 的 22 项按性质拆开迁移：**2 项状态逻辑（勾选切换、再点取消）→ `app/test/domain/`；20 项数据形状与图片校验 → `content/test/rules.test.ts`**。工作量主要在后者。
（原型本体在 2026-10-27 删掉了 —— 它不被任何构建或测试引用，只是一份只读参考；历史里还能取回。）

## 2. 技术选择

| 部分 | 选择 | 理由 |
| --- | --- | --- |
| 语言 | TypeScript（全仓） | content 与 app 共用类型 |
| 包管理 | npm workspaces | content / app / desktop / mobile 四个包，不需要更重的工具 |
| Markdown 解析 | unified / remark + remark-gfm | 小节、图片的 AST 与位置。**必须带 gfm**：手册里有不少表格，不开的话表格会被当成普通段落，表格结构就丢了 |
| Schema | JSON Schema（ajv）→ 生成 TS 类型 | 结构校验与类型同源 |
| UI | Preact + Vite | 交互只有列表 / 展开 / 勾选 |
| 样式 | Tailwind CSS v4 + daisyUI 5（只用它的主题令牌机制）+ 自写组件层 | 组件与主题都是**构建期**产物（daisyUI 是纯 CSS 插件，不注 JS、不装 Provider）—— 产物里没有运行时，PWA / Electron / Capacitor 三处跑同一份 CSS。界面不再用 daisyUI 的组件类：形状语言是「一页手帖」（细横线分栏 + 用法用量表），而那套组件给的是「一叠带阴影的圆角卡 + 粉色提示块」。响应式靠断点，桌面与手机不是两套界面 |
| PWA | vite-plugin-pwa（Workbox） | 浏览器形态：可装可离线 |
| 桌面端 | Electron（`desktop/`） | 自定义 `app://` 协议伺服 `app/dist`。**不能用 `file://`** —— 渲染层要 `fetch("cards.json")`，file:// 下会被拦；协议注册成 standard + secure 之后 origin 稳定，IndexedDB 里的记录才留得住。构建目标为 Windows / macOS / Linux 各 x64 + arm64；渲染层带 CSP、导航守卫与 IPC sender 校验。**Windows 安装版与 Linux 的 AppImage 版接自动更新**（macOS 没签名接不了；Linux 的 deb / rpm 装的没有 AppImage 那个文件，硬跑会把应用装到别处，所以那两种仍手动换包）。主进程只管生命周期；协议 / 提醒 / 菜单 / 导航 / IPC 信任在 `desktop/lib/` 各一块 |
| 手机端 | Capacitor（`mobile/`） | 同一份 `app/dist` 装进原生 WebView，生成 Android / iOS 工程。界面不重写 |
| 存储 | IndexedDB（idb 薄封装） | 事件日志不适合 localStorage |
| 测试 | Vitest + Playwright + node:test | 组件渲染用 `preact-render-to-string`，不需要浏览器与 DOM 环境；浏览器级验收与桌面端真启动用 Playwright；主进程 / 导航 / 协议的纯逻辑用 `node --test` |
| 部署 | 任意静态托管 | 无后端 |

不引入：状态管理库、路由库（hash 路由即可）、后端。

**为什么样式层可以引框架而别的不引**：daisyUI 只是 Tailwind 插件，编译进 CSS，
运行时零成本，也不接管任何行为（不注 Provider、不加全局 JS）——
与「不引入状态管理库」这种会接管应用结构的库不是一回事。
主题是 CSS 变量（`@plugin "daisyui/theme"`），暖纸色与暗色各配了一套，
不套默认皮。Tailwind 只扫 `app/` 下的源码，`content/` 不参与。

**三种形态的关系**：界面只写一遍（`app/src`），构建产物 `app/dist` 三处复用 ——
浏览器里是 PWA，桌面上是 Electron 壳，手机上是 Capacitor 壳。
**各自的数据是分开的**（IndexedDB 按 origin / 应用 id 存），要合并用设置页的导出 / 导入。

桌面壳的发布目标覆盖 Windows / macOS / Linux 各 x64 + arm64，同一份 `app/dist` 在三个系统上跑；
差异只在安装包格式与更新通道：Windows 与 Linux 的 AppImage 版接 electron-updater，macOS 与 Linux 的 deb / rpm 版目前手动换包。

## 3. 关键接口

```ts
type Quote = string | string[];

// content/src/rules/index.ts
type Rule = (ctx: {
  article: ArticleCards;      // 一篇的 yaml
  source: SourceIndex;        // 对应快照 md 的解析结果
  all: ArticleCards[];        // 跨篇检查（id 唯一、忙档）
}) => Finding[];

type Finding = {
  rule: string;               // "R1"
  level: "error" | "warning";
  file: string; cardId?: string; path?: string;
  message: string;
};

type ReviewSignature = { by: string; date: string; hash: string };
```

```ts
// app 消费的 cards.json
type CardsBundle = {
  schemaVersion: string;
  source: { repo: string; commit: string; date: string };   // 来自 SOURCE.lock
  cards: Card[];
  articles: { path: string; title: string; kind?: string }[]; // 手册目录索引
  defaultRoutine: string[];                                  // 首启默认清单
  // 刻意**不放**构建时间：产物里每多一个随时间变的字段，Service Worker 的
  // 预缓存 revision 就跟着变一次 —— 内容没变，用户却要重下 1.3 MB。
};

type DoneEvent = {
  date: string;
  cardId: string;
  variant: Variant;
  ts: number;
  /** 周期卡：true 算完成，false 是撤销过的历史；没有的是旧日志 */
  periodDone?: boolean;
  /** 完成时按哪种周期算：改频率后旧完成不冒充新频率 */
  periodCadence?: "weekly" | "monthly";
};

// 设置里另有 skipToday: { [cardId]: "YYYY-MM-DD" } —— 「今天不做」只跳过当天，
// 不进事件日志、不改 myRoutine；过了 04:00 日界线自然失效。
```

## 4. 数据流

1. **导入（一次）**：`content import --blog ../blog --commit <sha>` → 写 `content/source/`、`content/media/` 与两份 lock → 检查报告中下载失败的图片 → 提交。
   勘误：改快照文件 + 写 `ERRATA.md`，同一次提交。
2. **编写**：手写或 `content draft <article>` 生成 `status: draft` 的 yaml。起草工具只写 draft，自检不过就不写盘。
3. **校验**：`content check`，本地与 CI 相同，CI 只读不写。
4. **签字**：人工审过后 `content review <cardId>` → 写入签字 → 提交。
5. **构建**：`content build` 只收签字有效的 reviewed 卡 → `cards.json`；同时把快照全文 → `manual.json` → App 构建与部署。
6. **重新导入（可选，P4 之后）**：换快照后 R1 / R8 报错的卡就是原文改过的卡；它们的签字因内容需修改而自然失效，重新审阅。

## 5. 版本与兼容

- `cards.schema.json` 带版本；破坏性变更走 ADR，升主版本。
- 备份文件带 `schemaVersion`；`backup.ts` 负责迁移。
- 卡片 `id` 与步骤 `id` 发布后不改名；确需改名时写 `formerIds`，事件日志靠它关联。

## 6. 开发顺序（对应 AGENTS.md §7）

- **P0**：`git init` → 根 `package.json` + workspaces → `schema/` 空壳 → `content import`（正文 + 图片 + 两份 lock，先用 fixture 测试再跑真实 blog）→ `ci.yml` 空跑（`npm test`、`content:check` 为绿）→ 用真 README 替换模板。
- **P1**：`content/source` 解析 → `rules` R1–R12 + fixtures（R2 先写数字归一化的表驱动测试）→ `coverage` / `budget` / `review` → 12 张卡 → `build`；迁移原型的图片校验用例。后来补了 R13–R16。
  - 解析必须**单遍遍历**。写成 visit(heading) + visit(paragraph) 两遍是错的：heading 那遍先跑完，`current` 已经停在最后一个标题上，于是所有段落都算进最后一个小节，前面的全空（实测 `bone.md` 5 个小节有 4 个是空的）。
  - 抽卡时**引文只能照抄原文**。原文里夹着日文括注（`每天 50 次（「1日50回が目安」）`）就不能跳过它，否则引文不是逐字子串，R1 会拦下。
  - 归一化要剥掉**成对的加粗标记**：源文是 `**每天 50 次**`，解析出的纯文本没有 `**`，而人复制引文时带的正是 `**`。不剥掉的话每条含加粗的引文都误报 R1。
  - `content review` 改卡片时**必须用 yaml 的 Document API**（`parseDocument` + `setIn`），不能用 parse + stringify —— 后者会把文件里的注释全冲掉，而 ignore 清单里「为什么不抽这条」的理由全靠注释记录。
- **P2**：`app/domain`（先迁移原型的状态逻辑用例）→ `data` → `ui` → `sw` → e2e（含断网后图片可见）。
  - **PWA 的 entry 必须是渲染入口**（`src/index.tsx`），不能指向组件模块（`src/main.tsx`）。指向组件模块时 `App` 是个没人用的 export，被 tree-shake 掉，页面全白且不报错——chunk 里甚至只剩 workbox 和 idb。
  - **分档换动作时，默认的剂量与步骤不能跟着走**：踮脚换成防跌倒之后，「每天 50 次」是踮脚的量，挂在防跌倒上是错的。分档没给剂量就显示空。
  - **`.ics` 必须是定时事件**（`DTSTART:<时间戳>` + `VALARM`），不能用 `VALUE=DATE` 的全天事件：全天事件在系统日历里不会按时响，日历作为备份就落空了。
- **P3**：`content/extract`；审阅辅助 `content/audit`。
  - 起草流水线只写 `status: draft`，自检不过就不写盘（R1/R2/R3/R4/R8/R9/R10/R14 + schema）。
  - **审阅工具的例外条件已经触发**：原计划是「审阅即 `git diff` + `content review`，不另做工具，
    除非实测审阅 > 10 分钟 / 篇」。553 张卡远超这个量级，所以做了 `content audit`：
    机械检查（重复、禁忌小节没被引用、文字远长于引文、步数过多）加上语义检查
    （用模型问「卡片文字是不是引文的忠实转述」—— R1/R2 查不出的那一类），
    报告分「意思不对」与「引文没覆盖全」两类，**但它不签字**。
  - 语义检查会误报也会漏报：实测同一张卡（肺癌那篇）第一轮被报成「含义正好相反」，
    其实卡片与引文一致。所以报告是**待读清单，不是缺陷清单**。
  - **起草流水线只写 `status: draft`，自检不过就不写盘**。模型会犯的错（引文改写、数字对不上、dose.value 写成非数字）由 R1/R2 与 schema 校验兜住；机器查不了的是**语义改写**（引文逐字但卡片文字被概括），那一层只能靠人审。
  - **`.ics` 与浏览器验收不能只靠单元测试**：定时事件、离线预缓存、导出→清空→导入都要在真浏览器里跑一遍，所以有 `scripts/acceptance/`。
