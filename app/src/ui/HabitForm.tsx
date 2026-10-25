/**
 * 加一条自己的习惯（也能改）。
 *
 * 为什么是表单而不是直接用一张现成的卡：手册里 518 张卡是别人的习惯，
 * 「我每天冥想 10 分钟」这种只有用户自己知道。App 得给这条路。
 *
 * **但不给它另造一套界面**：加完之后它在数据层就是一张卡，
 * 所以盖章、累计天数、提醒、次序全都白得。
 *
 * 三个字段：叫什么、做什么（可空）、什么时候做。
 * 时段是**用户说的**，不是原文说的 —— 内容层那条「只有原文明确说了才填时段」
 * 的规矩管的是策展，管不到用户自己的习惯。
 */
import { useState } from "preact/hooks";

import { HABIT_NAME_MAX, HABIT_TEXT_MAX, type HabitSlot } from "../domain/custom.ts";

const SLOTS: { id: HabitSlot; label: string }[] = [
  { id: "morning", label: "早晨" },
  { id: "daytime", label: "日间" },
  { id: "evening", label: "晚间" },
  { id: "anytime", label: "随时" },
];

export interface HabitFormProps {
  /** 改的时候带上原来的值 */
  initial?: { name: string; text: string; slot: HabitSlot };
  title?: string;
  onSave: (name: string, text: string, slot: HabitSlot) => void;
  onCancel: () => void;
}

export function HabitForm({ initial, title, onSave, onCancel }: HabitFormProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [text, setText] = useState(initial?.text ?? "");
  const [slot, setSlot] = useState<HabitSlot>(initial?.slot ?? "anytime");
  const trimmed = name.trim();

  function submit(e: Event) {
    e.preventDefault();
    if (!trimmed) return;
    onSave(trimmed, text.trim(), slot);
  }

  return (
    <form class="lg-habitform" onSubmit={submit}>
      <h3>{title ?? "加一个自己的习惯"}</h3>

      <label class="lg-habitfield">
        <span>叫什么</span>
        <input
          type="text"
          value={name}
          maxlength={HABIT_NAME_MAX}
          placeholder="例如：睡前拉伸 5 分钟"
          required
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
        />
      </label>

      <label class="lg-habitfield">
        <span>
          做什么<small>（可以不填）</small>
        </span>
        <input
          type="text"
          value={text}
          maxlength={HABIT_TEXT_MAX}
          placeholder="例如：站墙靠一会儿"
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
      </label>

      <div class="lg-habitfield">
        <span>什么时候做</span>
        <div class="lg-cats" role="radiogroup" aria-label="什么时候做">
          {SLOTS.map((s) => (
            <button
              key={s.id}
              type="button"
              class="lg-cat"
              role="radio"
              aria-checked={slot === s.id}
              onClick={() => setSlot(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div class="lg-btn-row">
        <button class="lg-btn" type="submit" disabled={!trimmed}>
          保存
        </button>
        <button class="lg-btn lg-btn-ghost" type="button" onClick={onCancel}>
          取消
        </button>
      </div>
    </form>
  );
}
