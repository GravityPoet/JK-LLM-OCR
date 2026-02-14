# JK-LLM-OCR Server（PP-OCRv5 HTTP）

这个目录提供插件配套的本地/远程 OCR HTTP 服务。

## 接口

- `POST /ocr`：OCR 推理（请求/响应结构对齐 PaddleX OCR 服务的常见字段）
- `GET /healthz`：健康检查，返回 `{"status":"ok"}`

## 快速启动（开发/测试）

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip

# 依赖（CPU）
python -m pip install "paddlepaddle==3.2.2" -f https://www.paddlepaddle.org.cn/packages/stable/cpu/
python -m pip install "paddleocr==3.4.0" "paddlex==3.4.1"

# 模型
./scripts/download_ppocrv5_server_models.sh

# 启动
./scripts/start_ppocrv5_server.sh
```

然后：

```bash
curl -sS http://127.0.0.1:8080/healthz
```

## 生产建议（VPS）

参考文档：`docs/vps-remote-ocr.md`

