/**
 * 分步计时器在卡上的样子。
 *
 * 这条测的是**摆在哪、摆成什么形态**：
 *   · 在「怎么做」那一节里，步骤列表的上方
 *   · 每一步自己带时长时才有；没有就不摆
 *   · 读数是**这一步**的（30 秒），不是整张卡的总时长（7 分钟）
 *
 * 逻辑本身在 app/test/domain/timer.test.ts 里。
 */
import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { CardView } from "../../src/ui/Card.tsx";
import { StepTimer } from "../../src/ui/StepTimer.tsx";
import type { Card } from "../../src/domain/routine.ts";

/** 血管拉伸那样的卡：5 个动作各 30 秒，第 6 步是「动作之间休息」的说明（不计时）。 */
const TIMED_STEPS = [
  { id: "a", text: "压上去", quote: "压上去", duration: { basis: "quote" as const, sec: 30 } },
  { id: "b", text: "换边", quote: "换边", duration: { basis: "quote" as const, sec: 30 } },
  {
    id: "rest",
    text: "动作之间休息",
    quote: "动作之间休息",
  },
];

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "vessel",
    status: "reviewed",
    source: { anchor: "血管拉伸术" },
    remind: { text: "早晚各做一轮血管拉伸" },
    steps: [{ id: "plain", text: "没有时长的那一步", quote: "没有时长的那一步" }],
    ...over,
  };
}

function view(card: Card, expanded: boolean): string {
  return render(
    <CardView
      card={card}
      mode="normal"
      userTags={[]}
      done={false}
      streakDays={0}
      onToggle={() => {}}
      expanded={expanded}
      onExpand={() => {}}
      dayOfMonth={24}
    />,
  );
}

describe("分步计时器在卡上", () => {
  it("步骤各自带时长时，在「怎么做」那一节里摆出来", () => {
    const html = view(makeCard({ steps: TIMED_STEPS }), true);
    expect(html).toContain("lg-steptimer");
    // 在步骤列表之前 —— 计时器是那串步骤的引子
    expect(html.indexOf("lg-steptimer")).toBeLessThan(html.indexOf("lg-steps"));
  });

  it("步骤没有时长时，不摆（没时长不等于 0 秒）", () => {
    const html = view(makeCard(), true);
    expect(html).not.toContain("lg-steptimer");
  });

  it("收起态不摆（计时是「做这一件时」才用得上的）", () => {
    const html = view(makeCard({ steps: TIMED_STEPS }), false);
    expect(html).not.toContain("lg-steptimer");
  });
});

describe("计时器自己", () => {
  it("起手显示第一步的读数（这一步的秒数，不是整张卡的）", () => {
    const html = render(<StepTimer steps={TIMED_STEPS} title="血管拉伸" cardId="vessel" />);
    expect(html).toContain("00:30");
    // 共几步：只数带时长的那几步
    expect(html).toContain("第 1 / 2 步");
  });

  it("显示当前那一步的原文（用户看得见现在该做哪一步）", () => {
    const html = render(<StepTimer steps={TIMED_STEPS} title="血管拉伸" cardId="vessel" />);
    expect(html).toContain("压上去");
  });

  it("没有带时长的步骤 → 什么都不摆", () => {
    const html = render(
      <StepTimer steps={[{ text: "没有时长的那一步" }]} title="什么" cardId="x" />,
    );
    expect(html).not.toContain("lg-steptimer");
  });

  it("休息那一步不参与计时（它不是序列里的一步）", () => {
    // TIMED_STEPS 里第三步没有 duration → 不该出现在步数里
    const html = render(<StepTimer steps={TIMED_STEPS} title="血管拉伸" cardId="vessel" />);
    expect(html).toContain("第 1 / 2 步");
    expect(html).not.toContain("第 1 / 3 步");
  });
});
