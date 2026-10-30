# AGENTS.md

045 · 生活指南：把《生活手册》从「需要翻的文字」变成「能照着做的卡片」。

> 写给协作方（AI 编程工具或人类开发者）。读完这一份就该知道：项目是什么、边界在哪、
> 哪些已决定、下一步做什么、怎样算做完。工程结构见 `ARCHITECTURE.md`。

---

## 1. 一句话

`blog` 仓库里有 114 个中文生活手册的 md（NHK 说明书系列；其中 113 篇是正文，另一页是目录），写得很细，但用法是「需要翻」。
本项目从 blog 取一次**固定快照**，在快照上建一层**可校验的结构化数据**，用 PWA 呈现成「今天做什么 / 怎么做 / 不能做」的卡片。
**App 不跟随 blog 更新**：blog 之后怎么改，都不影响 045，除非人为重新导入。

**项目真正的资产是「结构化层 + 校验器」，App 只是第一个消费者。**
难的不是把 113 篇铺出来，而是让铺出来的东西可信。

## 2. 现状

已经是独立仓库并跑起来了：内容管线 + PWA 都在，600 个单元测试 + 41 个桌面逻辑测试、内容校验、类型检查、CI 全绿。

```
life-guide/
├── AGENTS.md / ARCHITECTURE.md
├── package.json              npm workspaces: ["content", "app", "desktop", "mobile"]
├── tsconfig.json / vitest.config.ts
├── schema/cards.schema.json
├── content/                  内容管线（Node CLI，无 UI）
│   ├── source/               blog 快照：113 篇正文 + 目录页 README + SOURCE.lock + ERRATA.md
│   ├── media/                快照图片 106 张 + media.lock
│   ├── cards/                491 张 reviewed 卡（已签字）+ 33 张 LLM 起草的 draft 卡
│   │                         （按手册分类分四层：body-care / food / life-hacks / mind-growth）
│   ├── busy-budget.yaml
│   ├── src/                  source / cards / rules / budget / review / build / extract / audit / cli
│   │                         · default-routine · slot · signing-list · repair-quotes · media-optimize
│   └── test/                 rules · build · errata · extract · audit · default-routine
│                             · signing-list · repair-quotes · media-optimize 的单元测试
├── app/                      PWA（Preact + Vite + Tailwind v4 + daisyUI 5 主题 + vite-plugin-pwa + idb；组件层自写）
│   ├── index.html / vite.config.ts
│   ├── public/               cards.json、manual.json、media/（构建产物）+ icons/
│   ├── src/                  index.tsx（渲染入口）· domain/ · data/ · platform/ · ui/
│   └── test/                 domain/ · platform/ · data/ 单元测试 · ui/ 组件渲染测试
├── desktop/                  桌面端：Electron 壳（跑同一份 app/dist）
│   ├── main.mjs              生命周期：单实例、窗口、托盘、导航守卫，把几块 lib 接起来
│   ├── preload.cjs           页面与 Node 之间那条极窄的缝（只暴露提醒、更新与 WebDAV 请求）
│   ├── lib/                  protocol / protocol-headers（app:// 与 CSP）· navigation（导航与 IPC 信任）
│   │                         · reminders（主进程定时器）· updater · tray · menu
│   │                         · dav / dav-client（局域网 WebDAV：主进程代发）
│   │                         · reminder-timing / window-state / store（纯逻辑，可单测）
│   ├── lib/*.test.mjs        纯逻辑的 node --test（npm run test:desktop）
│   └── build/                打包与托盘用的图标（brand/ 那张标记的 ico/icns/png）
├── mobile/                   手机端：Capacitor 壳（跑同一份 app/dist）
│   ├── capacitor.config.ts
│   ├── android/ · ios/       原生工程（cap add 生成）
│   ├── assets/               图标与启动图的源（Capacitor 资源生成器读这里）
├── sync/                     同步服务（Cloudflare Worker + KV）：只存密文，见 §4.6
│   ├── src/worker.ts         取一份 / 写一份密文 + 版本号（纯逻辑，可单测）
│   ├── src/index.ts          Worker 入口（把 env 递进去）
│   ├── wrangler.toml         部署配置（KV 绑定 + 允许的来源）
│   └── test/worker.test.ts   协议的单测
├── brand/                    品牌资产：标记母版（SVG）· 社交预览 · 启动画面
│   └── README.md             改设计改这里，重跑渲染命令出图（别直接改 PNG）
├── docs/                     使用指南 · 部署 · 发布说明/（每版一份，release 的正文来源）
│                             · README 用的截图
├── scripts/                  acceptance/（浏览器级验收，Playwright 驱动本机 Chrome）
│                             · set-version · release-draft · release-notes · release-assets
│                             · check-workflows · check-desktop-metadata
│                             · decision-gate · desktop-smoke · screenshot 等
│                             · test/（发版校验脚本的纯逻辑单测）
├── .desktop-policy.json      桌面端已登记的取舍（带 reason + revisitWhen）
└── .github/workflows/        ci.yml（校验）/ deploy.yml（PWA 发布）/ release.yml（tag 发版）
```

- 快照锁定在 blog 的 `061de57d`；113 篇正文里抽过卡的是 104 篇（104 个卡文件）、共 524 张卡，校验 0 error。
- 原型里的校验用例已迁移为 `app/test/domain/` 与 `content/test/rules.test.ts` 里的单元测试（原型本体 2026-10-27 已删 —— 不被任何构建或测试引用，只是一份只读参考；历史里能取回）。
- **规则不是每条一个文件**：`content/src/rules/index.ts` 一个文件装 R1–R6、R8–R10、R14、R16、R17；R7、R12 在 `content/src/budget.ts` / `review.ts`；R13 在 `content/src/source/errata.ts`；R15 在 `content/src/default-routine.ts`；R11 是 UI 规则，由 `app/test/ui/card.test.tsx` 守住。
- **没做的**：设备端验收（**Android 模拟器上已真机验过：装 APK、卡上设提醒、到点系统通知真弹**；还差 iOS 与实体手机、两个日历 App 的实际导入）、**卡片的签字**（33 张 draft 卡等人审）、14 天决策门。
- **多设备同步（§4.6）已铺好**：合并规则、加密、客户端、设置页的开关都在，
  服务端那一半在 `sync/`（Worker + KV）。**默认关着** —— 不开就一个字节都不出去。
  还没做的是真机实测（两台设备来回改同一份数据）与服务端部署。
- **等作者补的**（管道已铺好，只差内容层点一下）：**无**。
  原先是 **39 张卡 · 56 行剂量**的引文写的是「约 / 大约 / 左右」，卡上没标 `approximate`，屏上把近似说成了定值（其中一张是服药周期）；
  **2026-10-28 已补齐**（作者授权代签，签名 `AI（作者授权代签）`）：56 行全部标上 `approximate: true` 并重签，
  `npm run content:approx-check` 现在是 0 张卡 · 0 行。
  这条命令仍然只列不改 —— 改卡要重签，签字是人的活。见 §5.1f。
  （其中 `towel-water-top-loader` 原本是 draft 卡，补标志时顺带被签了；已退回 draft，
  「多一张卡进产品」是内容决策，不该由签字带出来。要签就 `npm run content:review towel-water-top-loader --by <名字>`。）

---

## 3. 已确定的事（不要重新讨论）

| # | 决定 | 说明 |
| --- | --- | --- |
| D1 | **快照，不同步** | 正文来源是 `blog/src/the-savvy-life-manual/` 的某一个 commit，一次性复制到 `content/source/`，**图片一并下载**到 `content/media/`，`SOURCE.lock` 记下 commit、日期与每个文件的 sha256。之后 045 只认快照：不改 blog 仓库、不接 blog CI、不跟随更新，运行时不访问 `img.newzone.top`。**所有权随之转移**：blog 是上游草稿，045 的快照是 App 的权威版本（§4.1）。 |
| D2 | **每个事实字段附原文逐字引文，由机器校验** | 提醒、剂量、效果、步骤、禁忌都带 `quote`（可为多句数组）；校验器检查每句都是快照的逐字子串。「适量 / 适度」等于零信息。 |
| D3 | **图片按步骤显式绑定** | 不按文章整批搬，也不按位置推断归属。例：`tears.md` 7 张图只有 2 张属于睑缘清洗，且散在全文。说明类动作允许无图。 |
| D4 | **一张卡承载全部层次** | 收起态 = 名 / 做什么 / 剂量（+ stop 禁忌）；展开态 = 用法用量表 + 步骤 + 禁忌 + 逐字出处。这条保的是**一张卡要能独立承载三层信息**；「全局清单」由手册页承担，今天只放用户自己挑进日常的那几张（见 §6 —— 当前 491 张卡里 387 张是「随时」或没标时段，全铺进今天就是几十屏）。 |
| D5 | **降级是版本，不是失败** | 出差 / 生病换版本做，记为完成（源自 `DailyRoutine.md`「最小版本」）。 |
| D6 | **一套代码，三种形态：PWA、Electron 桌面、Capacitor 手机** | 界面只写一遍（Preact），构建产物 `app/dist` 三处复用：浏览器里是 PWA（可装可离线），桌面上是 Electron 壳（`desktop/`），手机上是 Capacitor 壳（`mobile/`）。**不是三套应用**，是同一份界面的三种壳。样式层同理：Tailwind + daisyUI 是**构建期**的（daisyUI 是纯 CSS 插件，运行时零成本），三处跑的是同一份 CSS。 |
| D7 | **推算 ≠ 原文；不知道就写不知道** | 推算值必须写算式并在界面标「推算」。原文没给、也无法可靠推算的（如 3T 保湿耗时），标 `unknown`，**禁止为了过校验编数字**。 |
| D8 | **保健动作与疾病信息分开处理** | 胰腺癌、青光眼、帕金森、CKD 等疾病类内容不进「今日清单」，不可勾选，单独一套提示分级（§5.4）。 |
| D9 | **多设备共用一份数据；默认不上传** | 数据仍然只在本机，**同步是用户自己开的开关**（不开 = 一个字节都不出去，README 与设置页那句话仍然是真的）。开了之后：口令派生出空间 id 与 AES-GCM 密钥，**上传的只有密文**，服务端没有口令就解不开（§4.6）。 |

## 4. 已拍板的事

### 4.1 内容来源 → 一次性快照，卡片数据放在 045 自己的仓库

```
content/
├── source/            blog 文章快照（只允许勘误修改，见下）
│   ├── SOURCE.lock    { repo, commit, date, files: { path: sha256 } }
│   └── ERRATA.md      对快照的每一处修改
├── media/             快照中引用的全部图片，按 sha256 命名
│   └── media.lock     { 原 URL → 文件名, sha256, bytes, fetchedAt }
└── cards/             每篇文章一个卡片文件（按手册分类分四层）
    └── the-savvy-life-manual/
        └── body-care/
            └── tears.yaml
```

- **为什么不同步**：跟随 blog 更新需要 stale 检测、跨仓库 CI、版本 pin 与升级节奏。这些复杂度只为一个「保持最新」的需求服务，而手册内容本身很稳定。快照之后，045 是一个自包含的仓库。
- **覆盖检查**仍然保留（R9），对象是快照：快照里每个小节、每张图片，要么被某张卡引用，要么列入 `ignore`。它防的是「抽漏了」，与是否同步无关。
- 文章状态 `coverage: partial | complete`。
- **重新导入**是可选的手动操作，不是流程的一部分：`content import --commit <sha>` 替换快照后跑一遍校验，R1 报错的地方就是原文改过、需要人看的卡片。此功能等真需要时再做（P4）。
- **图片也进快照**：import 时下载快照引用的全部图片（首批 12 张卡约 9 张、359 KB；全量预计数十 MB，可直接入 git）。yaml 里仍写原 URL 便于溯源；构建时按 `media.lock` 重写成本地路径，并只把 reviewed 卡用到的图片拷进 App。图片下载失败时 import 报告列出，不静默跳过。
- **所有权转移**：快照之后两边长期分叉。**blog 是上游草稿，045 的快照是 App 的权威版本。** 发现原文错误：
  1. 改 `content/source/` 对应文件，并在 `ERRATA.md` 记一条 `{ file, before, after, reason, upstream: fixed | pending | n/a }`；
  2. 若读者也会看到这个错误，再去 blog 改一次，然后把 `upstream` 改为 `fixed`。
  校验器比对 `SOURCE.lock` 中的 sha256：快照文件被改动却没有对应勘误记录 → error（R13）。这样「只改了一边」至少会留下记录。
  **反过来也算**：快照里有 `SOURCE.lock` 没登记的文件（重新导入只写不删，旧文章会留在盘上）→ 同样是 R13 —— 否则快照里就有记录 commit 之外的内容，校验器一声不吭。
- **代价**：blog 之后的修订不会自动进入 App，只能靠勘误或重新导入。

### 4.2 提醒 → App 自己响，日历当备份

**（2026-10-21 改）** 原来这一节写的是「App 是仪式，日历是闹钟」—— 只导出 `.ics`，
闹钟交给系统日历。用户明确要求 App **自己提醒**（桌面与手机都要），所以改成下面这样：

- **App 自己排程、自己响**，三端各走各的通道（`app/src/platform/notify.ts` 一层，三种实现）：

| 形态 | 通道 | 关掉 App 还响吗 |
| --- | --- | --- |
| 桌面（Electron） | 主进程定时器 + 原生 `Notification`（`desktop/lib/reminders.mjs`） | 进程在就行（**关窗口只是收进托盘**，托盘右键才退出） |
| 手机（Capacitor） | 系统级本地通知（`@capacitor/local-notifications`，`cap sync` 装进原生工程） | **会响**（操作系统在排程） |
| 浏览器 / PWA | 页内定时器 + `Notification` API（经 Service Worker 弹） | **不响**（后台标签页被浏览器节流） |

- **提醒有两种，合成一条列表**（存设置 `reminders`）：
  - **整段的**（`cardId = null`）：「早晨」「晚间」那两条，响的时候说这一段该做哪几件
    （`reminderSuggestion`，按**日常里的次序** —— 用户自己排的，不是 `cards.json` 的顺序）；
  - **绑在卡上的**（`cardId = 某张卡`）：「这张卡该在什么时候做」。**在卡上设**：
    展开那张卡 →「提醒」那一行→「设提醒」。设置页里也列得出、也删得掉。
  - **卡移出日常时，提醒不会自己消失**（2026-10-25 补）：点「移出日常」时，若这张卡有提醒，
    会就地给出「一起删 / 只移卡 / 取消」；**调顺序里移出也走同一个询问**，不再静默删。
    放回默认时，被换掉卡上的提醒会随确认文案一起删掉；选「只移卡」就把提醒留着，
    设置页里仍然能删。
  - **「今天不做」不是移出日常**：只写 `skipToday`（cardId → 当天日期），
    当天不显示、卡上的提醒当天也不响；过了 04:00 日界线自然回来，日常清单不动。
    撤销入口在清单上方「今天不做」那一块；永久移出才走上面的提醒询问。
    **只跳「这一次」，不丢整条提醒**：整段提醒（早晨/晚间）是每天重复的，
    某一段的卡全被跳过时只是今天这一次不响、明天照常 —— 早先的写法是把整条
    丢掉，结果这一段在本次会话里就没了（桌面端没了定时器，手机端系统通知被取消）。
    **手机端的系统重复表达不了「今天不算」**：系统的「每天 08:00」一旦排上，
    今天 08:00 就会响。所以被跳过的那一次退成一串一次性通知
    （`ReminderSpec.firstSkipped` → `platform/notify.ts`），今天不响、明天起照常，
    App 每次打开重排，链不断。
- **四种时间模式**（用户要的「多种模式」）：`daily` 每天 / `weekly` 每周几（可多选）/
  `interval` 每隔 N 天 / `once` 就一次。屏上写法见 `describeReminder`。
  **新建卡提醒的默认模式跟着卡的频率**：周卡默认每周当天，月卡默认每隔 30 天；已有提醒不改。
- **「下一次是哪一刻」只有一处算法**（`app/src/domain/reminders.ts` 的 `nextOccurrence`）：
  桌面、手机、浏览器都从这儿取时刻。**主进程不另写一份日期算法** —— 两处各写一份必然分叉。
  桌面主进程到点后回头问渲染层要下一次（`life-guide:reminder-due`），渲染层答了才会一直响下去；
  渲染层不在时，主进程用随排程一起送去的备用几次（`after`）接着响。
- **响过要接着排**：浏览器到点、主进程到点，都会拧一下重排（`tick`）——
  不重排的话，一天只响一次。
- **`.ics` 降级成备份**：浏览器那条路不靠谱（后台会被节流），所以日历那条路仍然留着，
  并且用用户设定的时刻。点它导出 → 早 / 晚两条每日重复事件，链接带 `?slot=morning|evening`；
  **卡片提醒也在这个文件里**（2026-10-25 补）：按每条提醒自己的每天 / 每周几 / 每隔 N 天 / 一次
  生成事件，VALARM 就在提醒时刻。当天标了「今天不做」的卡会带 `EXDATE`，那一天不响；
  某一时段的卡全跳过时，该时段的整段事件也会带 `EXDATE`。网页端「设了卡片提醒但关掉页面」时，
  这是可靠的落地方式。
- 打开时落到对应时段：链接里带了 `?slot=` 就落那一段，没带就按当前时间自动落。
- 主屏上时段是可以手动切的（默认跟着钟点走）—— 否则晚上就看不到早上该做的事。
- Web Push 仍不作为前提：本地通知不要后端，本地就够了。
- **手机的「每隔 N 天」靠一次性通知排**：系统的重复规则只有「每天」「每周某天」，
  所以把接下来几次的准确时刻排成一次性通知（App 每次打开都会重排一遍，链不会断）。
- **Android 上有四个坑，都是在模拟器上真跑才发现的**（`SCHEDULE_EXACT_ALARM` / `POST_NOTIFICATIONS`）：
  - **不给精确闹钟权限，提醒会晚**：系统把闹钟降级成不精确的，攒着一起发 ——
    实测 08:11 的提醒 08:12 才到。App 已在 `AndroidManifest.xml` 里声明该权限，
    设置页在没授权时给一颗「去允许精确提醒」（`exactAlarmStatus` /
    `openExactAlarmSettings`）。授权后实测准点（08:22:00 触发，08:22:00.011 续到明天）。
  - **要不要精确，由 App 自己说了算 —— 不许插件替我们跳系统的授权页**：
    插件的 `isExactNotification` 默认是 `true`，而它在 Android 12+ 遇到没授权时
    **自己去打开系统的「闹钟和提醒」授权页**（实测：新装第一次打开 App，
    界面还没露出来就被那张系统页顶掉了；用户没答应的话，下次开还来一次）。
    抢屏 + 反复问 = 越权。所以 App 传 `isExactNotification: 是否已授权`：
    没授权就按**不精确**排程（提醒照样响，实测「排 +1 秒」晚约 **5 秒**到，
    `dumpsys alarm` 里看得到 `window=+1h0m0s0ms`），授权了就准点
    （`window=0 exactAllowReason=permission`）。想准点响的用户自己点设置页那颗按钮 ——
    那次跳系统页才是被允许的。授权后要**立刻重排**：已排的那几条还是按不精确排的。
  - **通知权限也一样：没允许就不排，不许插件替我们问**。
    插件的 `schedule()` 自己在没授权时会弹系统的**通知授权页**
    （`LocalNotificationsPlugin.kt`：`if (shouldRequestNotificationPermission()) requestPermissionForAlias(...)`）——
    App 一启动就排程的话，用户还没看见界面就被那张系统对话框盖住
    （实测：新装第一次打开就是它，底下的应用界面根本没机会被看清）。
    所以 App 自己先 `checkPermissions()`：**没允许就不排**，
    用户在设置页点「允许通知」（那颗按钮是用户自己点的，那次弹窗才被允许）之后
    立刻重排。设置页与首启说明都写清「没允许通知，提醒不会响」。
  - **通知 id 不能撞**：系统按 id 存通知，撞了就是**后一条把前一条顶掉** ——
    实测「早晨一周五条」占了 id 1–5，「晚间那条每日提醒」占了 id 2，
    早晨周二那条就没了。所以每条提醒占一段号（`index + 1) * 100`），段内自己编号。
  - **要给 `second: 0`**：不给秒，系统把「排程那一刻的秒数」带进去 ——
    07:00 的提醒会变成 07:00:46。排程形状由 `app/test/platform/notify.test.ts` 钉住。

### 4.3 抽取 → LLM 起草 + 脚本校验 + 人工只审差异

1. P1 手工抽 12 张高频卡，同时定稿 schema 与校验器。
2. P3 起由 LLM 按 schema 起草。起草工具**只能**写 `status: draft`。
3. 校验器拦截不可信字段；人工只审：diff、全部 `derived`、全部 `unknown`、全部疾病类卡片。
4. **审阅闸门**：`draft → reviewed` 只能由人运行 `content review <cardId>` 完成。它写入签字 `{ by, date, hash }`，`hash` 是该卡片当时内容的指纹。卡片之后被任何人（含 bot）改动，hash 不符即视为未审阅（R12）。CI 只校验，从不改文件。
   签字有两条前提，**不满足就拒签**（否则签出来的东西是假的）：
   - **那个文件的结构得合法**（过 schema）—— 结构坏的卡签了，`content build` 会在剥引文时崩，崩在写 `cards.json` 之前，产物还留在上一版却看着像新的；
   - **那个 id 得只有一张卡** —— 同一个 id 签一次等于签了两张不同的卡，签字的意义就没了。
   已签字的卡**改过之后**要重签，必须明说：`content review <cardId> --by <名字> --resign`。
   不加 `--resign` 时已签字的卡会被跳过 —— R12 存在的意义就是「卡被改过而没人再确认」，
   一声不吭地重签正好把它废掉。
5. **只有签字有效的 reviewed 卡会进入 App 构建。**
6. **批量签字走清单**（`content/src/signing-list.ts`）：`npm run content:signing-list` 把
   审阅报告里「没发现问题」的卡按篇排成一份带勾选框的清单（每条给一张卡的预览：
   做什么、几步、剂量、注意），人一张张勾，然后
   `npm run content:review -- --list content/signing-list.md --by <名字>` 只签勾上的那些。
   任何一条都能加 `--dry-run`：只说要签哪几张，不写盘。
   **清单只排「机器没挑出毛病」的卡** —— 意思不对、引文没覆盖全、重复的那些不该混进来让人白看。
   - **2026-10-21 有两批是批量签的（289 + 206 张）**：依据是审阅报告的「没发现问题」——
     那是**机器**查的（引文逐字、数字对得上、字段比例正常），**人没有逐条读过**。
     那一批卡进 App 之前，人只看过抽样。逐条过请重新生成清单再签。
7. **「引文没覆盖全」用机器补**（`content/src/repair-quotes.ts`）：
   那种情况是**引文引窄了**（卡片自己补了「起始姿势」那一段，原文里有但没引进去），
   不是内容错了。`npm run content:repair-quotes` 会把原文里缺的那一段也引进去 ——
   找法是「先把引文盖住的部分从卡片文字里剔掉，剩下的才是缺的那块」。
   补完重跑一次审阅就知道有没有补对（`content audit`）。
   **只动 draft 卡**：reviewed 的是人工成果，改了得重签，不在这里碰。
8. **2026-10-24 的标题审计是作者授权代签的（254 张）**：这一轮只改 `name`
   （224 张保健 + 30 张疾病类），没动引文、剂量、步骤、时段与模式版本。
   作者明确说「不用我过目，你把所有内容逐条审核处理」，所以 239 张已签字卡用
   `--resign` 重新签，签名写作 `AI（作者授权代签）`；另有 15 张 draft 一并改名，仍未签。
   **这不是把签字改成机器行为**：事实字段仍由 R1/R2/R12 看守，以后改事实仍要人逐条看。
   这一轮为什么值得改：同一篇里曾出现 5 张同名「各部位对应的穴位位置」、5 张「全部 41 张
   卡片对照」、4 张「注意事项」—— 新用户在手册里看到这些名字，不知道点进去做什么。
9. **2026-10-28 的近似值补齐也是作者授权代签**（签名同样写作 `AI（作者授权代签）`）：
   39 张卡 · 56 行剂量的引文写的是「约 / 大约 / 左右」，卡上没标 `approximate`，
   屏上把近似说成了定值（其中一张是服药周期）。这一轮**只加 `approximate: true` 这个
   事实标志，不改任何一句话**，然后重签。顺带把一张原本的 draft 卡退回了 draft ——
   签名不该顺带把新卡带进产品（见 §2 的说明）。
10. **2026-10-29 的合并也是作者授权代签**（同一署名）：作者看到「有些卡片拆得过散」
    后定了范围「全合」，这一轮**合并了 14 组**（详见 §5.1g）：
    真重复 4 组、表/清单切片 3 组、同主题薄卡 7 组，共 38 张旧卡并成 14 张
    （其中 12 张进产品、2 张是 draft 之间互合），
    **产品里的卡从 518 张降到 491 张**（每张都带着原来的全部步骤与引文）。
    合并的规矩：
    - **只合并已经进产品（reviewed）的卡**；draft 卡之间可以合（少审几遍），
      但 **draft 内容不并进 reviewed 卡** —— 那等于把没人审过的内容签字放行；
    - **被并掉的 id 写进留下那张的 `formerIds`**，用户的记录靠它认领回来（§5.1g）；
    - **内容变了就重签**（R12 会拦），这一轮 12 张重签（新卡 9 + 改动 3）。

> 为什么不用「PR approvals」：这是个人项目，GitHub 不允许自己批准自己的 PR。签字 + 内容指纹在单人和多人下都成立，而且与忙档预算（§5.3）是同一套机制。

### 4.4 历史记录 → 第一天就记事件，不做打卡

- 从 P2 起写事件日志 `{ date, cardId, variant, ts, periodDone?, periodCadence? }`（IndexedDB），
  支持 JSON 导出 / 导入。`periodDone: true` 表示这次盖章算周期完成，`false` 表示用户撤销过；
  没有这个字段的是旧日志。`periodCadence` 记录完成时是按每周还是每月算的，改频率后旧完成不冒充新频率。
- 界面只显示累计、不因断签清零：「已做 38 天 · 原文：连续 5～6 个月才显现效果」；
  主动撤销一次周期完成会从可见累计里扣掉那一次，但事件仍留在历史里。
- 「一天」以凌晨 04:00 为界。页首日期、印章与默认时段也用同一口径：
  00:00–03:59 仍显示前一天 · 晚间，04:00 才翻到新一天 · 早晨。

### 4.5 发版 → tag 是唯一版本源；Windows 桌面端能自己更新

**（2026-10-24 改，2026-10-25 补平台）** 原来发版是手工的：本地打包 → `gh release create` → 手工传附件。
现在走 tag 驱动的流水线（`.github/workflows/release.yml`）：

```
push tag vX.Y.Z
  └─ validate       tag 与 5 个 package.json 的版本对得上 + 内容校验 + 类型检查 + lint + 单测 + 桌面逻辑测试
                    + **这一版的发布说明在不在**（docs/发布说明/<tag>.md）
      ├─ prepare     建发布草稿（正文取自 docs/发布说明/<tag>.md + 固定告知）→ 拿到 release id
      ├─ build-desktop-win     Windows x64+arm64：NSIS 合一安装包 + 双架构免安装版 + latest.yml
      ├─ build-desktop-mac     macOS x64+arm64：dmg + zip（zip 是更新载体）+ latest-mac.yml
      ├─ build-desktop-linux   Linux x64+arm64：AppImage + deb + rpm + latest-linux*.yml
      └─ build-android         Linux：APK
          └─ publish   单一草稿 → 校验资产 → SHA256SUMS → 发布 → 核验
```

- **发布说明在版本库里**（2026-10-30 改）：`docs/发布说明/<tag>.md`，跟那一版的代码
  在同一个提交里。`validate` 先查它在不在，`prepare` 用它当草稿正文，
  再由 `scripts/release-notices.mjs` 的 `STANDING_NOTICES` 附上那几条固定告知。
  - **为什么不再写在草稿页上**：原来 publish 走 `release` environment（人工审批），
    作者在放行之前到 GitHub 的草稿页上把说明写进去。**正文在草稿页上，不在版本库里**
    —— 这条路已经翻过车：v0.2.0 发布出去的那一页上写的仍是占位符
    （`62d66de` 记着这件事，`affa93c` 把那些文件删了）。审批拆掉之后这条路整个没有了，
    所以说明必须有个可靠的地方可读 —— 回到版本库。
  - **缺了就报错，不自动生成一段**：这一版的说明是作者写的，给的是**用这个 App 的人**看的；
    机器能推的「提交里改了什么」是给开发者看的，替不了它。
    `scripts/release-notes.mjs` 缺文件时报错退出，**正文里再没有占位符**。
  - **模板由 `set-version.mjs` 生成**：那条命令改版本时顺手放一份模板
    （`docs/发布说明/vX.Y.Z.md`），模板里那行 `<!-- 待写 -->` 不删就算没写
    —— 文件非空不等于写过了。
  - **tag 推出去之后才发现漏写**：把说明提交到默认分支、重跑失败的 job 就行，
    **不用动 tag**（产物是按那个提交打的）。`release-notes.mjs` 会先看工作区
    （流水线里就是被打 tag 的那个提交），再看 `origin/main`。
  - **每次都有的那几条固定告知**（未签名、哪些形态能自动更新、关窗口只是收进托盘）
    由 `scripts/release-notices.mjs` 提供，**说明文件里不要重复写** ——
    重复了发布页上会出现两遍。

- **产物不走 artifact 中转（2026-10-28 改）**：每个构建 job 把产物**直接传进
  那个发布草稿**，publish 只读 API。
  **为什么**：Actions 的 artifact 存储有配额 —— GitHub Free 只有 500 MB
  （与 GitHub Packages 共用同一个池），而且**只给私有仓用**（公开仓的 artifact
  存储免费，见 GitHub 文档）；账户里其它私有仓的产物已堆到 11.5 GB
  （`shiye` 6.1 GB、`md-publisher` 3.8 GB 等），没有付款方式时超额是**硬阻断**。
  2026-10-28 实测：本仓那时还是私有的，连 CI 那 157 MB 的桌面产物都传不上去 ——
  「Artifact storage quota has been hit」直接让两个 job 判红。
  **release 资产不占 artifact 配额**，所以绕开它是正路；转公开之后这条路更稳
  （1.6 GB 的产物走 artifact 中转要多传一遍再下回来，直接进草稿省两趟）。
  顺带把 CI 里两个 artifact 上传改成 `continue-on-error`：产物留不留是便利问题，
  配额满了不该让构建判定失败（真正的判定是那次真启动）。
- **校验和不用把 1.6 GB 再下一遍**：GitHub 的 release 资产 API 每个资产都带
  `digest`（`sha256:…`），那是服务端算的，跟用户下载下来算的同一个值
  （实测与本地 `sha256sum` 逐字一致）。`scripts/release-assets.mjs` 直接拿它拼
  SHA256SUMS，格式与 `sha256sum` 一致（两格空格），用户的 `sha256sum -c` 能直接用。
  校验的内容：15 个产物在不在、四条更新清单的版本对不对、清单指向的文件在不在、
  清单指的是不是对的载体 —— 缺一条就退出非零，草稿不会被发出去。
- **草稿只建一次**：几个构建 job 并行往同一个草稿传东西时，「按 tag 找草稿」会撞上
  草稿标签被 GitHub 改成 `untagged-xxx` 的老问题，所以 `prepare` job 先把草稿建好，
  后面全部按 **release id** 传（`scripts/release-draft.mjs` 的 `RELEASE_ID` 模式）。

- **平台覆盖**：桌面三平台各 x64 + arm64；每个 OS 一个 job，同一 OS 的多架构必须在**同一次**
  electron-builder 调用里打 —— 分 job 打会各写同名 `latest*.yml`，谁后跑谁赢。
  没有原生模块，Linux arm64 可以在 x64 runner 上交叉打。
- **macOS 暂不接自动更新**：macOS 的 Squirrel.Mac 只认签过名的应用，现在没有 Developer ID；
  界面如实写「请手动下载新版」，不把「有新版本」伪装成能一键装。
  **Linux 接了，但只放行 AppImage**：electron-updater 的 Linux 更新器要替换 APPIMAGE 指到的
  那个文件（deb / rpm 装的没有它，硬跑会把应用装到别处），所以 AppImage 版能自动更新，
  deb / rpm 版仍写「请手动换新包」。
- **`latest*.yml` 是四份，不是一份**：`latest.yml`（Windows）、`latest-mac.yml`（macOS，含两个架构的 zip）、
  `latest-linux.yml` / `latest-linux-arm64.yml`（Linux 两个架构）。publish 会逐份核对版本与它指向的文件。
- **没有人工审批闸门**（2026-10-30 拆掉）：publish job 不再走 `release` environment，
  那个 environment 上的 Required reviewers 也一并删了 —— 留着它，流水线会**一直停在
  「Waiting for review」等人点放行**，而这正是作者不要的（发版说好了是自动的）。
  - **当初为什么有那道闸门**：它跟「人在草稿页上补发布说明」是同一件事 ——
    说明写好、确认过，才放行。闸门拆了，说明改到版本库里
    （`docs/发布说明/<tag>.md`），`validate` 先查它在不在，`prepare` 用它当正文。
  - **「半成品不会被人下载到」靠什么保证**：靠机器 —— `validate` 跑全量测试，
    `publish` 校验 15 个产物与四份更新清单、`SHA256SUMS` 对得上才发。
    「这一版说明写得对不对」本来就是人的判断，闸门只是把它挪到了发布之后。
  - **想再加回来**：Settings → Environments → release 配回 Required reviewers，
    再在 `release.yml` 的 publish job 上加回 `environment: release`（**两处都要**：
    光配审阅人但 job 不引用那个 environment，不会有任何效果）。

- **tag 是唯一版本源**：发版提交先改版本再打 tag，`validate` 断言一致，不一致即失败。
  一条命令改到位：`node scripts/set-version.mjs 0.1.1`
  （5 个 package.json + 锁文件的版本字段 + Android 的 `versionCode`）。
- **Android 的 `versionCode` 必须递增**，否则系统认为没变、**新包装不上**；
  映射规则 `major×10000 + minor×100 + patch`（0.1.1 → 101），版本只增不减它也只增不减。
- **打包一律 `--publish never`**，由唯一的 publish job 上传：否则几个 job 各自抢着发，会发出半成品。
- **`SHA256SUMS` 必须在 Linux 上用 `sha256sum` 生成**（行尾 LF）：
  PowerShell 的 `Set-Content` 写 CRLF，应用自己读没事，但用户那条 `sha256sum -c` 会逐行失败。
- **附件名只能是 ASCII**：GitHub 的附件名只吃 ASCII，中文会被换成 `default.exe`；
  而 `latest*.yml` 里记的就是附件名 —— 对不上就更新不了。
  所以 `desktop/package.json` 把产物名钉成 ASCII：Windows 是
  `LifeGuide-Setup-${version}.${ext}`（双架构合一）与 `LifeGuide-Portable-${version}-${arch}.${ext}`；
  macOS / Linux 是 `LifeGuide-${version}-${arch}.${ext}`（Linux 的 `${arch}` 会按格式展开成
  `x86_64` / `amd64` / `aarch64`，不是统一的 `x64`）。
  **装完仍是「生活指南」**（开始菜单、窗口标题、快捷方式都没变）。

**桌面端的自动更新**（electron-updater，`desktop/lib/updater.mjs`）——**Windows 与 Linux 的 AppImage**：

- **不自动下载**：双架构合一的安装包两百多兆，用户没说要更新就先下两百多兆是不礼貌的。
  启动时只**查**，查到新版本弹一条系统通知；下载与安装由用户点（设置页 → 更新）。
- **免安装版不参与**：portable 没有安装目录，而安装动作依赖安装布局 ——
  硬跑会把应用装到别处。免安装版的 SFX 会设 `PORTABLE_EXECUTABLE_DIR`，靠它认出来。
- **没签名也能更新（仅 Windows）**：`app-update.yml` 里没有 `publisherName` 时，
  electron-updater **跳过**签名校验（未签名应用的正常路径）；
  完整性靠 `latest.yml` 里的 sha512 核对下载到的文件。
  macOS 的 Squirrel.Mac 没有这个退路 —— 未签名就不接更新，界面写「请手动下载新版」。
- **仓库已公开（2026-10-28）**：更新清单从 `releases/latest/download/latest*.yml` 取，
  私有仓库匿名取不到 —— 转公开前自动更新是走不通的，现在这条用户路径才真正可用。
  **哪些形态能更新**的判断是纯逻辑（`desktop/lib/update-events.mjs` 的 `updateSupportFor`，
  `node --test` 守着）：免安装版没有安装目录、macOS 没签名、Linux 只认 AppImage，
  各有一条照实说的理由，界面显示的就是那句。
- **界面上不出现内部词**：状态到人话的翻译在 `app/src/domain/update.ts`，
  状态机在 `desktop/lib/update-events.mjs`（纯逻辑，`node --test` 守着）。

**已知取舍登记在 `.desktop-policy.json`**（desktop-app-standard 的 house style）：
  仓库已转公开（2026-10-28），但还没有 Azure/Apple 凭据 → Windows 未签名、macOS 未签名/未公证、
  Linux 的 AppImage 自动更新已接上但**还没在一台 Linux 机器上实测过 N→N+1**。
  每条都带 reason + revisitWhen；巡检脚本按它把对应的发现算作「已接受的偏离」，
  不计入 P0/P1/P2。**没有登记的旧做法按 house style 算「漂移」** ——
  要报告、要给复查条件，不默认保留。
  审阅基线 `.desktop-app-standard-review-20261026.json`：**本机文件，不入库**
  （`.gitignore` 里 `.desktop-app-standard-review-*.json` 排掉了，从未进过版本库）——
  它只标记已审阅的 release，不表示已升级、已修复或通过验收。
  换机器时它不在，巡检会把上游变更候选全算成「未审阅」——那是如实的结果，不是漏了。
  巡检命令：`node <aishort-skills>/skills/desktop-app-standard/scripts/audit.mjs <项目目录> --out audit.json`。

**发版链路上踩过的坑（都写进代码注释了，这里汇总一下）**：

| 坑 | 现象 | 怎么办 |
| --- | --- | --- |
| 工作流文件里的「冒号+空格」 | 整个文件被 GitHub 拒绝，CI 0 秒就死，只说一句「likely failed because of a workflow file issue」 | `npm run lint:workflows` 解析所有工作流 + 把每段 shell 交给 `bash -n`（CI 里跑） |
| Capacitor 8 要 JDK 21 | runner 默认 JDK 17 → `invalid source release: 21` | 流水线里显式 `actions/setup-java@v6` |
| `gh release upload <tag>` | 草稿在 `GET /releases/tags/<tag>` 里查不到，gh 会把草稿的标签改成 `untagged-xxx`，再往那儿传 → 404 | 走 API，按 **release id** 传（`scripts/release-draft.mjs`） |
| PATCH 草稿只带 `body` | 草稿的标签被打回 `untagged-xxx`，后面按 tag 找全落空 | 每次 PATCH 都显式带 `tag_name`，发布那一步用 release id |
| 私有仓库的下载链接 | `releases/latest/download/latest*.yml` 匿名取不到（它认浏览器会话） | 四份清单逐一走 API 核验；仓库公开后自动切回匿名下载（用户那条路径） |
| **artifact 存储配额：私有仓才有，公开仓免费** | 2026-10-28：CI 两个 job 挂在最后的上传步骤上，错误是 `Artifact storage quota has been hit`，而校验本身全过。**根因是那时本仓还是私有的**：GitHub 的 500 MB 额度（GitHub Free）只给私有仓用（公开仓的 artifact 存储免费），而**没有付款方式时超额是硬阻断**。本仓自己就攒了 314 MB 旧产物（每次 CI 157 MB × 2），再来一份就顶到额度 | 三件事一起做：① 产物**不走 artifact 中转** —— 构建 job 直接传进发布草稿（release 资产不占这个配额）；② CI 的上传改 `continue-on-error`（产物留不留是便利问题）；③ 保留期改 7 天 + 清掉旧产物。本仓已转公开，这条对本仓不再是隐患。**账户里别的仓（`shiye` / `md-publisher` / `zhengyin`）都是公开仓，不受这个额度限制** |
| Linux 的 deb / rpm 要 homepage 与作者邮箱 | 2026-10-28：第一轮发版 Windows / macOS / Android 都打好了，Linux 报 `Please specify project homepage`，整条流水线停在那儿 | `desktop/package.json` 写明 `homepage` 与 `repository`；`scripts/check-desktop-metadata.mjs` 在 CI 打包前查一遍（CI 只在 Windows 上打包，本来查不出来） |
| `cp` 一次接多个通配符 | 有一个通配符没匹配到文件时，bash 把它当字面量传下去，cp 报 `No such file or directory`，整步崩 —— Linux **没有** `.blockmap`（那是 NSIS 与 macOS 才有的增量下载用） | 逐个文件拷，没匹配到的跳过；产物齐不齐由 publish 的资产校验管（它数着 15 个） |

### 4.6 多设备 → 共用同一份数据（默认仍然不上传）

**为什么加这个**：换设备要靠「导出 / 导入」手动搬，攒了几百天的记录搬一次就够烦的；
手机与桌面各记一半更糟（两边的「已做 N 天」谁也不全）。

**但「不上传」是产品的承诺**（README 写着「没有账号、没有服务器、不上传任何东西」）。
所以这条的形状是：**默认一个字节都不出去，用户自己开开关；开了也只有密文出去。**

| 形态 | 同步开着吗 | 数据去哪 |
| --- | --- | --- |
| 浏览器 / PWA | 默认关 | 只在本机 IndexedDB |
| 桌面（Electron） | 默认关 | 同上 |
| 手机（Capacitor） | 默认关 | 同上 |
| 开了同步（三端一样） | 开 | 密文 → 用户自己的同步服务 |

**口令 → 两样东西**（`app/src/data/sync-crypto.ts`）：

```
口令 ──PBKDF2(210000, SHA-256)──→ 主密钥
                                   ├─HKDF("space")→ 空间 id（公开的定位符）
                                   └─HKDF("key")  → AES-GCM 密钥
```

- **空间 id 由口令派生**：同一个口令在任何设备上都算出同一个 id ——
  换设备只要填同一个口令，不用再抄一串编号。
- **服务端只拿到密文**：它没有口令 → 没有密钥 → 拿到 KV 里的东西也解不开。
- **口令只存在本机**（IndexedDB，跟用户自己的记录放在一起），不上传。

**合并规则在 `app/src/domain/sync.ts`（纯函数，单测守着）**：

| 数据 | 身份 | 冲突怎么办 |
| --- | --- | --- |
| 盖章记录 | `ts` | 同一条取 `updatedAt` 新的 |
| 自定义习惯 | `id` | 同一条取 `updatedAt` 新的 |
| 设置 | 键名 | 整项取 `updatedAt` 新的（清单是有序的，合并顺序反而更乱） |
| 删除 | `kind:id` 墓碑 | 取 `updatedAt` 新的 |

三条不能省的规矩：

1. **合并必须与顺序无关**（`merge(a,b) === merge(b,a)`）。两台设备各算一遍，
   结果不一样就会来回覆盖，越同步越乱。同分时按内容逐字比大小，
   **不能看谁在左边**。
2. **删除要留墓碑**。删掉的东西如果只是"不传了"，另一台设备会把它带回来（复活）。
   墓碑也进同步（`tombstones` 表）。
3. **跟随同步的设置项是白名单**（`SYNCED_SETTING_KEYS`）：`tags` / `mode` /
   `myRoutine` / `cadence` / `skipToday` / `reminders`。
   同步口令、服务器地址**不能**跟着走 —— 白名单不是黑名单，
   以后新增设置项默认不同步，要同步得显式写进白名单。

**传输层是接口，不是实现**（`SyncTransport`，`app/src/data/sync.ts`）：
`sync-http.ts` 是其中一个实现（GET/PUT 一份密文）。
要换成网盘、局域网直连或别的，写一个新的 transport 就行 —— 合并与加密不用动。

| 落点 | 要不要自己部署 | 浏览器能用 | 说明 |
| --- | --- | --- | --- |
| **GitHub 私有仓库** | **不要** | 能 | 仓库里的一个文件；账号现成、API 现成，`api.github.com` 发 `access-control-allow-origin: *`（实测） |
| **网盘 WebDAV** | **不要** | **不能** | 坚果云 / Nextcloud / NAS 都自带，**也能填局域网里自建的那台**（见下面「局域网 WebDAV」）。坚果云与自建的那台都**不发 CORS 头**（实测），浏览器会拦 → 桌面端与 Android 手机能用（走主进程 / 原生 HTTP，绕开 CORS） |
| 自建中转服务 | 要 | 能 | `sync/` 那个 Worker（Cloudflare Worker + KV），自己跑 |

**落点是可插拔的**（`SyncTransport` 接口）：合并与加密那一层与落点无关 ——
换落点不用改它们。各家给"版本"的方式不一样（GitHub 给 blob 的 sha、网盘给 ETag、
自建服务给数字），所以 `rev` 是**字符串**：「我读到的是哪一版」只要求能原样退回去。

**默认不需要自己搭任何服务端** —— 落点选择器里前两个都是现成的。

**什么时候同步**：打开 App 时一次 + 回到前台时一次 + **App 开着时每隔 5 分钟看一眼** + 设置页手动一次。
点「完成」**只写本地、不联网**；同步是另一件事，择机发生（最多等 5 分钟，不必切前台）。
自动同步失败**不许把 App 弄坏**（断网是常事），错误只在手动同步时说出来。

**「完成」与「排序」不会互相踩**：记录按条合并、设置按键合并，清单整体按「谁新谁赢」。
（设备 A 盖章、设备 B 同时排序 → 盖章保住，次序取新的那个 —— 有单测钉着。）

**同步逻辑里几处特意做的省与等**（2026-10-29，落点定为 WebDAV 时一起改的）：

| 做法 | 为什么 |
| --- | --- |
| **只在真变了才传**（算载荷指纹，比上次传上去的） | 网盘按流量算钱；每次开 App 都重传几百 KB 是白花。**远端那份没了时一定要传** —— 否则本地这份永远上不去 |
| **自动同步有最小间隔**（5 分钟）+ **失败冷却**（5 分钟） | 「切回前台」一分钟能发生十几次；网盘有流量限制、浏览器有请求配额 |
| **同一时刻只跑一轮**（数据层一把锁） | 自动同步在后台跑、用户同时点了「立即同步」时，两个一起推正是把对方那份盖掉的时候 |
| **WebDAV 的条件头分三档** | 强 ETag → `If-Match`；**弱 ETag（`W/"…"`）不能当 If-Match**（弱比较永远不匹配 → 一直 412）→ 退到 `If-Unmodified-Since` + `Last-Modified`；连时间戳都没有 → 不带条件（最后一次写赢） |
| **第一次写用 `If-None-Match: *`** | 别把别人刚写的那份盖掉 |
| **每次拉取先问一句「还是那一版吗」**（`If-None-Match` → 304，不发 body） | **下载流量是按月算的**：载荷 ~160 KB，5 分钟一次全量拉 = 1.4 GB/月，坚果云免费版的下载额度只有 1 GB/月 —— 光是"问一句"就够一个月了。改成条件请求后，没变的那次只花几百字节 |

**设置页那块（2026-10-30 简化，作者定的第二档）**：
原来三段说明 + 三个落点的长选项名 + 两个按钮（保存并同步 / 立即同步），
现在收成：一句说明 + 一个可展开的「这安全吗」+ 短选项名 + 下面一行按落点变的说明。

| 做法 | 为什么 |
| --- | --- |
| **字段失焦即存，只留一个「立即同步」** | 原来那个「立即同步」用的是**没存**的输入框内容：改了地址点它，这一轮用新地址同步、存下去的却是旧地址 → 之后的自动同步又用回旧地址（这种问题最难查）。现在**先存后同步，存的和用的永远是同一份** |
| **GitHub 的「目录」字段去掉，固定 `life-guide/`** | 那个字段多半是空的（少一个字段少一次犹豫）；而且它要是能改，手动同步与自动同步就可能写到两个地方 —— 那样两台设备永远碰不到同一份数据 |
| **落点选项名改短，说明放到下面** | 选项名长成一句话时，下拉框读起来像一堵墙 |
| **地址的形状在 `syncConfigProblem` 里查** | 少了 `http://` 时，桌面端报「地址不合法」、浏览器报「Failed to fetch」→ 都被翻译成「地址填对没有、网络通不通」，用户看不出是自己少打了协议 |

**同一轮复查里改掉的三个真问题**（都在 `app/src/data/`）：

1. **改动会卡住不传**（`sync.ts`）：远端回 304 时代码**先**把「本地现在长什么样」记下来，
   **然后**才去推。推失败（断网）时那个指纹已经记成新的 → 下一轮远端还是 304、
   本地指纹 == 记着的那个 → 走「两边都没变」那条路 → **这份改动永远传不上去**，
   界面还显示「没有要传的改动」。修法：那个指纹只在**这一轮真的成了**之后才写
   （函数尾部统一写）。有单测钉着（把 bug 放回去，测试会红）。
2. **账号密码里有中文就炸**（`sync-webdav.ts`）：`btoa` 只认 Latin1，
   密码带中文时直接抛 `InvalidCharacterError` —— 传输层都构造不出来。
   改成按 UTF-8 编（RFC 7617 现在的事实标准）。
3. **「正在同步」被当成失败**（`useAutoSync.ts`）：另一轮同步在跑时，
   自动同步会把它算成失败并**进 5 分钟冷却** —— 而那只是有人（多半是用户）
   刚点了手动同步。现在报告里带 `busy` 标志，自动同步碰到它不进冷却。

**已知限制：合并靠墙钟**（`updatedAt` 比大小）。
**本机时钟是单调的，并且会吸收远端的时间戳**（`app/src/domain/clock.ts`）——
所以「对方的时钟快」「本机时钟往回走」都不会再把正常的改动吃掉：

- **单调**：本机每次取时间至少比上一次大 1 毫秒（时钟往回走也不怕）；
- **吸收**：收到远端数据时把它的最大时间戳并进本机时钟 ——
  于是「我看见过的东西」之后，本机的改动一定排在它后面。

**它不能治的**：物理时钟本身就快的那台设备，它的记录仍然排在很后面
（任何基于时间的方案都躲不过，除非换掉墙上时钟）。但只要两台设备同步过一次，
**因果序就建立了** —— 之后各自的改动不再互相吞掉。

**另外两条已知限制**（都写在明处，不假装没有）：

- **载荷是全量的**：每次同步传的是全部记录（不是差量）。
  一年下来几千条记录、几百 KB —— 量级算过了：按每天改 3 次算，约 **13 MB/月**
  （坚果云免费版上传额度 3 GB/月），**几年内都不构成问题**。
  **什么时候该改**：载荷超过 1 MB，或月上传超过 100 MB 时，
  再上增量同步（只传变了的记录 + 一份清单）—— 那是协议改动：
  远端要存"目录 + 分片"，三个传输层都得支持列目录 / 读单片 / 写单片。
- **墓碑只增不减**：删掉一条记录会留一个墓碑（不然对面的设备会把它带回来）。
  墓碑也跟着全量传。量很小（一条几十字节），但同样只增不减。

**桌面端的 CSP 放了一处**（`desktop/lib/protocol-headers.mjs`）：
`connect-src` 从 `'self'` 变成 `'self' https:` ——
同步服务是用户在设置页里填的地址，不可能是固定的。
**仍然不放行 `http:`**：局域网那条路走的不是渲染层（见下面的「局域网 WebDAV」），
渲染层发出去的请求一律是 https —— 收紧比放开更省事。
远程脚本仍然不放行（`script-src 'self'` 不变，渲染层只跑自己构建出来的那份代码）。

**局域网里自建的 WebDAV**（2026-10-30 补，作者要的）：
作者自己搭了一台在局域网里，所以「网盘 WebDAV」那个落点要能填**自定义地址**，
包括 `http://192.168.x.x:5006/dav/` 这种没有证书的。

**实测出来的关键事实**（Electron 45，`app://` 源 → `http://127.0.0.1`）：
服务器不给 `Access-Control-Allow-Origin` 就是 `blocked by CORS policy`，
给了才通。而**自建 WebDAV 默认不发这个头**（nginx 的 dav 模块、Apache mod_dav、
NAS 自带的那些都不发；坚果云也不发）⇒ **渲染层直接 fetch 一定连不上**。
（真应用里还有 CSP 先拦一道：`connect-src 'self' https:` 不放行 http://；
就算服务器是 https 的，CORS 那一关照样拦 —— 所以这条路必须绕开渲染层。）

所以 WebDAV 那条路**不用 fetch**，改走 `app/src/platform/http.ts`：

| 形态 | 走哪条 | 为什么 |
| --- | --- | --- |
| 桌面（Electron） | **主进程**（`desktop/lib/dav-client.mjs`，Node 的 http） | 不受同源策略管，`http://192.168.x.x` 直接能用。渲染层 → preload 的 `davRequest` → IPC → 主进程 |
| 手机（Android） | **原生 HTTP**（CapacitorHttp 插件） | WebView 之外的请求：既不过 CORS，也不受混合内容限制。清单里要 `usesCleartextTraffic="true"`（Android 9+ 默认禁明文） |
| 浏览器 / PWA | fetch | **走不通**：CORS 与混合内容两道关 |
| 手机（iOS） | fetch | **走不通 http://**（混合内容）；且 CapacitorHttp 只有 Android 实现（iOS 那侧没有这个插件）→ 退回 fetch，CORS 也拦 |

**主进程那条缝**（`desktop/lib/dav.mjs` + `preload.cjs` 的 `davRequest`）：
和提醒、更新那两条一样窄 —— 只放 http/https，且只认自己页面发来的 IPC。
主进程**不解释任何业务**：条件头（`If-Match` / `If-None-Match`）与认证头都是渲染层算好的。
渲染层那条缝没接上时**明说**（「桌面端那条缝没接上」），不静默退回 fetch ——
退回去也是被 CORS 拦，只是错误更难懂。

**明文 http 的代价**（写在明处）：同步的**载荷**是端到端加密的密文，
但 WebDAV 的**账号密码**在 `http://` 下是明文（Basic 认证是 Base64，不是加密）。
⇒ 局域网那台服务器值得用一个只管一个文件夹的小号。
自签证书也不给过：主进程直说「证书不被信任」，让用户改用 http:// 或把证书装进系统信任库。

**文件名带前缀**：网盘与 GitHub 里的文件叫 `life-guide-<空间 id>.json` ——
空间 id 是一串随机字符，人在文件列表里根本认不出来（要删、要备份、要看它多大）。

**还没验的**：Android 上真机跑一次局域网 WebDAV（模拟器上没搭 WebDAV 服务）；
作者自己那台服务器还没填过真实账号；iOS 那侧仍然是走不通的状态。

**库升到第 3 版时踩的一个坑**：`scripts/acceptance/checks.mjs` 里原来写死
`indexedDB.open("life-guide", 2)` —— 库一升版就报
"The requested version (2) is less than the existing version (3)"，
验收里那条「导入备份后清单跟着换」直接红。已改成**不写版本号**（打开当前那一版）。
以后再升 `db.ts` 的库版本，验收脚本里别写死版本号。

**还没做的**：iOS 与实体手机上的实测、真实两台设备同时改同一份数据的验收、
密文体积随记录增长的观察（现在一份 JSON 全量传，没有增量）。

---

## 5. 数据模型与校验（项目核心）

### 5.1 每篇的 yaml（示意，`<…>` 为占位）

```yaml
article: tears.md
kind: practice                    # practice（保健动作）| condition（疾病信息）
coverage: partial                 # partial | complete
ignore:                           # 覆盖清单：明确不抽的内容
  images:                         # 逐条列出，或整篇豁免：images: { all: true, reason: "全篇为章节配图，无可执行动作" }
    - { url: "https://img.newzone.top/…", reason: "热敷，归 warm-compress 卡" }
  sections:
    - { anchor: "<小节>", reason: "背景介绍，无可执行动作" }

cards:
  - id: eyelid-cleaning           # 全局唯一、稳定
    status: reviewed              # draft | reviewed
    source: { anchor: "<小节>" }
    name: "睑缘清洗"               # 屏上显示的动作名（≤16 字）；不填就用小节名，见 §5.1d
    review: { by: benson, date: 2026-10-19, hash: "<工具生成>" }   # 由 content review 写入，勿手填
    slot: evening                 # morning | daytime | evening | anytime
    images:                       # 卡片级配图（动作示意图），与步骤图分开
      - "https://img.newzone.top/…"
    remind: { text: "<一句话：今天做什么>", quote: ["<原文 A>", "<原文 B>"] }   # 收起态显示，数字最密
    effect: { text: "<多久见效>", quote: "<原文>" }
    dose:
      - { value: 10, unit: 秒, what: "<对象>", quote: "<原文>" }
      # 原文是范围时写一条（value + valueMax），别拆成「下限/上限」两条
      - { value: 32, valueMax: 34, unit: ℃, what: "<原文的话>", quote: "<原文>" }
      - { value: 5, unit: 次, what: "<对象>", quote: "<原文>", approximate: true }   # 原文写「约 5 次」
      # 值是换算来的（1/2 勺 → 0.5 勺）：写算式，界面标「推算」
      - { value: 0.5, unit: 小勺, what: "<对象>", quote: "<原文>", derived: { formula: "1/2 小勺 = 0.5 小勺" } }
    duration:                     # 整张卡一次的耗时
      basis: unknown              # quote | derived | unknown
      # basis=quote   → sec + quote
      # basis=derived → sec + formula
    steps:
      - id: warm                  # 步骤用稳定 id，不用序号
        text: "<步骤>"
        quote: "<原文>"
        images: ["https://img.newzone.top/…"]
        duration:                 # **这一步**的耗时（2026-10-30 加，可选）
          basis: quote            # quote | derived | unknown
          sec: 30
          quote: "<原文>"

      # 步级 duration 与卡级 duration 是两回事：卡级是**整张卡的总时长**，
      # 步级是**这一步**的时长。原文写「每个动作 30 秒」时，那个 30 秒是每一步的 ——
      # 血管拉伸那张卡记的总时长是 420 秒（5 个动作 × 2 回 × 30 秒 + 4 次休息 × 30 秒），
      # 只看总数，30 秒一组的节奏就丢了。
      # **没写这个字段不算错**：原文没给每步多长时间的卡很多，
      # 逼着填就成了编数（D7）。R1/R6/R17 同样管着它（引文逐字 / formula / approximate 要有着落）。
      # **R2 也管它的秒数**（2026-10-31 加）：`duration.sec` 必须在自己的引文里
      # 找得到对应的数（换算过也算：「约 3 分钟」→ 180 秒）。
      # 原来 R2 只查 dose 的值与自由文本 —— 把「保持 10 秒」抄成「保持 100 秒」
      # 没人拦，屏上直接把 10 倍的量说成定值（D7）。
      - id: wipe
        text: "<步骤>"
        quote: ["<原文 A>", "<原文 B>"]   # 跨句合并时用数组
    cautions:
      - { level: stop, text: "<禁忌>", quote: "<原文>" }
    notices:                      # 疾病类专用：提示分级（与 cautions 分开，见 §5.4）
      - { level: seek-care, text: "<该就医的信号>", quote: "<原文>" }
    variants:                     # normal 隐含为全部步骤；其余每项三选一
      busy:   { include: [warm, wipe] }
      travel: { replace: { text: "<替代做法>", quote: "<原文>" } }
      sick:   { skip: true }
    segments:                     # 人群分档：适用人群不同，就该做不同的动作
      - id: bone-senior
        when: ["age:senior"]     # 标签列表，AND 语义
        action: { text: "<做什么>", quote: "<原文>" }
        dose:   { text: "<多少>",   quote: "<原文>" }
        avoid:
          - { text: "<注意>", quote: "<原文>" }
```

### 5.1b 三种「分档」的分工

手册里长得很像的东西其实有三类，别混：

| 类型 | 例子 | 归到哪 |
| --- | --- | --- |
| **人群不同，动作不同** | 骨密度运动：成人之前跳跃 / 成人～60 代深蹲 / 70 代～防跌倒 | `segments` |
| **人群不同，数值不同** | 铁推荐摄入量（年龄 × 性别 × 月经期） | **不建模**。查表用的背景资料，不是「今天做什么」，进的是手册浏览而不是今日清单 |
| **同一动作的不同版本** | 忙 / 出差 / 生病时做简化版 | `variants`（按模式自动选） |

`segments` 和 `variants` 的区别在**谁触发**：`variants` 由用户选的模式（忙/出差/生病）自动决定；
`segments` 由用户的画像标签决定。两者都是「替代默认动作」，但语义不同，合成一个字段会既难读又难选。

**模式版本只做原文允许的删减**（2026-10-24 定）：忙档只能引用**卡片已有的步骤 id**
（R5 守着），不新写动作；出差 / 生病只在原文明确给了替代做法或停止条件时才建。
全量 524 张里目前 **15 张**有模式版本（14 张忙档、1 张生病跳过），**0 张出差版** ——
手册没有给出差场景的替代做法，宁可让 App 如实说「照常做」，也不编一个。
生病那条是 `sweat-heat-adaptation-plan`（原 `exercise-heat-adaptation`，2026-10-29 合并时并进来的）：
原文「如果感觉身体状况变差，请停止运动」→ `sick: { skip: true }`。
界面在卡上标「忙档 · N 步」/「今天不做」，条件那一行说明
当前清单里有几张有对应版本；没有对应版本的卡照常做。

**合并时容易漏掉 `variants`**（2026-10-30 补过一次）：2026-10-29 合并把
`exercise-heat-adaptation` 并进 `sweat-heat-adaptation-plan` 时，步骤与引文都带过来了，
`sick: skip` 却没跟过来 —— 结果「生病」模式在全产品里一张卡都没有，选了等于没选。
**合并时除了步骤/剂量/引文/禁忌，还要看 `variants` 与 `segments`**。

**为什么必须支持 `segments` 而不是拆成三张卡**：原文说「没有一个动作适合所有人」。
拆成三张卡，用户会在今日清单里同时看到三条踮脚/跳跃/深蹲，却不知道该点哪个；
合成一张卡 + 按年龄改写动作与剂量，才是原文的意思。

**人群标签（`when`）**：`when` 是标签列表，AND 语义 —— 用户的标签必须全部覆盖。

| 标签 | 含义 |
| --- | --- |
| `age:child` / `age:adult` / `age:senior` | 内置年龄档，设置里选一次，**默认「成年人（未满 70 岁）」** |
| `fall-risk` | 易跌倒 |
| `knee-pain` | 膝盖不适 |
| `pregnant` | 孕期 |
| `menstruating` | 经期 |

**年龄档必须有默认值，且默认是成人。** 原文的分档是按人群分的（骨密度运动：未成年人跳跃 /
成人深蹲 / 70 岁以上防跌倒），没有年龄档就等于**成人那一档永远命中不了** —— 用户看到的是默认
动作（踮脚）而不是原文给成人的那一版（深蹲一类的力量训练）。
所以 `app/src/domain/conditions.ts` 的 `normalizeTags` 会把缺失的年龄档补成 `age:adult`，
年龄档同时只能选一个（`toggleTag`）。

白名单在 `content/src/rules/index.ts` 的 `KNOWN_TAGS`。**为什么要白名单**：标签写错（比如写成
`age:70plus`）不会有任何症状 —— 只是那一档永远匹配不上，用户永远看不到那条建议。
白名单把「这个标签根本不存在」变成一条明确的错误。

### 5.1c 时段（`slot`）的判据

`slot` 决定两件事：App 什么时候推荐这张卡，以及卡片行左边那个标签写什么。
它是**策展**，但依据在快照里，不在起草模型的脑子里 —— 所以判据只能从原文出。

**只有原文明确说了这一段做，才填具体时段**：

| 原文的说法 | slot |
| --- | --- |
| 早晨 / 早上 / 清晨 / 晨光 / 起床后 / 上午 / 早餐 | `morning` |
| 午后 / 下午 / 中午 / 白天 / 日间 | `daytime` |
| 睡前 / 就寝前 / 晚上 / 夜里 / 夜间 / 傍晚 / 过夜 | `evening` |
| 「早晚各一次」「每天」「饭后」「每餐」「洗澡时」「通勤」「随时」，或**根本没提时间** | `anytime` |

三条容易搞错的地方：

- **「早晚各一次」是 `anytime`，不是某一档** —— 标任何一段都会漏掉另一段。
  手册的每日清单里那一大串（清洁、眼睛、保湿、拉伸）都属于这一类。
- **食谱、吃法、量法多半是 `anytime`** —— 什么时候做由人定。
  上一轮 25 张卡就是在这里错的：食谱被标成「日间」、早晚各做的训练被标成「早晨」。
- **标宽比标窄好**：标窄了 App 会在原文没说的时段推它。
- **2026-10-24 的时段复查**：只改了一张 —— 防晒霜的「打圈涂两遍」从 `morning` 改回
  `anytime`（原文给的是涂法，不是只在早上做）。它仍在默认清单里，注释写「出门前」。
  其余查出来的差异逐张看过，保留原判（晨光、早餐蛋白、洗脸、洗鼻、补涂、百会、内关
  都有原文的时段依据；「入睡」「夜间」出现在禁忌或提示里的卡不算动作时间）。

**怎么查**：`npm run content:slot-check`（`content slot-check`）逐篇出一张表 ——
每张卡的现状、建议、以及**原文里带时间线索的那几句原话**。判断留给人，机器只负责把证据摆齐。
报告在 `content/slot-report.md`（不入库）。

**改 `slot` 要重签**：`slot` 在卡片指纹里（`content/src/cards/fingerprint.ts` 只排除 `review` 与 `status`），
改了就是「卡被改过」，R12 立刻报出来。重签走 `content review --list <清单> --by <名字> --resign`。
清单长什么样见 `content/slot-resign.md`（不入库）。

**R16** 查的是**未签字的草稿卡**：标了具体时段、但原文里找不到那个时段的说法 → warning。
已签字的卡不查 —— 那时段的判断是人的，R12 已经守着改动的路径。

### 5.1d 卡名（`name`）与「一套做法 = 一张卡」

**卡名是内容层策展的，App 不自己编。** 平时用「原文小节名」当名字（那是手册作者给动作起的名字），
但小节名有时是**文章的骨架**，不是动作的名字：

| 小节名 | 在文章里 | 在今天的清单里该是什么 |
| --- | --- | --- |
| 「涂法一：打圈涂（クルクル塗り）」 | 一套三步做法里的第一步 | 整套做法一个名字：「涂防晒霜」 |
| 「为什么偏偏是胰腺」 | 解释 | 一个短话题：「胰腺的位置与作用」 |
| 「该什么时候补涂」 | 小标题 | 「补涂防晒霜」 |
| 「方法一：运动」 | 两个可选办法之一 | 「在略热环境运动」 |

所以卡片有了一个可选字段 **`name`**（≤16 字，屏上那一行放得下）：

- **有 `name` 就用它**，没有才用小节名；`name` 写错是内容的问题，R12 照常报（它在指纹里）。
- **同名相撞要回落**：两张卡显式写了同一个 `name`，屏上会并排两行一样的名字 ——
  这时回落到「这张卡在做什么」的首句（`app/src/domain/lines.ts` 的 `displayNames`，
  撞车判定按**最终显示的那个名字**算，不只是小节名）。
- **名字是动作，不是标题**：动作卡给动作名（「涂防晒霜」「控制抓挠」），
  疾病类卡给短话题名（「胰腺的位置与作用」）—— 它只出现在手册里，不可勾选。

**名字要是一个完整的话：主体 + 动作 + 对象 + 目的（目的不明显时才写）。**
清单那一行只有名字，没有上下文 —— 名字不完整，看的人就得自己去猜：

| 不完整 | 缺了什么 | 完整 |
| --- | --- | --- |
| 「什么是 3T 涂抹法？」 | 是什么、涂什么、干什么 | 「身体涂保湿剂：3T 涂法」 |
| 「睡眠期间，身体在拆你的肌肉」 | 这是个「为什么」，不是动作 | 「早餐吃够 20g 蛋白质」 |
| 「改用笔握法或端握法轻轻刷」 | 没说是拿什么刷 | 「轻握牙刷轻轻刷」 |
| 「中午百会集中力提升」 | 是个状态，不是动作 | 「中午按百会穴提集中力」 |
| 「专家推荐的补救办法：抱枕」 | 谁用、为什么 | 「打鼾的人抱枕侧睡」 |

**默认清单那 16 张尤其要完整** —— 它们是用户每天第一眼看到的东西，
每张都要能独立读懂（相关方一起说清：谁、对谁、做什么、为了什么）。

**另一条规矩：一套做法是一张卡。** 原文说「这套做法是三步：① 打圈涂 ② 涂两遍 ③ 2～3 小时补涂」，
那是一件事，拆成三张卡，清单里就出现三行半截的做法。
**按小节拆卡是抽取时最容易犯的错**（防晒那篇就是这么错的：6 张卡挤进早晨那一屏）。
判断依据是原文自己怎么说那套做法，不是有几个小节。

**背景小节不要单独成卡**：解释「为什么」的段落进 `ignore.sections`（写明理由），
或它的内容被引文引到动作卡里（R9 看引文落在哪）。

### 5.1e 手册正文：按 markdown 渲染

**手册是给人读的东西，格式就是内容的一部分。** 以前构建产物里放的是**纯文本**
（`sections[].text`），结果 114 篇里 47 篇的表格变成一堆挤在一起的竖线、
27 篇的图只剩图注、加粗也没了。现在产物里放的是**原文切片**（`sections[].md`），
App 用 marked 渲染（`app/src/domain/markdown.ts`）。

| | 纯文本（旧） | markdown（现在） |
| --- | --- | --- |
| 表格 | 竖线连成一行 | `<table>`，宽表横向滚 |
| 图片 | 挪到小节末尾的图廊 | 留在原文的位置 |
| 列表 | 挤成连续的短句 | 有序/无序、嵌套都对 |
| 加粗 | 记号被删掉， emphasis 丢了 | `<strong>` |

两处**快照自创的记号**要单独处理（博客那边也是这么处理的）：

- `^[[「腹痛」のトリセツ](https://…)]`（215 处）：脚注记号 → 小字出处链接
  （`app/src/domain/markdown.ts` 的 `preprocessFootnotes`）。
- `> [!IMPORTANT]`（36 篇）：提示框 → 带标签的块（`lg-callout`）。

**还有一处 CommonMark 的坑：`**粗体**` 挨着全角标点时不成立。**
`里的**「鳄鱼姿势」**` 的开标记前面是「的」、后面是全角括号「「」，
按 flank 规则不算 left-flanking，于是强调不成立、星号原样留在屏幕上
（实测 52 篇、238 处；marked 与 markdown-it 一致）。
手册里的 `**` 只有「加粗」一个意思，所以 App 自己认（`preprocessBold`）——
宁可渲染得比源渲染器更宽，也不能让星号露在正文里。

**纯文本只留给检索用**（`mdToPlain` 剥一遍再匹配），
产物里不再放第二份 —— 两份都带着会让 manual.json 白胖一倍。

### 5.1f 近似值（`approximate`）：不许把「约」说成定值

原文写「来回轻柔地洗**约** 5 次」，屏上写「5 次」—— 这是把近似说成定值，
在剂量这种地方是要出事的（实测 39 张卡、56 行剂量这样，其中一张是服药周期）。
**2026-10-28 已全部补齐**（56 行标上 `approximate: true` 并重签，`content approx-check` 现在是 0 行）。

**App 判不出来**：它手里只有剂量行与那句提醒，而提醒与剂量引文往往不是同一句话
（实测 56 处里只有 7 处能从提醒里看出那个「约」）。所以这件事只能由内容层记下来：

```yaml
dose:
  - { value: 5, unit: 次, what: "来回轻洗", quote: "来回轻柔地洗约 5 次", approximate: true }
```

标了 `approximate` 的剂量行，App 渲染成「约 5 次」（收起态与展开态的用法用量表都一样）。

- **R17 守着这个标志**：标了却在引文里找不到贴着那个数的近似词 → error。
  「左右各 5 次」的「左右」是「两边」，不算近似（判定在
  `content/src/source/normalize.ts` 的 `approximationAttached`）。
- **待办用命令列**：`npm run content:approx-check` 把「原文写了约、卡上没标」的
  剂量行列成 `content/approx-report.md`（按篇排，每行给出位置、屏上现在显示什么、
  原文引文、以及改完要重签的命令）。
  **这个命令只列不改** —— 改卡要重签（R12），签字是人的活。
- **不要在 App 里猜**：哪个数是近似由内容层说，App 不许自己判断（判错就是编数，D7）。

### 5.1g 合并（`formerIds`）：改 id 不等于丢历史

**§5.1d 那条「一套做法是一张卡」是硬规矩**，但实测有 68 组「同一原文小节抽出多张卡」
（涉及 192 张卡），其中一部分不是「一套做法拆多步」，而是**同一件事抽了两次**
（审阅报告里早有 14 条「多半该合并」，只是没人动它）。

合并要换 id —— 而用户的盖章记录、日常清单里存的就是 id。
所以每张卡有一个可选字段 **`formerIds`**（这张卡用过的旧 id）：

```yaml
- id: corn-storage
  formerIds: [keep-corn-sweet-cold, corn-after-purchase]   # 这两张并进来了
  status: reviewed
  ...
```

- **schema 里有**（`schema/cards.schema.json`），构建时带进 `cards.json`。
- **App 侧认领**：`app/src/domain/former.ts`（纯函数：建表、解链、迁移 id 列表与映射表）、
  `app/src/data/migrate.ts`（把用户数据里的旧 id 换成新 id）。
  盖章记录、日常清单、频率覆盖、「今天不做」都会换 —— **合并不丢历史**。
- **迁移不刷新 `updatedAt`**：那是机械迁移，不是用户改了什么。
- **清单要顺带去重**：两张卡并成一张，清单里会出现两个同一个 id。
- **别只搬步骤与引文**（2026-10-30 踩过）：合并还要带上 `variants`（忙档/出差/生病版）
  与 `segments`（人群分档）。漏了它们，合并后的卡看着完整，某个模式却悄悄失效了 ——
  `exercise-heat-adaptation` 的 `sick: skip` 就是这么丢的（见 §5.1b）。

### 5.1h 步级时长补录：机器给候选，人做裁定

**2026-10-31**：步级时长刚加时只补了 4 张卡。全量一查，
**128 张卡、202 步**原文写明了「这一步做多久」，其余 1800 多步原文没给。

补录分两半 —— **机器认得出，人定得准**：

- **`content/src/step-duration.ts`**（纯逻辑）：从步骤文本与引文里认时长。
  判据是「**这一步本身**持续多久」，要排除五类：
  整组的量（整套 90 秒）、频次（每天 50 次）、什么时候做（睡前 1-2 小时）、
  症状描述（走了 5 分钟就痛）、效果持续时长（防晒霜能撑 2～3 小时）。
  自查表 / 评分表这类卡整体排除 —— 它们的步骤是「问一句」，不计时。
- **`content/src/step-duration-verdicts.ts`**（人工裁定）：机器判不准的两类
  由人定，**每条带理由**：
  - 一句里两个时长（抬起保持 10 秒 / 放下休息 3 秒 —— 这一步是 10 还是 13？）
  - 该不该有时长（速走 1 分钟 = 半格是**换算**；衰退线 25 秒是**参考值**）。
  清单里也记了**明确排除**的步与理由 —— 别过一阵又把它们捡回来。
- **`npm run content:step-duration`**：默认只列不改；`--apply` 写盘；
  `--overwrite` 改裁定后重写已有的；`--card <id>` 只看一张卡。
  **写完要重签**（R12 的指纹失效了）。

**为什么不让机器一把写完**：把「60 秒」误当成「评分 4 分」写进卡里，
屏上就摆一个假读数；而 R1/R2 拦不住这种错（引文是逐字的，秒数也换算得通）。
机器负责「找出来」，人负责「哪个算数」。

**范围值取下限**（「保持 30 秒到 1 分钟」→ 30 秒）：计时器宁可早提醒，
让人自己判断，不替原文选上限。**分支情况不加**（「西兰花 2 分钟 / 大白菜 2 分半」）。

### 5.2 校验规则

所有 `quote` 字段类型为 `string | string[]`。

| # | 规则 | 级别 |
| --- | --- | --- |
| R1 | 每个 `quote`（数组则每一句）是快照逐字子串（仅归一化空白与全半角标点）。**三档变体（忙 / 出差 / 生病）都要查** —— 只查一档的话，别的变体里的引文就没人管了 | error |
| R2 | **数字一致**：卡片任一自由文本字段（`remind`、`dose`、`effect.text`、`steps.text`、`replace.text`）里出现的每个数字，都必须出现在该字段自己的 `quote` 中（数组则任意一句即可）；做不到就改用 `derived`。比较前统一数字写法：中文数字、全角数字、范围（5～6 / 5-6）、单位换算不做。三档变体的 `replace.text` 同样查。**`duration.sec`（卡级与步级）也要查**（2026-10-31 加）：秒数要在自己的引文里找得到对应的数，换算过也算（「约 3 分钟」→ 180 秒、「1 分半」→ 90 秒） | error |
| R3 | `dose` / `remind` 出现模糊词（适量、适度、多、少许、尽量…） | error |
| R4 | `image` URL 存在于源文件，且在 `media.lock` 中有本地副本 | error |
| R5 | `variants.include` 引用的步骤 id 都存在；每个 variant 恰好是 include / replace / skip 之一 | error |
| R6 | `duration.basis=derived` 缺 `formula`；`basis=quote` 缺 `quote`（卡级与**步级** `steps[].duration` 同样管） | error |
| R7 | **忙档预算**：总时长 > 300 秒，或有卡耗时为 `unknown`，且 `busy-budget.yaml` 中没有与当前状态一致的确认记录 | error |
| R8 | `source.anchor` 在快照中存在 | error |
| R9 | 源文件中的小节 / 图片既未被引用也不在 `ignore` 中 | `complete`：error；`partial`：小节报 warning，图片只在报告中计数，不逐条报 |
| R10 | `kind: condition` 的卡含 `slot` / `variants` / 勾选类字段 | error |
| R12 | `status: reviewed` 但无签字，或签字 `hash` 与当前卡片内容不符 | error（构建时剔除该卡） |
| R13 | 快照文件 sha256 与 `SOURCE.lock` 不符，且 `ERRATA.md` 无对应记录；快照里有 `SOURCE.lock` 没登记的文件（重新导入留下的旧文章）；或 `media.lock` 里的图片副本缺失 / 字节不符 | error |
| R14 | 分档的 `id` 在卡内重复；`when` 为空；`when` 里出现白名单外的人群标签 | error |
| R15 | 默认清单（`content/default-routine.yaml`）里的卡不存在、还没签字、或重复 | error（见 `content/src/default-routine.ts`） |
| R16 | **时段要有原文依据**：未签字的草稿卡标了具体时段，但原文里找不到那个时段的说法 | warning（见 §5.1c） |
| R17 | **标了 `approximate` 就得有着落**：剂量行标了 `approximate`（屏上会显示「约」），但引文里找不到贴着那个数的近似词 | error（见 §5.1f） |
| R11 | `stop` 级禁忌在收起态未显示 | error（UI 级，见下） |

**规则分布**：R1–R6、R8–R10、R14、R16、R17 在 `content/src/rules/index.ts`；R7、R12 在
`content/src/budget.ts` 与 `content/src/review.ts`；R13 在 `content/src/source/errata.ts`；
R15 在 `content/src/default-routine.ts`（仓库级：默认清单里的卡都在、都已签字）；
R11 是 UI 规则 —— 它问的是「收起态的输出里有没有 stop 级禁忌」，
所以由 `app/test/ui/card.test.tsx` 的组件渲染测试守住（不是 e2e，也不需要浏览器）。
`npm test` 与 `npm run content:check` 都会跑它们。

**R4 与 R13 的分工**：卡片引用的图片「在不在 `media.lock`」由 R4 报（那张卡自己负责）；
R13 管的是仓库级完整性 —— 快照文件对不对得上 `SOURCE.lock`、图片副本还在不在、字节有没有被换过。
同一个问题只报一次。

已删除旧规则「图片必须在 anchor 段落范围内」：位置不代表归属，会误报。

R1 与 R2 的分工：R1 保证**引文**没被改写（改通顺后的句子不是原文子串，会被 R1 拦下）；
R2 保证**卡片自己的文字**没有偏离引文——这才是 LLM 起草最容易失真的地方：引文抄对了，`text` 里却写成了另一个数。
**R2 还查剂量里的数值本身**（`dose[].value` / `valueMax`）：以前只查 `what` 里的数字，
`value` 写错（32 写成 33）没人拦。已签字的卡错了是 error（错在屏上），草稿是 warning（等人审）。

**具体内容不许改。** 三条规矩，都是从用户那句「你直接用原文就就好了。具体内容不该改」来的：

- **事实字段的文字用原文的话。** 步骤、禁忌、提示、见效都直接抄原文那一句 —— 不改写。
  当时实测 2055 条步骤里 **1786 条（87%）被改写过**，而且常常改丢东西：原文
  「在心里反复默念「心情正悠然平静、慢慢安定下来」」被改成「默念让心情平静的句子」——
  把原话换成了描述。**已按这条改完** ✓（改掉的是：步骤 1801 条、禁忌 362 条、提示 131 条、见效 132 条）。
  只有 `remind`（收起态那行「做什么」）与 dose.what（这一行的名目）例外：
  前者要短、后者本来就该短。
- **范围是一条，不拆成「下限 / 上限」两条。** 原文写「用 32 到 34℃ 的温凉水冲洗脸部」，
  就写 `value: 32, valueMax: 34` 一条（App 渲染成「32～34 ℃」）。拆成两条就成了卡片自己加的界说，
  而且两条引的是同一句话 —— 屏上看着像两件事。当时实测 557 张卡里 104 条剂量用了这个套路（52 张卡）。
- **`what` 用原文的话**，别自己造词（原文「温凉水冲洗脸部」≠ 卡片「冲洗水温下限」）。
  原文写「早晚各一次」就别换算成「2 次」，写「每天都做」就别写「1 次/天」——
  需要换算的写 `derived: { formula }`（D7），界面上标「推算」。
  **当时全量 557 张卡里 104 条剂量用了「上下限」那个套路（52 张卡），已按上面两条改完** ✓

R9 判断「这个小节被抽过没有」时，**既看 `source.anchor`，也看引文落在哪**。
只认 anchor 会把「引文其实来自别的小节」误判成抽漏 —— 实测抽 `bone.md` 时，
提醒语引自文首小节，而 anchor 指向动作小节，文首小节会被误报。

### 5.3 忙档预算

`content/busy-budget.yaml` 记录忙档成员和人工确认。「五分钟」是手册作者的估算，不是物理上限，
所以超时和不可知走**同一个机制**：不拦截，但必须有人签字写明理由。

```yaml
members: [eyelid-cleaning, moisturize-3t, nasal-rinse]
acknowledged:
  - snapshot: { total_sec: null, unknown: [moisturize-3t] }   # 确认时的状态
    by: benson
    date: 2026-10-19
    note: "3T 保湿耗时取决于涂抹面积，原文未给；仍留忙档"
```

`snapshot` 与当前计算结果不一致（成员、总时长、unknown 列表任一变化）时，旧确认失效，R7 重新报错。

界面：耗时全可知时显示「约 X 分钟」；含推算标「推算」；超过 5 分钟如实显示；有 unknown 时不显示总时长。

### 5.4 疾病类内容（`kind: condition`）

- 只出现在「手册」浏览中，不进今日清单，不可勾选，不计入累计天数。
- 页首固定提示：「本页是疾病知识，不是治疗方案；调整饮食、用药前请咨询医生。」
- 提示分级与动作禁忌分开 —— 提示落在卡片的 `notices` 字段，禁忌落在 `cautions`：
  - `seek-care`：出现某症状应就医（醒目，收起态可见）
  - `with-doctor`：需在医生指导下进行的调整（如饮食、运动强度）
  - `info`：一般知识
- 疾病类卡片一律人工审阅，不接受 LLM 直出。

---

## 6. 界面结构

三个界面各干一件事，别混：**今天 = 做，手册 = 查，设置 = 配。**

**今天只放自己挑的。** 这一屏回答的是「现在做什么」，所以它列的是 `myRoutine`（用户显式加入的那几张），
不是所有 practice 卡。判据是量出来的：全量 491 张卡里 89 张是疾病知识、402 张可做，
其中 387 张是 `anytime` 或没标时段；按「所有卡都进今天」排，早/日间/晚各约 392 / 390 / 394 张，
仍是几十屏 —— 那不是清单，是目录。
其余动作走发现层：每天给三张 + 手册里每篇标出「N 个动作能照着做」。
（为什么是三张不是一张：候选池 386 张，一天一张的话一个月才看过约 7%。）
**386 与 387 是两件事，别当成一个数**：386 = `dailyCandidates` 算出来的候选池
（402 张可做 − 默认清单那 16 张）；387 = 可做卡里「随时或没标时段」的那部分。
两个数都对，但量的不是一回事。

**当前首启是什么样**（2026-10-25 实测，干净 profile）：

| 屏幕 | 数量 |
| --- | --- |
| 今天 · 早晨 / 日间 / 晚间 | 各 10 张（默认 16 张里属于该段的 + 随时） |
| 发现层轮换池 | 386 张 |
| 手册里标了「N 个动作能照着做」的篇数 | 88 篇 / 113 篇可翻（最多的一篇 10 个） |
| 手册页顶部的「常用」小片 | 16 个（= 默认清单那 16 张） |

**手册页顶部有一个「常用」入口**（2026-10-29 加，作者定的位置）：
一排小片，摆的是**默认清单那 16 张**（内容层策展的「每天固定做的几件事」——
洗脸、刷牙、防晒、晨光……），点一下就加进「我的日常」；已经在日常里的摆着但不让再点。
**为什么不另做一份「常用清单」**：默认清单本来就是手册的每日清单，两份清单会分叉。
**为什么不放在今天页**：今天的次序是用户自己排的（次序即显示次序），加分组会打乱它。

**「今天」那一屏仍然只有 9～10 张** —— 这是设计：它是「你今天要做的」，不是目录。
大量推荐走另外两层（发现层每天给三张、手册里 88 篇能照着做）。
教训记在这：数量瓶颈从来不在界面，在**签字进度**（当时 557 张里只签了 25 张，
首屏 9 张、发现池 8 张、手册只有 34 篇有动作）。

**但「自己挑」不该是进入 App 的前置步骤。** 第一次打开时 App 自己把**《每天固定做的几件事》**
那几张放进 `myRoutine` —— 清单在内容层（`content/default-routine.yaml` → `cards.json` 的
`defaultRoutine`），次序即显示次序，用户随时可移出、可自己加、可自己重排；顶部那颗「放回默认」把它恢复回来。
理由是量出来的：刚起步时**已签字的 12 张卡里一张日间的都没有**，只按时段挑的话 12:00–18:00 首启仍然是空的
——「初次进去一个动作都没有」「三个时间段经常只有一个推荐」。
所以默认清单除了手册那两节，还按时段补了几张（补的都审阅签字过）：
早晨 3 · 日间 3 · 晚间 3 · 随时 7 —— 16 张，每一档都有货。
（睑缘清洗在「随时」那 7 张里 —— 它的 slot 就是 anytime，见下面那一段。）
**默认次序按时间排**（早晨 → 日间 → 晚间 → 随时，同一时段内按手册清单里的次序）：
刷牙排在「随时」那几张的最前面 —— 手册的每日清单自己写着「顺序不重要，每天做就行」，
而「晚间清洁」那一节也把刷牙算了进去，早晚都做，就不锁死在早晨；
洗脸留在早晨，因为原文专门有一节讲「早上不用洗面奶」的风险。
**睑缘清洗是例外**：它的 slot 是 anytime（早晚各一次），但手册的「时间紧的日子」把它排在
第 2 位（紧跟晨光），所以次序跟着那份清单走 —— 放在洗脸前面，
免得早晨看它被甩到「随时」那组末尾（离晨光太远）。
**抱枕侧睡不在默认清单里**：它只对打鼾的人和孕妇有意义，不是所有人都该做 ——
默认清单只放普遍适用的动作（2026-10-24 移出）。
**「没设置过」与「用户自己清空过」要分得开**：前者给默认清单，后者尊重用户，不再自动塞回去
（`initialRoutine`：`undefined` → 默认清单，`[]` → 原样）。
**「随时」那一档也在默认清单里**（早晚都做、时间不定的动作，每天都在）。
`starterPack` 现在只是**兜底**：默认清单为空时才用得上，它自己每段封顶 3 张 ——
随时卡一次性铺开就是 54 屏的目录问题（见 §6 与 commit `40ba972`）。

```
今天（主屏）
├── 页边（宽屏）／顶部（窄屏）：日期与时段 · 早/日间/晚 · 条件一行 · 几个动作·盖了几印·累计几天＋14 格印迹
│       首启时多一行说明：清单是 App 放的、怎么改、闹钟在设置里（用户一动手就撤掉）
│       新用户还没选过年龄段时，再多一块「先选年龄段」（可跳过，默认成人）
├── 条件：模式（正常 / 很忙 / 出差 / 生病）+ 我的情况（年龄段 + 自选状态）
│         → 收成一行，点开才展开；设置页里也有一份，改的是同一份
├── 手帖清单：只列 myRoutine 里、属于当前时段的卡（随时的一直在）
│   ├── 收起（一行三行契约）：名（内容层给的动作名，没有就用原文小节名）/ 做什么 / 剂量 ＋ stop 禁忌 ＋ 分档标记
│   │       「做什么」与「名」说的是同一句话时**这一行整个不显示** —— 一屏里同一句话说两遍
│   │       看着像出了错（实测 491 张里有 14 张这样：4 张一字不差，有 3 张首启就能看见）
│   │       名在「一个小节拆出多张卡」或「两张卡同名」时会撞车（刷牙/牙线、三个穴位…）——
│   │       这时回落到**这张卡在做什么**的首句（还是原文的话），见 domain/lines.ts 的 displayNames
│   └── 展开（一次一张）：用法用量表（剂量·做什么·时段·频率·提醒·耗时·计时·见效）→ 按你的情况 → 提示 → 怎么做 → 注意 → 出自
│       「频率」是这张卡多久做一次（每天 / 每周 / 每月）；每周 / 每月做完会收进下方「本周期已完成」
│       「提醒」那一行是这张卡自己的闹钟：点「设提醒」挑模式（每天 / 每周 / 隔几天 / 就一次）与时刻
│       「计时」那一行是**这张卡旁边的计时器**（2026-10-30 加，作者定的位置）：
│       点一下开始数着，到点提醒一次；形态由这张卡自己的时长决定，用户不用选 ——
│       **知道时长就倒计时**（数着原文给的那个数走）、**不知道就正计时**（从零往上数）。
│       数据在 `duration.sec`（491 张里 104 张有：45 条原文引用、45 条推算、14 条未知）。
│       **为什么不给用户选**：两件事不是一回事 —— 倒计时回答「到点了没有」，
│       正计时回答「我做了多久」；时长未知的卡（14 张）倒计时不出来，那不是没数，
│       是**不知道该数到几**。忙档只做几步、时长未知，所以忙档下摆的是正计时 ——
│       拿原卡的时长去倒，倒的是「原卡」的数，不是「忙档」这一次的。
│       **一小时以上不倒计时**（那是「持续 2 周」那类疗程，倒计时没有意义）→ 走正计时。
│       推算来的时长照样倒计时，但归零时说的是「按推算的时长到了」，不让它冒充原文的数（D7）。
│       **状态不存**（作者定的）：切走就没了 —— 计时是「此刻在做这一件」的临时状态，
│       存进库里还要处理「同步到对面设备上的一个正在跑的秒表」这种没人想遇到的事。
│       卡片的话与引文逐字相同时不摆原文，改留一个「原文」链接跳到那一篇；长卡默认只铺前 6 步
│       「怎么做」那节里，步骤各自带时长时摆**分步计时器**（2026-10-30 加）：
│       这一步归零就跳下一步自动接着数，读数是**这一步**的（每个动作 30 秒），
│       不是卡级那个总时长（血管拉伸一轮 7 分钟 = 5 个动作 × 2 回 + 4 次休息）。
│       **每步的时长从原文抽**（`steps[].duration`，带引文）；没写的步骤不参与计时，
│       它不是「0 秒」是**不知道这一步多久**（D7）。休息那一步也不计时 ——
│       原文的休息是「动作之间」的，不是序列里的第 6 个动作，放到末尾会走反。
│       **一小时以上那几步走正计时**（跟卡级同一条线）：步级时长里也有
│       「冷藏 5 小时」这类 —— 那是**等待**，不是「做一件事要多久」。
│       展开态底部有「今天不做」（只跳过当天，明天回来）与「移出日常」（永久移出，明天也不再出现）；
│       这张卡若有提醒，永久移出时会就地选「一起删 / 只移卡 / 取消」；「今天不做」只让当天不响
│       用户自己加的习惯：页脚写「你自己加的」，那两颗键换成「改」「删掉」
│   展开着的卡怎么收起：点卡外面（空白、导航、另一张卡）就收起；点那颗印 → 盖上印 + 一起收起；
│       Esc 收起并把焦点还给卡名那颗键。**点卡里面的东西不收起** —— 正在读剂量、点步骤图时卡就没了，
│       那比不收更糟。「这一张卡」的范围靠 data-card-unit 划（末尾那排键画在 article 之外，
│       点「移出日常」时那张确认行不该跟着卡一起被收掉）
├── 调顺序：条件那一行下面那颗「调顺序」→ 全部日常里的卡按次序排开，每条有 ↑ ↓ 移出日常
│       次序就存在 myRoutine 数组里（`moveInRoutine`），「今天」按它摆，不按 cards.json 的顺序
├── 加自己的习惯：条件那一行下面第三颗键 → 侧栏里展开一张表单（叫什么 / 做什么 / 什么时候做）
│       自定义习惯在数据层就是一张卡，所以盖章、累计天数、提醒、次序全都白得
├── 今天不做：当天跳过的卡收在这里，可撤销；第二天自动回清单
├── 本周期已完成：每周 / 每月做完的卡收在这里，可撤销
└── 发现：今天轮到的一张（可加入我的日常 / 换一个）＋「手册里还有 N 个动作没进日常」
手册：113 篇（快照根下的 README 是目录页，不算一篇）· 按四目录分类 · 搜索（含疾病信息）· 每篇标出能照着做的动作数
　　　文章里 2 个以上动作没进日常时，可「把这一篇的 N 个动作一起加入」；正文内链同页打开、返回回上一篇
　　　正文按 **markdown 渲染**（表格、图片、列表、加粗都在原位，见 §5.1e）
设置：条件 · 提醒（早/晚两条 + 卡上那些）· 导出日历 · 导出 / 导入数据 · 安装提示
　　　· 源码入口（GitHub 标记 +「源码在 GitHub」；官方 octicon，MIT；
　　　　target=_blank —— 浏览器开新标签、桌面端由 setWindowOpenHandler 交系统浏览器）
```

**宽屏的导航是吸顶的一条，三颗键靠左**：原来浮在正文列上方、还会随页面滚走 ——
今天页十几张卡、手册一整篇，滚下去就找不回「手册 / 设置」了；现在贴着窗口顶，
内容从它下面滚过去，导航一直在。四种排法实测比较过（居中 / 左对齐 / 贴正文列 /
居中药丸），左对齐最顺 —— 眼睛本来就从左上角进。窄屏还是底部那颗悬浮药丸。

**三种形态都摆同一排导航**（今天 / 手册 / 设置），包括桌面窗口 ——
换页不靠原生菜单。菜单藏得深、容易被当成「另一个东西」，
而桌面窗口一度把导航藏了、只留菜单能换页，结果从手册回主页就没有一条看得见的路。
原生菜单（`desktop/lib/menu.mjs`）只留桌面本就该有的那些：退出、重新加载、开发者工具、缩放。

**换页跟着地址栏走**（`#today` / `#manual` / `#settings`）：
页面自己认自己的 hash（`app/src/main.tsx` 的 `tabFromHash`），
网页因此能用链接直接进某一页，前进后退也能换页。

**为什么条件要收成一行**：模式与人群分档是「在什么条件下做」，不是「今天要做的事」。
它们摊在主屏上会让人以为今天多出好几件事，而它们恰恰只该偶尔改。
**为什么总览要提到第一眼**：项目最在意的是「断签不清零」——累计天数原来只藏在每张卡的小字里，
看不见就等于没有。

**分档换动作时，默认的剂量与步骤不能跟着走。** 踮脚换成防跌倒之后，
「每天 50 次」是踮脚的量，挂在防跌倒上是错的 —— 用户会以为防跌倒也是 50 次。
分档没给剂量就显示空，步骤没给就提示见原文。这条在
`app/src/domain/segments.ts` 的 `matchSegments` 里实现，有单元测试盯着。

**年龄档只能选一个**：同时是「未成年人」和「70 岁以上」没有意义。规则在
`app/src/domain/conditions.ts` 的 `toggleTag` 里，状态标签（易跌倒 / 孕期……）可以多选。

**卡里不再出现「原文」，来源只有页脚一个链接。**
原来每条事实后面都挂着一颗「…的原文」的键（点开看逐字引文），后来又换成一条条「原文」链接 ——
现在两样都没了：卡片上的事实**已经是原文的话**（步骤、禁忌、提示、见效全部照抄原文，
见 §5.2「具体内容不许改」），再摆一份引文只是把同一句念两遍。
**来源（出自〈哪一篇〉）放在展开态的页脚**，跟「收起」并排 —— 卡读完再跳去原文，顺路。

**只管界面，不动内容层**：引文仍然是数据层的事实字段（R1 逐字校验、R2 数字一致），
审阅报告里仍然把「卡片的话」与「引文」并排放着给人看；撤掉的只是屏幕上的那颗键。

**屏幕上的每一句话都得有个期限。** 那条状态提示（`flash`）6 秒后自己走 ——
原来它一直挂在那儿（要等下一条消息顶掉它），首启那三句话就此变成永久的旧话。
首启说明另算：它放在**主栏顶部**（手机上是两屏之外，看不见等于没写），用户一动手就撤掉。
放在主栏而不是侧栏，是因为侧栏只有 232px 宽 —— 两段话在那边会被压成八行。
**小屏（≤380px）上年龄块和这段说明不同时出现**：年龄块还在时先让说明让位，
选完或跳过再出现 —— 两块叠起来会把第一张卡顶出首屏，说明本身一个字不少。
**又窄又矮（≤380px 且 ≤640px 高）时两块各收成一行**：点「选择 / 展开」才铺原文；
否则年龄块、说明和底部导航叠在一起，第一张卡仍然进不了首屏。

**样式层是 Tailwind v4 + 自写的组件层**（`app/src/style.css`）：设计令牌两套（和紙 / 夜紙），
字号六档梯子（11/13/15.5/19/24/30），正文栏 34 个汉字，触控下限 44px。
朱红只做两件事 —— 当前这一件与「今天盖的印」；禁忌用更冷的深红，不再和主色抢同一支红。
**做过的行不铺整块底色**：完成的信号只留右边那颗日期印章；底色在暗色主题下会在行首形成一条硬边。
**剂量数字用墨色**：朱红 `#a82a24` 与禁忌红 `#9e2b1e` 色相几乎一样，数字若也用朱红，
扫一眼会与「不要做」的那行红混在一起 —— 剂量是事实，不是警示。
daisyUI 仍装着做主题令牌机制，但界面上**不再用它的组件类**（`btn` / `badge` / `alert` 都不用），
`classes.test.ts` 的白名单因此清空 —— 防撞名那条判据照旧生效。

**桌面与手机不是两套界面**：同一份组件，靠断点改排布 —— 窄屏一列、导航浮在底部；
宽屏（≥1000px）今天页变成「页边 + 660px 正文栏」两栏，导航变成顶部一条（吸顶），手册列表两列。
正文栏不随窗口变宽：汉字一行 34 字是读得下去的上限，实测桌面拉满时一行 56 字。

**几处是「实测撞出来」的，别凭直觉改回去**（2026-10-27 一轮全页面截图审查）：

- **悬浮导航上面压一段纸色渐隐**：药丸不透明，内容从它下面滚过去会被拦腰切断 ——
  一行禁忌正好落在药丸后面会整段看不见，最容易误读成「没有禁忌」。渐隐让它是「淡出」而不是「被切」。
- **空印章要看得见**：它是今天页唯一的主动作（首启说明专门教人「点右边的方格盖个印」）。
  原来描边用 `--lg-rule`，浅色 1.27:1 / 暗色 1.40:1，几乎隐形 → 改 `--lg-ink-3`（4.3:1 / 5.4:1）。
- **触控下限是 44px，没有例外**：提醒方式与周几的小圆片原来 34px，比项目自己的标准低。
- **自己画清除键**：浏览器原生的搜索清除键是 9×7px 的字形，颜色还不是令牌表里的 —— 关掉它，自绘一颗。
- **条件面板的两排片要有可见的组标题**：「年龄段 · 只能选一个」「我的情况 · 可以多选」。
  原来只有 `aria-label`（读屏分得清，眼睛分不清）。
- **「今天不做」的撤销区：卡名是纯文字，「撤销」单独成键**：全 App 里点头像都是展开那张卡，
  在这里点头像却是撤销跳过 —— 误触就把卡悄悄放回清单。
- **收起态的「做什么」不与「名」重复**（`domain/lines.ts` 的 `redundantWithName`）：
  判据是**新字占比不到两成**（汉字没有词边界，按字算最稳），两种例外不算重复：
  「名」里没有的新数字（那是别处没有的事实）、「名」里没有的程度词
  （「稍微晾干」与「晾干」差的是强度，不是说法）。
  **只判整行，不逐句删** —— 逐句删会把「想提升食材的鲜味和香气时，先冷冻再料理」
  里的动作句删掉、只留下半截话。
  去重要对着**屏上真正显示的那个名**算（显示名可能是父组件回落过的），
  收起态省掉的原文，展开态的「做什么」那一行仍然摆着（D2）。
- **手册搜索也要按卡名找**：卡名是内容层起的策展名，原文里未必有那个词
  （「晨光」在快照正文里一次都没出现，只在目录页）。用户在「今天」页看到它，
  到手册里搜却一篇都搜不到 —— 搜索在自己的词汇表上失灵，用户会认定「搜不准」而不再用。
  索引见 `domain/manual.ts` 的 `buildCardNameIndex`。

## 6.1 用户自己加的习惯

手册里 491 张卡是**别人的**习惯。「我每天冥想 10 分钟」「睡前拉伸 5 分钟」这种只有用户自己知道 ——
所以 App 得给这条路。

**但不给它另造一套界面。** 加完的习惯在数据层就是一张卡（`app/src/domain/custom.ts` 的
`habitToCard`），所以盖章、累计天数、提醒、次序、「已做 N 天」全都白得。
自建一套界面的话，这些每一样都要重做一遍，而且很快就会和内容层的那套不一致。

与内容层的卡有三条不同，说清楚免得以后混淆：

| | 内容层的卡 | 用户自己加的 |
| --- | --- | --- |
| 出处 | 有（屏上「出自〈哪一篇〉」） | 没有（页脚写「你自己加的」） |
| 引文 | 有（R1/R2 逐字校验的对象） | 没有（用户自己写的，不是原文） |
| 时段的依据 | 原文明说（§5.1c） | **用户说的** —— 内容层那条规矩管的是策展，管不到用户自己的习惯 |

- **存哪**：IndexedDB 的 `custom` 表（版本 1 → 2，升级只建新表，老数据不动）。
- **id 前缀 `my-`** 是硬约定：撞上内容层的 id 就分不清「我加的」还是「手册里那张」。
- **不进「发现」**：它是「我的」，不是「可以试试的」（`dailyCandidates` 里排掉）。
- **移出 = 删掉**：自定义习惯只有一处存在（用户的日常里），移出它就等于不要它了 ——
  所以那颗键写「删掉」，是真的删（连库里的那条）。
- **「今天不做」对自定义习惯同样成立**：只跳过当天，不删习惯；第二天照常回来。
- **备份要带走它**：不然「搬家」搬了一半，日常清单里那几条会变成空引用（`Backup` 的 v2）。
- 入口在今天页侧栏：**「加自己的习惯」** → 表单就地展开（触发的地方和表单挨着，
  窄屏时侧栏在上方，展开就在眼前）；卡片展开态里那颗「改」能改回来。

## 6.2 性能：先量再改

**2026-10-24 性能阶段**（本地 `vite preview`，Chrome，手机 390×844 DPR 3；
Fast 4G = 1.6 Mbps / 150 ms，Slow 4G = 400 kbps / 400 ms，CPU 4×；数字只用于同一环境对比）：

| 指标 | 改前 | 改后 |
| --- | --- | --- |
| 首屏第一张卡（Fast 4G / Slow 4G） | 2.26 s / 6.43 s | **1.53 s / 5.42 s** |
| 首屏 LCP（Fast 4G / Slow 4G） | 2.52 s / 6.65 s | **1.70 s / 5.79 s** |
| CLS | **0.602** | **0.039** |
| 首屏传输（Fast 4G） | 280 KB | **221 KB** |
| `cards.json` | 645,807 B（gzip 188 KB） | **547,306 B（gzip 163 KB）** |
| 初始 JS（gzip） | 63.6 KB | **23.1 KB + 共享运行时 6.7 KB** |
| 手册列表（Fast 4G / Slow 4G） | 5.36 s / 13.1 s | **1.62 s / 5.80 s** |
| 媒体文件 | 2.83 MB | **2.12 MB** |
| SW 预缓存 | 4.59 MB | **3.86 MB** |

做了六件事：

1. **路由级拆包**：Manual（含 marked，17.5 KB gzip）、Settings（5.7 KB）、
   SortPanel（含 dnd-kit，15.0 KB）都按需加载；首屏只留 23.1 KB 应用代码
   再加上 6.7 KB 共享运行时。手册/设置/调顺序第一次点会有一个很短的「加载中…」。
2. **cards.json 预加载**：`index.html` 用
   `<link rel=preload as=fetch crossorigin=anonymous>`，`main.tsx` 的 fetch
   同步用 `credentials:"omit"`。卡片数据从「JS 执行完才发请求」变成与 JS 并行，
   首卡约快 0.4 s。
3. **产物只留 App 读的字段**：`stripQuotes` 再剥 `review`（签字指纹）、`status`、
   卡级 `images`、无模式版本卡的步骤 `id`；`articleKind` 只在疾病卡上保留。
   `cards.json` 少 98 KB（gzip 少 26 KB），事实字段一条没动。
4. **手册先目录、后全文**：`cards.json` 带 `articles` 索引（path/title/kind，
   约 13 KB）；手册列表先用它画，`manual.json` 在「打开文章 / 搜正文」时才取。
   列表不再等 800 KB 全文；代价是第一次搜全文/开文章要等一下，界面上如实写
   「正文还在加载，先按标题找」。
5. **图片按显示尺寸重编码**：build 时最多 1200×960、WebP q82；只改
   `app/public/media` 副本，`content/media` 快照和 `media.lock` 不动（R13 照旧）。
   106 张里 54 张重编码，省 640 KB；`npm run content:build` 默认不跑（开发快），
   `npm run app:build` 自动带 `--optimize-media`。
6. **CLS 收口**：清单没读回来时不再先挂「发现」再被今天的卡片顶下去
   （原来实测 CLS 0.602）；等 `routine.ready` 再一起画，降到 0.039。

**仍然全部预缓存**（2026-10-30 实测）：2.1 MB 图片 + 约 1.3 MB JSON
（卡片 525 KB + 手册全文 811 KB；SW 预缓存 127 项、3.8 MB）
是一次性成本，换来「断网也能翻手册」
（P2 退出条件，§7）；不能为了首屏快几秒破掉。Service Worker 仍等首屏画完再注册。
深链 `#manual` 离线也能先出目录、再读文章（已实测）。

**几条一直有效的规矩**：

- **产物是给机器读的，不缩进。** 2 空格缩进会让 `cards.json` 每次启动白传几百 KB。
- **App 的产物里没有引文。** 引文是内容层的证据，App 一次都不读；
  同一段原文存两遍曾占 `cards.json` 的 40%。
- **篇名跟着卡片走**（`articleTitle`），手册目录索引也跟着 `cards.json` 走 ——
  今天页的「出自〈哪一篇〉」和手册列表都不需要启动时拉整本手册。
- **同一份产物要能在三处跑**：浏览器（可能部署在子路径）、桌面端（`app://bundle/`）、
  手机端（`capacitor://localhost/`）。所以下面几条不能破：
  - `app/vite.config.ts` 的 `base` 是 `"./"`（相对），不是 `"/"`；
  - 产物里的图片路径是**相对**的 `media/xxx.png`，不是 `/media/xxx.png`；
  - `index.html` 里的图标也是相对的；只有 `og:image` 例外 —— 它只认绝对 URL，
    部署时用 `OG_IMAGE_URL` 环境变量给（不给就落成相对路径，桌面/手机不受影响）。

**实测过**：把 `app/dist` 挂在 `/app/` 子路径下，App 起得来、Service Worker 的
scope 就在子路径、断网重载后 13 张卡与 18 张图全在（`base: "/"` 时图片会全部 404）。

**顺带修掉一个真 bug**：首屏有 7 ms 的空态闪烁 —— 卡片到了、日常清单还没从
IndexedDB 读回来，那一下闪的是「你把动作都移出去了」。现在清单没读回来就走「加载中」
（`Today.tsx` 的 `routineReady`）。**空着不等于「被清空了」**，这句话对界面和对人都成立。

## 6.3 功能补齐（2026-10-25）

这一轮把第一次功能评审里留下的五个缺口补上了。它们都不是「再加一个按钮」，
而是把内容/日常的真实单位接进界面：

- **首启先问年龄段（可跳过）**：默认成人只是兜底，不等于用户选过。
  `useConditions` 的 `ageKnown` 只有在存过的标签里真有 `age:*` 时才为 true；
  否则今天页顶部显示一次「先选年龄段」区块。选完或点「先按成年人显示」就写进
  `tags`，不再出现。**手册文章里的动作卡现在也接同一套标签**（`ArticleView`
  传 `userTags`），不会出现「手册里踮脚、加入日常变深蹲」。
- **频率（每天 / 每周 / 每月）**：卡片展开态多一行「频率」。默认从提醒语判断
  （明确写「每月」/「每周」才算，判断不了就是每天，见 `domain/cadence.ts`），
  用户改过的存在设置 `cadence` 里。每周 / 每月的卡本周期做完后从今天列表收进
  「本周期已完成」，可按「撤销」把它放回来；周从周一算，月按自然月。
  **撤销只把该次周期完成降级为 false，不删历史事件**：被撤销的那次完成不再算
  可见的累计天数/印迹，但更早按每日做过的记录仍然保留。备份 v5 会带走这份设置。
- **整套加入**：手册文章里若还有 2 个以上动作没进日常，顶部给
  「把这一篇的 N 个动作一起加入」。它加的是这一篇列出的全部动作（含安全提示 /
  总结卡），用户之后可以逐张移出；不是自动判断「哪些算一套」。加入后的提示条给
  「撤销」，只撤回这一次加入的那些卡。
- **手册内链**：正文里的相对 `.md` 链接（`./knee.md`、`../body-care/acupoints.md#…`）
  在渲染时解析成应用内文章（`data-article`），同页打开。左上返回：有上一篇时
  写「上一篇」并回上一篇，否则写「手册」并回列表。外链仍新开标签页。
- **卡提醒的生命周期**：移出卡时给出「一起删 / 只移卡 / 取消」；调顺序里移出
  也先问，删自定义习惯一起清理；放回默认时被换掉卡上的提醒会随确认文案一起删掉。
  **这条和 `.ics` 的卡片提醒是一对**：不想留的提醒不会被幽灵保留，想留的可以进系统日历。

## 6.4 工具与命令

```bash
npm run content:import -- --blog <blog 路径> [--commit <sha>]   # 导入快照
npm run content:check                                         # 校验 + 覆盖报告
npm run content:build                                         # 生成 cards.json 与 manual.json（不优化图片）
npm run content:build -- --optimize-media                     # 同时按显示尺寸重编码图片（app:build 已带）
npm run content:review <cardId> --by <名字>                    # 签字
npm run content:review --all --by <名字>                       # 批量签字
npm run content:review --list content/signing-list.md --by <名字>  # 签清单里勾上的那些
npm run content:signing-list                                  # 生成待签字清单（按篇排好、带勾选框）
npm run content:slot-check                                   # 逐篇检查时段标注
npm run content:approx-check                                 # 列出「原文写了约、卡上没标」的剂量行（带原文证据）
npm run content:step-duration [--apply] [--overwrite] [--card <id>]  # 步级时长：列候选 / 写盘（写完要重签）
npm run content:draft -- --all [--concurrency 8]              # LLM 起草（只写 draft）
npm run content:audit [--article <文章>] [--no-llm]          # 审阅辅助：挑出该人看的卡
npm run content:repair-quotes                                # 补全 draft 卡漏掉的引文
node scripts/decision-gate.mjs <备份.json>                    # 决策门：两周用得够不够
npm run dev                                                    # 起 PWA（先 build 一次）
npm run app:build                                             # 构建 PWA
npm run acceptance                                             # 浏览器级验收（离线 / .ics / 导入导出 / 提醒生命周期 / 今天不做 / 计时器）
ACCEPTANCE_URL=https://life.newzone.top npm run acceptance:url  # 同一套验收跑在真实部署上（根路径部署）
npm test                                                      # 单元测试
npm run test:desktop                                          # 桌面端纯逻辑的 node --test
npm run typecheck                                             # tsc --noEmit
npm run lint                                                   # markdownlint
npm run lint:workflows                                         # 工作流文件：YAML 解析 + shell 语法 + 两条 GitHub 特有的坑
node scripts/check-desktop-metadata.mjs                       # 桌面端打包元数据（homepage / 作者邮箱，Linux 打包要）
node scripts/release-assets.mjs                               # 校验发布草稿的资产并生成 SHA256SUMS（流水线里跑）
node scripts/release-draft.mjs <目录>                          # 建/找发布草稿并把产物传上去（按 release id 传）
```

**带 `--flag` 的命令在 PowerShell 下要小心**（2026-10-30 实测）：PowerShell 优先解析
`npm` → `npm.ps1`，而老版本 npm 的 `.ps1` 壳子（AppData 下的 npm 11.2.0）会把
`--` 后面那个参数当成 **npm 自己的配置**吃掉 —— `npm run content:review -- --list x.md --by 名字`
在 pwsh 里会报「用法：content review ... --by 名字」（`--by` 没了），
而 `npm run content:build -- --optimize-media` 会**静默不优化图片**（只是没报）。
两种写法都稳：

- `npm -- run content:review -- --list x.md --by 名字`（`--` 前再加一个 `--`）
- 或者直接 `node content/src/cli.ts review --list x.md --by 名字`（不经 npm，最省心）

CI 与 cmd.exe / bash 下 `npm run x -- --flag` 正常，所以上面命令表照旧能用。

**提交信息用英文**（标题与正文都是）。
这是本仓历史里的惯例，不是新规矩：最近 30 条提交里 29 条英文标题，
22 段有正文的提交里 22 段是英文正文。格式照 Conventional Commits：
`type(scope): what changed`，正文写清**改了什么、为什么、验过什么、还开着什么**。
一次提交只做一件事 —— 不同功能域分开提交（内容层 / App / 品牌 / 文档各一条）。

内容管线在 `content/`（Node CLI，无 UI），App 在 `app/`（Preact + Vite + PWA）。
两者之间只隔两个 json：`cards.json`（结构化卡片）与 `manual.json`（手册全文，供「手册」页浏览）。
App 不认识 markdown。

**这两个 json 是给机器读的**：紧凑输出（不缩进）、App 那份不带引文（见 §6.2），
`manual.json` 只在打开文章或搜正文时才取 —— 启动只传 `cards.json`（525 KB），
手册列表先用它自带的 `articles` 索引画出来。

**Node 26**（`package.json` 的 engines 写死 `>=26.0.0`，CI 也用 26）——
版本是写死的，不是 `node-version-file`：那等于把 CI 交给未来的自己。
**Android 构建要 JDK 21**（Capacitor 8 的要求）；Gradle 找不到时在
`~/.gradle/gradle.properties` 里 `org.gradle.java.installations.paths` 指给
Android Studio 自带的 JBR（它就是 21）。

**起草要凭据。** 放在环境变量（`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`）或
`content/llm.local.json`（已 gitignore，只在本机）。两者都没有时命令会列清缺什么并退出非零。
**凭据在一段时间内能用的调用次数有限**：跑到一定篇数后会开始报 `HTTP 401`
（并发越高越早触到 —— 实测并发 4 时十几篇就挂，串行 `--concurrency 1` 能多跑一倍）。
**401 挂掉的篇不算审过**（状态里记成「语义检查失败」），下次 `content audit`
会自动把它们挑出来重跑 ✓ —— 所以分批跑就行，跑不完不亏。
**401 之后的急救**：凭据会过期 —— 换一份新的写进 `content/llm.local.json`，
再 `--resume` 接着跑。
（2026-10-22 实测：凭据一换，94 篇里挂掉的 49 篇立刻能接着审。）
起草也是**可续跑**的：已经写盘的文章会被跳过，没写盘的（自检没过的、401 挂掉的）下次自动重来。

**审阅也是靠它。** `content audit` 走一遍草稿，把「该人看的」挑出来：
机械检查（重复卡、原文禁忌小节没被引用、卡片文字远长于引文、步数过多）
加上语义检查（用模型问「卡片文字是不是引文的忠实转述」—— 这是 R1/R2 查不出的那一类）。

**重复卡有两条判据**（2026-10-29 补）：

- **相似度型**：remind 或步骤的字符二元组 Dice > 0.6（原判据）。
- **子集型**（新）：一张卡的**每一步**都出现在另一张卡里 —— 原样出现算，
  改写过也算（每一步的字八成以上对得上）。
  **原判据抓不到这一类**：子集再像，两边长度也差得远，Dice 上不去。
  实测语料里 5 对真重复有 3 对是这种，审阅一条都没报
  （`exercise-heat-adaptation` ⊂ `sweat-heat-adaptation-plan`、
  `keep-corn-sweet-cold` ≈ `corn-after-purchase`、`super-filter-sauce` ⊂ `super-filter-sauce-noodles` …）。
  **会有误报**：同一套系统的几个选项（三色蛋白卡：黄色主食系 / 绿色植物系 / 红色动物系，
  步骤是同一个模板）也会命中 —— 这是有意接受的：它的定位是「值得人看一眼」，
  不是「确定有问题」。
语义检查分两类，因为轻重不同：

| 标记 | 意思 | 要做的 |
| --- | --- | --- |
| ⚠️ | 意思不对：卡片说了原文没有的话，或把限定词丢了 | 改卡片 |
| ⓘ | 意思没错，只是引文没覆盖全 | 换一条更完整的引文 |
| ⧉ | 与另一张卡重复 | 合并 |

报告里每条都把**引文与卡片自己的文字并排**放着 —— 不用再去开卡片文件才能判断。
`content audit --report-only` 只重排报告、不重跑模型（已审过的结论原样保留，只补上那两行）。
结果写进 `content/audit-report.md`（已 gitignore），**但它不签字**：签字是人的判断。
审阅要几十分钟，中途断了可以 `content audit --resume` 接着跑（已审过的篇会跳过）；
`node scripts/check-audit-coverage.mjs` 可以查审了多少篇。

**语义检查会误报，也会漏报。** 实测：同一张卡（肺癌那篇的「40% 不能说与香烟有关」）
第一轮被报成「含义正好相反」，其实卡片与引文一致 —— 是模型看错了。
所以这份报告是**待读清单，不是缺陷清单**：⚠️ 的每一条都要人自己再判断一眼。

## 7. 路线图（不达退出条件不进下一阶段）

说明：当前用户实际上是作者本人（n=1），决策门判断的是「作者自己会不会用」，不冒充统计结论。

| 阶段 | 内容 | 退出条件 | 状态 |
| --- | --- | --- | --- |
| **P0 仓库** | `git init`；npm workspaces 骨架；`content import` 导入快照；一条 CI 空跑通过 | `npm test` 与 `content:check` 在 CI 上为绿 | **已完成** |
| **P1 内容层** | schema 定稿；校验器 R1–R10；手工抽 12 张卡；生成 `cards.json` 与校验报告 | 12 张卡 0 error；R7 已有确认记录 | **已完成**（R1–R17 都有实现，见 §5.2） |
| **P2 PWA MVP** | 今天视图、时段、模式、事件日志、`.ics`、离线、导出；原型校验迁移为测试 | 技术清单全过：iOS / Android 安装成功；断网可完整使用一天；`.ics` 在 iOS 日历与 Google 日历导入后按时提醒；导出 → 清空 → 导入后事件日志逐条一致；R11 组件级测试通过 | **代码完成，浏览器能验的都已自动化**：离线预缓存、`.ics` 定时事件（早/晚 + 卡片提醒）与闹钟、导出→清空→导入逐条一致、卡上设的提醒存得住也删得掉，由 `npm run acceptance` 在真浏览器里验（10 项全过：离线可完整使用一天、断网也能翻手册、`.ics`、导出→清空→导入、卡上提醒、提醒生命周期与周期撤销、今天不做/撤销/次日回来、展开的卡点别处就收起、**计时器（形态对、读数在走、暂停/重置、到点停在 00:00、再点重新计时）**、导航；生命周期检查含取消/只移卡/一起删、放回默认、周期撤销、批量撤销）。**三种形态已就位**：浏览器 PWA、桌面 Electron（构建目标覆盖 Windows / macOS / Linux 各 x64 + arm64；只有 Windows 做过真启动与更新链验证）、手机 Capacitor（Android 的 debug APK 已构建出来；iOS 需 macOS）。**真机安装与两个日历 App 的实际提醒仍需人工**，清单见 §7.1 |
| **决策门** | 作者本人连续使用 14 天后，看事件日志 | 第 2 周打开 ≥ 4 天，且早晚两个时段都有记录，才进 P3；否则先改交互。试用者反馈只作定性参考，不作门槛 | **未开始**：P3 的工具链已经建好（不占着门），但 `reviewed` 数量与「作者自己会不会用」仍要等这 14 天的数据 |
| **P3 批量抽取** | LLM 起草流水线；审阅工具；手册浏览；今日一篇；疾病类分级 | ≥ 60 篇 `reviewed`；人工审阅 ≤ 10 分钟 / 篇（目标值，按 P1 实测校准） | **工具链完成，审阅基本收工**：`content draft` 流水线已用真实 LLM 跑通（自检不过就不写盘）；`content audit` 审阅辅助已跑通全量 94 篇；手册浏览 / 今日一篇 / 疾病类分级已实现；**104 篇卡文件、524 张卡已产出，全部通过校验**；其中 **491 张已签字**（机器没挑出毛病的 289 张于 2026-10-21 批量签字，之后逐篇补签；2026-10-22 又给 135 张改过名字/合并过的卡重签；2026-10-29 合并后产品里是 491 张）；剩下 **33 张 draft**（21 张保健 + 12 张疾病类）—— 逐张看过：多数是「表格/自测/清单」型（记分卡对照、钾卡、31 分自测、危险度检查表），手册原文里本来就有，做成卡只是重复；**那几张「一个动作一张卡」的才值得签**。**签字与审阅是人的活**（作者授权代签有三处：§4.3 第 8 条的 2026-10-24 纯改名、2026-10-28 给 56 行剂量补 `approximate` 标志，以及 §4.3 第 10 条的 2026-10-29 合并 —— 都是「按原文补事实标记」或「把已有的内容并到一张卡上」，不是改内容的意思） |
| **P4 增强** | Web Push（可选）、趋势回看、季节性卡片 | 按需 | 未开始 |

### 7.1 设备端验收清单（只能人工做）

浏览器里能验的已经脚本化了：`npm run acceptance` 跑离线预缓存、`.ics` 文件内容、
导出 → 清空 → 导入的逐条一致性、卡上设的提醒存得住也删得掉、调顺序/放回默认/
周期撤销/批量撤销的提醒生命周期、**计时器的读数与形态**（2026-10-30 加）；桌面端
`node scripts/desktop-check.mjs` 会真启动一次 Electron，并把「到点 → 主进程弹通知 →
回头问渲染层要下一次」整条回路跑一遍。
**Android 端在模拟器上真跑过了**（API 34 / google_apis x86_64，2026-10-21）：
装 APK → 授予通知权限 → 走真界面在卡上设提醒 → 系统待发清单里能看到 →
到点**系统通知真的弹出来**（当时的卡名是「光照建议」、正文「该做了：光照建议」）→
四种模式的排程形状都对。过程中查出并修掉两个 bug：通知 id 互相顶掉、秒数被带偏
（详见 §4.2 末尾）。

**下面这几条没有真机就验不了**，需要人在对应设备上跑一遍，逐条打勾：

- [ ] **macOS 安装**：dmg 打开（未签名需右键 →「打开」）→ Intel / Apple Silicon 各一次 → 窗口、托盘、提醒正常，设置页写「请手动下载新版」
- [ ] **Linux 安装**：AppImage / deb / rpm 各装一次（x64 / arm64）→ 窗口、托盘、提醒正常；AppImage 版设置页能查更新，deb / rpm 版写「请手动换新包」
- [ ] **iOS 安装（原生 App）**：macOS 上 `cd mobile/ios/App && pod install && open App.xcworkspace` → 装到 iPhone → 图标是「生活指南」、点开全屏无地址栏
- [ ] **Android 安装（原生 App）**：`mobile/android/app/build/outputs/apk/debug/app-debug.apk` 传到手机安装 → 图标与启动图正常
- [ ] **Android 精确闹钟**：手机装好后 → 设置 → 提醒 → 若出现「去允许精确提醒」，点它并在系统里打开「闹钟和提醒」→ 否则提醒会晚一点（模拟器实测：不授权晚约 5 秒～1 分钟，授权后准点）
- [ ] **iOS 安装（PWA）**：Safari 打开 → 分享 → 添加到主屏幕 → 主屏图标能打开、全屏无地址栏
- [ ] **Android 安装（PWA）**：Chrome 菜单 → 安装应用 → 应用列表里出现「生活指南」
- [ ] **离线可用**：装好之后开飞行模式 → 打开 App → 今天的卡片在、步骤图能显示、勾选能记上；恢复网络后再开，记录还在
- [ ] **手机端站外链**：设置 → 关于 →「源码在 GitHub」→ 能打开系统浏览器（而不是在应用内开一个网页）
- [ ] **iOS 日历提醒**：导入导出的 `.ics` → 日历里出现早 / 晚两条每日重复的**定时**事件（以及你设过的卡片提醒）→ 到点系统通知真的响
- [ ] **Google 日历提醒**：同上，导入 Google 日历 → 到点响
- [ ] **数据不被回收**：装到主屏后隔几天再打开，记录还在（iOS 会回收未安装站点的本地数据）
- [ ] **三种形态的数据是分开的**：手机上记的不会自动出现在电脑上 —— 确认「导出 / 导入」这条路走通了

## 8. 已知的坑

- **不要做打卡软件。** 断签清零与「连续 5～6 个月才见效」直接冲突。
- **「五分钟」是精确声明。** 血管拉伸一轮约 7 分钟（推算）、晨光要出门 15 分钟，都不进忙档。算不出时如实报告，不编数。
- **iOS 存储会被清。** 未安装到主屏的 Safari 站点长期不访问会被回收数据：提示安装 + 提供导出。
- **健康与疾病内容。** 保健卡要免责声明；疾病类按 §5.4 处理。
- **快照根下的 README 会被当成一篇文章。** `the-savvy-life-manual/README.md` 是这本书自己的目录页（约 1.9 万字），
  `content build` 把该目录下所有 `.md` 都收进 `manual.json`，于是「114 篇」里有一篇不是文章。
  App 侧用 `listableArticles` 按「有没有目录前缀」摘掉它，界面显示 113 篇；快照本身不动（D1）。
- **`duration` 的语义在草稿里漂过。** 6 张卡把「持续 2 周」「浸 3 天」「放置一晚」写成了单次耗时（最长 1,209,600 秒 = 336 小时）。
  界面侧的处理是：>3600 秒一律标「待核」，不替你换算；要真修得在 schema 里分清「手上的耗时 / 要等多久 / 疗程长度」。
- **daisyUI 的类名是保留字。** `steps` 是它的**步骤条组件**（`inline-grid` + 按列排布），
  `card-body` 是它的卡片体（自带 24px 内边距与 14px 字号）。自己的钩子类名撞上就会被它
  悄悄接管样式 —— 步骤列表曾因此被排成四列 76px 窄条，文字读起来像打乱的。
  所以本项目的钩子类名一律带 `lg-` 前缀，`app/test/ui/classes.test.ts` 守着这条。
- **两边分叉。** blog 的修订不会进入 App；045 的勘误不会回到 blog。按 §4.1 的勘误流程处理，`ERRATA.md` 中 `upstream: pending` 的条目定期清一次。
- **证书不对 = 离线功能没有。** 自定义域名的证书没签发时，页面在忽略证书的情况下照样渲染得出来，
  但 Chrome 会拒绝带证书错误的 Service Worker 脚本 → PWA 装不上、离线不可用（2026-10-28 实测；
  2026-10-29 证书已签发，这条留作坑）。
  **验域名必须等 `navigator.serviceWorker.ready` 到 `activated`，不能只看 200**；
  而且 DNS 指过去 ≠ 域名绑上了，EdgeOne 控制台里没绑就不会签这张域名的证书。
  最省事的验法：`ACCEPTANCE_URL=<地址> npm run acceptance:url`（整套验收跑在真实域名上）。
- **EdgeOne 的 Git 同步可能整个停掉，而且只能靠人去控制台救。**
  2026-10-29 实测：12:02 那次推送 2.5 分钟内跟上了，**13:19 那次过了 10 个小时没跟上**，
  线上一直是旧构建；**去控制台点一次「重新部署」当场就好了**（08:40 恢复，
  线上 sha256 从 `BEC9A130…` 变 `45CBC3C6…`，og:image 也从镜像站地址改成了
  `https://life.newzone.top/og.png`）。**而且同步是真恢复了**：点完之后 5 分钟内，
  `gh-pages` 上一个新提交被 EdgeOne **自动跟上**（线上 sha256 变 `88D2DD48…`，
  与 HEAD 逐字相同）⇒ Git 集成回到常态，往后 push 不用再手动点。
  判据：对比线上 `index.html` 与 `gh-pages` HEAD 的 sha256。
  **三个已排除的猜测**（别再重查一遍）：① 不是它自己 build 失败 —— 它**根本不 build**，
  伺服的就是分支里那份文件树（线上 `sw.js` 与分支那个提交逐字节相同）；
  ② 不是 CDN 缓存压着旧文件 —— 加随机 query 拿到的还是旧的、新资源在源站直接 404；
  ③ 不是「没推送所以没触发」 —— 推一个**空提交**（树不变）也激不动它。
  ⇒ 卡的是它**取分支那一步**。
  另有一个容易误判的坑：**`deploy.yml` 打出 `There is nothing to commit` 时其实没推任何东西**
  （产物与分支上已有的逐字相同），所以「分支最近有没有更新」不能只看 commit 时间。
- **GitHub Pages 从国内慢 16 倍。** 同一批文件 EdgeOne 平均 0.16 s/件、GitHub Pages 2.66 s/件；
  PWA 首访预缓存 127 项（2026-10-30 实测），镜像站上 SW 要 98.7 s 才激活。主地址走 EdgeOne，镜像只当兜底。
- **内容授权。** 对外公开发布前确认手册与图片的转载 / 改编授权。

## 9. 欢迎挑战的点

1. 「今天只放自己挑的」之后，起步包会不会又被人堆回几十张？轮换 + 手册入口够不够用来发现新动作？
2. `.ics` 日历提醒的打开率，是否真的高于「靠自觉早晚各开一次」？
3. 「今日一篇」的新鲜感，能否撑过第 3 周？
4. 快照不收勘误，这个代价在实际使用中是否可接受？

## 10. 怎么跑

```bash
npm install
npm run content:check         # 解析快照 + 校验 + 覆盖报告
npm run content:build         # 生成 app/public/cards.json
npm run dev                   # 本地运行 PWA
npm test                      # 全部单元测试
```

**怎么用**（装到手机 / 电脑、每天怎么用）：见 `docs/使用指南.md`。
**怎么审阅与签字、14 天决策门**（那是你自己的活）：见本文 §4.3 与 §7。

**怎么发版**（桌面端安装包 + Android APK，tag 驱动，流水线自动跑）：

```bash
node scripts/set-version.mjs 0.4.0     # 版本一次改到位（含 Android versionCode）+ 放一份发布说明模板
# 写 docs/发布说明/v0.4.0.md：这一版改了什么（模板里那行 <!-- 待写 --> 删掉）
git commit -am "chore(release): 0.4.0" && git push origin main
git tag v0.4.0 && git push origin v0.4.0   # 这一推才触发流水线
```

**流水线不会停下来等人放行**（2026-10-30 拆掉了 `release` environment 的 required
reviewers）：tag 推上去 → 校验 → 打包 → 发布，一路走完。
发布说明来自 `docs/发布说明/<tag>.md`，**要在打 tag 之前写好并提交** ——
`validate` 会查它；缺了就停下来（不会发出一页占位符）。

**已发布三版**：v0.1.1（2026-10-28，第一版公开分发）、v0.2.0（2026-10-29，
加了多设备同步）与 **v0.3.0（2026-10-30，多设备同步、局域网 WebDAV、卡片合并、标记重画）**。
再发一版要升版本号并带上新 tag：`set-version.mjs` 会把 5 个 package.json
与 Android 的 `versionCode` 一起改掉，而 `versionCode` 只增不减 ——
不涨的话新包装不上。

**怎么发布浏览器那条路**（产物、域名、EdgeOne Pages 的三条发布路径、发完要验的四件事）：
见 `docs/部署.md`。**主地址 <https://life.newzone.top/> 已同步**（2026-10-29 08:40 控制台点了一次重新部署后恢复，
8 项验收在真实地址上重跑 8 通过 0 失败）；GitHub Pages 的
`rockbenben.github.io/life-guide/` 是镜像，两个地址伺服同一份 `gh-pages` 分支的内容。
**主站与镜像不同步时的处置见 §8**（卡在 EdgeOne 取分支那一步，去控制台点重新部署）。

原型的校验用例已迁移成单元测试（`app/test/domain/` 与 `content/test/rules.test.ts`），
原型本体在 2026-10-27 删掉了 —— 它不被任何构建或测试引用，只是一份只读参考，
公开仓里留着会让人以为还有另一套界面在维护；历史里还能取回。
