/**
 * 今天页清单的折叠。
 *
 * **为什么要有**：默认清单扩到 40 张后，「随时」那一档有 30 多张 ——
 * 全铺开就是一屏目录，正是这个项目要否定的用法（AGENTS.md §6）。
 * 所以先铺前几张，其余收在一行「还有 N 件」里。
 *
 * 形态与卡内步骤的折叠一致（`lg-more` 那颗键）。
 */
import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { TodayLog, LOG_CHUNK } from "../../src/ui/TodayLog.tsx";
import type { Card } from "../../src/domain/routine.ts";

function makeCards(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    status: "reviewed" as const,
    source: { anchor: `第 ${i} 件` },
    name: `第 ${i} 件`,
    remind: { text: `第 ${i} 件` },
    steps: [{ id: `s${i}`, text: "做", quote: "做" }],
  }));
}

function view(cards: Card[]): string {
  return render(
    <TodayLog
      cards={cards}
      names={new Map()}
      mode="normal"
      tags={[]}
      events={[]}
      today="2026-10-31"
      expanded={null}
      onExpand={() => {}}
      onToggle={() => {}}
      dayOfMonth={31}
      onEditHabit={() => {}}
      onRemoveHabit={() => {}}
      onSkipToday={() => {}}
      onTakeOut={() => {}}
      cadenceOf={() => "daily"}
      onCadenceChange={() => {}}
    />,
  );
}

describe("今天页清单的折叠", () => {
  it("不多的时候全铺（不用为几张卡加一道折叠）", () => {
    const html = view(makeCards(5));
    expect(html).not.toContain("lg-more");
    expect(html).toContain("第 4 件");
  });

  it("多的时候先铺前几张，其余收起来", () => {
    const html = view(makeCards(LOG_CHUNK + 8));
    expect(html).toContain("lg-more");
    // 先铺的那些在
    expect(html).toContain("第 1 件");
    // 收起来的那些不在
    expect(html).not.toContain(`第 ${LOG_CHUNK + 1} 件`);
  });

  it("那颗键说清还有多少件", () => {
    const html = view(makeCards(LOG_CHUNK + 8));
    expect(html).toContain("还有 8 件");
    expect(html).toContain("全展开");
  });

  it("折叠键标出展开状态（读屏要知道现在是收着还是展着）", () => {
    const html = view(makeCards(LOG_CHUNK + 8));
    expect(html).toContain('aria-expanded="false"');
  });
});
