# ⚡ JK-LLM-OCR（最强本地 OCR）

[![GitHub release](https://img.shields.io/github/v/release/GravityPoet/JK-LLM-OCR?style=flat-square)](https://github.com/GravityPoet/JK-LLM-OCR/releases)
[![Platform](https://img.shields.io/badge/platform-macOS-black?style=flat-square&logo=apple)](https://www.apple.com/macos/)
[![Privacy](https://img.shields.io/badge/privacy-local%20only-success?style=flat-square&logo=shield)](https://github.com/GravityPoet/JK-LLM-OCR)

> 拒绝云端 OCR 的等待和隐私外发风险。  
> 这是一个为 [Bob](https://bobtranslate.com/) 打造的本地 OCR 插件：默认走本机服务，不依赖云端 OCR API，不消耗云端 Token。

## 核心特性

- `低延迟`：OCR 请求默认发往 `127.0.0.1` 本机服务，减少公网请求带来的额外等待。
- `隐私优先`：截图不需要上传到第三方云 OCR（按默认配置）。
- `长期免费`：不走按次计费的云 OCR API 路线。
- `中英混排可用`：基于 PaddleOCR PP-OCRv5_server 模型，适配日常开发与文档场景。

## 与云端 OCR 路线对比

| 指标 | JK-LLM-OCR（本地） | 云端 OCR API |
|---|---|---|
| 网络依赖 | 默认仅本机 | 必须联网 |
| 数据路径 | 本机处理 | 图片上传到外部服务 |
| 成本模型 | 本地算力 | 常见为按量计费 |
| 可用性 | 断网可用 | 网络异常会失败 |

## 安装

1. 打开 [Releases](https://github.com/GravityPoet/JK-LLM-OCR/releases) 下载最新 `JK-LLM-OCR.bobplugin`。
2. 双击插件文件安装到 Bob。
3. 手动启动本地 OCR 服务：

```bash
cd /Users/moonlitpoet/Tools/PaddleOCR/bob-plugin-ppocrv5-server
./scripts/start_ppocrv5_server.sh
```

4. 在 Bob 中选择 `JK-LLM-OCR` 插件并使用默认服务地址：`http://127.0.0.1:8080/ocr`。

## VPS 远程运行（SSH 隧道）

如果你希望把 OCR 的模型与推理放到自己的 VPS（节省本机内存/CPU），推荐用 **SSH 隧道**：

1. VPS 上启动服务（示例为 systemd）：  

```bash
sudo systemctl start ppocrv5-http.service
```

2. Mac 上建立端口转发（保持终端窗口不关闭）：  

```bash
ssh -N -L 8080:127.0.0.1:8080 gravity-vps
```

3. Bob 插件仍使用默认地址：`http://127.0.0.1:8080/ocr`（无需改成公网 IP）。

注意：截图数据会通过加密隧道发送到你的 VPS 进行识别，隐私边界变为“本机 + 自有 VPS”。

## 更新机制

- 仓库根目录提供 `appcast.json`：`https://github.com/GravityPoet/JK-LLM-OCR/raw/main/appcast.json`
- Bob 可通过该文件获取插件版本与下载地址。

## FAQ

**Q: 为什么比很多云端方案体感更快？**  
A: 本方案省掉了公网传输和远端排队的开销，尤其在网络抖动时优势明显。

**Q: 会不会上传我的截图？**  
A: 默认配置只请求本机服务地址 `127.0.0.1`。如果你手动改成远程 URL，则会按你的配置发送请求。

**Q: 服务必须常驻吗？**  
A: 不必须。你可以随用随启，用完关闭。

## 声明

- 本仓库为公开发布版，已去除私有称呼。
- 本项目定位是“隐私优先 + 低延迟”的本地 OCR 方案。
