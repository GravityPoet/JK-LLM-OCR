# 本机 OCR 服务（macOS / Linux）

本插件只负责把截图发给一个 HTTP OCR 服务（默认 `http://127.0.0.1:8080/ocr`）。下面是把服务跑在本机的最短路径。

## 目标

- 启动后可访问：`GET http://127.0.0.1:8080/healthz` 返回 `{"status":"ok"}`
- Bob 插件 `OCR 服务地址` 保持默认：`http://127.0.0.1:8080/ocr`

## 1) 准备代码与 Python 环境

目的：拿到服务端脚本并准备 Python 虚拟环境。

命令（示例）：

```bash
git clone https://github.com/GravityPoet/JK-LLM-OCR.git
cd JK-LLM-OCR/server

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
```

预期现象：

- `python -V` 能看到 `3.10+`
- `which python` 指向 `.../JK-LLM-OCR/server/.venv/...`

## 2) 安装依赖（已验证组合）

说明：离线 OCR 依赖和模型都不小。首次安装会占用一定磁盘空间。

命令（CPU 推理，Linux/macOS）：

```bash
# PaddlePaddle CPU 版
python -m pip install "paddlepaddle==3.2.2" -f https://www.paddlepaddle.org.cn/packages/stable/cpu/

# PaddleOCR + PaddleX
python -m pip install "paddleocr==3.4.0" "paddlex==3.4.1"
```

预期现象：

- `python -c "import paddle; import paddleocr; print('ok')"` 输出 `ok`

## 3) 下载 PP-OCRv5_server 模型

目的：下载 det/rec 两个推理模型到 `server/models/`。

命令：

```bash
cd JK-LLM-OCR/server
./scripts/download_ppocrv5_server_models.sh
```

预期现象：

- 目录存在：`server/models/PP-OCRv5_server_det_infer`、`server/models/PP-OCRv5_server_rec_infer`

## 4) 启动服务

命令：

```bash
cd JK-LLM-OCR/server
./scripts/start_ppocrv5_server.sh
```

预期现象：

- 终端里看到服务启动日志
- 另开一个终端测试：

```bash
curl -sS http://127.0.0.1:8080/healthz
```

返回：

```json
{"status":"ok"}
```

## 5) Bob 插件配置

- Bob 偏好设置 -> OCR -> 选择 `JK-LLM-OCR`
- `OCR 服务地址`：`http://127.0.0.1:8080/ocr`

## 常见问题

### A) “请求本地 OCR 服务失败”

按顺序排查：

1. 本机服务是否在跑：`curl -m 3 -sS http://127.0.0.1:8080/healthz`
2. 端口是否被占用：`lsof -nP -iTCP:8080 -sTCP:LISTEN`
3. Bob 里 `OCR 服务地址` 是否仍是 `http://127.0.0.1:8080/ocr`

