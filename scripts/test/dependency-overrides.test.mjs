/** Integration contracts for security overrides that cross upstream version ranges. */
import { afterEach, describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const scratch = [];
async function temporaryDirectory() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "life-guide-dependency-"));
  scratch.push(dir);
  return dir;
}
afterEach(async () => {
  for (const dir of scratch.splice(0)) {
    if (
      path.dirname(dir) !== path.resolve(os.tmpdir()) ||
      !path.basename(dir).startsWith("life-guide-dependency-")
    ) {
      throw new Error("Unexpected dependency test directory");
    }
    await rm(dir, { recursive: true, force: true });
  }
});

describe("security override consumer contracts", () => {
  it("应用、通知插件与原生 SDK 共用同一份且版本一致的 Capacitor core", () => {
    const appRequire = createRequire(path.join(root, "app/package.json"));
    const mobileRequire = createRequire(path.join(root, "mobile/package.json"));
    const android = mobileRequire.resolve("@capacitor/android/package.json");
    const ios = mobileRequire.resolve("@capacitor/ios/package.json");
    const notifications = appRequire.resolve(
      "@capacitor/local-notifications/package.json",
    );
    const consumers = [
      appRequire,
      mobileRequire,
      ...[android, ios, notifications].map(createRequire),
    ];
    expect(
      new Set(consumers.map((consumer) => consumer.resolve("@capacitor/core")))
        .size,
    ).toBe(1);
    const core = appRequire("@capacitor/core/package.json");
    expect(core.version).toBe(
      mobileRequire("@capacitor/android/package.json").version,
    );
    expect(core.version).toBe(
      mobileRequire("@capacitor/ios/package.json").version,
    );
  });

  it("Workbox 的预缓存扫描保持文件类型、子目录与忽略规则", async () => {
    const { getManifest } = require("workbox-build");
    const dir = await temporaryDirectory();
    for (const file of [
      "index.html",
      "cards.json",
      "assets/app.js",
      "assets/app.css",
      "media/step.webp",
      "ignored/no.js",
      "notes.txt",
      ".hidden.js",
    ]) {
      const destination = path.join(dir, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, `fixture ${file}`);
    }
    const { manifestEntries, warnings } = await getManifest({
      globDirectory: dir,
      globPatterns: ["**/*.{js,css,html,json,png,jpg,jpeg,webp,svg,woff2}"],
      globIgnores: ["ignored/**"],
      maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
    });
    expect(warnings).toEqual([]);
    expect(manifestEntries.map(({ url }) => url).sort()).toEqual([
      "assets/app.css",
      "assets/app.js",
      "cards.json",
      "index.html",
      "media/step.webp",
    ]);
    expect(
      manifestEntries.every(({ revision }) => /^[0-9a-f]{32}$/.test(revision)),
    ).toBe(true);
  });

  it("Markdown lint 仍能解析公式，数学扩展保持默认的不信任渲染", async () => {
    const { lint } = await import("markdownlint/sync");
    const markdown = "# Math\n\n$x^2 + y^2$\n\n$$\nx + y = 1\n$$\n";
    const results = lint({
      strings: { math: markdown },
      config: { default: true },
    });
    expect(results.math).toEqual([]);
    const { micromark } = await import("micromark");
    const { math, mathHtml } = await import("micromark-extension-math");
    const render = (text) =>
      micromark(text, { extensions: [math()], htmlExtensions: [mathHtml()] });
    expect(render("$x^2$\n")).toContain('class="katex"');
    expect(render("$\\href{javascript:alert(1)}{click}$\n")).not.toMatch(
      /href=["']javascript:/,
    );
  });

  it("桌面打包使用实际 files 配置时，包含应用代码并排除测试文件", async () => {
    const { FileMatcher } = require("app-builder-lib/out/fileMatcher.js");
    const config = JSON.parse(
      await readFile(path.join(root, "desktop/package.json"), "utf8"),
    );
    const appDir = path.join(root, "desktop");
    const matcher = new FileMatcher(
      appDir,
      appDir,
      (value) => value,
      config.build.files,
    ).createFilter();
    for (const [file, included] of [
      ["main.mjs", true],
      ["preload.cjs", true],
      ["lib/reminders.mjs", true],
      ["package.json", true],
      ["build/tray.png", true],
      ["lib/reminder-timing.test.mjs", false],
    ]) {
      const absolute = path.join(appDir, file);
      expect(matcher(absolute, await stat(absolute)), file).toBe(included);
    }
  });

  it("universal 与 lint 的匹配入口保留函数、构造器和 matchBase 语义", () => {
    for (const consumer of ["@electron/universal", "markdownlint-cli"]) {
      const consumerRequire = createRequire(require.resolve(consumer));
      const { minimatch, Minimatch } = consumerRequire("minimatch");
      expect(
        minimatch("native/x64.js", "{x64,arm64}.js", { matchBase: true }),
      ).toBe(true);
      expect(
        minimatch("native/other.js", "{x64,arm64}.js", { matchBase: true }),
      ).toBe(false);
      const matcher = new minimatch.Minimatch("docs/**/*.md");
      expect(matcher).toBeInstanceOf(Minimatch);
      expect(matcher.match("docs/部署.md")).toBe(true);
      expect(matcher.match("docs/file.ts")).toBe(false);
    }
    // Legacy ASAR/glob uses a callable export; it must keep its own unaffected v3 dependency.
    const asarRequire = createRequire(require.resolve("@electron/asar"));
    const globRequire = createRequire(asarRequire.resolve("glob"));
    expect(typeof globRequire("minimatch")).toBe("function");
  });

  it("Capacitor assets 的 xcode 能生成唯一 PBX ID 并保存、重读实际 iOS 工程", async () => {
    const assetsRequire = createRequire(
      require.resolve("@capacitor/assets/package.json"),
    );
    const projectRequire = createRequire(
      assetsRequire.resolve("@trapezedev/project/package.json"),
    );
    const xcode = projectRequire("xcode");
    const source = path.join(
      root,
      "mobile/ios/App/App.xcodeproj/project.pbxproj",
    );
    const project = xcode.project(source);
    project.parseSync();
    const existingIds = new Set(project.allUuids());
    const generated = new Set(
      Array.from({ length: 100 }, () => project.generateUuid()),
    );
    expect(generated.size).toBe(100);
    for (const id of generated) {
      expect(id).toMatch(/^[0-9A-F]{24}$/);
      expect(existingIds.has(id)).toBe(false);
    }
    const group = project.addPbxGroup(
      [],
      "DependencyAcceptance",
      "DependencyAcceptance",
    );
    project.addToPbxGroup(
      group.uuid,
      project.getFirstProject().firstProject.mainGroup,
    );
    const saved = path.join(await temporaryDirectory(), "project.pbxproj");
    await writeFile(saved, project.writeSync());
    const restored = xcode.project(saved);
    restored.parseSync();
    expect(restored.pbxGroupByName("DependencyAcceptance").name).toBe(
      "DependencyAcceptance",
    );
    expect(restored.getFirstProject().uuid).toBe(
      project.getFirstProject().uuid,
    );
    expect(await readFile(source, "utf8")).not.toContain(
      "DependencyAcceptance",
    );
  });
});
