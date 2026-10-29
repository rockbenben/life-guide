/**
 * 设置：条件（模式 + 我的情况）· 提醒 · 导出/导入数据 · 安装提示。
 */
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { ConditionPanel, useConditions } from "./Conditions.tsx";
import { Disclaimer } from "./Disclaimer.tsx";
import { buildIcs, downloadIcs } from "../domain/ics.ts";
import {
  buildBackup,
  downloadBackup,
  parseBackup,
  restoreBackup,
} from "../data/backup.ts";
import { allEvents, clearEvents, getSetting, setSetting } from "../data/db.ts";
import {
  createTransport,
  lastSyncAt,
  readSyncConfig,
  saveSyncConfig,
  syncConfigProblem,
  syncNow,
  type SyncConfig,
  type SyncKind,
} from "../data/sync.ts";
import type { Card, ModeCounts } from "../domain/routine.ts";
import { variantAvailability } from "../domain/routine.ts";
import {
  describeReminder,
  normalizeReminders,
  parseTime,
  type Reminder,
} from "../domain/reminders.ts";
import { cardName, displayNames } from "../domain/lines.ts";
import { describeUpdate, updateBusy, type UpdateStatus } from "../domain/update.ts";
import { ReminderModePicker } from "./Reminder.tsx";
import {
  exactAlarmStatus,
  notifyKind,
  openExactAlarmSettings,
  requestPermission,
  showNow,
  status,
  type NotifyStatus,
} from "../platform/notify.ts";
import {
  checkForUpdate,
  downloadUpdate,
  hasUpdater,
  installUpdate,
  onUpdateChanged,
  updateStatus,
} from "../platform/update.ts";

/** 屏幕上的每一句话都得有个期限 —— 与 Today 页那条提示同一个时限。 */
const NOTICE_MS = 6000;

/**
 * 源码仓库。设置页「关于」里那一条链到这里。
 *
 * 仓库公开之后，这个地址就是陌生人能看到的第一个入口 —— 看说明、提 issue、给星标都从这儿走。
 */
const REPO_URL = "https://github.com/rockbenben/life-guide";

/**
 * GitHub 标记（官方 octicon 的 mark-github-16，MIT）。
 *
 * 为什么用官方的而不是自己画：这是第三方的商标，自制的「像 GitHub 的圆猫」反而是侵权风险；
 * 官方标记在 GitHub 的标志使用规范里就是给「链到 GitHub」用的。
 * 用 currentColor，跟着主题走（暗色下也是同一个图形，只换颜色）。
 */
function GithubMark() {
  return (
    <svg
      class="lg-ghmark"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M6.766 11.328c-2.063-.25-3.516-1.734-3.516-3.656 0-.781.281-1.625.75-2.188-.203-.515-.172-1.609.063-2.062.625-.078 1.468.25 1.968.703.594-.187 1.219-.281 1.985-.281.765 0 1.39.094 1.953.265.484-.437 1.344-.765 1.969-.687.218.422.25 1.515.046 2.047.5.593.766 1.39.766 2.203 0 1.922-1.453 3.375-3.547 3.64.531.344.89 1.094.89 1.954v1.625c0 .468.391.734.86.547C13.781 14.359 16 11.53 16 8.03 16 3.61 12.406 0 7.984 0 3.563 0 0 3.61 0 8.031a7.88 7.88 0 0 0 5.172 7.422c.422.156.828-.125.828-.547v-1.25c-.219.094-.5.156-.75.156-1.031 0-1.64-.562-2.078-1.609-.172-.422-.36-.672-.719-.719-.187-.015-.25-.093-.25-.187 0-.188.313-.328.625-.328.453 0 .844.281 1.25.86.313.452.64.655 1.031.655s.641-.14 1-.5c.266-.265.47-.5.657-.656"
      />
    </svg>
  );
}

type Notice = { text: string; kind: "ok" | "error" };

export function Settings({
  cards,
  reminders,
  onRemindersChange,
  onRefreshSchedule,
  refreshKey = 0,
  onDataImported,
  skipped,
  routine,
}: {
  cards?: Card[];
  /** 提醒：整段那两条 + 绑在卡上的那些 */
  reminders?: Reminder[];
  /** 提醒改了 —— App 要重排一次，否则新时刻不生效 */
  onRemindersChange?: (reminders: Reminder[]) => void;
  /** 重排提醒（改了精确闹钟授权之后要立刻重排：已排的那几条还是「不精确」的） */
  onRefreshSchedule?: () => void;
  /** 数据在别处被换掉（导入备份）时，让这里再读一次 */
  refreshKey?: number;
  /** 导入成功：告诉 App 重新读清单与条件（不然界面还摆着导入前的旧值） */
  onDataImported?: () => void;
  /** 今天不做的卡：导出日历时给当天那次加 EXDATE */
  skipped?: Record<string, string>;
  /** 日常清单：某一段全跳过时，整段日历事件也排除当天 */
  routine?: string[];
}) {
  const cond = useConditions(refreshKey);
  // 提醒由 App 持有（它要排程），这里只用来看与改
  const reminderList = reminders ?? [];
  /** 按时段响的那两条（早晨 / 晚间）：模式与时刻都在这页改 */
  const slotReminders = reminderList.filter((r) => !r.cardId);
  /** 绑在卡上的那几条：卡片里改时间，这里只看得见、也删得掉 */
  const cardReminders = reminderList.filter((r) => r.cardId);
  const [count, setCount] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  /* --- 多设备同步 --- */
  const [syncOn, setSyncOn] = useState(false);
  const [syncKind, setSyncKind] = useState<SyncKind>("webdav");
  const [syncUrl, setSyncUrl] = useState("");
  const [syncUser, setSyncUser] = useState("");
  const [syncPassword, setSyncPassword] = useState("");
  const [syncToken, setSyncToken] = useState("");
  const [syncPath, setSyncPath] = useState("");
  const [syncPass, setSyncPass] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  /** 同步的结果（留在这一节里，别一闪而过） */
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [syncLast, setSyncLast] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [installed, setInstalled] = useState(false);
  const [notify, setNotify] = useState<NotifyStatus | null>(null);
  /** Android 12+：精确闹钟够不够用（不给的话提醒会晚几分钟） */
  const [exact, setExact] = useState<{ needed: boolean; granted: boolean } | null>(null);
  /** 自动更新：只有桌面端有这一说（浏览器更新 PWA、手机更新 APK，都不归这里管） */
  const updaterOn = hasUpdater();
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  // 同一个「被拒绝」，浏览器、桌面、手机要去的地方不一样 —— 别在手机上叫用户改浏览器设置。
  const deniedNotice =
    notify?.kind === "native"
      ? "通知被系统拒绝了 —— 到手机的「设置 → 通知」里允许生活指南，提醒才会响。"
      : notify?.kind === "desktop"
        ? "通知被系统拒绝了 —— 到系统的通知设置里允许生活指南，提醒才会响。"
        : "通知被浏览器拒绝了 —— 到浏览器的网站设置里把「通知」改成允许，提醒才会响。";
  const modeVariants = useMemo(() => variantAvailability(cards ?? []), [cards]);  const coverage = useMemo<ModeCounts>(
    () => ({
      busy: (cards ?? []).filter((c) => c.variants?.busy != null).length,
      travel: (cards ?? []).filter((c) => c.variants?.travel != null).length,
      sick: (cards ?? []).filter((c) => c.variants?.sick != null).length,
    }),
    [cards],
  );
  /** 有没有卡按人群换动作（分档）：有的话条件面板里要提一句 */
  const hasSegments = (cards ?? []).some((c) => c.segments && c.segments.length > 0);
  // 屏上叫什么：一个小节拆出多张卡时名字会撞车，回落到这张卡在做什么
  const names = useMemo(() => displayNames(cards ?? []), [cards]);

  useEffect(() => {
    void allEvents().then((e) => setCount(e.length));
    void status().then(setNotify);
    void exactAlarmStatus().then(setExact);
    // 同步的设置也读回来 —— 这一页可能是开同步之后第一次进来
    void (async () => {
      const cfg = await readSyncConfig();
      setSyncOn(cfg.enabled);
      setSyncKind(cfg.kind);
      setSyncUrl(cfg.serverUrl);
      setSyncUser(cfg.user);
      setSyncPassword(cfg.password);
      setSyncToken(cfg.token);
      setSyncPath(cfg.path);
      setSyncPass(cfg.passphrase);
      setSyncLast(await lastSyncAt());
    })();
    setInstalled(
      window.matchMedia("(display-mode: standalone)").matches ||
        (window.navigator as { standalone?: boolean }).standalone === true,
    );
  }, []);

  // 导出、导入、清空、改提醒都往这一条里报结果；到点就自己走。
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), NOTICE_MS);
    return () => clearTimeout(t);
  }, [notice]);

  function showNotice(text: string, kind: Notice["kind"] = "ok"): void {
    setNotice({ text, kind });
  }

  /**
   * 自动更新的状态：进来先问一次，之后主进程推过来。
   *
   * 主进程启动 5 秒后也会自己查一遍 —— 查到了就弹系统通知，
   * 所以用户不打开这一页也知道有新版本。
   */
  useEffect(() => {
    if (!updaterOn) return;
    void updateStatus().then(setUpdate);
    onUpdateChanged(setUpdate);
  }, [updaterOn]);

  async function saveReminders(next: Reminder[]) {
    const clean = normalizeReminders(next);
    await setSetting("reminders", clean);
    onRemindersChange?.(clean);
    showNotice("提醒已保存。");
  }

  async function askPermission() {
    const s = await requestPermission();
    setNotify(s);
    if (s.permission === "granted") {
      showNotice("可以了，App 到点会自己提醒。");
    } else if (s.permission === "denied") {
      // 同一个「被拒绝」，浏览器 / 桌面 / 手机要去的地方不一样 —— 别在手机上
      // 叫用户改浏览器设置（这里原来写死了一句「浏览器里」）。
      showNotice(deniedNotice, "error");
    } else {
      showNotice("这个环境暂时拿不到通知权限。", "error");
    }
    // 允许了才排得上程（没允许时 App 不会去弹那张系统授权页 ——
    // 那是用户自己点的入口才该做的事），所以这里要重排一次。
    if (s.permission === "granted") onRefreshSchedule?.();
  }

  /**
   * 同步一轮。
   *
   * `save` 为真时先把地址与口令存下来 —— 用户填完就点「保存并同步」，
   * 不该还要再点一次「保存」。
   */
  async function runSync(save: boolean) {
    const conf: SyncConfig = {
      enabled: syncOn,
      kind: syncKind,
      serverUrl: syncUrl.trim(),
      user: syncUser.trim(),
      password: syncPassword,
      token: syncToken.trim(),
      path: syncPath.trim(),
      passphrase: syncPass,
    };
    if (save) await saveSyncConfig(conf);
    const problem = syncConfigProblem(conf);
    if (problem) {
      setSyncMsg(problem);
      return;
    }
    setSyncBusy(true);
    try {
      const report = await syncNow(createTransport(conf), conf);
      setSyncMsg(report.message);
      if (report.ok) {
        setSyncLast(Date.now());
        // 远端带来的记录、清单、提醒要重新读一遍，界面才不是旧的
        onDataImported?.();
      }
    } catch (err) {
      setSyncMsg(`同步失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSyncBusy(false);
    }
  }

  return (
    <main class="lg-shell lg-settings">
      <div class="lg-topbar">
        <h1 class="lg-h1">设置</h1>
        <span class="lg-dateline">
          {syncOn ? "同步已开 · 只上传密文" : "只在本机，不上传"}
        </span>
      </div>

      <section class="lg-set">
        <h2>条件</h2>
        <p>
          决定今天出现哪些动作、哪些卡按你的情况换一版。
          今天页顶部的「条件」改的是同一份。
        </p>
        <ConditionPanel
          {...cond}
          modeVariants={modeVariants}
          coverage={coverage}
          coverageScope="manual"
          hasSegments={hasSegments}
        />
      </section>

      <section class="lg-set">
        <h2>提醒</h2>
        <p>
          到点 App 自己响，响的时候告诉你这一段该做哪几件。
          某张卡要单独提醒，把它放进日常，展开后点「设提醒」。
        </p>
        {notify?.note ? <p class="lg-pool">{notify.note}</p> : null}

        {slotReminders.length ? (
          <>
            <p class="lg-grouphint">按时段提醒</p>
            <div class="lg-remrows">
              {slotReminders.map((r) => (
                <div class="lg-remblock" key={r.id}>
                  <div class="lg-remrow">
                    <label class="lg-remcheck">
                      <input
                        type="checkbox"
                        checked={r.on}
                        onChange={(e) =>
                          void saveReminders(
                            reminderList.map((x) =>
                              x.id === r.id ? { ...x, on: (e.target as HTMLInputElement).checked } : x,
                            ),
                          )
                        }
                      />
                      <span>{r.label}</span>
                    </label>
                    <input
                      class="lg-remtime"
                      type="time"
                      value={r.time}
                      aria-label={`${r.label}提醒时刻`}
                      onChange={(e) => {
                        const v = (e.target as HTMLInputElement).value;
                        // 清空输入框 ≠ 删掉这条提醒。
                        // 时刻不合法时 normalizeReminders 会把整条丢掉 —— 那用户只是
                        // 清了一下时间框，早晨提醒就整条没了（界面上还没有加回来的入口）。
                        if (!parseTime(v)) return;
                        void saveReminders(
                          reminderList.map((x) => (x.id === r.id ? { ...x, time: v } : x)),
                        );
                      }}
                    />
                  </div>
                  <ReminderModePicker
                    reminder={r}
                    onChange={(mode, extra) =>
                      void saveReminders(reminderList.map((x) => (x.id === r.id ? { ...x, ...extra, mode } : x)))
                    }
                  />
                </div>
              ))}
            </div>
          </>
        ) : null}

        {/* 绑在卡上的提醒：时间在卡片里改，这里只列出来 —— 一处看得见全部 */}
        {cardReminders.length ? (
          <div class="lg-remcards">
            <p class="lg-grouphint">绑在卡上的提醒（时间在卡片里改）</p>
            {cardReminders.map((r) => {
              const card = cards?.find((c) => c.id === r.cardId);
              const name = card
                ? (names.get(card.id) ?? cardName(card))
                : r.label;
              return (
                <div class="lg-remcard" key={r.id}>
                  <span class="lg-remcardname">{name}</span>
                  <span class="lg-remval">
                    {r.on ? describeReminder(r) : "已关闭"}
                  </span>
                  <button
                    class="lg-linkbtn"
                    onClick={() =>
                      void saveReminders(reminderList.filter((x) => x.id !== r.id))
                    }
                  >
                    删掉
                  </button>
                </div>
              );
            })}
          </div>
        ) : null}

        {!slotReminders.length && !cardReminders.length ? (
          <p class="lg-pool">还没有提醒。把一张卡放进日常，展开它就能设一条。</p>
        ) : null}

        {/* Android 12+：不给精确闹钟权限，系统就把闹钟攒着一起发 —— 实测晚了一分钟 */}
        {exact?.needed && !exact.granted ? (
          <div class="lg-pool" data-dp="exact">
            <p>
              Android 会把提醒攒着一起发，所以会晚几分钟。
              允许「闹钟和提醒」之后准点响。
            </p>
            <button
              class="lg-btn lg-btn-ghost"
              onClick={async () => {
                await openExactAlarmSettings();
                const now = await exactAlarmStatus();
                setExact(now);
                if (now.granted) {
                  // 已经排上的那几条还是「不精确」排的 —— 立刻重排一遍才准点
                  onRefreshSchedule?.();
                  showNotice("准点响已开启，提醒重新排过了。");
                } else {
                  showNotice("还没打开「闹钟和提醒」，提醒会晚几分钟。", "error");
                }
              }}
            >
              去允许精确提醒
            </button>
          </div>
        ) : null}

        <div class="lg-btn-row" style="margin-top:12px">
          {notify?.permission === "granted" ? null : notify?.permission === "denied" ? (
            <span class="lg-pool" style="margin:0; align-self:center">
              {deniedNotice}
            </span>
          ) : notify?.permission === "unsupported" ? (
            <span class="lg-pool" style="margin:0; align-self:center">
              这个环境没有通知通道，提醒不会响。
            </span>
          ) : (
            <>
              <button class="lg-btn" onClick={() => void askPermission()}>
                允许通知
              </button>
              {/* 允许之前所有提醒都不会响 —— 包括卡上单独设的那些，
                  否则用户以为设了提醒就一定会有。 */}
              <span class="lg-pool" style="margin:0; align-self:center">
                还没允许通知 —— 允许之前，所有提醒都不会响。
              </span>
            </>
          )}
          <button
            class="lg-btn lg-btn-ghost"
            disabled={notify?.permission !== "granted"}
            onClick={() =>
              void showNow(
                "生活指南 · 测试提醒",
                "到了这个点，App 就这样提醒你 —— 带上这一段该做的那几件。",
              )
            }
          >
            发一条测试提醒
          </button>
        </div>

        {/* 这台设备怎么响，上面那句 status().note 已经说清了；不重复第二遍 */}

        <button
          class="lg-btn lg-btn-ghost"
          style="margin-top:10px"
          onClick={() => {
            // 时刻用**用户设的那个**（小时与分钟都要）——
            // 只取小时的话，07:30 的提醒导成 07:00，日历那条会差几十分钟。
            const timeOf = (id: "morning" | "evening", fallbackHour: number) => {
              const t = parseTime(reminderList.find((r) => r.id === id)?.time ?? "");
              return t ? { hour: t.hour, minute: t.minute } : { hour: fallbackHour, minute: 0 };
            };
            const m = timeOf("morning", 7);
            const e = timeOf("evening", 21);
            downloadIcs(
              buildIcs({
                urlBase: window.location.origin + window.location.pathname,
                name: "生活指南",
                morningHour: m.hour,
                morningMinute: m.minute,
                eveningHour: e.hour,
                eveningMinute: e.minute,
                cardReminders: reminderList.filter((r) => r.cardId),
                skipped,
                routine,
                cards,
              }),
            );
          }}
        >
          导出日历（含卡片提醒）
        </button>
      </section>

      <section class="lg-set">
        <h2>数据</h2>
        <p>
          记录存在这台设备上。没开同步的话，什么都不会上传。
          没装到主屏幕的话（尤其是 iOS），系统可能回收本地数据，所以定期导出一份。
        </p>
        <div class="lg-btn-row">
          <button
            class="lg-btn lg-btn-ghost"
            onClick={async () => {
              const b = await buildBackup();
              downloadBackup(b);
              showNotice(`已导出 ${b.events.length} 条记录`);
            }}
          >
            导出数据
          </button>
          <button
            class="lg-btn lg-btn-ghost"
            onClick={() => fileRef.current?.click()}
          >
            导入数据
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            class="hidden"
            onChange={async (e) => {
              const input = e.target as HTMLInputElement;
              const f = input.files?.[0];
              if (!f) return;
              try {
                const backup = parseBackup(await f.text());
                // 导入是**替换**，不是合并。不说清楚，用户会在「试试导入」时
                // 丢掉这台设备上已经攒下的记录。先问一句再动手。
                const ok = window.confirm(
                  `导入会用备份里的 ${backup.events.length} 条记录替换这台设备现在的 ${count} 条记录。\n` +
                    "日常清单、条件和自己加的习惯也会一起替换；备份里带了提醒的话，提醒也会替换。\n继续？",
                );
                if (!ok) return;
                const n = await restoreBackup(backup);
                showNotice(`已导入 ${n} 条记录`);
                setCount(n);
                // 清单与条件住在 App 层（不随页签重挂载）——
                // 不叫它们重读，界面还摆着导入前的旧清单，
                // 用户改一下就把刚导入的那份盖掉了。
                onDataImported?.();
              } catch (err) {
                showNotice(
                  `导入失败：${err instanceof Error ? err.message : String(err)}`,
                  "error",
                );
              } finally {
                // 同一个文件再选一次也会触发 change；不重置的话，失败后改好文件
                // 同名再试，浏览器不会再给一次机会。
                input.value = "";
              }
            }}
          />
        </div>

        {/* 危险操作单独隔开：清空是不可撤销的，不该跟导出挤在一排 */}
        <div class="lg-danger">
          <p class="lg-pool">
            当前记录 <span class="tabular">{count}</span> 条。
            清空后只能靠导入备份恢复。
          </p>
          <button
            class="lg-btn lg-btn-ghost"
            style="margin-top:10px"
            onClick={async () => {
              const n = count;
              // 不可撤销的操作先问一句：这些记录是用户攒下的天数，
              // 手一滑清掉就只剩「导入备份」能救（而多数人没导过）。
              if (
                n > 0 &&
                !window.confirm(
                  `清空 ${n} 条盖章记录？\n清掉之后只能靠导入备份恢复。`,
                )
              ) {
                return;
              }
              await clearEvents();
              setCount(0);
              showNotice(`已清空 ${n} 条记录`);
            }}
          >
            清空记录
          </button>
        </div>
      </section>

      {/*
        多设备同步。

        **默认是关的**：关着的时候，什么都不上传（页首那句话是实话）。
        打开之后也只有密文离开这台设备 —— 口令派生出密钥，
        服务器拿到的是一串解不开的字节。

        换设备时不用再导文件：在新设备上填同一个地址、同一个口令就行。
      */}
      <section class="lg-set">
        <h2>多设备同步</h2>
        <p>
          默认关着 —— 关着的时候记录只在这台设备上，什么都不上传。
          打开之后，每台设备填同一个同步口令，
          盖章记录、日常清单、条件、提醒、自己加的习惯就能在设备之间来回走。
        </p>
        <p>
          放在哪儿由你选：<strong>网盘</strong>或<strong>GitHub 私有仓库</strong>都不用自己搭服务器
          （GitHub 那条浏览器里也能用，网盘那条只有桌面端与手机端能用）；
          也可以指向你自己跑的中转服务。
        </p>
        <p>
          上传的只有加密后的内容：口令只存在这台设备上，
          服务器拿到的是解不开的密文。
        </p>

        <label class="lg-remcheck">
          <input
            type="checkbox"
            checked={syncOn}
            onChange={async (e) => {
              const on = (e.target as HTMLInputElement).checked;
              setSyncOn(on);
              await saveSyncConfig({ enabled: on });
              // 刚打开就同步一次：用户填过地址与口令的话，
              // 这一下就能看到"另一台设备上的记录出现了"。
              if (on) void runSync(false);
            }}
          />
          <span>开启同步</span>
        </label>

        {syncOn ? (
          <>
            <label class="lg-synccfg">
              <span>放在哪儿</span>
              <select
                class="lg-syncselect"
                value={syncKind}
                onChange={(e) =>
                  setSyncKind((e.target as HTMLSelectElement).value as SyncKind)
                }
              >
                <option value="webdav">网盘 WebDAV（坚果云 / Nextcloud / NAS；桌面与手机能用）</option>
                <option value="github">GitHub 私有仓库（不用自己搭服务器，三端都能用）</option>
                <option value="http">自己搭的中转服务（sync/ 那个 Worker）</option>
              </select>
            </label>

            {syncKind === "github" ? (
              <>
                <label class="lg-synccfg">
                  <span>
                    仓库<small>（owner/repo，例如 rockbenben/life-guide）</small>
                  </span>
                  <input
                    type="text"
                    value={syncUrl}
                    placeholder="owner/repo"
                    autocomplete="off"
                    spellcheck={false}
                    onChange={(e) => setSyncUrl((e.target as HTMLInputElement).value)}
                  />
                </label>
                <label class="lg-synccfg">
                  <span>
                    目录<small>（可空 → 放仓库根下）</small>
                  </span>
                  <input
                    type="text"
                    value={syncPath}
                    placeholder="life-guide"
                    autocomplete="off"
                    spellcheck={false}
                    onChange={(e) => setSyncPath((e.target as HTMLInputElement).value)}
                  />
                </label>
                <label class="lg-synccfg">
                  <span>
                    Token<small>
                      （Personal Access Token，只要 repo 权限；只存在这台设备）
                    </small>
                  </span>
                  <input
                    type="password"
                    value={syncToken}
                    placeholder="ghp_…"
                    autocomplete="off"
                    onChange={(e) => setSyncToken((e.target as HTMLInputElement).value)}
                  />
                </label>
              </>
            ) : null}

            {syncKind === "webdav" ? (
              <>
                <label class="lg-synccfg">
                  <span>
                    网盘地址<small>（WebDAV 根地址）</small>
                  </span>
                  <input
                    type="text"
                    value={syncUrl}
                    placeholder="https://dav.jianguoyun.com/dav/"
                    autocomplete="off"
                    spellcheck={false}
                    onChange={(e) => setSyncUrl((e.target as HTMLInputElement).value)}
                  />
                </label>
                <label class="lg-synccfg">
                  <span>账号</span>
                  <input
                    type="text"
                    value={syncUser}
                    autocomplete="off"
                    onChange={(e) => setSyncUser((e.target as HTMLInputElement).value)}
                  />
                </label>
                <label class="lg-synccfg">
                  <span>
                    应用密码<small>（坚果云在「安全选项」里生成，不是登录密码）</small>
                  </span>
                  <input
                    type="password"
                    value={syncPassword}
                    autocomplete="off"
                    onChange={(e) => setSyncPassword((e.target as HTMLInputElement).value)}
                  />
                </label>
                <p class="lg-pool">
                  网盘这条路在浏览器里走不通（WebDAV 不给 CORS 头，浏览器会拦）——
                  桌面端与手机端能用。
                </p>
              </>
            ) : null}

            {syncKind === "http" ? (
              <label class="lg-synccfg">
                <span>同步服务地址</span>
                <input
                  type="text"
                  value={syncUrl}
                  placeholder="https://life-guide-sync.xxx.workers.dev"
                  autocomplete="off"
                  spellcheck={false}
                  onChange={(e) => setSyncUrl((e.target as HTMLInputElement).value)}
                />
              </label>
            ) : null}

            <label class="lg-synccfg">
              <span>
                同步口令<small>（至少 8 个字，换设备时填同一个）</small>
              </span>
              <input
                type="password"
                value={syncPass}
                placeholder="一句你不会忘的话"
                autocomplete="off"
                onChange={(e) => setSyncPass((e.target as HTMLInputElement).value)}
              />
            </label>
            <div class="lg-btn-row" style="margin-top:10px">
              <button
                class="lg-btn"
                disabled={syncBusy}
                onClick={() => void runSync(true)}
              >
                {syncBusy ? "同步中…" : "保存并同步"}
              </button>
              <button
                class="lg-btn lg-btn-ghost"
                disabled={syncBusy || !syncOn}
                onClick={() => void runSync(false)}
              >
                立即同步
              </button>
            </div>
            {syncMsg ? <p class="lg-pool">{syncMsg}</p> : null}
            <p class="lg-pool">
              {syncLast
                ? `上次同步：${new Date(syncLast).toLocaleString("zh-CN")}`
                : "还没同步过。"}
            </p>
          </>
        ) : null}
      </section>

      {!installed ? (
        <section class="lg-set">
          <h2>装到主屏幕</h2>
          <p>
            iOS：分享 → 添加到主屏幕。Android：浏览器菜单 → 安装应用。
            装上以后，被系统回收的概率小很多。
          </p>
        </section>
      ) : null}

      {updaterOn ? (
        <section class="lg-set">
          <h2>更新</h2>
          <p>
            有新版本会写在这里。安装包一百多兆，不自动下载 —— 你点了才下，
            下完重启装上。
          </p>
          <p class="lg-pool">{update ? describeUpdate(update) : "正在查…"}</p>
          <div class="lg-btn-row">
            <button
              class="lg-btn lg-btn-ghost"
              disabled={update ? updateBusy(update) : false}
              onClick={() => void checkForUpdate().then(setUpdate)}
            >
              检查更新
            </button>
            {update?.state === "available" ? (
              <button
                class="lg-btn"
                onClick={() => void downloadUpdate().then(setUpdate)}
              >
                下载更新
              </button>
            ) : null}
            {update?.state === "ready" ? (
              <button
                class="lg-btn"
                onClick={() => void installUpdate().then(setUpdate)}
              >
                重启并安装
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section class="lg-set">
        <h2>关于</h2>
        <p>
          生活指南：把《生活手册》变成能照着做的卡片。
          卡片上的每一步、每条禁忌都是原文的话，数字对过原文；换算是推算，屏上会标出来。
        </p>
        <p>换设备时用「导出数据 / 导入数据」搬家。</p>
        {/*
          源码入口。target=_blank：浏览器开新标签、桌面端被 setWindowOpenHandler
          交给系统浏览器（手机端与手册页的外链同一条路）。
        */}
        <p>
          <a
            class="lg-linkbtn lg-ghlink"
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
          >
            <GithubMark />
            源码在 GitHub
          </a>
        </p>
        <Disclaimer />
      </section>

      {/* 提示条：导出、导入、清空、改提醒都往这里报（浮在页底，不绑在某一段里）。
          成功与失败分开：失败那条不能带「✓」。 */}
      {notice ? (
        <p
          class="lg-flash"
          data-kind={notice.kind}
          role="status"
          aria-live="polite"
        >
          {notice.text}
        </p>
      ) : null}
    </main>
  );
}
