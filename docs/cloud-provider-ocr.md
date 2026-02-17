# 云端 OCR 服务商模式（OpenAI 兼容 + 智谱 GLM-OCR）

本插件从 `v0.2.1` 起，云端模式支持两条通道：

1. `OpenAI 兼容（硅基流动等）`
2. `智谱 GLM-OCR（layout_parsing）`

## 目标

- Bob 切换到云端模式后可直接识别
- 可按服务商选择正确协议，避免 `HTTP 404`

## A) OpenAI 兼容通道（硅基流动示例）

Bob 配置建议：

- `OCR 后端模式`：`云端 OpenAI 兼容 OCR`
- `云端通道`：`OpenAI 兼容（硅基流动等）`
- `云端 Base URL`：`https://api.siliconflow.cn/v1`
- `云端 API Key`：你的 SiliconFlow API Key
- `云端模型名`：`PaddlePaddle/PaddleOCR-VL-1.5`
- `云端图像细节`：`high`
- `云端 OCR 指令`：保持默认即可

接口说明：

- 插件请求 `POST /chat/completions`
- 图片以 `data:image/...;base64,...` 方式发送

## B) 智谱 GLM-OCR 通道（官方 layout_parsing）

Bob 配置建议：

- `OCR 后端模式`：`云端 OpenAI 兼容 OCR`
- `云端通道`：`智谱 GLM-OCR（layout_parsing）`
- `云端 API Key`：你的智谱 API Key
- `GLM-OCR 接口地址`：`https://open.bigmodel.cn/api/paas/v4/layout_parsing`
- `GLM-OCR 模型名`：`glm-ocr`

接口说明：

- 插件请求 `POST /api/paas/v4/layout_parsing`
- Header: `Authorization: Bearer <API_KEY>`
- Body: `{"model":"glm-ocr","file":"<base64>"}`
- 文件限制：仅 `PDF/JPG/PNG`；图片 `<=10MB`，PDF `<=50MB`，PDF `<=100` 页

## 常见报错

### 1) HTTP 404

最常见原因是“通道与 URL 不匹配”：

- 选了 `OpenAI 兼容`，却填了 `layout_parsing` 地址
- 选了 `GLM-OCR`，却填了 `/v1` 或 `/chat/completions`

### 2) 401 / 403

- API Key 错误、过期或权限不足
- 智谱通道必须是 `Bearer` 鉴权
- 在 Bob 里填写 API Key 时，不要手动加 `Bearer ` 前缀（插件会自动补）

### 3) 有响应但无文本

- 图像内容过于复杂或过小
- 可先切回本地模式对比，或更换云端模型再试

### 4) 请求云端 OCR 服务失败（非 4xx/5xx）

- 常见是网络超时、TLS 握手失败、DNS 不通或服务商临时抖动
- 建议先用 curl 验证同一 Base URL 与 Key 是否可达

## 参考（官方）

- 智谱 GLM-OCR 文档：[https://docs.bigmodel.cn/cn/guide/models/vlm/glm-ocr](https://docs.bigmodel.cn/cn/guide/models/vlm/glm-ocr)
- 智谱 API 参考（layout_parsing，Bearer）：[https://docs.bigmodel.cn/api-reference](https://docs.bigmodel.cn/api-reference)
- SiliconFlow Chat Completions：[https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions](https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions)
