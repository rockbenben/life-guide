/**
 * 「发现」：今天轮到的那几张 —— 手册里还没进你日常的动作。
 *
 * 一天给三张（不是一张）：候选池有几百张，一天一张的话一个月才看过 12%。
 */
import { useState } from "preact/hooks";

import { CardView } from "./Card.tsx";
import type { Card, Mode } from "../domain/routine.ts";

export interface DiscoverPanelProps {
  /** 今天轮到的几张 */
  picks: Card[];
  /** 屏上叫什么 */
  names: Map<string, string>;
  /** 手册里还有多少个动作没进日常 */
  pool: number;
  mode: Mode;
  tags: string[];
  onOpenArticle?: (path: string) => void;
  onAdd: (card: Card) => void;
  onNext: () => void;
}

export function DiscoverPanel({
  picks,
  names,
  pool,
  mode,
  tags,
  onOpenArticle,
  onAdd,
  onNext,
}: DiscoverPanelProps) {
  // hooks 要在任何 return 之前：picks 可能在用完最后一张后变空，
  // 把 useState 放在 early return 之后会让同一实例的 hook 数变化（条件调用）。
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!picks.length) return null;
  // 「发现」里这些卡的标题是可以点的（指针、悬停变色都在说它能点）——
  // 以前给的是个空回调，按下去什么也不发生，读者以为坏了。展开看看做法是对的。
  return (
    <section class="lg-discover">
      <h2>发现</h2>
      <p class="lg-do">
        手册里还有{" "}
        <span class="tabular">{pool}</span>
        {" 个动作没进日常，今天先看这 "}
        <span class="tabular">{picks.length}</span>
        {" 张："}
      </p>
      {picks.map((c) => (
        // data-card-unit：这一张卡连着旁边那颗「放进日常」——
        // 点它不算「点了别处」，否则正看着卡却被收起来。
        <div class="lg-discover-item" key={c.id} data-card-unit={c.id}>
          <div class="lg-log">
            <CardView
              card={c}
              mode={mode}
              userTags={tags}
              done={false}
              streakDays={0}
              expanded={expanded === c.id}
              onExpand={() => setExpanded(expanded === c.id ? null : c.id)}
              onToggle={() => {}}
              readOnly
              displayName={names.get(c.id)}
              onOpenArticle={onOpenArticle}
            />
          </div>
          <div class="lg-btn-row">
            <button class="lg-btn lg-btn-ghost" onClick={() => onAdd(c)}>
              放进日常
            </button>
          </div>
        </div>
      ))}
      <div class="lg-btn-row" style="margin-top:14px">
        <button class="lg-btn lg-btn-ghost" onClick={onNext}>
          换一批
        </button>
      </div>
      <p class="lg-pool">也可以到「手册」里按篇翻 —— 每篇都标着能照着做几个动作。</p>
    </section>
  );
}
