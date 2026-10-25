/**
 * 时段是「一组可切换按钮」，不是没有 tabpanel 的 tabs。
 *
 * Lighthouse 实测：三个 role=tab 的按钮挂在一个 role=group 里，
 * 报 aria-required-parent（缺 tablist）。换成 aria-pressed 的按钮组。
 */
import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { TodaySidebar } from "../../src/ui/TodaySidebar.tsx";
import type { RoutineStore } from "../../src/data/useRoutine.ts";

function renderSidebar(today = "2026-10-24"): string {
  const routine = {
    ids: ["a"],
    restoreIds: ["a"],
  } as unknown as RoutineStore;
  return render(
    <TodaySidebar
      today={today}
      slot="daytime"
      clockSlot="daytime"
      onSlotPick={() => {}}
      cond={{
        mode: "normal",
        tags: ["age:adult"],
        onMode: () => {},
        onTag: () => {},
      }}
      condOpen={false}
      onToggleCond={() => {}}
      modeVariants={{ busy: false, travel: false, sick: false }}
      hasSegments={false}
      routine={routine}
      sorting={false}
      onSorting={() => {}}
      onRestoreDefault={() => {}}
      habitForm={null}
      onHabitForm={() => {}}
      onAddHabit={() => {}}
      onEditHabit={() => {}}
      mineCount={0}
      doneToday={0}
      activeDays={0}
      dots={[]}
    />,
  );
}

describe("时段选择", () => {
  it("时段按钮用 aria-pressed，不用孤立的 tab 角色", () => {
    const html = renderSidebar();
    expect(html).not.toContain('role="tab"');
    expect(html).toMatch(/class="lg-slot"[^>]*aria-pressed="true"[^>]*>[\s\S]*?日间/);
  });

  it("页首日期用逻辑日，不用钟点日的日历日", () => {
    const html = renderSidebar("2026-10-24");
    expect(html).toContain("10月24日");
    expect(html).toContain("星期六");
    expect(html).not.toContain("10月25日");
  });
});
