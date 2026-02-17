# ⚡ JK-LLM-OCR（本地 + 云端 OCR）

> Bob 安装显示名：`JK-LLM-OCR—GravityPoet开发`

[![GitHub release](https://img.shields.io/github/v/release/GravityPoet/JK-LLM-OCR?style=flat-square)](https://github.com/GravityPoet/JK-LLM-OCR/releases)
[![Platform](https://img.shields.io/badge/platform-macOS-black?style=flat-square&logo=apple)](https://www.apple.com/macos/)
[![Privacy](https://img.shields.io/badge/privacy-local%20first-success?style=flat-square&logo=shield)](https://github.com/GravityPoet/JK-LLM-OCR)

> 默认是“隐私优先”的本地 OCR。  
> 现在也支持切换到云端服务商（OpenAI 兼容多模态），例如硅基流动 `PaddlePaddle/PaddleOCR-VL-1.5`。

## 核心特性

- `双通道`：本地 PP-OCRv5 与云端 OpenAI 兼容 OCR 可切换。
- `低延迟`：默认本机服务秒回。
- `隐私优先`：默认不上传第三方云 OCR。
- `可扩展`：云端模式支持自定义 Base URL / API Key / 模型名。
- `中英混排可用`：基于 PaddleOCR 的 `PP-OCRv5_server` 模型，适配开发与文档场景。
- `可远程`：支持把推理跑在你的 VPS 上，Mac 端通过 SSH 隧道调用（仍保持 `127.0.0.1` 配置，不暴露公网端口）。

## 模式说明

- 本地模式（默认）：`OCR 后端模式 = 本地 PP-OCRv5_server`
- 云端模式：`OCR 后端模式 = 云端 OpenAI 兼容 OCR`

### 硅基流动示例（PaddleOCR-VL-1.5）

- 云端 Base URL：`https://api.siliconflow.cn/v1`
- 云端模型名：`PaddlePaddle/PaddleOCR-VL-1.5`
- 云端 API Key：你的 SiliconFlow API Key
- 云端图像细节：建议 `high`

> 也可以填写完整端点 `.../chat/completions`，插件会自动兼容。
>
> 详细教程：`docs/cloud-provider-ocr.md`

## 本地与云端对比

| 指标 | 本地模式 | 云端模式 |
|---|---|---|
| 网络依赖 | 默认仅本机 | 必须联网 |
| 数据路径 | 本机处理 | 图片上传到外部服务 |
| 成本模型 | 本地算力 | 常见按量计费 |
| 可用性 | 断网可用 | 网络异常会失败 |

## 安装

1. 打开 [Releases](https://github.com/GravityPoet/JK-LLM-OCR/releases) 下载最新 `JK-LLM-OCR.bobplugin`。
2. 双击插件文件安装到 Bob。
3. 在 Bob 中选择 `JK-LLM-OCR`，配置 `OCR 后端模式`。
4. 如果用本地模式：服务地址示例 `http://127.0.0.1:50000/ocr`，启动方式见 `docs/local-server.md` 或 `docs/vps-remote-ocr.md`。
5. 如果用云端模式：填写 `云端 Base URL`、`云端 API Key`、`云端模型名`。

## VPS 远程运行（SSH 隧道）

如果你希望把 OCR 的模型与推理放到自己的 VPS（节省本机内存/CPU），推荐用 **SSH 隧道**：不暴露公网端口、只监听 VPS 本地 `127.0.0.1`。

完整教程（含 systemd 开机自启、排错）：`docs/vps-remote-ocr.md`

## 更新机制

- 仓库根目录提供 `appcast.json`：`https://github.com/GravityPoet/JK-LLM-OCR/raw/main/appcast.json`
- Bob 可通过该文件获取插件版本与下载地址。

## FAQ

**Q: 支持流式输出(onStream)吗？**  
A: 不支持。Bob 当前公开的 OCR 插件接口是一次性 completion 返回，不是 translate 那套流式回调模型。  

**Q: 为什么本地模式比很多云端方案体感更快？**  
A: 省掉了公网传输和远端排队开销，网络抖动时优势更明显。

**Q: 会不会上传我的截图？**  
A: 本地模式不会上传到第三方；云端模式会把截图发送到你配置的云端服务商。

**Q: 服务必须常驻吗？**  
A: 不必须。你可以随用随启，用完关闭。

## 声明

- 本仓库为公开发布版，已去除私有称呼。
- 本项目定位为“本地优先 + 云端可扩展”的 OCR 方案。
