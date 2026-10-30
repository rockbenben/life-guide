/**
 * 卡片：一行手帖 + 展开成一张用法用量表。
 *
 * 收起态（三行契约，判据在 domain/lines.ts）：
 *   名 / 做什么 / 剂量 —— 外加 stop 级禁忌与 seek-care 提示（安全信息不许折叠）
 *   「做什么」与「名」重复时那一行不显示（同一句话说两遍看着像出了错），
 *   展开态的「做什么」那一行仍然摆原文 —— 收起态省了，原文不许消失（D2）。
 * 展开态：剂量·时段·耗时·见效 成表，步骤逐条配图
 *   （卡里的事实就是原文的话，不再另摆引文；来源链接在页脚，跳到那一篇）
 *
 * 键盘通路（batch2 量出来的两条）：
 *   · Esc 收起，并把焦点还给那颗名字键 —— 之前按 Esc 什么都不发生
 *   · 展开态顶部一个「跳到本卡末尾」的跳转键 —— 23 步的长卡从卡头到「收起」
 *     要 Tab 17 站，其中 15 站是同名按钮
 *
 * 注意类名：daisyUI 的类名是保留字（`steps` 是它的步骤条组件、`card-body`
 * 是它的卡片体），撞上就会被悄悄接管样式。本文件自己的钩子类名一律带 `lg-` 前缀。
 */
import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";

import type { Card, Mode, ResolvedStep } from "../domain/routine.ts";
import { filterByMode, skipped } from "../domain/routine.ts";
import { cardLines, doseValueText, NAME_MAX } from "../domain/lines.ts";
import { matchSegments } from "../domain/segments.ts";
import type { Segment } from "../domain/segments.ts";
import { slotLabel } from "../domain/day.ts";
import { tagText } from "../domain/conditions.ts";
import { NOTICE_LABELS, isConditionCard, plainText, sortNotices, urgentNotices } from "../domain/notices.ts";
import { cardName } from "../domain/lines.ts";
import { isCustomCard } from "../domain/custom.ts";
import type { Reminder } from "../domain/reminders.ts";
import {
  cardReminderId,
  defaultReminderFor,
  defaultTimeForSlot,
} from "../domain/reminders.ts";
import { CADENCE_LABELS, CADENCES, type Cadence } from "../domain/cadence.ts";
import { ReminderRow } from "./Reminder.tsx";
import { Timer } from "./Timer.tsx";
import { StepTimer } from "./StepTimer.tsx";

export interface CardProps {
  card: Card;
  mode: Mode;
  userTags: string[];
  done: boolean;
  /** 累计做了多少天 */
  streakDays: number;
  onToggle: () => void;
  expanded: boolean;
  onExpand: () => void;
  /** 只读展示（疾病卡、手册里的卡片）：不给盖章 */
  readOnly?: boolean;
  /** 这张卡的提醒（App 级的设置；绑在卡上的那一条） */
  reminders?: Reminder[];
  onRemindersChange?: (reminders: Reminder[]) => void;
  /**
   * 屏上显示的名字。
   *
   * 默认是原文小节名；**一个小节拆出多张卡时**（刷牙/牙线、三个穴位…）
   * 名字会撞车，父组件会传一个回落过的名字进来（domain/lines.ts 的 displayNames）。
   */
  displayName?: string;
  /** 跳到这张卡出自的那一篇 */
  onOpenArticle?: (path: string) => void;
  /** 那张卡出自哪一篇的篇名 */
  articleTitle?: string;
  /** 今天这一屏的日期，印上写它 */
  dayOfMonth?: number;
  /** 多久做一次（今天页才给改；手册只读） */
  cadence?: Cadence;
  onCadenceChange?: (cadence: Cadence) => void;
  /**
   * 本卡末尾除了「收起」还有哪颗键（如「今天不做 · 移出日常」）。
   *
   * 手机上展开一张卡有 1200 多像素高，末尾的键在首屏里根本看不到，
   * 而首启说明写着「展开卡片可改」。跳到末尾的那颗键是唯一能把它带到眼前的
   * 入口，所以把末尾有什么写在这颗键上。
   */
  endExtra?: string;
}
/** 警示符号画成 SVG：⚠ 这个字符在部分安卓上是彩色 emoji，且不吃 CSS 颜色。 */
function Warn() {
  return (
    <svg class="lg-icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M8 1.8 15 14H1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" />
      <path d="M8 6.2v3.3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
      <circle cx="8" cy="11.7" r="0.85" fill="currentColor" />
    </svg>
  );
}

/** 分档给的动作名也要守同一行宽：截断规则与 lines.ts 一致。 */
function trimName(s: string): string {
  return [...s].length > NAME_MAX ? s.slice(0, NAME_MAX) + "…" : s;
}

function StepRow({ s, n }: { s: ResolvedStep; n: number }) {
  if (!s.included) return null;
  return (
    <li>
      <p>{s.replaced ?? s.text}</p>
      {s.images?.length ? (
        // 图按原比例显示：快照里横图、竖图、方图都有，固定比例的盒子
        // 会把竖图压成一条。一步只有一张图时给足尺寸，多张才排成两列。
        s.images.length === 1 ? (
          <img src={s.images[0]} alt={s.text} loading="lazy" />
        ) : (
          <div class="lg-imgs">
            {s.images.map((u) => (
              <img key={u} src={u} alt={s.text} loading="lazy" />
            ))}
          </div>
        )
      ) : null}
    </li>
  );
}

function SegmentBox({ seg }: { seg: Segment }) {
  return (
    <div class="lg-segbox">
      {/* 说人话：标签本身是机器口径（age:senior），界面上不能直接给人看 */}
      <div class="lg-segbox-who">适用：{seg.when.map(tagText).join("、")}</div>
      {seg.action ? <div class="lg-segbox-do">{seg.action.text}</div> : null}
    </div>
  );
}

function SectionTitle({ children }: { children: ComponentChildren }) {
  return <h3>{children}</h3>;
}

export function CardView({
  card,
  mode,
  userTags,
  done,
  streakDays,
  onToggle,
  expanded,
  onExpand,
  readOnly,
  reminders,
  onRemindersChange,
  displayName,
  onOpenArticle,
  articleTitle,
  dayOfMonth,
  cadence,
  onCadenceChange,
  endExtra,
}: CardProps) {
  const [allOpen, setAllOpen] = useState(false);
  const nameRef = useRef<HTMLButtonElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const m = matchSegments(card, userTags);
  // 模式（忙/出差/生病）决定做哪几步；分档（人群）决定换成哪个动作。
  // 两者都要用时，先用分档换掉动作与步骤，再对换后的步骤套模式。
  const baseSteps = m.segment ? (m.segment.steps ?? []) : card.steps;
  const allSteps = filterByMode(baseSteps, card, mode);
  // 长卡分批：实测 23 步那张全展开是 6 屏，读到后面已经忘了前面。
  // 安全信息（stop 禁忌）不受这条影响 —— 它必须在收起态就全在（R11）。
  const longList = allSteps.length > STEP_CHUNK;
  const shownSteps = longList && !allOpen ? allSteps.slice(0, STEP_CHUNK) : allSteps;
  const isSkipped = skipped(card, mode);
  const modeVariant = mode === "normal" ? undefined : card.variants?.[mode];
  const busySteps = mode === "busy" ? modeVariant?.include : undefined;
  const modeFlag =
    isSkipped || mode === "normal" || !modeVariant
      ? null
      : mode === "busy"
        ? "忙档"
        : mode === "travel"
          ? "出差版"
          : "生病版";

  // Esc 收起，并把焦点还给触发它的那颗键
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onExpand();
      nameRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, onExpand]);

  /**
   * 点别处就收起。
   *
   * **怎么算「这张卡」**：按 data-card-unit 往上找最近的那一层。
   * 为什么不用 cardRef.contains：末尾那排键（「今天不做」「移出日常」）
   * 画在卡片外面（TodayLog 里是 article 的兄弟节点），只查 article 会把
   * 它们当成「别处」—— 点「移出日常」时那张确认行会先被收掉。
   * 整张卡（含末尾那排键）挂同一个 data-card-unit，找最近的那层就对了。
   *
   * **为什么用 click 而不是 pointerdown**：手指按下就收起，会在**滑动**列表时
   * 也收起来 —— 拇指按在屏幕上想往下翻，卡却先合上了。click 要等抬手，
   * 而抬手前没挪动过才算「点」，滑动不会触发它。
   *
   * **为什么用 capture**：capture 先于被点的那颗键自己的 handler 跑。
   * 点另一张卡的名字时，顺序必须是「先收起旧的、再展开新的」——
   * 反过来的话，旧卡那句「点了别处就收」会在新卡展开之后才执行，
   * 两张卡一起收掉（点谁都没反应）。这个顺序靠 capture 定住。
   */
  useEffect(() => {
    if (!expanded) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target;
      const unit =
        target instanceof Element ? target.closest("[data-card-unit]") : null;
      if (unit?.getAttribute("data-card-unit") === card.id) return;
      onExpand();
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [expanded, onExpand, card.id]);

  const lines = cardLines(card, displayName);
  const cautions = m.cautions;
  // 分档换的是**动作本身**：名用这一档给的动作，而 remind 描述的是被换掉的默认动作，
  // 一起显示等于给用户两句互相矛盾的话（§5.1b）。
  const segAction = m.segment?.action?.text?.trim();
  const name = segAction ? trimName(segAction) : (displayName ?? lines.name);
  const doText = segAction ? "" : lines.doText;
  const stopCautions = cautions.filter((c) => c.level === "stop");
  const notices = card.notices ?? [];
  const urgent = urgentNotices(notices);
  // 疾病知识不是「今天要做的事」：左边那一栏写「知识」，不写时段 ——
  // 「随时」挂在一条知识上读着像「随时可以做这条知识」。
  const conditionCard = isConditionCard(card);
  const slotText =
    !conditionCard && card.slot && card.slot !== "anytime" ? slotLabel(card.slot) : "";
  // 新提醒的默认模式跟着这张卡的频率：周卡别一上来就每天响。
  const reminderDefaults = defaultReminderFor(cadence ?? "daily");
  // 被截断的半句要在展开态读得到（D2）
  const fullRemind = plainText(card.remind?.text ?? "");
  const truncated = doText.length > 0 && fullRemind.length > lines.doText.length;
  // 收起态那一行与「名」重复、被整行删掉时，原文仍然要在展开态读得到（D2）
  const showRemind = truncated || segAction || (!doText && !!fullRemind);

  return (
    <article class="lg-card" data-card-unit={card.id} data-readonly={readOnly ? "true" : undefined}>
      <div class="lg-row" data-done={done ? "true" : "false"}>
        <div class="lg-when">
          {conditionCard ? "知识" : slotText || "随时"}
          {/* 今天不做的卡不该再摆一个时长：那读起来像「要做 30 分钟」 */}
          {conditionCard ? null : isSkipped ? (
            <span class="lg-dur" data-state="mode">
              今天不做
            </span>
          ) : busySteps?.length ? (
            <span class="lg-dur" data-state="mode">
              忙档 · {busySteps.length} 步
            </span>
          ) : lines.duration.text ? (
            <span class="lg-dur" data-state={lines.duration.state}>
              {lines.duration.text}
            </span>
          ) : null}
        </div>

        <button
          class="lg-name-btn"
          ref={nameRef}
          aria-expanded={expanded}
          onClick={onExpand}
        >
          <span class="lg-name">{name}</span>
          {modeFlag ? (
            <span class="lg-modeflag" data-mode={mode}>
              {modeFlag}
            </span>
          ) : null}
          {doText ? (
            <span class="lg-do" title={truncated ? fullRemind : undefined}>
              {doText}
            </span>
          ) : null}
          {lines.doses.length ? (
            <span class="lg-dose">
              {lines.doses.map((d, i) => (
                <span key={i}>
                  <b class="tabular">{doseValueText(d)}</b>{" "}
                  {d.what}
                </span>
              ))}
            </span>
          ) : null}
          {/* 分档给的剂量是一句话，不是数：用正文字重，别伪装成朱红数字 */}
          {segAction && m.dose ? <span class="lg-segdose">{m.dose}</span> : null}
          {/* R11：stop 级禁忌全文必须在收起态。多条并成一行，不再一人一块粉底 */}
          {stopCautions.length && !expanded ? (
            <span class="lg-stop">
              <Warn />
              <span>{stopCautions.map((c) => c.text).join(" · ")}</span>
            </span>
          ) : null}
          {urgent.map((n, i) => (
            <span key={i} class="lg-stop" data-notice="true">
              <Warn />
              <span>
                {NOTICE_LABELS[n.level]}：{n.text}
              </span>
            </span>
          ))}
          {m.segment ? (
            <span class="lg-segflag">按你的情况换了动作</span>
          ) : null}
        </button>

        {readOnly ? null : (
          <button
            class="lg-seal"
            data-empty={done ? "false" : "true"}
            aria-pressed={done}
            disabled={isSkipped}
            aria-disabled={isSkipped}
            aria-label={
              isSkipped
                ? "今天不做"
                : done
                  ? `取消今天这一格（${dayOfMonth ?? "印"}）`
                  : "盖上今天这一格"
            }
            title={
              isSkipped ? "今天不做" : done ? "取消今天这一格" : "盖个印：记下今天做过了"
            }
            onClick={() => {
              onToggle();
              // 盖完印就收起：这一件做完了，展开的那一大张没有理由继续占着屏。
              // 收起时卡还没盖过印（collapsed），onExpand 是「开合」的意思，
              // 所以只有正开着才收 —— 否则点一下会把卡打开。
              if (expanded) onExpand();
            }}
          >
            <i>{done ? dayOfMonth ?? "印" : ""}</i>
          </button>
        )}
      </div>

      {expanded ? (
        <div class="lg-guide">
          {/* 没盖过印的卡不摆一个空表头：一条 22px 的空条加一道横线，
              看着像内容没加载出来。有记录时才出现。 */}
          {streakDays > 0 ? (
            <div class="lg-guide-h">
              <span class="lg-streak">
                已做 <span class="tabular">{streakDays}</span> 天
              </span>
            </div>
          ) : null}

          <button
            class="lg-jump"
            onClick={() => endRef.current?.querySelector("button")?.focus()}
          >
            跳到卡末（收起{endExtra ? ` · ${endExtra}` : ""}）
          </button>

          <dl class="lg-kv">
            {(card.dose ?? []).length ? (
              <>
                <dt>剂量</dt>
                <dd>
                  <span class="lg-dl">
                    {card.dose!.map((d, i) => (
                      <span key={i}>
                        <b class="tabular">
                          {/* 范围是一行，不拆成「下限/上限」两条；原文是近似值时带「约」 */}
                          {doseValueText(d)}
                        </b>
                        {d.what}
                        {/* 换算来的数（如 1/2 勺 → 0.5 勺）要写出算式，不能装作是原文（D7） */}
                        {d.derived ? (
                          <span class="lg-note-inline">推算：{d.derived.formula}</span>
                        ) : null}
                      </span>
                    ))}
                  </span>
                </dd>
              </>
            ) : null}
            {showRemind ? (
              <>
                {/* 「做什么」是被截断的那句原文；下面「提醒」那一行是闹钟 —— 两件事，别混 */}
                <dt>做什么</dt>
                <dd>
                  <span class="lg-fullremind">{segAction ? plainText(card.remind?.text ?? "") : fullRemind}</span>
                </dd>
              </>
            ) : null}
            {conditionCard ? null : (
              <>
                <dt>时段</dt>
                <dd>{slotText || "随时"}</dd>
              </>
            )}            {!readOnly && cadence && onCadenceChange ? (
              <>
                <dt>频率</dt>
                <dd>
                  <div class="lg-cats" role="group" aria-label="多久做一次">
                    {CADENCES.map((value) => (
                      <button
                        key={value}
                        class="lg-cat"
                        aria-pressed={value === cadence}
                        onClick={() => onCadenceChange(value)}
                      >
                        {CADENCE_LABELS[value]}
                      </button>
                    ))}
                  </div>
                </dd>
              </>
            ) : null}
            {/* 这张卡自己的提醒：什么时候提醒我做这一件 */}
            {reminders && onRemindersChange ? (
              <>
                <dt>提醒</dt>
                <dd>
                  <ReminderRow
                    reminder={reminders.find((r) => r.cardId === card.id)}
                    defaults={{
                      id: cardReminderId(card.id),
                      label: name,
                      time: defaultTimeForSlot(card.slot),
                      cardId: card.id,
                      ...reminderDefaults,
                    }}
                    onSave={(r) =>
                      onRemindersChange([
                        ...reminders.filter((x) => x.cardId !== card.id),
                        r,
                      ])
                    }
                    onDelete={() =>
                      onRemindersChange(reminders.filter((x) => x.cardId !== card.id))
                    }
                  />
                </dd>
              </>
            ) : null}
            {/* 耗时这一行只在真给得出数的时候才摆；忙档不把原卡时长冒充自己的 */}
            {lines.duration.text || busySteps?.length ? (
              <>
                <dt>耗时</dt>
                <dd>
                  {busySteps?.length ? (
                    <span>
                      忙档只做 {busySteps.length} 步
                      {lines.duration.text
                        ? `；原卡 ${lines.duration.text.replace(/^推算 /, "")}`
                        : "；原卡时长未给"}
                    </span>
                  ) : (
                    <>
                      <span class="tabular">
                        {lines.duration.text!.replace(/^推算 /, "")}
                      </span>
                      {lines.duration.state === "derived" ? (
                        <span class="lg-note-inline">
                          推算：{lines.duration.formula ?? "算式未记"}
                        </span>
                      ) : null}
                    </>
                  )}
                </dd>
              </>
            ) : null}
            {/* 计时器（作者定的位置：展开态「耗时」这一行旁边）。
                知道时长 → 倒计时；不知道 → 正计时。
                忙档只做几步、时长未知，所以忙档下摆的是正计时 ——
                拿原卡的时长去倒计时，倒的是「原卡」的数，不是「忙档」这一次的。 */}
            <dt>计时</dt>
            <dd>
              <Timer
                duration={
                  busySteps?.length
                    ? null
                    : {
                        sec: lines.duration.sec,
                        derived: lines.duration.state === "derived",
                      }
                }
                title={name}
                cardId={card.id}
              />
            </dd>
            {card.effect ? (
              <>
                <dt>见效</dt>
                <dd>
                  {card.effect.text}
                </dd>
              </>
            ) : null}
          </dl>

          {m.segment ? (
            <div class="lg-sec">
              <SectionTitle>按你的情况</SectionTitle>
              <SegmentBox seg={m.segment} />
            </div>
          ) : null}

          {notices.length ? (
            <div class="lg-sec">
              <SectionTitle>提示</SectionTitle>
              <ul class="lg-caut">
                {sortNotices(notices).map((n, i) => (
                  <li key={i} data-level={n.level === "seek-care" ? "stop" : "info"}>
                    <b>{NOTICE_LABELS[n.level]}</b> {n.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {isSkipped ? (
            <div class="lg-sec">
              <p class="lg-do">这个模式今天不做这一件。</p>
            </div>
          ) : allSteps.length ? (
            <div class="lg-sec">
              <SectionTitle>怎么做</SectionTitle>
              {/* 分步计时（2026-10-30 加）：这张卡的步骤各自带时长时，
                  按步走 —— 这一步归零就跳下一步，自动接着数。
                  卡级那个「耗时」读数是**整张卡的总时长**，两者不是一回事：
                  血管拉伸那张卡的总时长是 7 分钟（两足各 2 回 + 组间休息），
                  而每个动作本身只保持 30 秒。 */}
              <StepTimer steps={allSteps} title={name} cardId={card.id} />
              <ol class="lg-steps">
                {shownSteps.map((s, i) => (
                  <StepRow key={s.id ?? i} s={s} n={i + 1} />
                ))}
              </ol>
              {longList ? (
                <button
                  class="lg-more"
                  aria-expanded={allOpen}
                  onClick={() => setAllOpen(!allOpen)}
                >
                  {allOpen ? `只看前 ${STEP_CHUNK} 步` : `还有 ${allSteps.length - STEP_CHUNK} 步，全展开`}
                </button>
              ) : null}
            </div>
          ) : m.segment ? (
            // 分档换的是另一个动作，默认步骤属于原来那个动作，不能拿来当这一步的指导
            <div class="lg-sec">
              <p class="lg-do">这一档换的是另一个动作，具体步骤在那一篇里。</p>
            </div>
          ) : null}

          {cautions.length ? (
            <div class="lg-sec">
              <SectionTitle>注意</SectionTitle>
              <ul class="lg-caut">
                {cautions.map((c, i) => (
                  <li key={i} data-level={c.level}>
                    {c.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div class="lg-foot" ref={endRef}>
            {/* 来源只留这一处：跳到手册里的那一篇 —— 卡里的事实已经是原文的话了 */}
            <span class="lg-from">
              {card.articlePath && onOpenArticle ? (
                <>
                  出自{" "}
                  <button class="lg-linkbtn" onClick={() => onOpenArticle(card.articlePath!)}>
                    〈{articleTitle || card.articleTitle || "那一篇"}〉
                  </button>
                </>
              ) : isCustomCard(card) ? (
                /* 用户自己加的：没有出处可说，明说它从哪来 */
                <span>你自己加的</span>
              ) : (
                <span>{name}</span>
              )}
            </span>
            <button class="lg-close" onClick={onExpand}>
              收起
            </button>
          </div>
        </div>
      ) : null}
    </article>
  );
}

const STEP_CHUNK = 6;
