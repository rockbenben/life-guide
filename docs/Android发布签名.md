# Android 发布签名

发布流水线使用 `assembleRelease`，发布前由 `apksigner verify` 核验 APK 签名。
每次发布使用同一份作者持有的 keystore；密钥文件和密码不能提交到仓库。

## 配置 GitHub Actions

在仓库 Settings → Secrets and variables → Actions 配置：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 固定 keystore 文件的 Base64 编码 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | 发布密钥别名 |
| `ANDROID_KEY_PASSWORD` | 该密钥的密码 |

缺少任一项时，Android 发布 job 在构建前失败，不使用临时密钥或 debug 签名兜底。
流水线只在构建期间解码 keystore，job 结束时会删掉，上传的附件只有 APK。
作者应另行备份 keystore、别名和密码；后续版本继续使用这份密钥。

## 本地构建

先设置环境变量 `ANDROID_KEYSTORE_PATH`（keystore 的绝对路径），以及与上表相同的
`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`，再运行：

```bash
npm run mobile:sync
npm run build:android:release --workspace @life-guide/mobile
```

产物是 `mobile/android/app/build/outputs/apk/release/app-release.apk`。
Gradle 的 `checkReleaseSigning` 检查必填变量与密钥文件；密码或别名不正确时签名任务失败。
本地调试仍使用 `npm run build:android --workspace @life-guide/mobile`。

## 验收与回滚

1. 不提供签名变量时，release 构建必须失败；debug 构建不受影响。
2. 用同一份测试 keystore 构建两次，`apksigner verify --print-certs` 必须通过，证书摘要一致。
3. 在设备上安装第一版，再以更高 `versionCode` 安装第二版，确认可直接覆盖且数据保留。

发布失败时保持草稿，不上传未签名 APK。业务代码需要回滚时，用相同发布密钥重新构建
更高版本号；不要换密钥，也不要退回 debug 发布。

2026-11-09：签名配置已实现；仓库 Actions 尚未配置上述四项 secrets。
正式密钥配置与设备覆盖安装验收完成前，Android 发布阶段不能标为全部验收通过。

作者已明确暂缓需要正式密钥和真机的 Android 验收，当前继续依赖安全维护。
