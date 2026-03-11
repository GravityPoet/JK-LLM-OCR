# 百度异步 jobs 403（签名不匹配）修复：本机 Relay 下载

当 `jsonUrl` 下载阶段报错：

- `403 The request signature we calculated does not match...`

可以使用本机 relay 作为下载回退路径，或者直接锁成“只走 Relay”。

## 原理

Bob 插件现在支持 3 种结果下载策略：

- `只走直连`
- `直连失败回退 Relay`
- `只走 Relay`

公开版推荐默认值：`直连失败回退 Relay`

其中“直连失败回退 Relay”的行为是：

- 插件先直连下载 `jsonUrl`
- 如果出现 `403/签名异常`，自动回退到本机 relay：

- 插件 -> `http://127.0.0.1:50123/fetch-jsonl?url=<jsonUrl>`
- relay（Python 标准库）再去下载真实 `jsonUrl`

## 需要安装什么？

不需要额外安装。

- macOS 自带 `python3`
- 使用仓库内脚本：`server/scripts/async_jsonl_relay.py`

## 快速启动

```bash
python3 server/scripts/async_jsonl_relay.py --host 127.0.0.1 --port 50123
```

健康检查：

```bash
curl -sS http://127.0.0.1:50123/healthz
# {"status":"ok"}
```

## Bob 配置

在 `JK-LLM-OCR` 的异步 jobs 模式中：

- `结果下载策略`：
  - `只走直连`：只测 Bob 运行时直连能力，不使用 relay
  - `直连失败回退 Relay`：公开版默认模式；保留一次直连机会，失败后回退 relay
  - `只走 Relay`：适合你本机已经部署 relay、且只追求稳定的场景
- `异步结果 Relay 地址(可选)`：`http://127.0.0.1:50123/fetch-jsonl`

只有在 `直连失败回退 Relay` 或 `只走 Relay` 时才会使用 relay 地址；若当前策略需要 relay，这里不能为空。

## 安全边界

relay 默认只允许以下域名后缀：

- `bcebos.com`
- `baidubce.com`
- `aistudio-app.com`

并且仅监听 `127.0.0.1`。
