/**
 * 把拷进 App 的图片按显示尺寸重编码一次。
 *
 * 快照里的图是 WebP（扩展名还是 .png，历史原因），但尺寸是给纸面/原始网页的：
 * 最大 2426px 宽、2160px 高。App 的文章栏最宽 34em（约 527px），图片还有
 * 320px 的高度上限 —— 再大的像素在屏幕上用不到，只会让 Service Worker 的
 * 预缓存变大。
 *
 * 目标：长边不超过 1200×960（DPR 2 的桌面 + 文章栏宽度），质量 82。
 * 重编码后不更小的文件保持原样 —— 小图二次压缩只会更糊。
 *
 * **只改 app/public/media 的副本**：content/media 是快照，sha256 记在 media.lock，
 * R13 拿它校验。这里不碰源文件，也不改文件名/URL。
 */
import fs from "node:fs";
import path from "node:path";

export const MEDIA_MAX_WIDTH = 1200;
export const MEDIA_MAX_HEIGHT = 960;
export const MEDIA_QUALITY = 82;

export interface MediaOptimizeStats {
  files: number;
  changed: number;
  failed: number;
  firstError: string | null;
  before: number;
  after: number;
}

export async function optimizeMediaFiles(dir: string): Promise<MediaOptimizeStats> {
  const { default: sharp } = await import("sharp");
  const stats: MediaOptimizeStats = { files: 0, changed: 0, failed: 0, firstError: null, before: 0, after: 0 };
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /\.(png|webp|jpe?g)$/i.test(e.name))
    .map((e) => path.join(dir, e.name));

  for (const file of files) {
    stats.files++;
    const before = fs.statSync(file).size;
    stats.before += before;
    try {
      // 从 Buffer 读：直接从文件读时 sharp 会一直握着源文件句柄，
      // Windows 上紧接着写回同一路径会报 UNKNOWN open
      //（改之前实测 106 张里有 54 张这样失败；改后正是这 54 张被重编码成功）。
      const original = fs.readFileSync(file);
      const image = sharp(original, { failOn: "none" });
      const meta = await image.metadata();
      if (!meta.width || !meta.height) {
        stats.after += before;
        continue;
      }
      const buf = await image
        .resize({
          width: MEDIA_MAX_WIDTH,
          height: MEDIA_MAX_HEIGHT,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: MEDIA_QUALITY, effort: 5 })
        .toBuffer();
      if (buf.length < before) {
        fs.writeFileSync(file, buf);
        stats.changed++;
        stats.after += buf.length;
      } else {
        stats.after += before;
      }
    } catch (err) {
      // 读不出来的图不拦构建：R4/R13 会先报它，这里保持原样即可
      stats.failed++;
      stats.firstError ??= `${path.basename(file)}: ${err instanceof Error ? err.message : String(err)}`;
      stats.after += before;
    }
  }
  return stats;
}
