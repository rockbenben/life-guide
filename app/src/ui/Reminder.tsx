/**
 * 提醒的设置：一张卡上「什么时候提醒我」。
 *
 * 用户问过「卡片在哪设置定时提醒」—— 就在卡上：展开后有一行「提醒」，
 * 点「设提醒」展开这一段。四种模式（每天 / 每周 / 隔几天 / 就一次）；
 * 新建时的默认模式由 Card 按这张卡的频率给，用户仍可改。
 *
 * 提醒存的是一条设置（IndexedDB 的 settings 表），平台怎么响是 notify.ts 的事。
 */
import { useEffect, useState } from "preact/hooks";

import {
  MODE_LABELS,
  WEEKDAY_LABELS,
  describeReminder,
  nextOccurrence,
  parseTime,
  type Reminder,
  type ReminderMode,
} from "../domain/reminders.ts";
import { dayOf, nextDay } from "../domain/day.ts";
import { status, type NotifyPermission } from "../platform/notify.ts";

const MODES: ReminderMode[] = ["daily", "weekly", "interval", "once"];

/** 逻辑上的明天（一次性的默认）。04:00 前仍算前一天。 */
function tomorrow(): string {
  return nextDay(dayOf(Date.now()));
}

export interface ReminderEditorProps {
  /** 这张卡现在有没有提醒 */
  reminder?: Reminder;
  /** 新建时的默认值（时刻、名字、绑在哪张卡上、按频率给的模式） */
  defaults: {
    id: string;
    label: string;
    time: string;
    cardId: string | null;
    mode?: ReminderMode;
    days?: number[];
    everyDays?: number;
    date?: string;
  };
  /** 设备的通知权限：没允许时保存了也不会响，得在设置的那一刻就说 */
  notifyPermission?: NotifyPermission | null;
  onSave: (reminder: Reminder) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** 通知没允许时的一句人话；已允许/还在查时不占位置。 */
function permissionHint(
  permission: NotifyPermission | null | undefined,
  pendingSave: boolean,
): string | null {
  if (!permission || permission === "granted") return null;
  if (permission === "unsupported") {
    return pendingSave
      ? "这个环境没有通知通道，保存后也不会响。"
      : "这个环境没有通知通道，提醒不会响。";
  }
  if (permission === "denied") {
    return pendingSave
      ? "通知被拒绝了 —— 保存后也不会响。到「设置」里看通知怎么开。"
      : "通知被拒绝了 —— 这个提醒不会响。到「设置」里看通知怎么开。";
  }
  return pendingSave
    ? "通知还没允许 —— 保存后也不会响。到「设置」里看通知怎么开。"
    : "通知还没允许 —— 这个提醒不会响。到「设置」里看通知怎么开。";
}

/** 编辑器：模式 + 时刻 + 各模式要的那些字段。 */
export function ReminderEditor({
  reminder,
  defaults,
  notifyPermission,
  onSave,
  onDelete,
  onClose,
}: ReminderEditorProps) {
  const unsavedHint = permissionHint(notifyPermission, true);
  const [mode, setMode] = useState<ReminderMode>(reminder?.mode ?? defaults.mode ?? "daily");
  const [time, setTime] = useState(reminder?.time ?? defaults.time);
  const [days, setDays] = useState<number[]>(
    reminder?.days ?? defaults.days ?? [1, 2, 3, 4, 5],
  );
  const [everyDays, setEveryDays] = useState(reminder?.everyDays ?? defaults.everyDays ?? 2);
  const [date, setDate] = useState(reminder?.date ?? defaults.date ?? tomorrow());

  function save() {
    onSave({
      id: reminder?.id ?? defaults.id,
      // 绑在哪张卡上：新建时由外面给（defaults.cardId）——
      // 少了它，这条提醒就成了整段提醒，卡上那一行再也匹配不上
      cardId: reminder?.cardId ?? defaults.cardId,
      label: reminder?.label ?? defaults.label,
      mode,
      time,
      slot: reminder?.slot,
      days: mode === "weekly" ? days : undefined,
      everyDays: mode === "interval" ? everyDays : undefined,
      date: mode === "once" || mode === "interval" ? date : undefined,
      on: true,
    });
  }

  return (
    <div class="lg-remedit">
      <div class="lg-remedit-modes" role="radiogroup" aria-label="提醒方式">
        {MODES.map((m) => (
          <button
            key={m}
            class="lg-chip"
            role="radio"
            aria-checked={mode === m}
            data-on={mode === m ? "true" : undefined}
            onClick={() => setMode(m)}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      <label class="lg-remrow2">
        <span>几点提醒</span>
        <input
          type="time"
          value={time}
          aria-label="提醒时刻"
          // 清空时刻框 ≠ 不要这条提醒。
          // 时刻不合法时 normalizeReminders 会把整条丢掉 —— 那用户只是清了一下
          // 输入框，刚设的提醒就整条没了（设置页那边已经有这道护栏）。
          onInput={(e) => {
            const v = (e.target as HTMLInputElement).value;
            if (!parseTime(v)) return;
            setTime(v);
          }}
        />
      </label>

      {mode === "weekly" ? (
        <div class="lg-remdays" role="group" aria-label="周几">
          {WEEKDAY_LABELS.map((w, i) => (
            <button
              key={w}
              class="lg-chip"
              data-on={days.includes(i) ? "true" : undefined}
              aria-pressed={days.includes(i)}
              aria-label={`周${w}`}
              onClick={() =>
                setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i].sort()))
              }
            >
              {w}
            </button>
          ))}
        </div>
      ) : null}

      {mode === "interval" ? (
        <>
          <label class="lg-remrow2">
            <span>每隔</span>
            <input
              type="number"
              min="1"
              max="60"
              value={everyDays}
              aria-label="每隔几天"
              onInput={(e) =>
                setEveryDays(Math.max(1, Number((e.target as HTMLInputElement).value) || 1))
              }
            />
            <span>天</span>
          </label>
          <label class="lg-remrow2">
            <span>从哪天开始</span>
            <input
              type="date"
              value={date}
              aria-label="从哪天开始"
              onInput={(e) => setDate((e.target as HTMLInputElement).value)}
            />
          </label>
        </>
      ) : null}

      {mode === "once" ? (
        <label class="lg-remrow2">
          <span>哪一天</span>
          <input
            type="date"
            value={date}
            aria-label="哪一天"
            onInput={(e) => setDate((e.target as HTMLInputElement).value)}
          />
        </label>
      ) : null}

      <div class="lg-btn-row">
        <button class="lg-btn" onClick={save}>
          保存
        </button>
        {reminder ? (
          <button class="lg-btn lg-btn-ghost" onClick={onDelete}>
            删掉
          </button>
        ) : null}
        <button class="lg-btn lg-btn-ghost" onClick={onClose}>
          取消
        </button>
      </div>
      {unsavedHint ? <p class="lg-hint">{unsavedHint}</p> : null}
    </div>
  );
}

/**
 * 卡片展开态里那一行：「提醒」+ 当前设置 + 设提醒的入口。
 *
 * 只摆值与那颗键 —— 行的名字由外面（卡里的「提醒」那一栏）给。
 */
export function ReminderRow({
  reminder,
  defaults,
  onSave,
  onDelete,
}: {
  reminder?: Reminder;
  defaults: {
    id: string;
    label: string;
    time: string;
    cardId: string | null;
    mode?: ReminderMode;
    days?: number[];
    everyDays?: number;
    date?: string;
  };
  onSave: (reminder: Reminder) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [permission, setPermission] = useState<NotifyPermission | null>(null);

  // 没允许通知时，提醒照样能存下来，但到点不会响 —— 在卡片上就说清楚，
  // 而不是让用户自己去设置页发现。桌面/手机端通常是 granted，不会多出这一行。
  useEffect(() => {
    let alive = true;
    void status().then((s) => {
      if (alive) setPermission(s.permission);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (editing) {
    return (
      <ReminderEditor
        reminder={reminder}
        defaults={defaults}
        notifyPermission={permission}
        onSave={(r) => {
          onSave(r);
          setEditing(false);
        }}
        onDelete={() => {
          onDelete();
          setEditing(false);
        }}
        onClose={() => setEditing(false)}
      />
    );
  }
  const rowHint = reminder ? permissionHint(permission, false) : null;
  return (
    <>
      <div class="lg-remrow">
        <span class="lg-remval">{reminder ? describeReminder(reminder) : "没设"}</span>
        <button class="lg-linkbtn lg-rembtn" onClick={() => setEditing(true)}>
          {reminder ? "改" : "设提醒"}
        </button>
      </div>
      {rowHint ? <p class="lg-hint">{rowHint}</p> : null}
    </>
  );
}

/**
 * 只改模式的那一排（设置页里那两条整段提醒用）。
 *
 * 绑在卡上的提醒用完整的编辑器（ReminderEditor）—— 那里还要挑时刻。
 */
export function ReminderModePicker({
  reminder,
  onChange,
}: {
  reminder: Reminder;
  onChange: (mode: ReminderMode, extra: Partial<Reminder>) => void;
}) {
  const days = reminder.days ?? [1, 2, 3, 4, 5];
  return (
    <div class="lg-rempicker">
      <div class="lg-remedit-modes" role="radiogroup" aria-label={`${reminder.label}提醒方式`}>
        {MODES.map((m) => (
          <button
            key={m}
            class="lg-chip"
            role="radio"
            aria-checked={reminder.mode === m}
            data-on={reminder.mode === m ? "true" : undefined}
            onClick={() =>
              onChange(m, {
                days: m === "weekly" ? days : undefined,
                everyDays: m === "interval" ? (reminder.everyDays ?? 2) : undefined,
                date:
                  m === "once" || m === "interval"
                    ? (reminder.date ?? tomorrow())
                    : undefined,
              })
            }
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {reminder.mode === "weekly" ? (
        <div class="lg-remdays" role="group" aria-label="周几">
          {WEEKDAY_LABELS.map((w, i) => (
            <button
              key={w}
              class="lg-chip"
              data-on={days.includes(i) ? "true" : undefined}
              aria-pressed={days.includes(i)}
              aria-label={`周${w}`}
              onClick={() =>
                onChange("weekly", {
                  days: days.includes(i) ? days.filter((x) => x !== i) : [...days, i].sort(),
                })
              }
            >
              {w}
            </button>
          ))}
        </div>
      ) : null}

      {reminder.mode === "interval" ? (
        <label class="lg-remrow2">
          <span>每隔</span>
          <input
            type="number"
            min="1"
            max="60"
            value={reminder.everyDays ?? 2}
            aria-label="每隔几天"
            onInput={(e) =>
              onChange("interval", {
                everyDays: Math.max(1, Number((e.target as HTMLInputElement).value) || 1),
              })
            }
          />
          <span>天</span>
        </label>
      ) : null}

      {reminder.mode === "once" ? (
        <label class="lg-remrow2">
          <span>哪一天</span>
          <input
            type="date"
            value={reminder.date ?? tomorrow()}
            aria-label="哪一天"
            onInput={(e) => onChange("once", { date: (e.target as HTMLInputElement).value })}
          />
        </label>
      ) : null}
      {/* 设置页里这两条是即时保存的，没有保存按钮可以拦 —— 排不出下一次就直接说。 */}
      {!nextOccurrence(reminder, new Date()) ? (
        <p class="lg-hint">
          这个提醒排不出下一次，不会响 —— 换个时间/日期，或至少选一天。
        </p>
      ) : null}
    </div>
  );
}
