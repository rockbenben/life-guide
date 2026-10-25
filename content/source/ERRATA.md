# 勘误记录

快照（`content/source/`）与 blog 上游的差异都记在这里。
校验器 R13 会比对 `SOURCE.lock` 的 sha256：改了快照文件却没有对应记录 → error。

每条记录一条：

```yaml
- file: <相对 content/source 的路径>
  before: <改动前>
  after: <改动后>
  reason: <为什么改>
  upstream: fixed | pending | n/a   # blog 那边是否也改了
```
