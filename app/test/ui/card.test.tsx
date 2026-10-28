/**
 * R11：stop 级禁忌必须在收起态可见。
 *
 * 这条规则是安全规则，不是样式偏好：禁忌被折叠起来等于没有 ——
 * 用户只会看收起态（列表一眼扫过），展开与否是可选动作。
 *
 * 用组件渲染来测，而不是 e2e：这条规则关心的是「收起态的输出里有没有它」，
 * 组件级渲染就足够断言，也不需要浏览器。设备端的验收另算（见 AGENTS.md §7）。
 */
import { describe, expect, it } from "vitest";
// 用具名导出：包的 .d.ts 是 CJS 风格，default 导入在类型上会被当成模块对象。
// 运行时走的是 ESM 构建，具名导出两边都对得上。
import { render } from "preact-render-to-string";

import { CardView } from "../../src/ui/Card.tsx";
import type { Card } from "../../src/domain/routine.ts";
import type { Reminder } from "../../src/domain/reminders.ts";

const STOP = "眼睛有伤时不要做睑缘清洗";
const INFO = "水温别太烫";

function makeCard(over: Partial<Card> = {}): Card {
  return {
    id: "tears",
    status: "reviewed",
    source: { anchor: "睑缘的清洁" },
    remind: { text: "每天清洗睑缘", quote: "每天清洗睑缘" },
    steps: [{ id: "warm", text: "用温水浸湿棉片", quote: "用温水浸湿棉片" }],
    cautions: [
      { level: "stop", text: STOP, quote: STOP },
      { level: "info", text: INFO, quote: INFO },
    ],
    ...over,
  };
}

function view(
  card: Card,
  expanded: boolean,
  userTags: string[] = [],
  onOpenArticle?: (path: string) => void,
): string {
  return render(
    <CardView
      card={card}
      mode="normal"
      userTags={userTags}
      done={false}
      streakDays={0}
      onToggle={() => {}}
      expanded={expanded}
      onExpand={() => {}}
      onOpenArticle={onOpenArticle}
    />,
  );
}

function viewMode(
  card: Card,
  mode: "busy" | "sick",
  expanded: boolean,
): string {
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

describe("模式版本", () => {
  it("忙档只显示选中的步骤，并标出忙档", () => {
    const card = makeCard({
      steps: [
        { id: "warm", text: "用温水浸湿棉片", quote: "用温水浸湿棉片" },
        { id: "wipe", text: "用棉片轻擦眼睑", quote: "用棉片轻擦眼睑" },
      ],
      variants: { busy: { include: ["warm"] } },
    });
    const html = viewMode(card, "busy", true);
    expect(html).toContain("忙档");
    expect(html).toContain("忙档 · 1 步");
    expect(html).toContain("用温水浸湿棉片");
    expect(html).not.toContain("用棉片轻擦眼睑");
  });

  it("生病跳过的卡标今天不做，且不能盖章", () => {
    const card = makeCard({ variants: { sick: { skip: true } } });
    const html = viewMode(card, "sick", false);
    expect(html).toContain("今天不做");
    expect(html).toMatch(/<button[^>]*class="lg-seal"[^>]*disabled/);
  });

  it("生病跳过的卡不再摆原卡时长", () => {
    const card = makeCard({
      duration: { basis: "quote", sec: 1800, quote: "每天 30 分钟" },
      variants: { sick: { skip: true } },
    });
    const html = viewMode(card, "sick", false);
    expect(html).toMatch(/class="lg-dur" data-state="mode">今天不做</);
    expect(html.match(/class="lg-dur"/g)).toHaveLength(1);
    expect(html).not.toContain('class="lg-modeflag"');
  });
});

describe("频率", () => {
  it("展开态可以改成每周/每月，当前值有按下标记", () => {
    const html = render(
      <CardView
        card={makeCard()}
        mode="normal"
        userTags={[]}
        done={false}
        streakDays={0}
        onToggle={() => {}}
        expanded
        onExpand={() => {}}
        cadence="weekly"
        onCadenceChange={() => {}}
      />,
    );
    expect(html).toContain("频率");
    expect(html).toMatch(/aria-pressed="true"[^>]*>每週|aria-pressed="true"[^>]*>每周/);
    expect(html).toContain("每月");
  });
});

describe("展开态标题层级", () => {
  it("小节标题是 h3，不从 h2 直接跳到 h4", () => {
    const html = view(makeCard(), true);
    expect(html).toContain("<h3>怎么做</h3>");
    expect(html).not.toContain("<h4>怎么做</h4>");
  });
});

describe("疾病知识卡的时间栏", () => {
  it("左边写「知识」，不写「随时」——知识不是今天要做的事", () => {
    const html = view(makeCard({ articleKind: "condition" }), false);
    expect(html).toContain("知识");
    expect(html).not.toContain("随时");
  });

  it("展开态没有「时段」那一行", () => {
    const html = view(makeCard({ articleKind: "condition" }), true);
    expect(html).not.toContain("时段");
  });
});

describe("印章的可访问名称", () => {
  it("盖过印后，屏上的日期也要出现在可访问名称里", () => {
    const html = render(
      <CardView
        card={makeCard()}
        mode="normal"
        userTags={[]}
        done
        streakDays={0}
        onToggle={() => {}}
        expanded={false}
        onExpand={() => {}}
        dayOfMonth={24}
      />,
    );
    expect(html).toContain('aria-label="取消今天这一格（24）"');
  });
});

describe("R11：stop 级禁忌在收起态可见", () => {
  it("收起态就显示 stop 级禁忌", () => {
    expect(view(makeCard(), false)).toContain(STOP);
  });

  it("收起态不塞普通禁忌（那是展开态的内容）", () => {
    expect(view(makeCard(), false)).not.toContain(INFO);
  });

  it("展开态显示全部禁忌", () => {
    const html = view(makeCard(), true);
    expect(html).toContain(STOP);
    expect(html).toContain(INFO);
  });

  it("命中人群分档时，卡片自己的 stop 禁忌不能丢", () => {
    // 分档换的是动作，安全信息不跟着换 —— 换了动作之后那条禁忌依然成立。
    const card = makeCard({
      segments: [
        {
          id: "bone-senior",
          when: ["age:senior"],
          action: { text: "坐位抬脚跟", quote: "坐位抬脚跟" },
          steps: [{ id: "seated", text: "坐着抬脚跟 20 次", quote: "坐着抬脚跟 20 次" }],
        },
      ],
    });
    const html = view(card, false, ["age:senior"]);
    expect(html).toContain(STOP);
    expect(html).toContain("坐位抬脚跟");
  });

  it("分档的适用人群说人话，不给机器口径", () => {
    // 标签是 age:senior 这种机器口径，界面上要显示「70 岁以上」。
    const card = makeCard({
      segments: [
        {
          id: "bone-senior",
          when: ["age:senior"],
          action: { text: "坐位抬脚跟", quote: "坐位抬脚跟" },
        },
      ],
    });
    const html = view(card, true, ["age:senior"]);
    expect(html).toContain("70 岁以上");
    expect(html).not.toContain("age:senior");
  });

  it("分档换动作时，收起态显示换后的那个动作，不显示被换掉的 remind", () => {
    const card = makeCard({
      remind: { text: "踮起脚尖再快速落下，每天 50 次", quote: "踮起脚尖再快速落下，每天 50 次" },
      segments: [
        {
          id: "bone-senior",
          when: ["age:senior"],
          action: { text: "坐位抬脚跟", quote: "坐位抬脚跟" },
          dose: { text: "每侧 10 次", quote: "每侧 10 次" },
        },
      ],
    });
    const html = view(card, false, ["age:senior"]);
    expect(html).toContain("坐位抬脚跟");
    expect(html).not.toContain("踮起脚尖");
    // 默认动作的剂量不许挂到换后的动作上
    expect(html).toContain("每侧 10 次");
    expect(html).not.toContain("50 次");
  });

  it("长卡默认只展开前 6 步，并说清还剩几步", () => {
    const steps = Array.from({ length: 23 }, (_, i) => ({
      id: `s${i}`,
      text: `第 ${i + 1} 步`,
      quote: `第 ${i + 1} 步`,
    }));
    const html = view(makeCard({ steps }), true);
    expect(html).toContain("第 1 步");
    expect(html).toContain("第 6 步");
    expect(html).not.toContain("第 7 步");
    expect(html).toContain("还有 17 步");
  });

  it("卡里不再出现「原文」，来源只有页脚一个链接", () => {
    const html = view(
      makeCard({
        articlePath: "the-savvy-life-manual/body-care/tooth.md",
        steps: [
          {
            id: "warm",
            text: "甲做法",
            quote: "乙原文里的那句原话",
          },
        ],
      }),
      true,
      [],
      () => {},
    );
    expect(html).toContain("甲做法");
    // 卡里没有「原文」的链接了
    expect(html).not.toContain("lg-srclink");
    expect(html).not.toContain("的原文</button>");
    expect(html).not.toContain("乙原文里的那句原话");
    // 来源在页脚，只有一处
    expect(html).toContain("出自");
    expect(html).toContain("lg-linkbtn");
  });

  it("没有出处可跳时，那条链接也不摆（不能给点不动的键）", () => {
    const html = view(
      makeCard({
        steps: [{ id: "wrap", text: "取一段牙线，两端缠在左右手中指上", quote: "取一段牙线，两端缠在左右手中指上" }],
      }),
      true,
    );
    expect(html).not.toMatch(/第 1 步\s*的原文/);
    expect(html).not.toContain("lg-srclink");
  });

  it("禁忌与提示上也不再有「…的原文」的键", () => {
    const html = view(
      makeCard({
        cautions: [{ level: "info", text: INFO, quote: INFO }],
        notices: [{ level: "seek-care", text: "出现这个症状请就医", quote: "出现这个症状请就医" }],
      }),
      true,
    );
    expect(html).not.toMatch(/注意 1\s*的原文/);
    expect(html).not.toMatch(/提示 1\s*的原文/);
    expect(html).not.toContain("lg-srcbtn");
  });

  it("剂量的范围是一行（32～34 ℃），不拆成上下限两条", () => {
    const html = view(
      makeCard({
        dose: [
          {
            value: 32,
            valueMax: 34,
            unit: "℃",
            what: "温凉水冲洗脸部",
            quote: "用 32 到 34℃ 的温凉水冲洗脸部",
          },
        ],
      }),
      true,
    );
    expect(html).toContain("32～34");
    expect(html).toContain("温凉水冲洗脸部");
    expect(html).not.toContain("下限");
    expect(html).not.toContain("上限");
  });

  it("展开态给出这张卡出自哪一篇，并能跳", () => {
    const html = render(
      <CardView
        card={makeCard({ articlePath: "the-savvy-life-manual/body-care/tears.md" })}
        mode="normal"
        userTags={[]}
        done={false}
        streakDays={0}
        onToggle={() => {}}
        expanded
        onExpand={() => {}}
        onOpenArticle={() => {}}
      />,
    );
    expect(html).toContain("出自");
    expect(html).toContain("lg-linkbtn");
  });

  it("疾病卡不给盖章，普通卡给", () => {
    expect(view(makeCard(), false)).toContain("盖上今天这一格");
    const html = render(
      <CardView
        card={makeCard()}
        mode="normal"
        userTags={[]}
        done={false}
        streakDays={0}
        onToggle={() => {}}
        expanded={false}
        onExpand={() => {}}
        readOnly
      />,
    );
    expect(html).not.toContain("盖上今天这一格");
  });

  it("展开态尾部有回到清单的出口（U4）", () => {
    expect(view(makeCard(), true)).toContain("收起");
  });

  it("「做什么」被截断时，展开态要能读到完整提醒（D2：截掉的那半句不许消失）", () => {
    const long = "先准备，再依次做脸部、眼周、足部，全程从四肢末端往锁骨方向轻抚，每处重复四次";
    const card = makeCard({ remind: { text: long, quote: long } });
    const collapsed = view(card, false);
    expect(collapsed).toContain("…"); // 收起态确实截断了
    const open = view(card, true);
    expect(open).toContain("轻抚，每处重复四次"); // 展开态读得到被截掉的后半句
  });

  it("警示符号不用 ⚠ 字符（安卓上会渲染成彩色 emoji）", () => {
    const html = view(makeCard(), false);
    expect(html).not.toContain("⚠");
    expect(html).toContain("<svg");
  });
});

/**
 * 卡上能设自己的提醒（用户问过「卡片在哪设置定时提醒」）。
 *
 * 收起的卡上不摆提醒那一行 —— 提醒是展开后才用的东西，
 * 收起态只留名 / 做什么 / 剂量三行（那条契约别破）。
 */
describe("「做什么」与名重复时", () => {
  const dup = {
    id: "limit-alcohol",
    name: "每天酒精不超过 20～25 克",
    remind: { text: "每天酒精不超过 20～25 克", quote: "…" },
  };

  it("收起态不把同一句话说两遍", () => {
    const html = view(makeCard(dup), false);
    expect(html.match(/每天酒精不超过 20～25 克/g)).toHaveLength(1);
  });

  it("展开态仍然读得到原文（D2：收起态省了，原文不许消失）", () => {
    const html = view(makeCard(dup), true);
    expect(html).toContain("做什么");
    expect(html).toContain("每天酒精不超过 20～25 克");
  });
});

describe("剂量里的「约」", () => {
  it("原文是近似值时，屏上写「约」而不是把近似说成定值", () => {
    const html = view(
      makeCard({
        dose: [
          {
            value: 5,
            unit: "次",
            what: "来回轻洗",
            approximate: true,
            quote: "来回轻柔地洗约 5 次",
          },
        ],
      }),
      false,
    );
    expect(html).toContain("约 5 次");
  });

  it("没有标记的就不带「约」", () => {
    const html = view(
      makeCard({ dose: [{ value: 5, unit: "次", what: "来回轻洗", quote: "来回轻柔地洗 5 次" }] }),
      false,
    );
    expect(html).toContain("5 次");
    expect(html).not.toContain("约 5 次");
  });
});

describe("卡上的提醒那一行", () => {
  function withReminders(reminders: Reminder[], expanded = true): string {
    return render(
      <CardView
        card={makeCard()}
        mode="normal"
        userTags={[]}
        done={false}
        streakDays={0}
        onToggle={() => {}}
        expanded={expanded}
        onExpand={() => {}}
        reminders={reminders}
        onRemindersChange={() => {}}
      />,
    );
  }

  it("展开态有「提醒」那一行，没设时给一颗「设提醒」的键", () => {
    const html = withReminders([]);
    expect(html).toContain("提醒");
    expect(html).toContain("设提醒");
  });

  it("设过了就显示时间与「改」", () => {
    const html = withReminders([
      {
        id: "card:tears",
        cardId: "tears",
        label: "睑缘的清洁",
        mode: "daily",
        time: "08:30",
        on: true,
      },
    ]);
    expect(html).toContain("每天 08:30");
    expect(html).toContain("改");
  });

  it("收起态不摆提醒那一行", () => {
    const html = withReminders([], false);
    expect(html).not.toContain("设提醒");
  });
});
