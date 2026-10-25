/**
 * 调顺序那一屏的每一行：能拖。
 *
 * 为什么还留着 ↑↓：拖拽是鼠标/手指的事，键盘与读屏走不了那条路 ——
 * ↑↓ 才是那条路（也能当拖拽失灵时的兜底）。
 *
 * 拖拽用的是 @dnd-kit（React 写的，靠 Vite 的 preact/compat 别名跑起来 ✓）。
 */
import { useSortable } from "@dnd-kit/sortable";
import type { ComponentProps } from "preact";
import { useState } from "preact/hooks";

import { slotLabel } from "../domain/day.ts";
import { isCustomCard } from "../domain/custom.ts";
import { describeReminder, type Reminder } from "../domain/reminders.ts";
import type { Card } from "../domain/routine.ts";

export interface SortableRowProps {
  card: Card;
  index: number;
  total: number;
  /** 屏上显示的名字 */
  name: string;
  /** 这一句是「这张卡在做什么」 */
  action: string;
  /** 这张卡的提醒：有的话，移出前先问 */
  reminder?: Reminder;
  onMove: (cardId: string, dir: -1 | 1) => void;
  onTakeOut: (card: Card, keepReminder?: boolean) => void;
}

export function SortableRow({
  card,
  index,
  total,
  name,
  action,
  reminder,
  onMove,
  onTakeOut,
}: SortableRowProps) {
  // 用户自己加的：移出就等于不要它了，所以那颗键写「删掉」
  const custom = isCustomCard(card);
  const [ask, setAsk] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  // dnd-kit 的 attributes 带 role: string，Preact 的类型只认那一小撮字面量 ——
  // 断言一下（值本身是对的，只是类型太宽）
  const dragProps = { ...attributes, ...listeners } as unknown as ComponentProps<"button">;

  return (
    <li
      ref={setNodeRef}
      data-dragging={isDragging ? "true" : undefined}
      style={{
        transform: transform ? `translateY(${transform.y}px)` : undefined,
        transition,
        opacity: isDragging ? 0.65 : undefined,
      }}
    >
      <button
        class="lg-grip"
        ref={setActivatorNodeRef}
        {...dragProps}
        aria-label={`拖动「${name}」调整次序`}
        title="拖动调整次序"
      >
        ⠿
      </button>
      <span class="lg-sort-when">{slotLabel(card.slot ?? "anytime")}</span>
      <span class="lg-sort-name">
        <b>{name}</b>
        {/* 一个小节拆出多张卡时名字会一样（原文小节名当卡名）——
            补一行这句动作，那几行才分得清是在挪哪张 */}
        <small>{action}</small>
      </span>
      <span class="lg-sort-ops">
        <button
          class="lg-move"
          aria-label={`把「${name}」上移`}
          disabled={index === 0}
          onClick={() => onMove(card.id, -1)}
        >
          ↑
        </button>
        <button
          class="lg-move"
          aria-label={`把「${name}」下移`}
          disabled={index === total - 1}
          onClick={() => onMove(card.id, 1)}
        >
          ↓
        </button>
        <button
          class="lg-move"
          aria-label={`把「${name}」${custom ? "删掉" : "移出今天"}`}
          onClick={() => {
            if (custom || !reminder) {
              onTakeOut(card);
              return;
            }
            setAsk(true);
          }}
        >
          {custom ? "删掉" : "移出"}
        </button>
      </span>
      {ask && reminder ? (
        <div class="lg-sort-ask" role="group" aria-label="移出时怎么处理提醒">
          <span>这张卡有提醒（{describeReminder(reminder)}）。</span>
          <button class="lg-linkbtn" onClick={() => onTakeOut(card)}>
            一起删
          </button>
          <button class="lg-linkbtn" onClick={() => onTakeOut(card, true)}>
            只移卡
          </button>
          <button class="lg-linkbtn" onClick={() => setAsk(false)}>
            取消
          </button>
        </div>
      ) : null}
    </li>
  );
}
