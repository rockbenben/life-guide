/**
 * 「调顺序」那一屏：日常里的卡按次序排开，能拖、能用 ↑↓。
 *
 * 看的是**全部**日常里的卡（不分时段）—— 否则挪动时看不到自己挪到了哪。
 * 有提醒的卡在移出前会先问「一起删 / 只移卡 / 取消」，与卡片展开态一致。
 */
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { SortableRow } from "./SortableRow.tsx";
import type { Card } from "../domain/routine.ts";
import type { Reminder } from "../domain/reminders.ts";

export interface SortPanelProps {
  /** 日常里的全部卡（次序即显示次序） */
  cards: Card[];
  /** 屏上叫什么 */
  names: Map<string, string>;
  /** 每张卡「在做什么」—— 同名的那几行才分得清 */
  actionLine: (card: Card) => string;
  /** ↑↓ 挪一位 */
  onMove: (cardId: string, dir: -1 | 1) => void;
  /** 拖完给一份新的次序（清单数组就是它） */
  onReorder: (ids: string[]) => void;
  /** 移出（自定义习惯走删除）；keepReminder=true 只移卡，保留提醒 */
  onTakeOut: (card: Card, keepReminder?: boolean) => void;
  /** 卡上那些提醒：移出有提醒的卡时要先问 */
  reminders?: Reminder[];
  onClose: () => void;
}

export function SortPanel({
  cards,
  names,
  actionLine,
  onMove,
  onReorder,
  onTakeOut,
  reminders,
  onClose,
}: SortPanelProps) {
  /**
   * 拖拽排序：按住手柄拖一下，落到哪儿就是哪儿。
   *
   * 按下要移动 6px 才算拖（activationConstraint）—— 否则点一下手柄
   * 也会被当成拖，用户只想点它看看。
   */
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = cards.findIndex((c) => c.id === String(active.id));
    const to = cards.findIndex((c) => c.id === String(over.id));
    if (from < 0 || to < 0) return;
    const next = [...cards];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onReorder(next.map((c) => c.id));
  }

  return (
    <div class="lg-sort">
      <div class="lg-sort-h">
        <h2>你的日常 · 次序</h2>
        <button class="lg-btn lg-btn-ghost" onClick={onClose}>
          回到今天
        </button>
      </div>
      <p class="lg-pool">
        这里是你日常里的全部动作（不分时段）。拖一下手柄就能挪位置；也可以用 ↑↓（键盘与读屏走的是那条路）。
        默认按时间排，挪过之后按你摆的来。
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <ol class="lg-sortlist">
            {cards.map((c, i) => (
              <SortableRow
                key={c.id}
                card={c}
                index={i}
                total={cards.length}
                name={names.get(c.id) ?? c.id}
                action={actionLine(c)}
                reminder={reminders?.find((r) => r.cardId === c.id)}
                onMove={(id, dir) => onMove(id, dir)}
                onTakeOut={onTakeOut}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {/* 清单很长时，排到最下面的人看不到顶部那颗「回到今天」——
          底部导航的「今天」是当前页、点了不会退出这个面板，所以这里再给一个出口。 */}
      <div class="lg-btn-row" style="margin-top:18px">
        <button class="lg-btn lg-btn-ghost" onClick={onClose}>
          回到今天
        </button>
      </div>
    </div>
  );
}
