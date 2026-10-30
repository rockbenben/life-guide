/**
 * 步级时长补录工具的单元测试。
 *
 * 这里守三件事：
 *   1. **认得出**：原文写明这一步做多久的，要能认出来。
 *   2. **认不错**：整组的量、频次、症状描述、效果持续时长，都**不该**被当成
 *      这一步的时长 —— 认错了屏上就会摆一个假读数。
 *   3. **引文一致**：写进卡里的引文必须是快照的逐字子串（R1 会查），
 *      秒数得跟引文对得上（R2 会查）。工具负责保证，不靠人手。
 */
import { describe, expect, it } from "vitest";
import {
  cardTakesStepTiming,
  durationForStep,
  findDurations,
  isStepDuration,
} from "../src/step-duration.ts";
import { STEP_DURATION_REJECTED, STEP_DURATION_VERDICTS } from "../src/step-duration-verdicts.ts";

describe("findDurations：认出「数字 + 时长单位」", () => {
  it("秒", () => {
    expect(findDurations("保持 10 秒")).toEqual([
      { sec: 10, raw: "10 秒", approximate: false },
    ]);
  });

  it("分钟换算成秒", () => {
    expect(findDurations("小火煮 5 分钟")[0].sec).toBe(300);
  });

  it("小时换算成秒", () => {
    expect(findDurations("冷藏 1 小时")[0].sec).toBe(3600);
  });

  it("中文数字也认（「一分钟」）", () => {
    expect(findDurations("一分钟也算数")[0].sec).toBe(60);
  });

  it("近似值带上标志（「约 3 分钟」）", () => {
    expect(findDurations("加热约 3 分钟")[0].approximate).toBe(true);
  });

  it("「分」单独出现不是时长（评分 4 分）", () => {
    expect(findDurations("糖尿病 4 分")).toEqual([]);
  });
});

describe("isStepDuration：这一步的时长 vs 不是", () => {
  it("是：保持 / 煮 / 烤 这类动作的持续时间", () => {
    expect(isStepDuration("坐在椅子上，抬起一条腿的膝盖，保持 10 秒后放回。")).toBe(true);
    expect(isStepDuration("中火煮 10 分钟")).toBe(true);
  });

  it("不是：整组的量（「整套做完大约 90 秒」）", () => {
    expect(isStepDuration("整套做完大约 90 秒")).toBe(false);
  });

  it("不是：频次（「每天 50 次」）", () => {
    expect(isStepDuration("每天 50 次，动作连贯快速进行")).toBe(false);
  });

  it("不是：什么时候做（「睡前 1-2 小时」）", () => {
    expect(isStepDuration("40-42.5℃ 热水浴安排在睡前 1-2 小时")).toBe(false);
  });

  it("不是：症状描述（「走了 5 分钟小腿肚就开始痛」）", () => {
    expect(isStepDuration("走了 5 分钟左右，小腿肚就开始痛")).toBe(false);
  });

  it("不是：效果持续时长（「防晒霜的高效效果只持续 2～3 小时」）", () => {
    expect(isStepDuration("防晒霜的高效效果只持续 2～3 小时左右，所以要勤于补涂")).toBe(false);
  });

  it("不是：上限（「5 分钟以内缓解」）", () => {
    expect(isStepDuration("5 分钟以内缓解、改变头位时发作")).toBe(false);
  });
});

describe("cardTakesStepTiming：这张卡该不该有步级计时", () => {
  it("动作卡该有", () => {
    expect(cardTakesStepTiming([{ id: "a", text: "保持 10 秒后放回" }], "practice")).toBe(true);
  });

  it("疾病类卡不进今日清单，不必有", () => {
    expect(cardTakesStepTiming([{ id: "a", text: "保持 10 秒" }], "condition")).toBe(false);
  });

  it("全是自查项的卡不该有", () => {
    expect(
      cardTakesStepTiming(
        [
          { id: "a", text: "判断有没有贫血" },
          { id: "b", text: "检查口腔" },
          { id: "c", text: "记录一周的疲劳程度" },
        ],
        "practice",
      ),
    ).toBe(false);
  });
});

describe("durationForStep：引文要跟秒数对得上", () => {
  it("从步骤自己的引文里取那一句", () => {
    const p = durationForStep("保持 10 秒后放回。", ["保持 10 秒后放回。"], "x", "y");
    expect(p?.sec).toBe(10);
    expect(p?.quote).toBe("保持 10 秒后放回。");
    expect(p?.confidence).toBe("sure");
  });

  it("一句里两个时长 → 标为 unsure，要人看一眼", () => {
    const p = durationForStep(
      "抬起单脚保持 10 秒，然后放下休息 3 秒",
      ["抬起单脚保持 10 秒，然后放下休息 3 秒"],
      "x",
      "y",
    );
    expect(p?.confidence).toBe("unsure");
    expect(p?.note).toContain("2 个时长");
  });
});

describe("人工裁定清单", () => {
  it("每条裁定都带理由 —— 不知道为什么的裁定不算裁定", () => {
    for (const v of STEP_DURATION_VERDICTS) {
      expect(v.note.length).toBeGreaterThan(0);
      expect(v.quote.length).toBeGreaterThan(0);
      expect(v.sec).toBeGreaterThan(0);
    }
  });

  it("每条排除都带理由", () => {
    for (const r of STEP_DURATION_REJECTED) {
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it("裁定优先于机器判断", () => {
    const v = STEP_DURATION_VERDICTS[0];
    const p = durationForStep("完全不同的文本", ["完全不同的文本"], v.id, v.step);
    expect(p?.sec).toBe(v.sec);
    expect(p?.quote).toBe(v.quote);
  });

  it("明确排除的步，机器不再捡回来", () => {
    const r = STEP_DURATION_REJECTED[0];
    const p = durationForStep("速走 1 分钟 = 半格速走 2 分钟 = 1 格", ["速走 1 分钟 = 半格"], r.id, r.step);
    expect(p).toBeNull();
  });
});
