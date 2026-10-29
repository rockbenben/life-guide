import { describe, expect, it } from "vitest";

import { TickClock } from "../../src/domain/clock.ts";

describe("单调时钟", () => {
  it("时钟往回走也不倒退（自己的改动不会被自己盖掉）", () => {
    const c = new TickClock(1000);
    expect(c.now(500)).toBe(1001);
    expect(c.now(400)).toBe(1002);
    expect(c.now(9_999_999)).toBe(9_999_999);
  });

  it("并进远端的时间戳后，本机之后的改动排在它后面", () => {
    const c = new TickClock(0);
    const now = Date.now();
    // 另一台设备的时钟快了一分钟
    c.absorb(now + 60_000);
    expect(c.now(now)).toBeGreaterThan(now + 60_000);
  });

  it("并进更旧的时间戳不会倒退", () => {
    const c = new TickClock(1000);
    c.absorb(500);
    expect(c.value).toBe(1000);
    expect(c.now(1000)).toBe(1001);
  });
});
