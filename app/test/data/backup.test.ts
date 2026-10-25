import { describe, expect, it } from "vitest";

import { parseBackup } from "../../src/data/backup.ts";

describe("parseBackup", () => {
  it("空文件/非 JSON 给用户能看懂的错误", () => {
    expect(() => parseBackup("")).toThrow("这个文件读不出来");
    expect(() => parseBackup("not json")).toThrow("这个文件读不出来");
  });

  it("JSON 不是备份对象时不抛技术性 TypeError", () => {
    for (const text of ["null", "[]", "123", '"x"']) {
      expect(() => parseBackup(text)).toThrow("这不是本应用导出的备份文件");
    }
  });
});
