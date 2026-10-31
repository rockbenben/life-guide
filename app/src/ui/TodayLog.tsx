/**
 * 今天页的清单：这一段该做的那些卡（收起态 + 展开态）。
 *
 * 与页边分开是因为它要的东西完全不同：页边要「时段与条件」，
 * 清单要「事件日志、提醒、模式与人群标签」。
 *
 * **清单长了要能收起来**（2026-10-31 加）：默认清单扩到 40 张之后，
 * 这一段随时会有 30 多张 —— 全铺开就是一屏目录，正是这个项目要否定的用法。
 * 所以先铺前 `LOG_CHUNK` 张，其余收在一行「还有 N 件」里。
 * 折叠与卡内步骤的折叠同一形态（`lg-more` 那颗键）。
 */
import { useState } from "preact/hooks";

import { CardView } from "./Card.tsx";
import { isCustomCard, type HabitSlot } from "../domain/custom.ts";
import { daysDone } from "../domain/progress.ts";
import type { DoneEvent } from "../data/db.ts";
import type { Card, Mode } from "../domain/routine.ts";
import { describeReminder, type Reminder } from "../domain/reminders.ts";
import type { Cadence } from "../domain/cadence.ts";
import type { HabitFormState } from "./TodaySidebar.tsx";

/** 默认铺几张；其余收在「还有 N 件」里。 */
export const LOG_CHUNK = 12;

export interface TodayLogProps {
  /** 这一段该做的卡（次序即显示次序） */
  cards: Card[];
  /** 屏上叫什么（同名卡会撞车，回落到「这张卡在做什么」的首句） */
  names: Map<string, string>;
  mode: Mode;
  tags: string[];
  events: DoneEvent[];
  today: string;
  expanded: string | null;
  onExpand: (cardId: string | null) => void;
  onToggle: (card: Card) => void;
  dayOfMonth: number;

  reminders?: Reminder[];
  onRemindersChange?: (reminders: Reminder[]) => void;
  onOpenArticle?: (path: string) => void;

  /** 自定义习惯：页脚那两颗键（改 / 删掉） */
  onEditHabit: (form: HabitFormState) => void;
  onRemoveHabit: (card: Card) => void;
  /** 今天不做：只跳过今天，不改日常 */
  onSkipToday: (card: Card) => void;
  /** keepReminder=true 只移出日常，保留它的提醒 */
  onTakeOut: (card: Card, keepReminder?: boolean) => void;
  cadenceOf: (cardId: string) => Cadence;
  onCadenceChange: (cardId: string, cadence: Cadence) => void;
  /** 清单是收着还是展着（由父组件管 —— 页边那行也要知道） */
  allOpen?: boolean;
  onAllOpenChange?: (open: boolean) => void;
}

/** 移出前的确认：有提醒时让用户选「一起删」还是「只移卡」。 */
function TakeOutButton({
  card,
  reminder,
  onTakeOut,
}: {
  card: Card;
  reminder?: Reminder;
  onTakeOut: (card: Card, keepReminder?: boolean) => void;
}) {
  const [ask, setAsk] = useState(false);
  if (!reminder) {
    return (
      <button
        class="lg-close"
        title="以后都不出现；手册里还能再加回来"
        onClick={() => onTakeOut(card)}
      >
        移出日常
      </button>
    );
  }
  if (!ask) {
    return (
      <button
        class="lg-close"
        title="以后都不出现；手册里还能再加回来"
        onClick={() => setAsk(true)}
      >
        移出日常
      </button>
    );
  }
  return (
    <div class="lg-rowfoot-ask" role="group" aria-label="移出日常时怎么处理提醒">
      <span>
        这张卡有提醒（{describeReminder(reminder)}）。移出后怎么处理它？
      </span>
      <button
        class="lg-close"
        title="把这条提醒也删掉"
        onClick={() => onTakeOut(card)}
      >
        一起删
      </button>
      <button class="lg-linkbtn" onClick={() => onTakeOut(card, true)}>
        只移卡
      </button>
      <button class="lg-linkbtn" onClick={() => setAsk(false)}>
        取消
      </button>
    </div>
  );
}

export function TodayLog({
  cards,
  names,
  mode,
  tags,
  events,
  today,
  expanded,
  onExpand,
  onToggle,
  dayOfMonth,
  reminders,
  onRemindersChange,
  onOpenArticle,
  onEditHabit,
  onRemoveHabit,
  onSkipToday,
  onTakeOut,
  cadenceOf,
  onCadenceChange,
  allOpen: allOpenProp,
  onAllOpenChange,
}: TodayLogProps) {
  // 清单长了先铺前几张，其余收起来（默认清单 40 张后随时那一档有 30 多张）。
  // 状态由父组件管（页边那行「先铺 N 张」也要知道现在收着还是展着）。
  const [localOpen, setLocalOpen] = useState(false);
  const allOpen = allOpenProp ?? localOpen;
  const setAllOpen = (open: boolean) => {
    setLocalOpen(open);
    onAllOpenChange?.(open);
  };
  const longList = cards.length > LOG_CHUNK;
  const shown = longList && !allOpen ? cards.slice(0, LOG_CHUNK) : cards;
  const hidden = cards.length - shown.length;

  return (
    <div class="lg-log">
      {shown.map((c) => {
        const done = events.some(
          (e) => e.cardId === c.id && e.date === today && e.periodDone !== false,
        );
        const custom = isCustomCard(c);
        return (
          // data-card-unit 标出「这一张卡」的全部范围：末尾那排键
          // （今天不做 / 移出日常 / 改 / 删掉）画在 article 之外，
          // 点它们不算「点了别处」，否则那张确认行会跟着卡一起被收掉。
          <div key={c.id} data-card-unit={c.id} data-open={expanded === c.id ? "true" : undefined}>
            <CardView
              card={c}
              mode={mode}
              userTags={tags}
              done={done}
              streakDays={daysDone(events, c.id)}
              expanded={expanded === c.id}
              onExpand={() => onExpand(expanded === c.id ? null : c.id)}
              onToggle={() => onToggle(c)}
              displayName={names.get(c.id)}
              reminders={reminders}
              onRemindersChange={onRemindersChange}
              onOpenArticle={onOpenArticle}
              dayOfMonth={dayOfMonth}
              cadence={cadenceOf(c.id)}
              onCadenceChange={(value) => onCadenceChange(c.id, value)}
              // 末尾除了「收起」还有哪颗键 —— 写进跳到末尾那颗键里，
              // 手机上展开一张卡有一屏多，末尾的键在首屏里看不见。
              endExtra={
                custom
                  ? done
                    ? "改 · 删掉"
                    : "今天不做 · 改 · 删掉"
                  : done
                    ? "移出日常"
                    : "今天不做 · 移出日常"
              }
            />
            {expanded === c.id ? (
              <div class="lg-rowfoot">
                {!done ? (
                  <button
                    class="lg-linkbtn"
                    title="只跳过今天，明天会回来"
                    onClick={() => onSkipToday(c)}
                  >
                    今天不做
                  </button>
                ) : null}
                {custom ? (
                  /* 自定义习惯：移出就等于不要了，所以是真的删掉 */
                  <>
                    <button
                      class="lg-linkbtn"
                      onClick={() =>
                        onEditHabit({
                          mode: "edit",
                          id: c.id,
                          name: c.customName ?? "",
                          text: c.remind?.text ?? "",
                          slot: (c.slot ?? "anytime") as HabitSlot,
                        })
                      }
                    >
                      改
                    </button>
                    <button class="lg-close" onClick={() => onRemoveHabit(c)}>
                      删掉
                    </button>
                  </>
                ) : (
                  <TakeOutButton
                    card={c}
                    reminder={reminders?.find((r) => r.cardId === c.id)}
                    onTakeOut={onTakeOut}
                  />
                )}
              </div>
            ) : null}
          </div>
        );
      })}
      {longList ? (
        <button
          class="lg-more"
          aria-expanded={allOpen}
          onClick={() => setAllOpen(!allOpen)}
        >
          {allOpen
            ? `只看前 ${LOG_CHUNK} 件`
            : `还有 ${hidden} 件，全展开`}
        </button>
      ) : null}
    </div>
  );
}
