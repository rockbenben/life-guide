/**
 * 今天页的「页边」：日期与时段 · 条件一行 · 调顺序/重置/加我自己的 · 总览 · 首启说明。
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
  /** 当前清单里被模式标记为「今天不做」的卡数 */
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
  return (
    <div class="lg-aside">
      <div class="lg-topbar">
        <h1 class="lg-h1">今天</h1>
        <span class="lg-dateline">
          {new Date(`${today}T00:00:00`).toLocaleDateString("zh-CN", {
            month: "long",
            day: "numeric",
            weekday: "long",
          })}{" "}
          · {SLOT_LABELS[slot]}
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

      <p class="lg-pool" data-dp="slothint">
        这里看的是「{SLOT_LABELS[slot]}」这一段要做的动作；标着「随时」的一直在。
      </p>

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
          「重置为默认」是第三件：把日常恢复成 App 给的初始清单，用户改乱了能一键回来。
          「加我自己的」是第四件：手册里没有的习惯，用户自己能加。 */}
      {!sorting ? (
        <div class="lg-setuprow">
          <button
            class="lg-btn lg-btn-ghost lg-sortbtn"
            disabled={routine.ids.length <= 1}
            onClick={onSorting}
          >
            调顺序
          </button>
          <button
            class="lg-btn lg-btn-ghost lg-sortbtn"
            disabled={!restoreIds.length}
            title="放回 App 给的那张默认清单 —— 你自己挑的那几张会被换掉"
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
            加我自己的
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

      {loading || !mineCount ? null : (
        <p class="lg-overview">
          <span class="lg-big tabular">{mineCount}</span>
          <span>个动作</span>
          {skippedCount > 0 ? (
            <span>
              · <span class="tabular">{skippedCount}</span> 个今天不做
            </span>
          ) : null}
          <span>
            今天盖了 <span class="tabular">{doneToday}</span> 印
          </span>
          {activeDays > 0 ? (
            <>
              <span>
                · 累计 <span class="tabular">{activeDays}</span> 天
              </span>
              <span class="lg-dots" aria-hidden="true">
                {dots.map((on, i) => (
                  <i key={i} class="lg-dot" data-on={on ? "1" : undefined} />
                ))}
              </span>
            </>
          ) : null}
        </p>
      )}
    </div>
  );
}
