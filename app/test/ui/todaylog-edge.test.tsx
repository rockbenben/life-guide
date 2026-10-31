// 临时：折叠边界（用完删）
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

describe("折叠的边界", () => {
  it("恰好 12 张：不折叠（全铺）", () => {
    const html = view(makeCards(LOG_CHUNK));
    expect(html).not.toContain("lg-more");
    expect(html).toContain(`第 ${LOG_CHUNK - 1} 件`); // 0 起，最后一张是第 11 件
  });

  it("13 张：折叠，收起 1 张", () => {
    const html = view(makeCards(LOG_CHUNK + 1));
    expect(html).toContain("lg-more");
    expect(html).toContain("还有 1 件");
    expect(html).not.toContain(`第 ${LOG_CHUNK} 件`); // 第 12 件被收起来了
  });

  it("0 张：什么都不摆", () => {
    const html = view([]);
    expect(html).not.toContain("lg-more");
  });
});
