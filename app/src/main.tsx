import { lazy, Suspense } from "preact/compat";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { registerSW } from "virtual:pwa-register";

import { Today } from "./ui/Today.tsx";
import type { Card } from "./domain/routine.ts";
import { variantAvailability } from "./domain/routine.ts";
import type { ManualArticle, ManualIndexEntry } from "./domain/manual.ts";
import { getSetting, setSetting } from "./data/db.ts";
import { useRoutine } from "./data/useRoutine.ts";
import {
  DEFAULT_REMINDERS,
  buildSpecs,
  normalizeReminders,
  sanitizeReminders,
  type Reminder,
} from "./domain/reminders.ts";
import { onReminderDue, schedule } from "./platform/notify.ts";

/**
 * Service Worker 只在浏览器里注册。
 *
 * 独立应用（Electron 桌面端、Capacitor 手机端）里资源本来就在本地，
 * 没有「离线要缓存」这回事，注册 SW 只会添乱（自定义协议下的 scope、
 * 更新提示、缓存清理），所以检测到壳就跳过。
 */
function inNativeShell(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Electron|Capacitor/i.test(navigator.userAgent);
}

/**
 * 注册 Service Worker —— **等首屏画完再注册**。
 *
 * 预缓存有 3.9 MB（两个 JSON + 106 张图 + 路由 chunk）。一进页面就注册，
 * 这 3.9 MB 会跟首屏抢带宽：弱网下 App 要等自己的资源跟预缓存挤完才画得出来。
 * 挪到首屏之后，首屏先拿满带宽，预缓存在后台慢慢下。
 *
 * 离线能力不受影响：预缓存照样在装（装完才 active），验收里那条
 * 「断网可完整使用一天」测的就是装完之后的状态。
 */
let swStarted = false;
function registerServiceWorker(): void {
  if (swStarted || inNativeShell()) return;
  swStarted = true;
  const idle =
    (window as unknown as { requestIdleCallback?: (cb: () => void) => void })
      .requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
  idle(() => {
    void registerSW({ immediate: true });
  });
}

type Tab = "today" | "manual" | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "today", label: "今天" },
  { id: "manual", label: "手册" },
  { id: "settings", label: "设置" },
];

// 手册带着 marked、设置带着导入导出：都不是首屏要用的，按路由拆包。
const Manual = lazy(() =>
  import("./ui/Manual.tsx").then((m) => ({ default: m.Manual })),
);
const Settings = lazy(() =>
  import("./ui/Settings.tsx").then((m) => ({ default: m.Settings })),
);

/**
 * 当前看哪一页 —— 跟着地址栏走（#today / #manual / #settings）。
 *
 * 为什么跟着地址栏：网页版的前进后退得能换页；桌面窗口虽然没有地址栏，
 * 同一个 hash 机制照样能用（菜单不再管换页，导航按钮自己改 hash）。
 * 页面只认这三个值，别的一概当「今天」。
 */
function tabFromHash(): Tab {
  const h = (window.location.hash || "").replace(/^#/, "");
  return TABS.some((t) => t.id === h) ? (h as Tab) : "today";
}

export function App() {
  const [cards, setCards] = useState<Card[]>([]);
  /** 默认清单：首启放进「我的日常」的那几张，次序即显示次序（策展在内容层） */
  const [defaultRoutine, setDefaultRoutine] = useState<string[]>([]);
  /** 提醒：什么时候响、响的时候说什么（整段那两条 + 绑在卡上的那些） */
  const [reminders, setReminders] = useState<Reminder[]>([...DEFAULT_REMINDERS]);
  /**
   * 重排的扳手：提醒响过之后要接着排下一次（一天只响一次是不够的）。
   * 浏览器到点、桌面主进程到点问回来，都会拧一下这个。
   */
  const [tick, setTick] = useState(0);
  const [articles, setArticles] = useState<ManualArticle[]>([]);
  /** 手册目录（cards.json 自带）：先画列表，全文按需再取 */
  const [manualIndex, setManualIndex] = useState<ManualIndexEntry[]>([]);
  const [tab, setTab] = useState<Tab>(() => tabFromHash());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** 改一下就重新拉一次内容（加载失败时「重试」按的就是它） */
  const [reloadKey, setReloadKey] = useState(0);
  /** 手册全文的状态：没进过手册页 → idle；进去过就是 loading / loaded / error */
  const [manualState, setManualState] = useState<"idle" | "loading" | "loaded" | "error">(
    "idle",
  );
  const [manualError, setManualError] = useState<string | null>(null);
  // 打开哪一篇由 App 拿着：今天页展开态里那句「出自」要能跳进手册
  const [manualPath, setManualPath] = useState<string | null>(null);
  /** 从文章内链跳进来时要落到的小节标题 */
  const [manualAnchor, setManualAnchor] = useState<string | null>(null);
  /** 文章内链的返回栈：有历史时返回键写「上一篇」，没有时写「手册」回列表 */
  const [manualHistory, setManualHistory] = useState<
    { path: string; anchor: string | null }[]
  >([]);

  /**
   * 数据在别处被换掉时（导入备份）：拧一下这个数，
   * 清单与条件就重新从库里读一次。
   * 不然它们还摆着旧值，用户改一下就把刚导入的那份盖掉了。
   */
  const [dataEpoch, setDataEpoch] = useState(0);

  /**
   * 「我的日常」：清单 + 用户自己加的习惯。
   *
   * 清单只有这一份 —— 今天页显示它、提醒的「建议」也按它算。
   * （以前两边各存一份、靠回调同步，同一件事两个真相。）
   */
  const routine = useRoutine({ cards, defaultRoutine, loading, refreshKey: dataEpoch });

  /**
   * 内容层的卡 + 用户自己的习惯。
   *
   * 合在一起给下游：自定义习惯在数据层就是一张卡，
   * 所以盖章、累计天数、提醒、次序全都白得（不用另做一套）。
   */
  const allCards = useMemo(() => [...cards, ...routine.habits], [cards, routine.habits]);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        // credentials: omit 必须与 index.html 的 preload 一致，否则预加载作废
        const res = await fetch("cards.json", { credentials: "omit" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bundle = await res.json();
        setCards(bundle.cards ?? []);
        setManualIndex(bundle.articles ?? []);
        setDefaultRoutine(bundle.defaultRoutine ?? []);
      } catch (e) {
        setError(
          `读不到 cards.json（${e instanceof Error ? e.message : String(e)}）。`,
        );
      } finally {
        setLoading(false);
        // 首屏画完了，让预缓存去下 —— 别跟首屏抢带宽
        registerServiceWorker();
      }
    })();
  }, [reloadKey]);

  /**
   * 手册全文：**打开文章或搜正文时才取**。
   *
   * 它有 800 KB，只服务「读某一篇」与「搜正文」；目录已经跟着 cards.json
   * 一起到了（manualIndex），点「手册」先看到列表，不必等全文。
   * 取过一次就不再来；失败后允许重试。
   *
   * **为什么用 ref 而不是状态**：加载会 setState（"loading"），
   * 状态一变若再触发加载，就会重复请求。ref 记「已经要过了」。
   */
  const manualRequested = useRef(false);
  const ensureManual = useCallback(() => {
    if (manualRequested.current) return;
    manualRequested.current = true;
    setManualState("loading");
    setManualError(null);
    void (async () => {
      try {
        const res = await fetch("manual.json");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bundle = await res.json();
        setArticles(bundle.articles ?? []);
        setManualError(null);
        setManualState("loaded");
      } catch (e) {
        setManualError(
          `读不到 manual.json（${e instanceof Error ? e.message : String(e)}）。`,
        );
        setManualState("error");
        manualRequested.current = false; // 失败了允许重试
      }
    })();
  }, []);
  const retryManual = useCallback(() => {
    manualRequested.current = false;
    ensureManual();
  }, [ensureManual]);

  // 旧缓存里的 cards.json 可能没有目录（升级瞬间）：退回「进手册取全文」，
  // 别让列表空着。新产物有目录，不会走这里。
  useEffect(() => {
    if (tab === "manual" && !loading && !manualIndex.length && manualState === "idle") {
      ensureManual();
    }
  }, [tab, loading, manualIndex.length, manualState, ensureManual]);

  // 提醒的设置（清单那边在 useRoutine 里管，不在这里再存一份）
  // dataEpoch 变了也要重读：导入备份会换掉提醒，不重读的话界面还摆着旧的，
  // 用户改任意一条就把刚导入的那份挤掉了。
  useEffect(() => {
    void (async () => {
      // 没存过（undefined）与「自己清空了」（[]）要分得开：
      // 前者给默认的两条，后者就是空的，别把用户删掉的塞回去
      const rem = await getSetting<Reminder[] | undefined>("reminders", undefined);
      setReminders(sanitizeReminders(rem));
    })();
  }, [dataEpoch]);

  // 桌面端：主进程到点了会问渲染层要下一次 —— 拧一下重排
  useEffect(() => {
    onReminderDue(() => setTick((t) => t + 1));
  }, []);

  // 排程：内容变了（换了卡、改了次序、改了时刻）就重排一次
  useEffect(() => {
    if (!allCards.length) return;
    const specs = buildSpecs(allCards, routine.ids, reminders, new Date());
    void schedule(specs, () => setTick((t) => t + 1));
  }, [allCards, routine.ids, reminders, tick]);

  /** 改了提醒：存起来 + 立刻重排 */
  async function changeReminders(next: Reminder[]) {
    const clean = normalizeReminders(next);
    setReminders(clean);
    await setSetting("reminders", clean);
  }

  /** 换页：地址栏也跟着变（网页的前进后退因此能换页，链接也能直接进某一页） */
  function goTab(next: Tab) {
    setTab(next);
    if (window.location.hash !== `#${next}`) window.location.hash = next;
  }

  // 地址栏变了（导航按钮 / 用户前进后退）→ 跟着变
  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // 换页回到顶部：从滚到一半的设置页切回今天，不该落在清单中间 ——
  // 那样会看不到日期、时段和第一张卡，像是「今天」从中间开始的。
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [tab]);

  function openArticle(path: string, anchor?: string) {
    if (tab !== "manual") {
      // 从今天页进来：内部返回栈从零开始，不能沿用上次在手册里留下的历史
      setManualHistory([]);
    } else if (manualPath && manualPath !== path) {
      setManualHistory((h) => [
        ...h,
        { path: manualPath, anchor: manualAnchor },
      ]);
    }
    ensureManual();
    setManualPath(path);
    setManualAnchor(anchor ?? null);
    goTab("manual");
  }

  function backToArticleList() {
    const prev = manualHistory[manualHistory.length - 1];
    if (!prev) {
      setManualPath(null);
      setManualAnchor(null);
      return;
    }
    setManualHistory((h) => h.slice(0, -1));
    setManualPath(prev.path);
    setManualAnchor(prev.anchor);
  }

  /** 手册里那张卡出自哪一篇 —— 反向跳回去 */
  const modeVariants = useMemo(() => variantAvailability(allCards), [allCards]);
  /** 有没有卡按人群换动作（分档）：有的话条件面板里要提一句 */
  const hasSegments = allCards.some((c) => c.segments && c.segments.length > 0);

  return (
    <div class="lg-app">
      {/* 导航在页面外面（三个页共用一个），宽屏下它得跟正文列对齐，
          所以外层给一个跟 .lg-shell 同样宽的框，导航再往右让出「页边」那一栏 */}
      <div class="lg-frame">
        {/* 三个页共用这排导航，网页、手机、桌面窗口都一样摆 ——
            换页不靠原生菜单：菜单藏得深、还容易被当成「另一个东西」，
            从手册回主页必须有一眼能看见、点得到的那条路。 */}
        <nav class="lg-nav" data-tab={tab} aria-label="主导航">
          {TABS.map((t) => (
            <button
              key={t.id}
              aria-current={tab === t.id ? "page" : undefined}
              onClick={() => {
                // 点「手册」是去**手册**（列表），不是回到上次读的那一篇。
                // 打开某篇有两条明明白白的路：列表里点它，或卡片里的「出自〈那一篇〉」。
                if (t.id === "manual") {
                  setManualPath(null);
                  setManualAnchor(null);
                  setManualHistory([]);
                } else {
                  setManualHistory([]);
                }
                goTab(t.id);
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>

        <div key={tab} class="page-fade">
          <Suspense
            fallback={
              <main class="lg-shell">
                <p class="lg-do">加载中…</p>
              </main>
            }
          >
          {/*
            加载不出来时**只**摆这段，不摆下面的内容。
            原来下面还会摆「今天这一屏是空的 · 你把动作都移出去了」——
            用户什么都没做，却告诉他「你把动作都移出去了」，那是冤枉人。
          */}
          {error ? (
            <div class="lg-shell">
              <p class="lg-alert-error">内容没加载出来。</p>
              <p class="lg-pool">可能是网络断了。点「重试」再试一次。</p>
              <div class="lg-btn-row" style="margin-top:12px">
                <button class="lg-btn" onClick={() => setReloadKey((k) => k + 1)}>
                  重试
                </button>
              </div>
              {/* 技术细节给开发者看（普通用户不看这一行） */}
              <p class="lg-pool" style="font-size:var(--lg-t1)">{error}</p>
            </div>
          ) : tab === "today" ? (
            <Today
              cards={allCards}
              loading={loading}
              routine={routine}
              reminders={reminders}
              onRemindersChange={changeReminders}
              onOpenArticle={openArticle}
              modeVariants={modeVariants}
              hasSegments={hasSegments}
            />
          ) : tab === "manual" ? (
            <Manual
              articles={articles}
              index={manualIndex}
              cards={allCards}
              loading={loading}
              manualState={manualState}
              error={manualError}
              path={manualPath}
              anchor={manualAnchor ?? undefined}
              onPath={(path) => {
                setManualPath(path);
                setManualAnchor(null);
                setManualHistory([]);
              }}
              onOpenArticle={openArticle}
              onArticleBack={backToArticleList}
              hasArticleHistory={manualHistory.length > 0}
              routineIds={routine.ids}
              onAddToRoutine={(id) => void routine.add(id)}
              onAddManyToRoutine={(ids) => void routine.addMany(ids)}
              onRemoveManyFromRoutine={(ids) => {
                const drop = new Set(ids);
                void routine.set(routine.ids.filter((id) => !drop.has(id)));
              }}
              onNeedManual={ensureManual}
              onRetry={retryManual}
            />
          ) : (
            <Settings
              cards={allCards}
              reminders={reminders}
              onRemindersChange={changeReminders}
              onRefreshSchedule={() => setTick((t) => t + 1)}
              refreshKey={dataEpoch}
              onDataImported={() => setDataEpoch((e) => e + 1)}
            />
          )}
          </Suspense>
        </div>
      </div>
    </div>
  );
}
