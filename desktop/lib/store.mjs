/**
 * 一个很小的 JSON 存储：存在 userData 里，存窗口大小、位置这类小状态。
 *
 * 纯 Node（不 import electron），所以能在 node --test 里跑。
 * 存坏了就当没有 —— 记不住窗口大小不至于让 App 起不来。
 */
import fs from "node:fs";
import path from "node:path";

export function createStore(dir, filename = "window-state.json") {
  const file = path.join(dir, filename);

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return {};
    }
  }

  return {
    get(key, fallback) {
      const data = read();
      return data[key] !== undefined ? data[key] : fallback;
    },
    set(key, value) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        const data = read();
        data[key] = value;
        fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
      } catch {
        // 写不进去就算了：下一次记不住窗口大小而已
      }
    },
  };
}
