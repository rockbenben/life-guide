/**
 * 图片优化只动 app/public/media 的副本，且只在不更小的时候保持原样。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { MEDIA_MAX_WIDTH, optimizeMediaFiles } from "../src/media-optimize.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
});

function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "life-guide-media-"));
  dirs.push(d);
  return d;
}

describe("图片优化", () => {
  it("超大图按显示尺寸缩到 1200 以内，并变小", async () => {
    const dir = tmp();
    const file = path.join(dir, "big.png");
    const width = 1300;
    const height = 1000;
    // 随机噪声：PNG 压不动，WebP 缩放后才看得出体积变化
    const raw = crypto.randomBytes(width * height * 3);
    await sharp(raw, { raw: { width, height, channels: 3 } }).png().toFile(file);
    const before = fs.statSync(file).size;

    const stats = await optimizeMediaFiles(dir);
    const meta = await sharp(fs.readFileSync(file)).metadata();
    expect(stats.changed).toBe(1);
    expect(stats.failed).toBe(0);
    expect(meta.width).toBeLessThanOrEqual(MEDIA_MAX_WIDTH);
    expect(fs.statSync(file).size).toBeLessThan(before);
  });

  it("重编码不更小时保持原样（1×1 的无损图重压缩反而更大）", async () => {
    const dir = tmp();
    const file = path.join(dir, "small.webp");
    await sharp({
      create: { width: 1, height: 1, channels: 3, background: "#000000" },
    })
      .webp({ lossless: true, quality: 100 })
      .toFile(file);
    const before = fs.readFileSync(file);

    const stats = await optimizeMediaFiles(dir);
    expect(stats.changed).toBe(0);
    expect(fs.readFileSync(file)).toEqual(before);
  });
});
