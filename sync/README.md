# 同步服务（Cloudflare Worker）

多设备同步的三个落点之一 —— **自己搭服务端的那个**。
**它只存密文** —— 服务端没有口令，也就没有密钥，
拿到 KV 里的东西也解不开。

> **不一定要用这个。** 落点是可插拔的（`SyncTransport`），另外两个落点
> **不用自己搭任何服务端**：
>
> **GitHub 私有仓库**（`app/src/data/sync-github.ts`）—— 三端都能用，浏览器里也行。
>
> **网盘 WebDAV**（`app/src/data/sync-webdav.ts`）—— 坚果云 / Nextcloud / NAS 都自带，
> 但浏览器用不了（WebDAV 不发 CORS 头）。
>
> 只有想自己掌控那个服务时才部署下面这个。

App 那一侧在 `app/src/data/sync*.ts`；这一侧只有两个动作：按空间 id 取一份密文、写一份密文。

```
GET  /blob/{spaceId}              → { iv, ciphertext, rev, updatedAt }，没有就 404
PUT  /blob/{spaceId}  {iv, ciphertext, baseRev}
     → 200 { ok: true, rev }；版本对不上就 409 + 当前那份（客户端合完再推）
```

## 部署

需要 Cloudflare 账号。命令行（`wrangler` 本机已装）：

```bash
cd sync

# 1. 登录（第一次会开浏览器）
npx wrangler login

# 2. 建 KV 命名空间 —— 会打印一串 id，填进 wrangler.toml
npx wrangler kv namespace create SYNC_KV

# 3. 把上面那串 id 填进 wrangler.toml 的 id = "..."，再把
#    ALLOWED_ORIGINS 改成自己的地址（多个用逗号分隔）

# 4. 部署
npx wrangler deploy
```

部署完会得到一个地址（`https://life-guide-sync.<子域>.workers.dev`）。
把它填进 App 的「设置 → 多设备同步 → 同步地址」，
再在每台设备上填**同一个同步口令**，就成了。

## 允许哪些来源

`ALLOWED_ORIGINS` 是逗号分隔的来源白名单：

```
ALLOWED_ORIGINS = "https://life.newzone.top,http://localhost:5173"
```

不配就是全放行。**这不是身份验证** —— 脚本、curl 照样能直接调。
它挡的是"任意网页顺手往这个服务写东西"：写的是密文，但那也会占 KV 的写入配额
（免费额度每天 1000 次写）。空间 id 是从同步口令派生的 128 位值，猜不到。

## 成本

KV 免费额度：每天 1000 次写、10 万次读、1000 条记录、1 GB 存储。
一个人三台设备，一天几十次同步，够用很久。

## 换一种落点

这个服务很小（不到 200 行），但 App 那一侧**不依赖它是 Cloudflare**：
`app/src/data/sync.ts` 里定的是 `SyncTransport` 接口，
`sync-http.ts` 只是其中一个实现。要换成网盘、局域网直连或别的，
写一个新的 transport 就行 —— 合并规则与加密不用动。
