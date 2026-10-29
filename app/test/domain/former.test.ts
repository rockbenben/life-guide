import { describe, expect, it } from "vitest";

import {
  buildFormerMap,
  migrateIdMap,
  migrateIds,
  resolveFormerId,
} from "../../src/domain/former.ts";

describe("旧 id 认领", () => {
  it("旧 id 换成新 id", () => {
    const map = buildFormerMap([{ id: "merged-card", formerIds: ["old-a", "old-b"] }]);
    expect(resolveFormerId(map, "old-a")).toBe("merged-card");
    expect(resolveFormerId(map, "old-b")).toBe("merged-card");
    // 不是旧 id 就原样返回
    expect(resolveFormerId(map, "other-card")).toBe("other-card");
  });

  it("链式也解开（A 并进 B，B 又并进 C）", () => {
    const map = buildFormerMap([
      { id: "b", formerIds: ["a"] },
      { id: "c", formerIds: ["b"] },
    ]);
    expect(resolveFormerId(map, "a")).toBe("c");
  });

  it("环不会绕死：最多走十步", () => {
    const map = new Map<string, string>([
      ["a", "b"],
      ["b", "a"],
    ]);
    expect(() => resolveFormerId(map, "a")).not.toThrow();
  });

  it("自己指向自己被忽略（写错了也不该生效）", () => {
    const map = buildFormerMap([{ id: "x", formerIds: ["x"] }]);
    expect(resolveFormerId(map, "x")).toBe("x");
  });

  it("清单迁移：换 id 并去掉重复，次序照旧", () => {
    const map = buildFormerMap([{ id: "merged", formerIds: ["old-a"] }]);
    expect(migrateIds(map, ["old-a", "b", "merged", "c"])).toEqual(["merged", "b", "c"]);
  });

  it("映射表迁移：两张卡合并时，后写的赢", () => {
    const map = buildFormerMap([{ id: "merged", formerIds: ["old-a"] }]);
    const out = migrateIdMap(map, { "old-a": "weekly", other: "daily" });
    expect(out).toEqual({ merged: "weekly", other: "daily" });
  });
});
