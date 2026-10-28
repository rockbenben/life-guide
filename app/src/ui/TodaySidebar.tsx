/**
 * 今天页的「页边」：日期与时段 · 条件一行 · 调顺序/重置/加自己的习惯 · 总览 · 首启说明。
 *
 * 为什么单独一个文件：它与主栏的清单没有共用状态（只有「这一段有几张卡」和
 * 几个动作回调），拆出来以后这一屏要改（比如加一个新入口）不用翻整页。
 *
 * DOM 结构照旧 —— 样式与验收脚本都指着这些类名。
 */
import { ConditionBar } from "./Conditions.tsx";
import { HabitForm } from "./HabitForm.tsx";
import { SLOT_LABELS, SWITCHABLE_SLOTS, type Slot } from "../domain/day.ts";
import type { HabitSlot } from "../domain/custom.ts";
import type { Mode, ModeCounts, ModeVariants } from "../domain/routine.ts";
import type { RoutineStore } from "../data/useRoutine.ts";

/** 自定义习惯的表单开着没有、开的是哪一条 */
export type HabitFormState =
  | null
  | { mode: "new" }
  | { mode: "edit"; id: string; name: string; text: string; slot: HabitSlot };

export interface TodaySidebarProps {
  /** 逻辑日（YYYY-MM-DD，04:00 为界）—— 页首日期跟它走，不跟钟点日的日历日走 */
  today: string;
  /** 当前看的那一段 */
  slot: Slot;
  /** 钟点决定的那一段（跟着它走时可以手动切走） */
  clockSlot: Slot;
  onSlotPick: (slot: Slot | null) => void;

  /** 条件（模式 + 我的情况） */
  cond: {
    mode: Mode;
    tags: string[];
    onMode: (m: Mode) => void;
    onTag: (t: string) => void;
  };
  condOpen: boolean;
  onToggleCond: () => void;
  modeVariants?: ModeVariants;
  coverage?: ModeCounts;
  hasSegments?: boolean;

  /** 「我的日常」：只用 restoreIds（放回默认放哪几张） */
  routine: RoutineStore;
  sorting: boolean;
  onSorting: () => void;
  onRestoreDefault: () => void;

  habitForm: HabitFormState;
  onHabitForm: (form: HabitFormState) => void;
  onAddHabit: (name: string, text: string, slot: HabitSlot) => void;
  onEditHabit: (name: string, text: string, slot: HabitSlot) => void;

  /** 总览：这一段几张卡、今天盖了几印、累计几天 */
  mineCount: number;
  doneToday: number;
  activeDays: number;
  dots: boolean[];
  loading?: boolean;
  /** 当前清单里被模式（生病等）标记为不做的卡数 */
  skippedCount?: number;
}

export function TodaySidebar({
  today,
  slot,
  clockSlot,
  onSlotPick,
  cond,
  condOpen,
  onToggleCond,
  modeVariants,
  coverage,
  hasSegments,
  routine,
  sorting,
  onSorting,
  onRestoreDefault,
  habitForm,
  onHabitForm,
  onAddHabit,
  onEditHabit,
  mineCount,
  doneToday,
  activeDays,
  dots,
  loading,
  skippedCount = 0,
}: TodaySidebarProps) {
  const restoreIds = routine.restoreIds;
  const dayDate = new Date(`${today}T00:00:00`);
  return (
    <div class="lg-aside">
      <div class="lg-topbar">
        <h1 class="lg-h1">今天</h1>
        <span class="lg-dateline">
          {dayDate.toLocaleDateString("zh-CN", { month: "long", day: "numeric" })}{" "}
          {dayDate.toLocaleDateString("zh-CN", { weekday: "long" })}
          {" · "}
          {SLOT_LABELS[slot]}
        </span>
      </div>

      <div class="lg-slots" role="group" aria-label="时段">
        {SWITCHABLE_SLOTS.map((s) => (
          <button
            key={s}
            class="lg-slot"
            aria-pressed={s === slot}
            title={s === clockSlot ? "现在就是这个时段" : "看看这一段该做什么"}
            onClick={() => onSlotPick(s === clockSlot ? null : s)}
          >
            {SLOT_LABELS[s]}
            {s === clockSlot ? <small>现在</small> : null}
          </button>
        ))}
      </div>

      {/* 账目放在时段下面：这是这一屏最在意的事（断签不清零），
          藏到工具按钮底下就等于没有。数字大、名目小，像手帖页边的一行记数。 */}
      {loading || !routine.ready || !(mineCount || doneToday || activeDays) ? null : (
        <div class="lg-overview">
          <span class="lg-stat">
            这一段 <b class="tabular">{mineCount}</b> 个动作
          </span>
          <span class="lg-stat">
            今天已盖 <b class="tabular">{doneToday}</b> 印
          </span>
          {activeDays > 0 ? (
            <span class="lg-stat">
              累计 <b class="tabular">{activeDays}</b> 天
              <span class="lg-dots" aria-hidden="true">
                {dots.map((on, i) => (
                  <i key={i} class="lg-dot" data-on={on ? "1" : undefined} />
                ))}
              </span>
            </span>
          ) : null}
          {skippedCount > 0 ? (
            <span class="lg-stat-note">
              <span class="tabular">{skippedCount}</span> 个动作按当前模式不做
            </span>
          ) : null}
        </div>
      )}

      <ConditionBar
        mode={cond.mode}
        tags={cond.tags}
        onMode={cond.onMode}
        onTag={cond.onTag}
        open={condOpen}
        onToggle={onToggleCond}
        modeVariants={modeVariants}
        coverage={coverage}
        coverageScope="current"
        hasSegments={hasSegments}
      />

      {/* 挑（筛选）与排序是用户的两种自由：挑在卡片上，排序在这里。
          「放回默认」把日常恢复成 App 给的初始清单，改乱了能一键回来。
          「加自己的习惯」给的是手册里没有的那部分。 */}
      {!sorting ? (
        <div class="lg-setuprow">
          <button
            class="lg-btn lg-btn-ghost lg-sortbtn"
            disabled={routine.ids.length <= 1}
            title={
              routine.ids.length <= 1
                ? "日常里至少有两张才能调次序"
                : "拖动或用 ↑↓ 调整次序"
            }
            onClick={onSorting}
          >
            调顺序
          </button>
          <button
            class="lg-btn lg-btn-ghost lg-sortbtn"
            disabled={!restoreIds.length}
            title={
              restoreIds.length
                ? "放回 App 给的那份默认清单 —— 你自己挑的那几张会被换掉"
                : "没有可放回的默认清单"
            }
            onClick={onRestoreDefault}
          >
            放回默认
          </button>
          <button
            class="lg-btn lg-btn-ghost lg-sortbtn lg-addhabit"
            onClick={() =>
              onHabitForm(habitForm?.mode === "new" ? null : { mode: "new" })
            }
          >
            加自己的习惯
          </button>
        </div>
      ) : null}

      {/* 表单就在按钮下面 —— 触发的地方和表单挨着 */}
      {habitForm ? (
        habitForm.mode === "new" ? (
          <HabitForm
            onSave={(name, text, slot) => onAddHabit(name, text, slot)}
            onCancel={() => onHabitForm(null)}
          />
        ) : (
          <HabitForm
            title="改这条习惯"
            initial={{
              name: habitForm.name,
              text: habitForm.text,
              slot: habitForm.slot,
            }}
            onSave={(name, text, slot) => onEditHabit(name, text, slot)}
            onCancel={() => onHabitForm(null)}
          />
        )
      ) : null}
    </div>
  );
}
