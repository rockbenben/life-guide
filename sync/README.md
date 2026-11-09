# 同步服务（Cloudflare Worker）

多设备同步的三个落点之一 —— **自己搭服务端的那个**。
**它只存密文** —— 服务端没有口令，也就没有密钥，
每个空间由一个 SQLite Durable Object 保存密文与版本。

> **不一定要用这个。** 落点是可插拔的（`SyncTransport`），另外两个落点
> **不用自己搭任何服务端**：
>
> **GitHub 私有仓库**（`app/src/data/sync-github.ts`）—— 三端都能用，浏览器里也行。
>
> **网盘 WebDAV**（`app/src/data/sync-webdav.ts`）—— 坚果云 / Nextcloud / NAS 都自带，
> **局域网里自己搭的那台也能填**（`http://192.168.x.x:5006/dav/`）；
> 但浏览器用不了（WebDAV 不发 CORS 头），桌面端与 Android 手机可以。
>
> 只有想自己掌控那个服务时才部署下面这个。

App 那一侧在 `app/src/data/sync*.ts`；这一侧只有两个动作：按空间 id 取一份密文、写一份密文。

```
GET  /blob/{spaceId}              → { iv, ciphertext, rev, updatedAt }，没有就 404
PUT  /blob/{spaceId}  {iv, ciphertext, baseRev}
     → 200 { ok: true, rev }；版本对不上就 409 + 当前那份（客户端合完再推）
```

## 部署

需要 Cloudflare 账号。在仓库根目录安装依赖，配置 `sync/wrangler.toml` 的
`ALLOWED_ORIGINS` 后执行：

```bash
npm ci
npx wrangler login
npx wrangler deploy --config sync/wrangler.toml
```

配置中的 `SYNC_SPACES` 绑定指向 `SyncSpace`。
首次部署通过 `new_sqlite_classes` 创建 SQLite Durable Object 命名空间，
请求使用空间 id 调用 `getByName()`，每个空间拥有独立的持久化快照。

部署完会得到一个地址（`https://life-guide-sync.<子域>.workers.dev`）。
把它填进 App 的「设置 → 多设备同步 → 同步地址」，
再在每台设备上填**同一个同步口令**，就成了。

## 允许哪些来源

`ALLOWED_ORIGINS` 是逗号分隔的来源白名单：

```
ALLOWED_ORIGINS = "https://life.newzone.top,http://localhost:5173"
```

不配就是全放行。浏览器来源通过 CORS 控制，脚本或 curl 仍可直接访问服务。
预检允许 `content-type` 与 `if-none-match`，客户端可以条件读取已见过的版本。

## 版本与原子写入

- 首次创建携带 `baseRev: null`，已有快照的更新携带当前正整数版本号。
- 版本比较与密文写入在同一个 SQLite 事务内完成。
- 并发写入时恰有一个成功，其他请求收到 `409` 与当前快照，客户端合并后重试。
- 版本和密文一起提交或回滚。存储异常返回 `503`，已有快照可继续读取。
- 空间不存在时，携带更新版本的写入返回 `404`，客户端下一轮重新读取。
- 所有读取响应带 `Cache-Control: no-store`，避免中间缓存返回过期数据。

## 本地验证

```bash
npx vitest run sync/test
npx wrangler deploy --config sync/wrangler.toml --dry-run
```

测试通过 Wrangler 的 `createTestHarness` 加载实际配置和构建产物，
在本地 workerd 中运行 SQLite Durable Object，覆盖首次创建竞争、同版本并发更新、
客户端加密合并重试、实例重建和写入失败回滚。

## 成本

服务使用 Worker 请求、Durable Object 请求和 SQLite 存储。
配额与费用按账户套餐和实际使用量计算。[Cloudflare 定价说明](https://developers.cloudflare.com/durable-objects/platform/pricing/)

## 换一种落点

`app/src/data/sync.ts` 定义 `SyncTransport` 接口，
`sync-http.ts` 是自建 HTTP 服务的实现。要换成网盘、局域网直连或别的，
写一个新的 transport 就行 —— 合并规则与加密不用动。
