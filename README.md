# ⚡ JK-LLM-OCR（最强本地 OCR）

[![GitHub release](https://img.shields.io/github/v/release/GravityPoet/JK-LLM-OCR?style=flat-square)](https://github.com/GravityPoet/JK-LLM-OCR/releases)
[![Platform](https://img.shields.io/badge/platform-macOS-black?style=flat-square&logo=apple)](https://www.apple.com/macos/)
[![Privacy](https://img.shields.io/badge/privacy-local%20only-success?style=flat-square&logo=shield)](https://github.com/GravityPoet/JK-LLM-OCR)

> 拒绝云端 OCR 的等待、计费与隐私外发风险。  
> 这是一个为 [Bob](https://bobtranslate.com/) 打造的 **隐私优先** OCR 插件：默认请求本机 `127.0.0.1` 服务，不依赖第三方云 OCR API，不消耗云端 Token。

## 核心特性

- `低延迟`：不走云端往返，默认本机服务秒回。
- `隐私优先`：截图不上传到第三方云 OCR（默认配置）。
- `长期免费`：不走按次计费的云 OCR API 路线。
- `中英混排可用`：基于 PaddleOCR 的 `PP-OCRv5_server` 模型，适配开发与文档场景。
- `可远程`：支持把推理跑在你的 VPS 上，Mac 端通过 SSH 隧道调用（仍保持 `127.0.0.1` 配置，不暴露公网端口）。

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
3. 在 Bob 中选择 `JK-LLM-OCR` 插件并使用默认服务地址：`http://127.0.0.1:8080/ocr`。
4. 启动本地/远程 OCR 服务（任选其一）：
   - 本机启动：见 `docs/local-server.md`
   - VPS 远程：见 `docs/vps-remote-ocr.md`

## VPS 远程运行（SSH 隧道）

如果你希望把 OCR 的模型与推理放到自己的 VPS（节省本机内存/CPU），推荐用 **SSH 隧道**：不暴露公网端口、只监听 VPS 本地 `127.0.0.1`。

完整教程（含 systemd 开机自启、排错）：`docs/vps-remote-ocr.md`

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
- 本项目定位是“隐私优先 + 低延迟”的本地 OCR 方案；如果你把服务跑在 VPS，上屏截图会通过 SSH 隧道发送到你的 VPS 进行识别。
