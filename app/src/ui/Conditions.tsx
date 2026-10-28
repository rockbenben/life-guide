/**
 * 条件：模式（正常/很忙/出差/生病）+ 我的情况（年龄段与状态）。
 *
 * 为什么要做成一个组件而不是各写一套：这两个值在今天页与设置页都要改，
 * 口径必须一致（同一份 setting），标签与顺序也不能各说各话。
 *
 * 两种形态：
 *   · ConditionBar   —— 今天页：收成一行，点开才展开（它们是条件，不是今天的内容）
 *   · ConditionPanel —— 设置页：一直展开着改
 *
 * 两件得如实说的事，各说各的：
 *   · 手册里还没有降级版本（variants）时，选「很忙 / 出差 / 生病」都不会改清单 ——
 *     得说清楚，假装它起作用比没有这个键更糟。
 *   · 有几张卡按人群换动作（segments）时，那一句得摆出来 ——
 *     这一句原来错挂在 variants 上，于是 7 张分档卡在界上一句也没提。
 */
import { useEffect, useState } from "preact/hooks";

import type { Mode, ModeCounts, ModeVariants } from "../domain/routine.ts";
import { MODES } from "../domain/routine.ts";
import {
  AGE_TAGS,
  STATE_TAGS,
  TAG_LABELS,
  describeConditions,
  describeConditionsFull,
  normalizeTags,
  orderedTags,
  toggleTag,
} from "../domain/conditions.ts";
import { getSetting, setSetting } from "../data/db.ts";

const MODE_LABELS: Record<string, string> = Object.fromEntries(
  MODES.map((m) => [m.id, m.label]),
);

type NonNormalMode = Exclude<Mode, "normal">;

/** 手册里还没有任何降级版本时，每个模式实际会发生什么 —— 别让标签许诺做不到的事。 */
const NO_VARIANT_SHORT: Record<NonNormalMode, string> = {
  busy: "照常做 —— 手册里还没有更省事的做法",
  travel: "照常做 —— 手册里还没有出差版",
  sick: "按身体情况来 —— 手册里还没有生病版",
};

const NO_VARIANT_NOTE: Record<NonNormalMode, string> = {
  busy: "手册里还没有更省事的做法，所以选「很忙」现在不会改变清单 —— 只是把这条记下来。",
  travel: "手册里还没有出差版的做法，所以选「出差」现在不会改变清单 —— 只是把这条记下来。",
  sick: "手册里还没有生病版的做法，所以选「生病」现在不会改变清单 —— 今天要不要做，按身体情况来。",
};

/** 该模式确实有卡带版本时，模式标签说的实际效果。 */
const ACTIVE_HINT: Record<NonNormalMode, string> = {
  busy: "有忙档的只做核心步骤，没有忙档的照常做",
  travel: "有出差版的换个做法，没有出差版的照常做",
  sick: "有生病版的按版本做，没有生病版的按身体情况来",
};

function modeHint(mode: Mode, hint: string, available: boolean): string {
  if (mode === "normal") return hint;
  return available ? ACTIVE_HINT[mode] : NO_VARIANT_SHORT[mode];
}

function availableFor(mode: Mode, variants?: ModeVariants): boolean {
  return mode === "normal" ? false : (variants?.[mode] ?? false);
}

function countFor(mode: Mode, counts?: ModeCounts): number | undefined {
  return mode === "normal" ? undefined : counts?.[mode];
}

export interface ConditionProps {
  mode: Mode;
  tags: string[];
  onMode: (m: Mode) => void;
  onTag: (t: string) => void;
  /** 每个非正常模式各自有没有卡带版本 */
  modeVariants?: ModeVariants;
  /** 当前这一屏（今天）或整本手册里，各模式各有多少张卡带版本 */
  coverage?: ModeCounts;
  /** coverage 说的是「当前清单」还是「手册」 */
  coverageScope?: "current" | "manual";
  /** 当前数据里有没有任何一张卡按人群分档（不同的人该做不同动作） */
  hasSegments?: boolean;
  /** 用户是否真的选过年龄段（旧设置/首启时可能只是默认成人） */
  ageKnown?: boolean;
  /** 首启「先按成年人显示」：把默认成人落库，不再提示 */
  onSkipAgePrompt?: () => void;
}

function Editor({
  mode,
  tags,
  onMode,
  onTag,
  modeVariants,
  coverage,
  coverageScope,
  hasSegments,
}: ConditionProps) {
  const current = MODES.find((m) => m.id === mode);
  const available = availableFor(mode, modeVariants);
  const count = countFor(mode, coverage);
  const scope = coverageScope === "manual" ? "手册里" : "当前清单里";
  return (
    <>
      <div class="lg-cats" role="group" aria-label="模式">
        {MODES.map((m) => (
          <button
            key={m.id}
            class="lg-cat"
            aria-pressed={m.id === mode}
            title={modeHint(m.id, m.hint, availableFor(m.id, modeVariants))}
            onClick={() => onMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {/* 提示带上模式名 —— 光一句「照常做」看不出是在说哪一个模式 */}
      {current ? (
        <p class="lg-pool">
          {current.label}：{modeHint(current.id, current.hint, available)}
        </p>
      ) : null}
      {mode !== "normal" && !available ? (
        <p class="lg-hint">{NO_VARIANT_NOTE[mode]}</p>
      ) : null}
      {mode !== "normal" && available && count !== undefined ? (
        <p class="lg-pool">
          {count > 0
            ? `${scope}有 ${count} 张有「${MODE_LABELS[mode]}」版；没有对应版本的照常做。`
            : `${scope}没有「${MODE_LABELS[mode]}」版，全部照常做。`}
        </p>
      ) : null}

      {/* 两排片要看得懂：上面是年龄段（只能选一个），下面是身体情况（可以多选）。
          原来两排样式一模一样，也没有可见的组标题 —— 视力正常的人只能猜，
          读屏才分得清（aria-label）。 */}
      <p class="lg-grouphint">年龄段（只能选一个）</p>
      <div class="lg-cats" role="radiogroup" aria-label="年龄段">
        {AGE_TAGS.map((t) => (
          <button
            key={t}
            class="lg-cat"
            role="radio"
            aria-checked={tags.includes(t)}
            onClick={() => onTag(t)}
          >
            {TAG_LABELS[t] ?? t}
          </button>
        ))}
      </div>

      <p class="lg-grouphint">我的情况（可以多选）</p>
      <div class="lg-cats" role="group" aria-label="我的情况">
        {STATE_TAGS.map((t) => (
          <button
            key={t}
            class="lg-cat"
            aria-pressed={tags.includes(t)}
            onClick={() => onTag(t)}
          >
            {TAG_LABELS[t] ?? t}
          </button>
        ))}
      </div>
      {hasSegments ? (
        <p class="lg-pool">少数几张卡会按你的情况换动作，其余照默认做就行。</p>
      ) : null}
    </>
  );
}

/** 今天页顶部那一行：显示当前条件，点开才展开选择。 */
export function ConditionBar({
  mode,
  tags,
  onMode,
  onTag,
  open,
  onToggle,
  modeVariants,
  coverage,
  coverageScope,
  hasSegments,
}: ConditionProps & { open: boolean; onToggle: () => void }) {
  return (
    <div class="lg-condrow">
      <button
        class="lg-cond"
        aria-expanded={open}
        onClick={onToggle}
        title={describeConditionsFull(mode, tags, MODE_LABELS)}
      >
        条件 <b>{describeConditions(mode, tags, MODE_LABELS)}</b>
      </button>
      {/* 面板与那一行平级：展开时独占一行，不被挤在右半边 */}
      {open ? (
        <div class="lg-condpanel">
          <Editor
            mode={mode}
            tags={tags}
            onMode={onMode}
            onTag={onTag}
            modeVariants={modeVariants}
            coverage={coverage}
            coverageScope={coverageScope ?? "current"}
            hasSegments={hasSegments}
          />
        </div>
      ) : null}
    </div>
  );
}

/** 设置页里的完整条件编辑。 */
export function ConditionPanel(props: ConditionProps) {
  return (
    <div class="lg-condpanel">
      <Editor {...props} />
    </div>
  );
}

/** 给别处用的一行摘要。 */
export function conditionSummary(mode: Mode, tags: string[]): string {
  return describeConditions(mode, tags, MODE_LABELS);
}

/** 已选中的标签（按固定顺序）。 */
export { orderedTags };

/**
 * 条件的读写。今天页与设置页都要改它们，写入的是同一份 setting，
 * 所以加载与保存只写一份，两处不可能各说各话。
 *
 * 每次进入页面重新从库里读：两个页签是分开挂载的，切回来时读到的是最新值。
 *
 * refreshKey：数据在**别处**被换掉时（导入备份），让这里再读一次 ——
 * 不然设置页显示的还是导入前的模式，改一下就把导入的值盖掉了。
 */
export function useConditions(refreshKey = 0): ConditionProps {
  const [mode, setMode] = useState<Mode>("normal");
  // 默认年龄段是「成年人（未满 70 岁）」：原文的分档按人群分，没有年龄档的话
  // 成人那一档永远命中不了（见 domain/conditions.ts 的 normalizeTags）。
  const [tags, setTags] = useState<string[]>(["age:adult"]);
  // 默认成人只是兜底，不等于用户选过；首启问一次，问完/跳过才为 true。
  const [ageKnown, setAgeKnown] = useState(true);

  useEffect(() => {
    void (async () => {
      const [m, t] = await Promise.all([
        getSetting<Mode>("mode", "normal"),
        getSetting<string[] | undefined>("tags", undefined),
      ]);
      setMode(m);
      setTags(normalizeTags(t ?? []));
      setAgeKnown((t ?? []).some((x) => AGE_TAGS.includes(x)));
    })();
  }, [refreshKey]);

  async function changeMode(m: Mode) {
    setMode(m);
    await setSetting("mode", m);
  }

  async function toggleOne(tag: string) {
    const next = normalizeTags(toggleTag(tags, tag));
    setTags(next);
    if (AGE_TAGS.includes(tag)) setAgeKnown(true);
    await setSetting("tags", next);
  }

  async function skipAgePrompt() {
    const next = normalizeTags(tags);
    setTags(next);
    setAgeKnown(true);
    await setSetting("tags", next);
  }

  return {
    mode,
    tags,
    onMode: (m) => void changeMode(m),
    onTag: (t) => void toggleOne(t),
    ageKnown,
    onSkipAgePrompt: () => void skipAgePrompt(),
  };
}
