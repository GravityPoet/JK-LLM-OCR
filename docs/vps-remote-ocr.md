# VPS 远程 OCR（MacBook 通过 Bob 调用 `/ocr`）

这份教程解决一个很具体的问题：

- PP-OCRv5_server 的模型和推理比较吃内存/CPU
- 你希望把推理丢到自己的 VPS 上跑
- 但 Bob 插件仍然使用 `http://127.0.0.1:8080/ocr`（不暴露公网端口）

核心手段：**SSH 本地端口转发（隧道）**。

## 架构（先搞懂，否则 100% 迷路）

```text
Bob 插件 -> http://127.0.0.1:8080/ocr
          (Mac 本机回环地址)
                 |
                 |  SSH 隧道: -L 8080:127.0.0.1:8080
                 v
VPS 127.0.0.1:8080 (PP-OCRv5 HTTP server)
```

关键点：

- VPS 端的 OCR 服务 **只监听 `127.0.0.1`**，不对公网开放端口。
- Mac 端通过 SSH 隧道把 “本机 `127.0.0.1:8080`” 映射到 “VPS `127.0.0.1:8080`”。
- 所以 Bob 插件地址 **不需要改成公网 IP**，也不会在公网暴露 OCR 服务。

隐私边界（务必理解）：

- 走本机：截图不出本机
- 走 VPS：截图会通过 SSH 加密隧道发到你的 VPS 做识别（不经过第三方云 OCR）

## 目标与验收

你做到以下 3 点就算成功：

1. VPS 上：`curl -sS http://127.0.0.1:8080/healthz` 返回 `{"status":"ok"}`
2. Mac 上（开了隧道）：`curl -sS http://127.0.0.1:8080/healthz` 也返回 `{"status":"ok"}`
3. Bob 里 OCR 正常出字，不再提示“请求本地 OCR 服务失败”

## 0) 前置条件

- 你能 SSH 登录 VPS（推荐密钥登录）
- VPS 系统建议：Ubuntu 22.04 / Debian 12（其它 Linux 也行，但你要自己排坑）
- VPS 配置建议：2C4G 起步（更小也许能跑，但体验可能差）

## 1) 在 VPS 上部署 OCR 服务

下面给一个“新手不容易翻车”的路径：直接把仓库克隆到 VPS，然后在 `server/` 目录里启动。

### 1.1 安装基础依赖

目的：准备 Python venv、curl、git。

命令（Ubuntu/Debian）：

```bash
sudo apt update
sudo apt install -y python3 python3-venv python3-pip git curl
```

预期现象：

- `python3 -V` 输出 `3.10+`

### 1.2 克隆仓库

```bash
cd ~
git clone https://github.com/GravityPoet/JK-LLM-OCR.git
cd JK-LLM-OCR/server
```

### 1.3 创建 venv 并安装依赖（已验证组合）

说明：我们优先给出一套“已验证能跑通”的版本组合。你当然可以升级，但升级出问题就要自己排查。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip

# PaddlePaddle CPU 版
python -m pip install "paddlepaddle==3.2.2" -f https://www.paddlepaddle.org.cn/packages/stable/cpu/

# PaddleOCR + PaddleX
python -m pip install "paddleocr==3.4.0" "paddlex==3.4.1"
```

自检：

```bash
python -c "import paddle; import paddleocr; print('ok')"
```

输出 `ok` 即可。

### 1.4 下载 PP-OCRv5_server 模型

```bash
cd ~/JK-LLM-OCR/server
./scripts/download_ppocrv5_server_models.sh
```

预期现象：

- `server/models/PP-OCRv5_server_det_infer` 存在
- `server/models/PP-OCRv5_server_rec_infer` 存在

### 1.5 启动 OCR 服务（前台运行）

```bash
cd ~/JK-LLM-OCR/server
./scripts/start_ppocrv5_server.sh
```

另开一个 SSH 终端测试：

```bash
curl -sS http://127.0.0.1:8080/healthz
```

返回：

```json
{"status":"ok"}
```

到这里说明 VPS 端 OK。

## 2)（可选）VPS 设置 systemd 开机自启

如果你希望 VPS 重启后服务自动拉起，推荐用 systemd。

> 注意：下面命令会写 `/etc/systemd/system/`，属于配置变更（P1）。  
> 做之前确认你知道如何 `systemctl disable` 回滚。

### 2.1 放置 service 文件

把仓库里的模板复制过去（你可以先看一眼再复制）：

```bash
sudo cp ~/JK-LLM-OCR/server/systemd/ppocrv5-http.service /etc/systemd/system/ppocrv5-http.service
```

如果你的安装目录不是 `~/JK-LLM-OCR`，就需要编辑 `ExecStart` / 模型路径为你的实际路径。

### 2.2 启用并启动

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ppocrv5-http.service
sudo systemctl status ppocrv5-http.service --no-pager
```

验收：`Active: active (running)`。

## 3) 在 Mac 上建立 SSH 隧道（核心步骤）

目的：把 Mac 的 `127.0.0.1:8080` 转发到 VPS 的 `127.0.0.1:8080`。

### 3.1 一次性命令（最简单）

```bash
ssh -N -L 8080:127.0.0.1:8080 <USER>@<YOUR_VPS_HOST>
```

说明：

- `-N`：不执行远程命令，只做转发
- 这个终端窗口必须保持打开；关了隧道就断了

### 3.2 推荐：写进 `~/.ssh/config`（更像人用的方式）

示例（自行替换）：

```sshconfig
Host jk-ocr-vps
  HostName <YOUR_VPS_HOST>
  User <USER>
  IdentityFile ~/.ssh/id_ed25519
```

然后建立隧道：

```bash
ssh -N -L 8080:127.0.0.1:8080 jk-ocr-vps
```

### 3.3 Mac 侧验收

```bash
curl -m 3 -sS http://127.0.0.1:8080/healthz
```

能返回 `{"status":"ok"}` 就说明隧道打通了。

## 4) Bob 插件配置（不改公网 IP）

Bob 偏好设置 -> OCR -> `最强隐私本地OCR—GravityFlux开发`：

- `OCR 服务地址`：保持默认 `http://127.0.0.1:8080/ocr`

## 5) 排错：为什么会“请求本地 OCR 服务失败”

从高概率到低概率：

### 5.1 你根本没开隧道

验证：

```bash
curl -m 3 -sS http://127.0.0.1:8080/healthz
```

失败就先把隧道开起来（见第 3 节）。

### 5.2 VPS 服务其实没跑起来

在 VPS 上：

```bash
curl -m 3 -sS http://127.0.0.1:8080/healthz
sudo systemctl status ppocrv5-http.service --no-pager
sudo journalctl -u ppocrv5-http.service -n 100 --no-pager
```

### 5.3 Mac 的 8080 端口被占用

在 Mac 上：

```bash
lsof -nP -iTCP:8080 -sTCP:LISTEN
```

解决方案：

- 让本机别占用 8080；或
- 换个本机端口（例如 18080）：

```bash
ssh -N -L 18080:127.0.0.1:8080 jk-ocr-vps
```

并把 Bob 插件 `OCR 服务地址` 改为：`http://127.0.0.1:18080/ocr`

### 5.4 你把 VPS OCR 服务绑到了 `0.0.0.0` 并试图走公网

不建议。正确姿势是“VPS 只监听 127.0.0.1 + SSH 隧道”。  
如果你坚持公网暴露，请自行做 HTTPS、鉴权、防火墙与速率限制，这里不提供“裸奔教程”。

## 6) 是否能节省本机内存？

能。内存大头在推理进程和模型加载，放到 VPS 后：

- Mac 端：主要是截图编码与网络转发，内存开销很小
- VPS 端：常驻推理进程会占用数百 MB 到 1GB+（取决于模型/并发/后端实现）
