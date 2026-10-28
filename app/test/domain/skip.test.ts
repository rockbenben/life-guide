import { describe, expect, it } from "vitest";

import {
  isSkippedToday,
  markSkipped,
  pruneSkips,
  removeSkip,
  type Skips,
} from "../../src/domain/skip.ts";

const routine = ["a", "b", "my-1"];

describe("今天不做", () => {
  it("只匹配当天，不匹配昨天", () => {
    const skips: Skips = { a: "2026-10-25" };
    expect(isSkippedToday(skips, "a", "2026-10-25")).toBe(true);
    expect(isSkippedToday(skips, "a", "2026-10-26")).toBe(false);
    expect(isSkippedToday(skips, "b", "2026-10-25")).toBe(false);
  });

  it("标记时只保留同一天、仍在日常里的记录", () => {
    const skips: Skips = { a: "2026-10-24", b: "2026-10-25", old: "2026-10-25" };
    expect(markSkipped(skips, "a", "2026-10-25", routine)).toEqual({
      b: "2026-10-25",
      a: "2026-10-25",
    });
  });

  it("永久移出后清掉它的跳过记录", () => {
    expect(pruneSkips({ a: "2026-10-25", b: "2026-10-25" }, ["b"])).toEqual({
      b: "2026-10-25",
    });
  });

  it("撤销只删这一张", () => {
    expect(removeSkip({ a: "2026-10-25", b: "2026-10-25" }, "a")).toEqual({
      b: "2026-10-25",
    });
  });
});
