/**
 * 计时器在卡上的样子。
 *
 * 这条测的是**摆在哪、摆成什么形态**：
 *   · 展开态才有（收起态是「现在做什么」的一行摘要，有三行契约）
 *   · 知道时长 → 倒计时；不知道 → 正计时
 *   · 忙档下摆正计时（忙档只做几步，拿原卡的时长去倒计时，倒的不是这一次的数）
 *
 * 逻辑本身在 app/test/domain/timer.test.ts 里。
 */
import { describe, expect, it } from "vitest";
import { render } from "preact-render-to-string";

import { CardView } from "../../src/ui/Card.tsx";
import { Timer } from "../../src/ui/Timer.tsx";
import type { Card } from "../../src/domain/routine.ts";

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "tears",
    status: "reviewed",
    source: { anchor: "睑缘的清洁" },
    remind: { text: "每天清洗睑缘", quote: "每天清洗睑缘" },
    steps: [{ id: "warm", text: "用温水浸湿棉片", quote: "用温水浸湿棉片" }],
    ...over,
  };
}

function view(card: Card, expanded: boolean, mode: "normal" | "busy" = "normal"): string {
  return render(
    <CardView
      card={card}
      mode={mode}
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

describe("计时器摆在卡上", () => {
  it("展开态才有计时器（收起态的三行契约不动）", () => {
    const card = makeCard({ duration: { basis: "quote", sec: 600, quote: "泡 10 分钟" } });
    expect(view(card, false)).not.toContain("lg-timer");
    expect(view(card, true)).toContain("lg-timer");
  });

  it("知道时长 → 倒计时", () => {
    const card = makeCard({ duration: { basis: "quote", sec: 600, quote: "泡 10 分钟" } });
    const html = view(card, true);
    expect(html).toContain('data-kind="countdown"');
    expect(html).toContain("10:00");
  });

  it("不知道时长 → 正计时", () => {
    const card = makeCard({ duration: { basis: "unknown" } });
    const html = view(card, true);
    expect(html).toContain('data-kind="countup"');
    expect(html).toContain("00:00");
  });

  it("完全没有时长字段 → 也是正计时", () => {
    const html = view(makeCard(), true);
    expect(html).toContain('data-kind="countup"');
  });

  it("推算来的时长照样倒计时（但归零时会说是推算的）", () => {
    const card = makeCard({
      duration: { basis: "derived", sec: 900, formula: "15 分钟 × 60 秒/分钟 = 900 秒" },
    });
    const html = view(card, true);
    expect(html).toContain('data-kind="countdown"');
    expect(html).toContain("推算");
  });

  it("疗程那样的一小时以上不倒计时（2 周倒计时没有意义）", () => {
    const card = makeCard({ duration: { basis: "quote", sec: 1209600, quote: "持续 2 周" } });
    expect(view(card, true)).toContain('data-kind="countup"');
  });

  it("忙档摆正计时（忙档只做几步，原卡的时长不是这一次的数）", () => {
    const card = makeCard({
      duration: { basis: "quote", sec: 1800, quote: "每天 30 分钟" },
      variants: { busy: { include: ["warm"] } },
    });
    const html = view(card, true, "busy");
    expect(html).toContain('data-kind="countup"');
    expect(html).not.toContain('data-kind="countdown"');
  });

  it("读数的键说清这是计时，不是装饰", () => {
    const card = makeCard({ duration: { basis: "quote", sec: 600, quote: "泡 10 分钟" } });
    const html = view(card, true);
    expect(html).toMatch(/<button[^>]*class="lg-timer-btn"[^>]*aria-label="开始倒计时"/);
  });
});

describe("计时器自己", () => {
  it("没跑的时候显示 00:00", () => {
    const html = render(<Timer duration={{ sec: 600 }} title="泡澡" cardId="bath" />);
    expect(html).toContain("10:00");
    expect(html).toContain('data-running="false"');
  });

  it("正计时从 00:00 起（目标数是空的）", () => {
    const html = render(<Timer duration={{ sec: null }} title="牙线" cardId="floss" />);
    expect(html).toContain("00:00");
    expect(html).toContain('data-kind="countup"');
  });

  it("时长未知时也有正计时可用", () => {
    const html = render(<Timer duration={null} title="牙线" cardId="floss" />);
    expect(html).toContain('data-kind="countup"');
    expect(html).toContain('aria-label="开始正计时"');
  });
});
