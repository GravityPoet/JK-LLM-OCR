# 百度异步 jobs 403（签名不匹配）修复：本机 Relay 下载

当 `jsonUrl` 下载阶段报错：

- `403 The request signature we calculated does not match...`

可以启用本机 relay 作为下载回退路径。

## 原理

Bob 插件先直连下载 `jsonUrl`；如果出现 `403/签名异常`，自动回退到本机 relay：

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

- `异步结果 Relay 地址(可选)`：`http://127.0.0.1:50123/fetch-jsonl`

留空表示禁用 relay 回退。

## 安全边界

relay 默认只允许以下域名后缀：

- `bcebos.com`
- `baidubce.com`
- `aistudio-app.com`

并且仅监听 `127.0.0.1`。
