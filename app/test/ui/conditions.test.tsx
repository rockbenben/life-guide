/**
 * 条件面板的话要跟实际行为对得上。
 *
 * 每个模式单独判断「有没有卡带这个版本」：只有忙档时，不能对出差说「换个做法」；
 * 只有部分卡有版本时，也不能说整个清单都会变。
 */
import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { ConditionPanel } from "../../src/ui/Conditions.tsx";
import type { Mode, ModeCounts, ModeVariants } from "../../src/domain/routine.ts";

const NONE: ModeVariants = { busy: false, travel: false, sick: false };
const ALL: ModeVariants = { busy: true, travel: true, sick: true };

function renderPanel(
  mode: Mode,
  modeVariants: ModeVariants,
  coverage?: ModeCounts,
  coverageScope: "current" | "manual" = "manual",
): string {
  return render(
    <ConditionPanel
      mode={mode}
      tags={["age:adult"]}
      onMode={() => {}}
      onTag={() => {}}
      modeVariants={modeVariants}
      coverage={coverage}
      coverageScope={coverageScope}
      hasSegments
    />,
  );
}

describe("条件面板：没有对应版本时", () => {
  it("正常模式不解释「很忙」", () => {
    const html = renderPanel("normal", NONE);
    expect(html).not.toContain("选「很忙」");
    expect(html).not.toContain('class="lg-hint"');
  });

  it("很忙：说清单不会变，只是把状态记下来", () => {
    const html = renderPanel("busy", NONE);
    expect(html).toContain("选「很忙」现在不会改变清单");
  });

  it("出差：说照常做，而不是「换个做法」", () => {
    const html = renderPanel("travel", NONE);
    expect(html).toContain("手册里还没有出差版的做法");
    expect(html).not.toContain("出差：换个做法");
  });

  it("生病：不写「今天不做」，改为按身体情况来", () => {
    const html = renderPanel("sick", NONE);
    expect(html).toContain("手册里还没有生病版的做法");
    expect(html).toContain("按身体情况来");
    expect(html).not.toContain("今天不做");
  });
});

describe("条件面板：有对应版本时", () => {
  it("生病版说按版本做，不再说今天不做", () => {
    const html = renderPanel("sick", ALL);
    expect(html).toContain("有生病版的按版本做");
    expect(html).not.toContain("生病：今天不做");
    expect(html).not.toContain("手册里还没有生病版");
  });

  it("忙档说只做核心步骤，其余照常", () => {
    const html = renderPanel("busy", ALL);
    expect(html).toContain("有忙档的只做核心步骤");
  });

  it("出差版说换个做法", () => {
    const html = renderPanel("travel", ALL);
    expect(html).toContain("有出差版的换个做法");
  });
});

describe("条件面板：按模式分别判断", () => {
  const PARTIAL: ModeVariants = { busy: true, travel: false, sick: true };

  it("没有出差版时，出差仍如实说照常做", () => {
    const html = renderPanel("travel", PARTIAL);
    expect(html).toContain("手册里还没有出差版的做法");
    expect(html).not.toContain("有出差版的换个做法");
  });

  it("当前清单里有几张真的变了，要说清范围", () => {
    const html = renderPanel(
      "busy",
      PARTIAL,
      { busy: 2, travel: 0, sick: 1 },
      "current",
    );
    expect(html).toContain("当前清单里有 2 张有「很忙」版");
  });

  it("当前清单里一张都没有时，也说清楚", () => {
    const html = renderPanel(
      "sick",
      PARTIAL,
      { busy: 2, travel: 0, sick: 0 },
      "current",
    );
    expect(html).toContain("当前清单里没有「生病」版");
  });
});
