/**
 * WebDAV 那条缝：渲染层发请求，主进程替它发。
 *
 * 为什么要有这条缝：渲染层的源是 `app://`，跨源请求要过 CORS，
 * 而自建 WebDAV 默认**不发** `Access-Control-Allow-Origin`（实测 Electron 45：
 * 不发就是 "blocked by CORS policy"）。主进程用 Node 的 http，不受同源策略管 ——
 * 局域网里的 `http://192.168.x.x` 因此能直接用。
 *
 * 安全口径：只放 http/https（别的协议不走这条缝），
 * 而且只认我们自己的页面发来的 IPC（isTrusted 与提醒、更新那两条一样）。
 */
import { ipcMain } from "electron";

import { davRequest } from "./dav-client.mjs";

/**
 * 装上这条链。
 *
 * @param {(event: object) => boolean} isTrusted IPC 是不是来自我们自己的页面
 * @returns {{ dispose: () => void }}
 */
export function installDavBridge({ isTrusted = () => false } = {}) {
  ipcMain.handle("life-guide:dav-request", async (event, req) => {
    if (!isTrusted(event)) throw new Error("不是我们自己的页面");
    return davRequest(req);
  });

  return {
    dispose() {
      ipcMain.removeHandler("life-guide:dav-request");
    },
  };
}
