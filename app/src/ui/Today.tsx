/**
 * 今日视图：唯一主屏。
 *
 * 这一屏只回答一个问题：现在做什么。
 * 所以它列的不是「手册里所有能做的动作」，而是**你自己挑进日常的那几张** ——
 * 实测过：全量 491 张卡里 89 张是疾病知识、402 张可做，其中 387 张是「随时」或没标时段；
 * 按「所有 practice 卡都进今天」排，早/日间/晚各约 392 / 390 / 394 张，仍是几十屏。
 * 那不是清单，是目录，而「需要翻」正是这个项目要否定的用法。
 *
 * 其余动作走发现层：每天给三张 + 手册里每篇标出「哪几个动作能照着做」。
 *
 * 疾病类卡片不进这张清单：它不是今天要做的事（AGENTS.md §5.4）。
 *
 * 这一页自己只管**界面状态**（展开哪张、开着哪个面板、现在几点）；
 * 「我的日常」与用户自己加的习惯在 data/useRoutine.ts —— 清单只有那一份，
 * 今天页显示它、提醒的「建议」也按它算。
 */
import type { ComponentChildren } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";

import { CardView } from "./Card.tsx";
import { TodaySidebar, type HabitFormState } from "./TodaySidebar.tsx";
import { TodayLog, LOG_CHUNK } from "./TodayLog.tsx";
import { DiscoverPanel } from "./DiscoverPanel.tsx";
import { Disclaimer } from "./Disclaimer.tsx";
import { useConditions } from "./Conditions.tsx";
import { isCustomCard, type HabitSlot } from "../domain/custom.ts";
import { AGE_TAGS, TAG_LABELS } from "../domain/conditions.ts";
import { doneInPeriod, periodDoneText, periodKeyOf } from "../domain/cadence.ts";
import { addEvent, allEvents, removeEvent, updateEvent, type DoneEvent } from "../data/db.ts";
import type { Card, ModeCounts, ModeVariants } from "../domain/routine.ts";
import { skipped } from "../domain/routine.ts";
import type { Reminder } from "../domain/reminders.ts";
import { cardName, displayNames } from "../domain/lines.ts";
import {
  dailyCandidates,
  dailyPicks,
  mergeWithDefault,
  refillPicks,
  restoreCounts,
  routineCards,
  todaysCards,
} from "../domain/daily.ts";
import { dayOf, slotOf, SLOT_LABELS, SWITCHABLE_SLOTS, type Slot } from "../domain/day.ts";
import { isSkippedToday } from "../domain/skip.ts";
import { daysDone, recentActivity, totalActiveDays } from "../domain/progress.ts";
import type { RoutineStore } from "../data/useRoutine.ts";

export interface TodayProps {
  cards: Card[];
  /** 卡片数据还在加载 —— 加载中显示「加载中」而不是「还没有卡片」，后者是误导 */
  loading?: boolean;
  /** 「我的日常」：清单 + 用户自己加的习惯（只有这一份，见 data/useRoutine.ts） */
  routine: RoutineStore;
  /** 提醒（App 级设置；绑在卡上的那一条也在里面） */
  reminders?: Reminder[];
  onRemindersChange?: (reminders: Reminder[]) => void;
  /** 跳到某篇文章（卡片展开态里的「出自」） */
  onOpenArticle?: (path: string) => void;
  /** 每个模式各自有没有卡带版本 */
  modeVariants?: ModeVariants;
  /** 数据里有没有按人群分档的卡 —— 有的话条件那一栏要提一句 */
  hasSegments?: boolean;
  /**
   * 数据在别处被换掉时拧一下（导入备份、多设备同步）：
   * 盖章记录要重新读一遍，不然界面还摆着旧的那一份。
   */
  refreshKey?: number;
}

const DOT_DAYS = 14;
/** 那条提示自己待多久（毫秒）。屏幕上的每一句话都得有个期限。 */
const FLASH_MS = 6000;
/** 又窄又矮的屏幕：首启两块说明收成一行，否则第一张卡进不了首屏。 */
const FOLD_ONBOARDING = "(max-width: 380px) and (max-height: 640px)";

// 拖拽排序只在「调顺序」时用：dnd-kit 不该跟着首屏一起下载。
const SortPanel = lazy(() =>
  import("./SortPanel.tsx").then((m) => ({ default: m.SortPanel })),
);

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
      return;
    }
    const mq = window.matchMedia(query);
    const sync = () => setMatches(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return matches;
}

/** 首启说明在小屏收成一行；宽屏保持原样，summary 由 CSS 隐藏。 */
function OnboardingFold({
  class: className,
  open,
  onToggle,
  summary,
  fold,
  children,
}: {
  class: string;
  open: boolean;
  onToggle: (open: boolean) => void;
  summary: string;
  fold: boolean;
  children: ComponentChildren;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  return (
    <details
      ref={ref}
      class={className}
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        onToggle(next);
        if (next && fold) {
          // 展开后整块送到顶部，否则第二排选项会被底部导航盖住。
          requestAnimationFrame(() => {
            if (ref.current?.open) {
              ref.current.scrollIntoView({ block: "start" });
            }
          });
        }
      }}
    >
      <summary class="lg-fold-sum">{summary}</summary>
      <div class="lg-fold-body">{children}</div>
    </details>
  );
}

export function Today({
  cards,
  loading,
  routine,
  reminders,
  onRemindersChange,
  onOpenArticle,
  modeVariants,
  hasSegments,
  refreshKey = 0,
}: TodayProps) {
  const cond = useConditions();
  const { mode, tags, onTag, ageKnown, onSkipAgePrompt } = cond;
  const [events, setEvents] = useState<DoneEvent[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [condOpen, setCondOpen] = useState(false);
  const [packOffset, setPackOffset] = useState(0);
  /**
   * 发现这一批的卡 id。
   *
   * 不能每次从候选池重算：用户加走一张时池子变了，重算会把另外两张也换掉。
   * 只在跨天、换一批时重算；加走一张时只补那一格。
   */
  const [pickIds, setPickIds] = useState<string[]>([]);
  const picksStarted = useRef(false);
  const pickDay = useRef("");
  const [flash, setFlash] = useState("");
  const [sorting, setSorting] = useState(false);
  const foldOnboarding = useMediaQuery(FOLD_ONBOARDING);
  const [ageOpen, setAgeOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  /**
   * 自定义习惯的表单：null = 不开；new = 新加一条；edit = 改某一条。
   *
   * 放在侧栏里、按钮的正下方 —— 触发的地方和表单挨着，
   * 不用滚屏去找（窄屏时侧栏在上方，展开就在眼前）。
   */
  const [habitForm, setHabitForm] = useState<HabitFormState>(null);
  const [now, setNow] = useState(() => new Date());
  // null = 跟着钟点走（默认）；手动切过时固定下来，重新打开 App 又回到自动
  const [slotPick, setSlotPick] = useState<Slot | null>(null);
  // 清单收着还是展着（默认清单 40 张后这一段有 30 多张，要能收起来）
  const [logOpen, setLogOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      setEvents(await allEvents());
    })();
  }, [refreshKey]);

  /**
   * 那条提示自己会走。
   *
   * 原来它一直挂在那儿（直到下一条消息把它顶掉），首启那三句话就此变成永久的旧话 ——
   * 屏幕上的每一句话都得有个期限。
   */
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);

  // 日历事件里的链接带 ?slot=morning|evening（AGENTS.md §4.2）：
  // 从日历点进来就落到那个时段，不用再自己切。
  useEffect(() => {
    if (typeof window === "undefined") return;
    const s = new URLSearchParams(window.location.search).get("slot");
    if (s && (SWITCHABLE_SLOTS as string[]).includes(s)) {
      setSlotPick(s as Slot);
    }
  }, []);

  // 每分钟刷新一次，「现在几点」决定时段与日界线
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(t);
  }, []);

  const today = dayOf(now.getTime());
  const clockSlot = slotOf(now.getTime());
  const slot = slotPick ?? clockSlot;

  const mineToday = useMemo(
    () => todaysCards(cards, routine.ids, slot),
    [cards, routine.ids, slot],
  );
  // 每周/每月的卡：本周期做完就收进「本周期已完成」，下周期再出来。
  const mine = useMemo(
    () =>
      mineToday
        .filter((c) => !isSkippedToday(routine.skipped, c.id, today))
        .filter((c) => {
          const cadence = routine.cadenceOf(c.id);
          return cadence === "daily" || !doneInPeriod(events, c.id, today, cadence);
        }),
    [mineToday, events, today, routine],
  );
  // 这一段里被用户标成「今天不做」的卡（只影响今天；明天自动回来）
  const skippedInSlot = useMemo(
    () => mineToday.filter((c) => isSkippedToday(routine.skipped, c.id, today)),
    [mineToday, routine.skipped, today],
  );
  const periodDone = useMemo(
    () =>
      mineToday.filter((c) => {
        const cadence = routine.cadenceOf(c.id);
        return cadence !== "daily" && doneInPeriod(events, c.id, today, cadence);
      }),
    [mineToday, events, today, routine],
  );
  const coverage = useMemo<ModeCounts>(
    () => ({
      busy: mine.filter((c) => c.variants?.busy != null).length,
      travel: mine.filter((c) => c.variants?.travel != null).length,
      sick: mine.filter((c) => c.variants?.sick != null).length,
    }),
    [mine],
  );
  const skippedCount = useMemo(
    () => mine.filter((c) => skipped(c, mode)).length,
    [mine, mode],
  );
  // 屏上叫什么：一个小节拆出多张卡时名字会撞车（刷牙/牙线、三个穴位…），
  // 这时回落到「这张卡在做什么」的首句。
  const names = useMemo(() => displayNames(cards), [cards]);
  // 调顺序那一屏看的是**全部**日常里的卡（不分时段）—— 否则挪动时看不到自己挪到了哪
  const mineAll = useMemo(() => routineCards(cards, routine.ids), [cards, routine.ids]);
  // 撤销区看全部日常（不分时段）：早上跳过的卡，晚上切回来仍然能撤销
  const skippedCards = useMemo(
    () => mineAll.filter((c) => isSkippedToday(routine.skipped, c.id, today)),
    [mineAll, routine.skipped, today],
  );
  const pool = useMemo(
    () => dailyCandidates(cards, routine.ids).length,
    [cards, routine.ids],
  );
  // 发现这一批：初次加载 / 跨天 / 换一批时才重新计算
  useEffect(() => {
    if (picksStarted.current || !cards.length) return;
    picksStarted.current = true;
    pickDay.current = today;
    setPickIds(dailyPicks(cards, routine.ids, today, packOffset).map((c) => c.id));
  }, [cards, routine.ids, today, packOffset]);

  useEffect(() => {
    if (!picksStarted.current) return;
    if (pickDay.current === today) return;
    pickDay.current = today;
    setPackOffset(0);
    setPickIds(dailyPicks(cards, routine.ids, today, 0).map((c) => c.id));
  }, [today, cards, routine.ids]);

  // 日常变了（加入 / 导入 / 重置）：只补被加走的那一格，另外两张不动。
  useEffect(() => {
    if (!picksStarted.current) return;
    setPickIds((ids) => {
      let next = ids;
      for (const id of ids) {
        if (routine.ids.includes(id)) {
          next = refillPicks(cards, routine.ids, next, id);
        }
      }
      return next;
    });
  }, [routine.ids, cards]);

  const picks = useMemo(
    () =>
      pickIds
        .map((id) => cards.find((c) => c.id === id))
        .filter((c): c is Card => Boolean(c)),
    [pickIds, cards],
  );

  // 撤销过的周期完成仍留在历史里，但今天这一格不该再算盖过印
  const doneToday = events.filter((e) => e.date === today && e.periodDone !== false).length;
  const activeDays = totalActiveDays(events);
  const dots = recentActivity(events, DOT_DAYS, now.getTime(), dayOf);

  async function toggle(card: Card) {
    const cadence = routine.cadenceOf(card.id);
    const periodKey = periodKeyOf(today, cadence);
    const periodic = cadence !== "daily";
    const periodCadence = cadence === "daily" ? undefined : cadence;
    const periodEvents = events.filter((e) => {
      if (e.cardId !== card.id) return false;
      if (!periodic) return e.date === today && e.periodDone !== false;
      return (
        periodKeyOf(e.date, cadence) === periodKey &&
        (e.periodCadence === undefined || e.periodCadence === cadence)
      );
    });
    const alreadyDone = periodic
      ? doneInPeriod(events, card.id, today, cadence)
      : periodEvents.length > 0;
    if (alreadyDone) {
      if (!periodic) {
        for (const e of periodEvents) await removeEvent(e.ts);
      } else {
        // 只降级真正的完成标记；旧日志没有标记时，把最近一天降级，
        // 更早的每日记录原样留在历史里。
        //
        // 用 updateEvent 而不是 addEvent：撤销是**改同一条**，
        // 而且要刷新 updatedAt —— 否则多设备合并时对面设备看不到这次撤销。
        const completed = periodEvents.filter((e) => e.periodDone === true);
        if (completed.length) {
          for (const e of completed) {
            await updateEvent({ ...e, periodDone: false, periodCadence });
          }
        } else {
          const latest = [...periodEvents].sort(
            (a, b) => a.date.localeCompare(b.date) || a.ts - b.ts,
          ).at(-1);
          if (latest) {
            for (const e of periodEvents) {
              if (e.date === latest.date) {
                await updateEvent({ ...e, periodDone: false, periodCadence });
              }
            }
          }
        }
      }
    } else {
      await addEvent({
        date: today,
        cardId: card.id,
        variant: mode,
        ts: Date.now(),
        ...(periodic ? { periodDone: true, periodCadence } : {}),
      });
      if (periodic) {
        setFlash(`${periodDoneText(cadence)}：「${cardNameOf(card)}」收起来了。`);
      }
    }
    setEvents(await allEvents());
    await routine.acknowledgeFirstRun();
  }

  async function addToMyRoutine(card: Card) {
    await routine.add(card.id);
    // 不重置 packOffset：加走一张只该补那一格，不该把另外两张也换掉。
    setFlash(`「${cardNameOf(card)}」已放进日常。`);
  }

  function nextPicks() {
    const offset = packOffset + 1;
    setPackOffset(offset);
    setPickIds(dailyPicks(cards, routine.ids, today, offset).map((c) => c.id));
  }

  /** 从日常移出一张卡；默认连同它的提醒一起删，避免「卡没了提醒还在」。 */
  async function takeOut(card: Card, keepReminder = false) {
    if (!keepReminder && reminders && onRemindersChange) {
      const next = reminders.filter((x) => x.cardId !== card.id);
      if (next.length !== reminders.length) onRemindersChange(next);
    }
    await routine.takeOut(card.id);
    setFlash(
      keepReminder
        ? `已把「${cardNameOf(card)}」移出日常；它的提醒还留着，可在设置里删。`
        : `已把「${cardNameOf(card)}」移出日常 —— 以后不再出现，盖过的印还在。`,
    );
  }

  /** 今天不做：只跳过这一天，日常不动；过了逻辑日界线自然回来。 */
  async function skipForToday(card: Card) {
    await routine.skipToday(card.id, today);
    setExpanded(null);
    setFlash(`「${cardNameOf(card)}」今天不做，明天会回来。`);
  }

  async function undoSkip(card: Card) {
    await routine.unskip(card.id);
    setFlash(`「${cardNameOf(card)}」放回今天了。`);
  }

  /* -------------------------------------------------------- 自定义习惯 */

  /** 加一条自己的习惯：建卡 + 放进「我的日常」。 */
  async function addHabit(name: string, text: string, slot: HabitSlot) {
    await routine.addHabit(name, text, slot);
    setHabitForm(null);
    setFlash(`「${name}」已放进日常。`);
  }

  /** 改一条自己的习惯。 */
  async function editHabit(name: string, text: string, slot: HabitSlot) {
    const id = habitForm?.mode === "edit" ? habitForm.id : null;
    if (!id) return;
    await routine.editHabit(id, { name, text, slot });
    setHabitForm(null);
    setFlash(`「${name}」改好了。`);
  }

  /**
   * 删掉一条自己的习惯。
   *
   * 自定义习惯只有一处存在：用户的日常里。移出它就等于不要它了 ——
   * 所以这里是真的删掉（连库里的那条），不是只从清单里拿掉。
   */
  async function removeHabit(card: Card) {
    if (reminders && onRemindersChange) {
      const next = reminders.filter((x) => x.cardId !== card.id);
      if (next.length !== reminders.length) onRemindersChange(next);
    }
    await routine.removeHabit(card.id);
    setHabitForm(null);
    setFlash(`「${card.customName ?? cardNameOf(card)}」删掉了。`);
  }

  /**
   * 放回默认的那几张。
   *
   * 与首启给的必须是**同一份** —— 否则「放回」放回来的东西跟第一次看到的不一样，
   * 用户会以为 App 换了一套推荐。默认清单来自内容层；它空了才回落到起步包。
   * 被换掉的卡若带提醒，也一起清掉；确认文案会先说明。
   */
  async function restoreDefault() {
    // 放回默认是**替换**：用户自己从手册/发现里挑的那几张会被换掉。
    // 清单里看不出哪张是「App 放的」、哪张是「你挑的」，所以先问一句；
    // 没有自己挑的卡时不打扰。
    const { dropped, mine } = restoreCounts(routine.ids, routine.restoreIds);
    const next = mergeWithDefault(routine.restoreIds, routine.ids);
    const droppedIds = new Set(routine.ids.filter((id) => !next.includes(id)));
    const droppedReminders = (reminders ?? []).filter(
      (r) => r.cardId && droppedIds.has(r.cardId),
    );
    if (dropped > 0) {
      const ok = window.confirm(
        `放回默认会把你挑的 ${dropped} 张换成 App 的默认清单` +
          (mine ? `；你自己加的 ${mine} 条会保留` : "") +
          (droppedReminders.length
            ? `；其中 ${droppedReminders.length} 张有提醒，也会一起删掉`
            : "") +
          "。\n继续？",
      );
      if (!ok) return;
    }
    await routine.restoreDefault();
    if (droppedReminders.length && reminders && onRemindersChange) {
      const gone = new Set(droppedReminders.map((r) => r.id));
      onRemindersChange(reminders.filter((r) => !gone.has(r.id)));
    }
    let text =
      dropped > 0
        ? `放回 ${routine.restoreIds.length} 张默认的；你挑的 ${dropped} 张被换掉了`
        : `放回 ${routine.restoreIds.length} 张，随时加减`;
    if (dropped > 0 && mine) text += `；自己加的 ${mine} 条还在`;
    if (droppedReminders.length) text += `；${droppedReminders.length} 条提醒也删了`;
    setFlash(`${text}。`);
  }

  return (
    <div class="lg-shell" data-desk="1">
      <TodaySidebar
        today={today}
        slot={slot}
        clockSlot={clockSlot}
        onSlotPick={setSlotPick}
        cond={cond}
        condOpen={condOpen}
        onToggleCond={() => setCondOpen(!condOpen)}
        modeVariants={modeVariants}
        coverage={coverage}
        hasSegments={hasSegments}
        skippedCount={skippedCount}
        routine={routine}
        sorting={sorting}
        onSorting={() => setSorting(true)}
        onRestoreDefault={() => void restoreDefault()}
        habitForm={habitForm}
        onHabitForm={setHabitForm}
        onAddHabit={(n, t, s) => void addHabit(n, t, s)}
        onEditHabit={(n, t, s) => void editHabit(n, t, s)}
        mineCount={mine.length}
        logOpen={logOpen}
        logShown={Math.min(mine.length, LOG_CHUNK)}
        doneToday={doneToday}
        activeDays={activeDays}
        dots={dots}
        loading={loading}
      />

      <main class="lg-main">
        {/* 年龄档只影响少数分档卡，但默认成人不等于用户选过。
            先问一次（可跳过），否则 70+ 用户会在不知情时拿到成人动作。 */}
        {!loading && routine.ready && ageKnown === false ? (
          <OnboardingFold
            class="lg-firstrun lg-ageask"
            open={!foldOnboarding || ageOpen}
            onToggle={setAgeOpen}
            summary="先选年龄段（默认成年人）"
            fold={foldOnboarding}
          >
            <p>
              <b class="lg-nb">先选年龄段。</b>
              手册里有几个动作会按年龄换一套。选一个；以后可在
              <span class="lg-nb">「条件」</span>里改。
            </p>
            <div class="lg-cats" role="group" aria-label="年龄段">
              {AGE_TAGS.map((t) => (
                <button
                  key={t}
                  class="lg-cat"
                  onClick={() => onTag(t)}
                >
                  {TAG_LABELS[t] ?? t}
                </button>
              ))}
            </div>
            <button class="lg-linkbtn lg-ageask-skip" onClick={onSkipAgePrompt}>
              先按成年人显示
            </button>
          </OnboardingFold>
        ) : null}
        {/* 首启说明：清单是 App 替你放的，得说清能怎么改。
            放在主栏而不是侧栏 —— 侧栏只有 232px 宽，两段话会被压成八行。 */}
        {routine.firstRun ? (
          <OnboardingFold
            class="lg-firstrun"
            open={!foldOnboarding || introOpen}
            onToggle={setIntroOpen}
            summary="第一次用？看怎么改"
            fold={foldOnboarding}
          >
            <p>
              这几张是按手册里<span class="lg-nb">「每天固定做的几件事」</span>替你放的。
              做完点右边的方格<span class="lg-nb">盖个印</span>；不想做的，展开卡片点
              <span class="lg-nb">「今天不做」</span>只跳过今天，点
              <span class="lg-nb">「移出日常」</span>以后都不出现。
            </p>
            <p>
              次序用<span class="lg-nb">「调顺序」</span>改。某张卡要单独提醒，展开点
              <span class="lg-nb">「设提醒」</span>；早晚两条整段提醒在设置里 ——
              先允许通知，它才会响。
            </p>
          </OnboardingFold>
        ) : null}
        {/* 今天不做放在清单上方：跳过一张后它就在眼前，撤销不用翻到页尾。
            只在今天页显示；调顺序时让位给清单本身。 */}
        {!sorting && !loading && routine.ready && skippedCards.length ? (
          <div class="lg-perioddone lg-skipped">
            <p class="lg-pool">今天不做</p>
            <p class="lg-note-soft">只跳过今天，明天自己回来。</p>
            <div class="lg-btn-row">
              {/* 卡名留作纯文字：「撤销」单独成一颗键。
                 原来把卡名做成撤销键 —— 全 App 里点头像都是展开这张卡，
                 在这里点头像却是撤销跳过，误触就把卡悄悄放回清单。
                 名字与「撤销」必须成对挨着：跳过两张以上时，
                 名字一排、撤销一排，谁对不上哪张就说不清了。 */}
              {skippedCards.map((c) => (
                <span key={c.id} class="lg-skipitem">
                  <span class="lg-skipname">{names.get(c.id) ?? cardNameOf(c)}</span>
                  <button class="lg-linkbtn" onClick={() => void undoSkip(c)}>
                    撤销
                  </button>
                </span>
              ))}
            </div>
          </div>
        ) : null}
        {/* 展开卡里的小节标题是 h3；这里补一个给读屏的 h2，别让 h1 直接跳到 h3。 */}
        <h2 class="lg-sr-only">今天的动作</h2>
        {loading || !routine.ready ? (
          // 清单还没从库里读回来时也走这里：空着不等于「被清空了」
          <p class="lg-do">加载中…</p>
        ) : mineAll.length === 0 ? (
          // 日常空了（不是「这一段没有卡」）：给放回去的路。
          // 调顺序那一屏里把卡全移掉也会走到这里 —— 否则用户会停在一个空面板里。
          <div class="lg-empty">
            <h2>今天还没有动作</h2>
            <p>
              手册里{" "}
              <span class="tabular">{pool}</span>
              {" 个动作都能照着做。放回默认的几张，或者从下面「发现」里挑。"}
            </p>
            <div class="lg-btn-row">
              <button
                class="lg-btn"
                onClick={() => void restoreDefault()}
                disabled={!routine.restoreIds.length}
              >
                {routine.restoreIds.length
                  ? `放回默认的 ${routine.restoreIds.length} 张`
                  : "放回默认"}
              </button>
            </div>
            <p class="lg-pool">断几天不清零 —— 盖过的印还在。</p>
          </div>
        ) : sorting ? (
          <Suspense fallback={<p class="lg-do">加载中…</p>}>
            <SortPanel
              cards={mineAll}
              names={names}
              actionLine={actionLine}
              onMove={(id, dir) => void routine.move(id, dir)}
              onReorder={(ids) => void routine.set(ids)}
              reminders={reminders}
              onTakeOut={(x, keepReminder) =>
                void (isCustomCard(x) ? removeHabit(x) : takeOut(x, keepReminder))
              }
              onClose={() => {
                setSorting(false);
                // 从清单末尾点「回到今天」时也回到顶部，别落在今天列表的中段。
                window.scrollTo(0, 0);
              }}
            />
          </Suspense>
        ) : mine.length === 0 && periodDone.length === 0 && skippedInSlot.length > 0 ? (
          <div class="lg-empty">
            <h2>{SLOT_LABELS[slot]}这一段今天都不做</h2>
            <p>
              明天会自己回来；可在上面撤销，也可以看看别的时段。
            </p>
            <SlotSwitch slot={slot} onPick={setSlotPick} />
          </div>
        ) : mine.length === 0 && periodDone.length === 0 ? (
          // 日常里有卡，但都不属于这一段 —— 说清是「这一段」的事，不是「你移光了」
          <div class="lg-empty">
            <h2>{SLOT_LABELS[slot]}没有安排动作</h2>
            <p>
              日常里还有 <span class="tabular">{mineAll.length}</span> 张，都在别的时段。
            </p>
            <SlotSwitch slot={slot} onPick={setSlotPick} />
          </div>
        ) : (
          <TodayLog
            cards={mine}
            names={names}
            mode={mode}
            tags={tags}
            events={events}
            today={today}
            expanded={expanded}
            onExpand={setExpanded}
            onToggle={(c) => void toggle(c)}
            dayOfMonth={Number(today.slice(8))}
            reminders={reminders}
            onRemindersChange={onRemindersChange}
            onOpenArticle={onOpenArticle}
            onEditHabit={setHabitForm}
            onRemoveHabit={(c) => void removeHabit(c)}
            onSkipToday={(c) => void skipForToday(c)}
            onTakeOut={(c, keepReminder) => void takeOut(c, keepReminder)}
            cadenceOf={routine.cadenceOf}
            onCadenceChange={(id, cadence) => void routine.setCadence(id, cadence)}
            allOpen={logOpen}
            onAllOpenChange={setLogOpen}
          />
        )}

        {!sorting && !loading && routine.ready && periodDone.length ? (
          <div class="lg-perioddone">
            <p class="lg-pool">本周期已完成</p>
            <p class="lg-note-soft">下个周期会自己回来。</p>
            <div class="lg-btn-row">
              {periodDone.map((c) => (
                <button
                  key={c.id}
                  class="lg-linkbtn"
                  title="撤销这次周期完成"
                  onClick={() => void toggle(c)}
                >
                  {names.get(c.id) ?? cardNameOf(c)}（撤销）
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {flash ? (
          <p class="lg-flash" role="status" aria-live="polite">
            {flash}
          </p>
        ) : null}

        {/* 调顺序时是专注改清单，不把「发现」也铺在下面 ——
            它会把页面拉长，还会把「回到今天」推到看不见的地方。
            清单没读回来时也别先挂「发现」：它先出现、随后又被今天的卡片顶下去，
            实测 CLS 0.60 —— 等清单就绪再一起画。 */}
        {sorting || loading || !routine.ready || !picks.length ? null : (
          <DiscoverPanel
            picks={picks}
            names={names}
            pool={pool}
            mode={mode}
            tags={tags}
            onOpenArticle={onOpenArticle}
            onAdd={(c) => void addToMyRoutine(c)}
            onNext={nextPicks}
          />
        )}
        <Disclaimer />
      </main>
    </div>
  );
}

/** 提示语里用短名，别把整句 remind 抄进反馈条 */
function cardNameOf(card: Card): string {
  // 用屏上显示的那个名字（内容层另起的动作名，没有才是小节名）——
  // 提示条里的短名和屏上的名字不一致，用户会以为说的是两张卡。
  return cardName(card);
}

/** 这一张卡在做什么（挪次序时用来分清同名的那几张） */
function actionLine(card: Card): string {
  const t = card.remind.text.replace(/\s+/g, " ").trim();
  return t.length > 22 ? t.slice(0, 22) + "…" : t;
}

/** 空时段里给两颗换段键 —— 停在「这一段没动作」不如直接带人去看别段。 */
function SlotSwitch({
  slot,
  onPick,
}: {
  slot: Slot;
  onPick: (slot: Slot | null) => void;
}) {
  return (
    <div class="lg-btn-row" style="margin-top:12px">
      {SWITCHABLE_SLOTS.filter((s) => s !== slot).map((s) => (
        <button key={s} class="lg-btn lg-btn-ghost" onClick={() => onPick(s)}>
          看「{SLOT_LABELS[s]}」
        </button>
      ))}
    </div>
  );
}
