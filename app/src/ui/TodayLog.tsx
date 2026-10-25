/**
 * 今天页的清单：这一段该做的那些卡（收起态 + 展开态）。
 *
 * 与页边分开是因为它要的东西完全不同：页边要「时段与条件」，
 * 清单要「事件日志、提醒、模式与人群标签」。
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
  /** keepReminder=true 只把卡移出，保留它的提醒 */
  onTakeOut: (card: Card, keepReminder?: boolean) => void;
  cadenceOf: (cardId: string) => Cadence;
  onCadenceChange: (cardId: string, cadence: Cadence) => void;
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
      <button class="lg-close" onClick={() => onTakeOut(card)}>
        移出今天
      </button>
    );
  }
  if (!ask) {
    return (
      <button class="lg-close" onClick={() => setAsk(true)}>
        移出今天
      </button>
    );
  }
  return (
    <div class="lg-rowfoot-ask" role="group" aria-label="移出时怎么处理提醒">
      <span>
        这张卡有提醒（{describeReminder(reminder)}）。
      </span>
      <button class="lg-close" onClick={() => onTakeOut(card)}>
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
  onTakeOut,
  cadenceOf,
  onCadenceChange,
}: TodayLogProps) {
  return (
    <div class="lg-log">
      {cards.map((c) => (
        <div key={c.id} data-open={expanded === c.id ? "true" : undefined}>
          <CardView
            card={c}
            mode={mode}
            userTags={tags}
            done={events.some(
              (e) => e.cardId === c.id && e.date === today && e.periodDone !== false,
            )}
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
            endExtra={isCustomCard(c) ? "改 · 删掉" : "移出今天"}
          />
          {expanded === c.id ? (
            <div class="lg-rowfoot">
              {isCustomCard(c) ? (
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
      ))}
    </div>
  );
}
