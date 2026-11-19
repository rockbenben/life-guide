import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { promoteLatest } from "../release-latest.mjs";

describe("latest 发布", () => {
  it("较新版先通过核验时，后完成的旧版不会改写 latest", async () => {
    let latest;
    const releases = { 1: "v0.9.99", 2: "v0.10.0" };
    const patches = [];
    const request = async (url, options) => {
      expect(url).toMatch(/^https:\/\/api.github.com\/repos\/fixture\/app\/releases\//);
      if (url.endsWith("/latest")) {
        return latest ? Response.json({ tag_name: latest }) : new Response(null, { status: 404 });
      }
      expect(options.method).toBe("PATCH");
      expect(JSON.parse(options.body)).toEqual({ make_latest: "true" });
      latest = releases[url.split("/").at(-1)];
      patches.push(latest);
      return Response.json({ tag_name: latest });
    };
    const promote = (id) => promoteLatest({
      repo: "fixture/app", token: "fixture", releaseId: String(id), tag: releases[id],
    }, request);
    expect(await promote(2)).toBe(true);
    expect(await promote(1)).toBe(false);
    expect(await promote(2)).toBe(true);
    expect(latest).toBe("v0.10.0");
    expect(patches).toEqual(["v0.10.0"]);
  });

  it("先完成旧版时，后完成的新版可以接替", async () => {
    const patched = [];
    const request = async (url, options) => {
      if (url.endsWith("/latest")) return Response.json({ tag_name: "v0.9.99" });
      patched.push([url, options.method]);
      return new Response(null, { status: 204 });
    };
    expect(await promoteLatest(
      { repo: "fixture/app", token: "fixture", releaseId: "2", tag: "v0.10.0" }, request,
    )).toBe(true);
    expect(patched).toEqual([["https://api.github.com/repos/fixture/app/releases/2", "PATCH"]]);
  });

  it("工作流只在校验完成后进入共享队列，落选历史版跳过 latest 下载核验", () => {
    const workflow = parse(fs.readFileSync(new URL("../../.github/workflows/release.yml", import.meta.url), "utf8"));
    const [, promotion] = Object.entries(workflow.jobs).find(([, job]) =>
      job.steps.some((step) => step.run === "node scripts/release-latest.mjs"));
    expect(promotion.needs).toContain("publish");
    expect(promotion.concurrency).toEqual({ group: "release-latest", queue: "max" });
    const verify = promotion.steps.find((step) => step.run?.includes("releases/latest/download/"));
    expect(verify.if).toBe("steps.latest.outputs.selected == 'true'");
  });
});
