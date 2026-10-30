/**
 * 通知：App 自己提醒的那一层。
 *
 * 三种形态，三条通道（AGENTS.md §4.2）：
 *
 *   · 桌面（Electron）—— 主进程定时器 + 系统通知。**App 开着就响**，
 *     窗口关了也行（进程还在）。
 *   · 手机（Capacitor）—— 系统级本地通知（LocalNotifications 插件）。
 *     **App 关了也会响**，因为是操作系统在排程。
 *   · 浏览器 / PWA —— 页内定时器 + Notification API。**只有 App 在前台时才准**
 *     （后台标签页的定时器会被浏览器节流），所以浏览器这条路要靠导出的 .ics 兜底。
 *
 * 上层只跟 `status / requestPermission / schedule / showNow` 说话；
 * 「什么时候响」由 domain/reminders.ts 算好，这里只管「怎么响」。
 *
 * **「今天不做」怎么落**：跳过的是**那一次**，不是整条提醒 ——
 * 桌面与浏览器照 `spec.at` 定时，那一次自然就不响了；
 * 手机端的系统重复规则表达不了「今天不算」，所以 domain 会把
 * `spec.firstSkipped` 带下来，被跳过的那一次退成一串一次性通知
 * （见下面的 nativeNotifications）。
 */
import type { ReminderSpec } from "../domain/reminders.ts";
import { nextOccurrence, parseTime } from "../domain/reminders.ts";

export type NotifyKind = "desktop" | "native" | "web" | "none";
export type NotifyPermission = "granted" | "denied" | "default" | "unsupported";

export interface NotifyStatus {
  kind: NotifyKind;
  permission: NotifyPermission;
  /** 这个平台上提醒到底怎么响 —— 界面上照实说 */
  note: string;
}

/** 交给主进程的一条（主进程只需要这些字段）。 */
interface DesktopSpec {
  id: string;
  at: string;
  title: string;
  body: string;
  /** 再往后几次：渲染层不在时，主进程靠它自己续着响 */
  after: string[];
}

/** Electron 预加载脚本暴露的那条缝（见 desktop/preload.cjs）。 */
interface DesktopBridge {
  isDesktop?: boolean;
  setReminders?: (specs: DesktopSpec[]) => void;
  notifyNow?: (title: string, body: string) => void;
  reminderSupport?: () => boolean;
  /** 提醒到点了：主进程问渲染层要下一次 */
  onReminderDue?: (cb: (id: string) => void) => void;
}

function desktopBridge(): DesktopBridge | undefined {
  const w = window as unknown as { lifeGuide?: DesktopBridge };
  return w.lifeGuide;
}

/** Capacitor 的插件注册表（插件装进原生工程后才有）。 */
interface CapacitorPlugins {
  LocalNotifications?: {
    checkPermissions(): Promise<{ display: string }>;
    requestPermissions(): Promise<{ display: string }>;
    /** Android 12+：精确闹钟是否被允许（不给的话闹钟会被降级，可能晚几分钟） */
    checkExactNotificationSetting?(): Promise<{ exact_alarm: string }>;
    /** 跳到系统的「闹钟和提醒」授权页 */
    changeExactNotificationSetting?(): Promise<{ exact_alarm: string }>;
    schedule(opts: {
      notifications: {
        id: number;
        title: string;
        body: string;
        schedule: {
          at?: Date;
          on?: { weekday?: number; hour?: number; minute?: number; second?: number };
          repeats?: boolean;
        };
        /**
         * 要不要精确闹钟。
         *
         * 默认是 true，而插件在 Android 12+ 遇到「没授权」时会**自己打开系统的
         * 「闹钟和提醒」授权页** —— 那是从 App 界面里把用户拽走，抢屏。
         * 我们自己决定：只有用户已经允许了才要精确的。
         */
        isExactNotification?: boolean;
      }[];
    }): Promise<void>;
    cancel(opts: { notifications: { id: number }[] }): Promise<void>;
    getPending(): Promise<{ notifications: { id: number }[] }>;
  };
}

function capacitor(): { isNativePlatform?: () => boolean } | undefined {
  const w = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  return w.Capacitor;
}

function localPlugin(): CapacitorPlugins["LocalNotifications"] | undefined {
  const w = window as unknown as { Capacitor?: { Plugins?: CapacitorPlugins } };
  return w.Capacitor?.Plugins?.LocalNotifications;
}

function isDesktop(): boolean {
  return !!desktopBridge()?.isDesktop;
}

function isNative(): boolean {
  const cap = capacitor();
  if (!cap) return false;
  try {
    return cap.isNativePlatform?.() ?? false;
  } catch {
    return false;
  }
}

/** 这台设备走哪条通道。 */
export function notifyKind(): NotifyKind {
  if (isDesktop()) return "desktop";
  if (isNative()) return "native";
  if (typeof window !== "undefined" && "Notification" in window) return "web";
  return "none";
}

const NOTES: Record<NotifyKind, string> = {
  desktop: "桌面端：App 开着就会响（窗口关了也行）",
  native: "手机端：系统排程，关掉 App 也会响",
  web: "浏览器：App 在前台才会响（后台标签页会被浏览器压住通知，可能晚几分钟），日历导出的闹钟更稳",
  none: "这个环境不支持通知",
};

/** 现在的权限状态。 */
export async function status(): Promise<NotifyStatus> {
  const kind = notifyKind();
  if (kind === "desktop") {
    const ok = desktopBridge()?.reminderSupport?.() ?? false;
    return {
      kind,
      permission: ok ? "granted" : "unsupported",
      note: ok ? NOTES.desktop : "这个系统没有可用的通知通道。",
    };
  }
  if (kind === "native") {
    const plugin = localPlugin();
    if (!plugin) {
      return {
        kind,
        permission: "unsupported",
        note: "这个安装包没带通知组件，提醒不会响 —— 换正式安装包。",
      };
    }
    try {
      const res = await plugin.checkPermissions();
      return { kind, permission: normalizePermission(res.display), note: NOTES.native };
    } catch {
      return { kind, permission: "unsupported", note: "手机的通知服务没响应。" };
    }
  }
  if (kind === "web") {
    const p = typeof Notification !== "undefined" ? Notification.permission : "unsupported";
    return { kind, permission: normalizePermission(p), note: NOTES.web };
  }
  return { kind, permission: "unsupported", note: NOTES.none };
}

function normalizePermission(p: string): NotifyPermission {
  // Capacitor 用 "prompt"，浏览器用 "default"，一回事
  if (p === "granted" || p === "denied") return p;
  if (p === "default" || p === "prompt") return "default";
  return "unsupported";
}

/** 要通知权限（必须在用户动作里调）。 */
export async function requestPermission(): Promise<NotifyStatus> {
  const kind = notifyKind();
  if (kind === "desktop") return status();
  if (kind === "native") {
    const plugin = localPlugin();
    if (!plugin) return status();
    try {
      const res = await plugin.requestPermissions();
      return { kind, permission: normalizePermission(res.display), note: NOTES.native };
    } catch {
      return status();
    }
  }
  if (kind === "web") {
    try {
      const p = await Notification.requestPermission();
      return { kind, permission: normalizePermission(p), note: NOTES.web };
    } catch {
      return status();
    }
  }
  return status();
}

/**
 * 排程。
 *
 * 三条通道各自的做法：
 *   · 桌面 —— 把「下一次触发时间 + 内容」交给主进程，它用系统定时器到点弹通知；
 *   · 手机 —— 交给系统的本地通知（App 关了也响）；
 *   · 浏览器 —— 页内记下时刻，到点自己发（App 在前台才准）。
 *
 * onDue 是「响完了」的通知：浏览器通道到点时调它，桌面通道由主进程问回来。
 * 调用方收到它就重排一次 —— 不重排的话，一天只响一次。
 */
export async function schedule(
  specs: ReminderSpec[],
  onDue?: (id: string) => void,
): Promise<void> {
  const kind = notifyKind();
  if (kind === "desktop") {
    desktopBridge()?.setReminders?.(
      specs.map((s) => ({
        id: s.id,
        at: s.at,
        title: s.title,
        body: s.body,
        after: s.after,
      })),
    );
    return;
  }
  if (kind === "native") {
    const plugin = localPlugin();
    if (!plugin) return;
    try {
      const pending = await plugin.getPending();
      for (const n of pending.notifications) {
        await plugin.cancel({ notifications: [{ id: n.id }] });
      }
      /**
       * 通知权限：没允许就不排。
       *
       * 插件的 `schedule()` 自己会弹系统的通知授权页 —— App 一启动就排程，
       * 用户还没看见界面就被那张系统对话框盖住（实测：新装第一次打开就是它，
       * 底下的应用界面根本没机会被看清）。跟精确闹钟是同一类问题：
       * 授权页只能由用户自己点的入口去跳。
       *
       * 用户在设置页点「允许通知」之后会立刻重排一次，那时才排。
       */
      const perm = await plugin.checkPermissions();
      if (normalizePermission(perm.display) !== "granted") return;
      /**
       * 要不要精确闹钟，由**用户有没有允许**决定，不由插件替我们决定。
       *
       * 插件的默认是 `isExactNotification: true`，而它在 Android 12+ 遇到没授权时
       * 会自己去打开系统的「闹钟和提醒」授权页 —— App 一启动就把用户从自己的界面里
       * 拽走，抢屏（实测：新装第一次打开就是那张系统页）。
       *
       * 没允许就按不精确排程：提醒**照样会响**，只是可能晚几分钟
       * （AGENTS.md §4.2 记过这个降级）。想准点响的，设置页里有那颗
       * 「去允许精确提醒」——那是用户自己点的，那才该跳系统页。
       */
      const exact = (await exactAlarmStatus()).granted;
      const notifications = specs.flatMap((s, i) => nativeNotifications(s, i));
      if (notifications.length) {
        await plugin.schedule({
          notifications: notifications.map((n) => ({
            ...n,
            isExactNotification: exact,
          })),
        });
      }
    } catch {
      // 排不上就算了：界面上已经说了这个平台怎么响，不该在这里崩
    }
    return;
  }
  if (kind === "web") {
    setWebReminders(specs, onDue);
  }
}

/**
 * 桌面端：主进程到点了会问渲染层要下一次。
 *
 * 注册一次就够（主进程每次到点只发一条消息），别在重排时反复注册。
 */
export function onReminderDue(cb: (id: string) => void): void {
  desktopBridge()?.onReminderDue?.(cb);
}

// ---------------------------------------------------------------- 浏览器

let webTimers: number[] = [];

/**
 * setTimeout 的上限（约 24.8 天）。
 *
 * 超了这个数，浏览器会**立刻**触发 —— 「每隔 30 天」那种提醒会在打开 App
 * 的那一秒响一次（然后哑掉）。所以定时器只排到上限，醒来发现还没到点就再排一次
 * （外面的重排会接上）。
 */
const MAX_DELAY = 2 ** 31 - 1;

/** 浏览器里的排程：每条一个定时器，到点自己发。 */
export function setWebReminders(
  specs: ReminderSpec[],
  onDue?: (id: string) => void,
): void {
  for (const t of webTimers) window.clearTimeout(t);
  webTimers = [];
  for (const s of specs) {
    const delay = new Date(s.at).getTime() - Date.now();
    if (!Number.isFinite(delay) || delay < 0) continue;
    webTimers.push(
      window.setTimeout(
        () => {
          // 定时器被上限截断了会先醒：还没到点就再排一次
          if (new Date(s.at).getTime() > Date.now()) {
            onDue?.(s.id);
            return;
          }
          void showNow(s.title, s.body);
          // 响完了要接着排明天的 —— 不叫一声，外面的重排就不会发生
          onDue?.(s.id);
        },
        Math.min(delay, MAX_DELAY),
      ),
    );
  }
}

/**
 * 立刻发一条（设置页的「试一下」、计时器到点用）。
 *
 * `id` 只有原生端用得上：系统按 id 存通知，**撞了就是后一条把前一条顶掉**
 * （AGENTS.md §4.2 记过这个坑：早晨一条占了 999，晚间那条就没了）。
 * 计时器要按卡分开，所以 id 传进来；不传就用默认那个。
 */
export async function showNow(
  title: string,
  body: string,
  id: number = 999,
): Promise<void> {
  const kind = notifyKind();
  if (kind === "desktop") {
    desktopBridge()?.notifyNow?.(title, body);
    return;
  }
  if (kind === "native") {
    const plugin = localPlugin();
    if (!plugin) return;
    try {
      // 同样按「用户允不允许」决定要不要精确（见 schedule 里那段注释）：
      // 试一下也不该把用户拽去系统授权页。
      const exact = (await exactAlarmStatus()).granted;
      await plugin.schedule({
        notifications: [
          {
            id,
            title,
            body,
            schedule: { at: new Date(Date.now() + 1000) },
            isExactNotification: exact,
          },
        ],
      });
    } catch {
      // 同上：试一下失败就安静着
    }
    return;
  }
  if (kind === "web") {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg) {
        await reg.showNotification(title, {
          body,
          // **相对路径**：同一份产物可能跑在根路径（life.newzone.top/）
          // 或子路径（rockbenben.github.io/life-guide/）——
          // 绝对路径 "/icons/..." 在子路径下会 404，通知就只剩一个空图标。
          icon: "icons/icon-192.png",
          badge: "icons/icon-192.png",
          tag: "life-guide",
        });
        return;
      }
      new Notification(title, { body, icon: "icons/icon-192.png", tag: "life-guide" });
    } catch {
      // 同上
    }
  }
}

// ---------------------------------------------------------------- 手机

/**
 * 精确闹钟够不够用。
 *
 * Android 12 起，App 想准点响铃得单独拿「精确闹钟」授权；不给的话系统把闹钟
 * 降级成不精确的，攒着一起发 —— 实测：08:11 的提醒 08:12 才到。
 * 桌面端与浏览器没有这个问题，只有手机端要问。
 */
export async function exactAlarmStatus(): Promise<{
  needed: boolean;
  granted: boolean;
}> {
  if (notifyKind() !== "native") return { needed: false, granted: true };
  const plugin = localPlugin();
  if (!plugin?.checkExactNotificationSetting) return { needed: false, granted: true };
  try {
    const res = await plugin.checkExactNotificationSetting();
    return { needed: true, granted: res.exact_alarm === "granted" };
  } catch {
    return { needed: false, granted: true };
  }
}

/** 跳到系统的「闹钟和提醒」授权页（必须由用户点一下）。 */
export async function openExactAlarmSettings(): Promise<void> {
  const plugin = localPlugin();
  try {
    await plugin?.changeExactNotificationSetting?.();
  } catch {
    // 打不开就算了：提醒照样会响，只是可能晚一点
  }
}

/**
 * 把一条提醒翻成系统排程。
 *
 * 系统的重复规则只有「每天」「每周某天」——「每隔 N 天」没有对应的规则，
 * 只能把接下来几次的准确时刻排成一次性通知（App 每次打开都会重排一遍，
 * 所以这条链不会断）。
 *
 * 通知 id 必须互不重叠：系统按 id 存这条通知，撞了就是**后一条把前一条顶掉**
 * （实测：早晨一周五条占了 id 1–5，晚间那条每日提醒占了 id 2，
 *  早晨周二那条就没了）。所以每条提醒占一段号（100 个一批），段内自己编号。
 */
export function nativeNotifications(
  spec: ReminderSpec,
  index: number,
): {
  id: number;
  title: string;
  body: string;
  schedule: {
    at?: Date;
    on?: { weekday?: number; hour?: number; minute?: number; second?: number };
    repeats?: boolean;
  };
}[] {
  const r = spec.rule;
  const t = parseTime(r.time);
  if (!t) return [];
  const base = (index + 1) * 100;
  const common = { title: spec.title, body: spec.body };

  if (r.mode === "once") {
    if (!r.date) return [];
    const at = new Date(`${r.date}T00:00:00`);
    if (Number.isNaN(at.getTime())) return [];
    at.setHours(t.hour, t.minute, 0, 0);
    if (at.getTime() <= Date.now()) return [];
    return [{ id: base, ...common, schedule: { at } }];
  }

  /**
   * 「今天不做」把这一次跳掉了。
   *
   * 系统的重复规则**表达不了「今天不算」**——那条「每天 08:00」一旦排上，
   * 今天 08:00 就会响。所以退成一串一次性通知：从 spec.at（下一个该响的时刻）
   * 往后排，今天不响、明天起照常。App 每次打开都会重排，链不会断
   * （跟「每隔 N 天」同一条路）。跳过过了期、firstSkipped 变回 false 时，
   * 它就自己回到系统的每日重复。
   */
  if (spec.firstSkipped) {
    const count = r.mode === "daily" ? SKIPPED_CHAIN_DAILY : SKIPPED_CHAIN_WEEKLY;
    return chainFrom(spec, count).map((at, k) => ({
      id: base + k,
      ...common,
      schedule: { at },
    }));
  }

  if (r.mode === "weekly") {
    const days = (r.days ?? []).filter((d) => d >= 0 && d <= 6);
    // 一条提醒排几天：系统一个通知只认一个 weekday，所以拆成几条
    return days.map((d, k) => ({
      id: base + k,
      ...common,
      // 系统的 Weekday：周日 = 1（我们内部是 0 = 周日）
      // second: 0 —— 不给秒的话系统把「排程那一刻的秒数」带进去，
      // 07:00 的提醒会变成 07:00:46
      schedule: {
        on: { weekday: d + 1, hour: t.hour, minute: t.minute, second: 0 },
        repeats: true,
      },
    }));
  }

  if (r.mode === "interval") {
    // 系统的重复规则没有「每隔 N 天」，只能排成一串一次性通知
    return chainFrom(spec, 5).map((at, k) => ({
      id: base + k,
      ...common,
      schedule: { at },
    }));
  }

  return [
    {
      id: base,
      ...common,
      schedule: { on: { hour: t.hour, minute: t.minute, second: 0 }, repeats: true },
    },
  ];
}

/** 被「今天不做」跳过后退成一次性串时排几次：每天一次 → 两周；每周一次 → 五周。 */
const SKIPPED_CHAIN_DAILY = 14;
const SKIPPED_CHAIN_WEEKLY = 5;

/**
 * 从 spec.at 那一次开始，往后排 count 次（每次一个准确时刻）。
 *
 * 为什么从 spec.at 起、而不是从「现在」起：spec.at 是**这一条该响的那一次**
 * ——「今天不做」跳过的那一次已经不在里面了。从「现在」起排会把被跳过的那次
 * 又排回去，手机上就会照样响。
 */
function chainFrom(spec: ReminderSpec, count: number): Date[] {
  const out: Date[] = [];
  const first = new Date(Date.parse(spec.at));
  if (Number.isNaN(first.getTime())) return out;
  out.push(first);
  let cursor = first;
  for (let i = 1; i < count; i++) {
    const d = nextOccurrence(spec.rule, new Date(cursor.getTime() + 1000));
    if (!d) break;
    out.push(d);
    cursor = d;
  }
  return out;
}
