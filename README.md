<div align="center">
  <h1>JK-LLM-OCR</h1>
  <p><strong>本地极速隐私 × 云端高精度识别</strong></p>
  <p>
    <a href="#下载安装">📥 下载安装</a> ·
    <a href="#配置指南">⚙️ 配置指南</a> ·
    <a href="#常见问题">🤔 常见问题</a>
  </p>
  <p>
    <a href="https://github.com/GravityPoet/JK-LLM-OCR/releases"><img src="https://img.shields.io/github/v/release/GravityPoet/JK-LLM-OCR?style=flat-square" alt="release"></a>
    <img src="https://img.shields.io/badge/Platform-macOS-black?style=flat-square&logo=apple" alt="platform">
    <img src="https://img.shields.io/badge/Bob-Plugin-blue?style=flat-square" alt="bob-plugin">
    <img src="https://img.shields.io/badge/OCR-Local+Cloud-success?style=flat-square" alt="ocr-mode">
  </p>
</div>

---

## ⚡ 为什么你需要这个插件

OCR 真实痛点不是“能不能识别”，而是“在不同场景下是否又快又准”。

- 纯本地方案：隐私好、速度快，但遇到复杂版面/手写/特殊符号时可能不稳。
- 纯云端方案：精度高，但有网络延迟、调用成本和数据外发顾虑。

`JK-LLM-OCR` 的定位是：**本地优先，云端可切换**。

- 日常截图：走本地 PP-OCRv5，低延迟、低成本。
- 困难样本：切换云端通道（OpenAI 兼容 或 智谱 `glm-ocr` 专用接口）。

## ✨ 核心特性

- `Local First`：默认本地 OCR，不依赖外部 API。
- `Cloud Ready`：支持 OpenAI 兼容 OCR 与智谱 GLM-OCR 专用接口。
- `双模式切换`：在 Bob 里通过 `OCR 后端模式` 一键切换本地/云端。
- `云端可自定义`：Base URL、API Key、模型名、图像细节、OCR 指令都可配。
- `VPS 方案完整`：支持把本地模型放 VPS，Mac 通过 SSH 隧道调用。
- `隐私边界清晰`：本地模式不出机；云端模式按你填写的服务商发送图片。

## 🧠 工作模式

| 模式 | 适合场景 | 优势 | 代价 |
|---|---|---|---|
| 本地 PP-OCRv5 | 日常截图、开发文档、常规中英文 | 快、稳定、免费、隐私好 | 极复杂图像精度可能不如云端 |
| 云端 OCR（OpenAI 兼容 / GLM 专用） | 复杂排版、难样本、需要更高识别质量 | 识别能力更强，可选更多模型 | 需要联网 + API 成本 |

## 📦 支持的云端方式

当前插件支持两种云端协议：

1. `OpenAI 兼容`（如硅基流动）：`/chat/completions`
2. `智谱 GLM-OCR`：`/api/paas/v4/layout_parsing`

硅基流动示例（OpenAI 兼容）：

- `云端 Base URL`: `https://api.siliconflow.cn/v1`
- `云端模型名`: `PaddlePaddle/PaddleOCR-VL-1.5`
- `云端图像细节`: `high`

智谱示例（GLM 专用）：

- `云端通道`: `智谱 GLM-OCR（layout_parsing）`
- `GLM-OCR 接口地址`: `https://open.bigmodel.cn/api/paas/v4/layout_parsing`
- `GLM-OCR 模型名`: `glm-ocr`

详细配置见：[`docs/cloud-provider-ocr.md`](docs/cloud-provider-ocr.md)

## 🚀 下载安装

1. 打开 [Releases](https://github.com/GravityPoet/JK-LLM-OCR/releases) 下载最新 `JK-LLM-OCR.bobplugin`。
2. 双击 `.bobplugin` 文件安装。
3. 在 Bob 中选择：`JK-LLM-OCR—GravityPoet开发`。

## ⚙️ 配置指南

### 本地模式（默认）

- `OCR 后端模式`：`本地 PP-OCRv5_server`
- `OCR 服务地址`：`http://127.0.0.1:50000/ocr`

教程：

- 本机部署：[`docs/local-server.md`](docs/local-server.md)
- VPS + SSH 隧道：[`docs/vps-remote-ocr.md`](docs/vps-remote-ocr.md)

### 云端模式（服务商 OCR）

- `OCR 后端模式`：`云端 OpenAI 兼容 OCR`
- `云端通道` 可选：
  - `OpenAI 兼容（硅基流动等）`
  - `智谱 GLM-OCR（layout_parsing）`

建议先按对应通道的官方示例跑通，再替换为你自己的服务商与模型。

## 💡 Prompt 进阶玩法

`云端 OCR 指令`（OpenAI 兼容通道）支持自定义，你可以让结果更贴近业务输出：

- 代码提取：`请识别图片中的代码，仅输出代码，不要解释。`
- 表格提取：`请将图片中的表格输出为 Markdown 表格。`
- 清洗输出：`请仅返回纯文本，保留换行与段落结构。`

## 🤔 常见问题

### Q1: 本地模式和云端模式会自动路由吗？

当前版本是**手动切换模式**，不是自动路由。这样更可控，也更容易管理成本与隐私边界。

### Q2: 为什么插件校验出现 HTTP 404？

通常是“通道和地址配错”：

- OpenAI 兼容通道要填 `/v1` 或 `/chat/completions`
- GLM-OCR 通道要填 `/layout_parsing`

### Q2.1: GLM-OCR 返回 400，提示“仅支持 PDF/JPG/PNG、图片≤10MB”？

这是 GLM-OCR 的官方限制。请检查：

- 图片是否是 PNG/JPG（很多剪贴板截图是 TIFF/HEIC，会被拒）
- 图片是否超过 10MB，或 PDF 是否超过 50MB/100 页

### Q3: 会上传我的截图吗？

- 本地模式：不会上传到第三方。
- 云端模式：会发送到你配置的云端服务商。

### Q4: 支持 OCR 流式输出吗？

不支持。Bob OCR 插件接口是一次性返回（completion），不是 translate 的 stream 回调模型。

## 🗺️ Roadmap

- [ ] 自动路由策略（按图片复杂度自动切换本地/云端）
- [ ] 更多云端返回格式兼容（结构化字段增强）
- [ ] OCR 质量对比样例集与基准报告

## 🤝 贡献与反馈

欢迎提交 Issue / PR：

- [Issues](https://github.com/GravityPoet/JK-LLM-OCR/issues)
- [Pull Requests](https://github.com/GravityPoet/JK-LLM-OCR/pulls)

如果这个插件帮你省时间，欢迎点个 ⭐。
