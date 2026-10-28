import { describe, it, expect } from "vitest";
import {
  parseManifest,
  verifyAssets,
  buildChecksums,
  expectedFiles,
  expectedCarriers,
  MANIFESTS,
} from "../release-assets.mjs";

const V = "0.1.1";

describe("parseManifest", () => {
  it("读出版本与它指向的文件", () => {
    const p = parseManifest(
      `version: ${V}\nfiles:\n  - url: LifeGuide-Setup-${V}.exe\n    sha512: abc\n    size: 1\npath: LifeGuide-Setup-${V}.exe\n`,
    );
    expect(p.version).toBe(V);
    expect(p.urls).toEqual([`LifeGuide-Setup-${V}.exe`]);
  });

  it("清单是空的也别炸", () => {
    const p = parseManifest("");
    expect(p.version).toBe("");
    expect(p.urls).toEqual([]);
  });
});

describe("expectedFiles", () => {
  it("15 个产物，一个都不能少", () => {
    const files = expectedFiles(V);
    expect(files).toHaveLength(15);
    expect(files).toContain(`LifeGuide-Setup-${V}.exe`);
    expect(files).toContain(`LifeGuide-${V}.apk`);
    expect(new Set(files).size).toBe(files.length);
  });

  it("附件名只有 ASCII（GitHub 的附件名不吃中文）", () => {
    for (const f of expectedFiles(V)) {
      expect(/^[\x20-\x7e]+$/.test(f)).toBe(true);
    }
  });
});

describe("expectedCarriers", () => {
  it("四条清单各有各该指的载体", () => {
    const c = expectedCarriers(V);
    expect(Object.keys(c).sort()).toEqual([...MANIFESTS].sort());
    expect(c["latest.yml"]).toEqual([`LifeGuide-Setup-${V}.exe`]);
    expect(c["latest-mac.yml"]).toHaveLength(2);
  });
});

describe("verifyAssets", () => {
  const okAssets = [
    ...MANIFESTS.map((m) => ({ name: m, digest: "sha256:aa" })),
    ...expectedFiles(V).map((f) => ({ name: f, digest: "sha256:bb" })),
  ];
  const okManifests = Object.fromEntries(
    MANIFESTS.map((m) => [
      m,
      { version: V, urls: expectedCarriers(V)[m] ?? [] },
    ]),
  );

  it("齐了就没问题", () => {
    expect(
      verifyAssets({
        assets: okAssets,
        manifests: okManifests,
        version: V,
        required: expectedFiles(V),
        carriers: expectedCarriers(V),
      }),
    ).toEqual([]);
  });

  it("少一个产物就报出来", () => {
    const problems = verifyAssets({
      assets: okAssets.filter((a) => a.name !== `LifeGuide-${V}.apk`),
      manifests: okManifests,
      version: V,
      required: expectedFiles(V),
      carriers: expectedCarriers(V),
    });
    expect(problems).toContain(`缺少 LifeGuide-${V}.apk`);
  });

  it("清单版本对不上就报出来", () => {
    const bad = { ...okManifests, "latest.yml": { version: "9.9.9", urls: [] } };
    const problems = verifyAssets({
      assets: okAssets,
      manifests: bad,
      version: V,
      required: expectedFiles(V),
      carriers: expectedCarriers(V),
    });
    expect(problems.some((p) => p.includes("latest.yml") && p.includes("9.9.9"))).toBe(true);
  });

  it("清单指向了不存在的文件就报出来", () => {
    const bad = {
      ...okManifests,
      "latest.yml": { version: V, urls: ["LifeGuide-Setup-0.0.0.exe"] },
    };
    const problems = verifyAssets({
      assets: okAssets,
      manifests: bad,
      version: V,
      required: expectedFiles(V),
      carriers: expectedCarriers(V),
    });
    expect(problems.some((p) => p.includes("指向了不存在的"))).toBe(true);
  });

  it("清单没指向该指的载体就报出来", () => {
    const bad = { ...okManifests, "latest.yml": { version: V, urls: [] } };
    const problems = verifyAssets({
      assets: okAssets,
      manifests: bad,
      version: V,
      required: expectedFiles(V),
      carriers: expectedCarriers(V),
    });
    expect(problems.some((p) => p.includes("没指向"))).toBe(true);
  });
});

describe("buildChecksums", () => {
  it("格式与 sha256sum 一致（两格空格，按文件名排序）", () => {
    const out = buildChecksums([
      { name: "b.txt", digest: "sha256:bb" },
      { name: "a.txt", digest: "sha256:aa" },
    ]);
    expect(out).toBe("aa  a.txt\nbb  b.txt\n");
  });

  it("没有 digest 的资产不写进去（宁可少一行，不要写错）", () => {
    const out = buildChecksums([{ name: "a.txt" }, { name: "b.txt", digest: "sha256:bb" }]);
    expect(out).toBe("bb  b.txt\n");
  });
});
