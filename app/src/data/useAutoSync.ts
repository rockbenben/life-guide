/**
 * 自动同步：打开 App 时同步一次，回到前台时再同步一次。
 *
 * **同步失败不许把 App 弄坏** —— 断网是常事（地铁里、电梯里），
 * 同步是锦上添花，App 本身该照常用。所以这里的错误一律吞掉，
 * 只在「设置」页手动同步时才把原因说出来。
 *
 * ## 节流：为什么不能每次切前台都同步
 *
 * 网盘按流量算钱，浏览器按请求数算配额，而「切回前台」这个动作
 * 一分钟能发生十几次。所以自动同步有两条规矩：
 *
 * - **最小间隔**（默认 5 分钟）：再快也不会比这个更频繁；
 * - **失败冷却**：连不上的时候，接下来 5 分钟不再自动试 ——
 *   不然每次切前台都失败一次，既费流量又刷屏。
 *
 * 手动同步（设置页的「立即同步」）不受这两条限制 —— 用户点了就是想现在同步。
 */
import { useEffect, useRef } from "preact/hooks";

import {
  createTransport,
  lastSyncAt,
  readSyncConfig,
  syncConfigProblem,
  syncNow,
} from "./sync.ts";

/** 两次自动同步之间的最小间隔。 */
const MIN_INTERVAL = 5 * 60 * 1000;
/** 失败之后的冷却时间。 */
const COOLDOWN = 5 * 60 * 1000;

/** 上一次自动同步的时刻（会话内；换一次会话就重来）。 */
let lastRun = 0;
/** 失败之后的冷却到什么时候。 */
let coolingUntil = 0;

export function useAutoSync(onSynced: () => void): void {
  /**
   * 回调放进 ref：外面每次渲染都会传一个新的函数进来，
   * effect 不该因为它重跑（重跑 = 多同步一次）。
   */
  const cb = useRef(onSynced);
  cb.current = onSynced;

  useEffect(() => {
    let running = false;

    async function run(): Promise<void> {
      if (running) return;
      const now = Date.now();
      if (now < coolingUntil) return;
      if (now - lastRun < MIN_INTERVAL) return;
      // 上一次**成功**的同步（跨会话也算：手动同步过一次就别再自动来一遍）
      const lastAt = await lastSyncAt();
      if (lastAt && now - lastAt < MIN_INTERVAL) return;

      running = true;
      lastRun = now;
      try {
        const cfg = await readSyncConfig();
        // 没开、没配好 —— 不是错误，是「这台设备没打算同步」
        if (syncConfigProblem(cfg)) return;
        const report = await syncNow(createTransport(cfg), cfg);
        if (!report.ok) {
          // 失败就冷却：别每次切前台都失败一次
          coolingUntil = Date.now() + COOLDOWN;
          return;
        }
        if (report.added || report.updated || report.removed || report.settingsChanged) {
          cb.current();
        }
      } catch {
        coolingUntil = Date.now() + COOLDOWN;
      } finally {
        running = false;
      }
    }

    void run();

    /**
     * App 开着的时候也定期看一眼。
     *
     * **为什么需要**：点「完成」只写本地，不联网；同步择机发生。
     * 如果只靠「打开 App / 回到前台」这两个时机，那么**一直开着不切走**的时候，
     * 上午记的东西要等到下次切前台才上得去 —— 那种情况下"记了但另一台看不到"很难查。
     *
     * 这个定时器只是"到点看一眼有没有要传的"：`run()` 自己也过节流，
     * 没改动时指纹相同 → 不传东西（见 sync.ts 的 needPush）。
     */
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      void run();
    }, MIN_INTERVAL);

    /**
     * 回到前台时再同步一次。
     *
     * 手机端 App 切到后台会被系统挂起，回来的那一刻正是数据可能已经
     * 在另一台设备上变了的时刻。
     */
    const onVisible = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") void run();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
}
