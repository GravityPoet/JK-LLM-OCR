# 云端服务商 OCR 模式（OpenAI 兼容）

当前版本已简化：`JK-LLM-OCR` 只保留一条云端服务商通道，即 `OpenAI 兼容`。

适用场景：

- 你想接硅基流动、OpenRouter、OneAPI、OpenAI 兼容网关
- 你要自定义模型名
- 你要通过 prompt 控制 OCR 输出格式

## Bob 配置

在插件里选择：

- `[模式] OCR 服务模式`：`云端服务商 OCR（OpenAI兼容）`
- `[云端服务商] API Key`：你的服务商 API Key
- `[云端服务商] Base URL`：例如 `https://api.siliconflow.cn/v1`
- `[云端服务商] 模型名`：例如 `PaddlePaddle/PaddleOCR-VL-1.5`
- `[云端服务商] 图像细节`：`high`
- `[云端服务商] OCR 指令`：保持默认或按需自定义

## 接口说明

- 插件请求：`POST /chat/completions`
- Header：`Authorization: Bearer <API_KEY>`
- 图片以 `data:image/...;base64,...` 方式发送

## 常见报错

### 1) HTTP 404

通常是 Base URL 填错：

- 正确：`https://api.siliconflow.cn/v1`
- 也支持直接填完整 `/chat/completions`

### 2) 401 / 403

- API Key 错误、过期或权限不足
- 在 Bob 里只填 key 本体，不要手动加 `Bearer `

### 3) 请求云端 OCR 服务失败（非 4xx/5xx）

- 常见是网络超时、TLS 握手失败、DNS 不通或服务商抖动
- 建议先用 `curl` 验证同一 Base URL 与 Key 是否可达

### 4) 提示图片格式不支持

当前云端服务商模式只接受 `PNG/JPG` 图片输入：

- 很多 macOS 剪贴板截图实际是 `TIFF/HEIC`
- 建议改用标准 `PNG/JPG`

## 参考（官方）

- SiliconFlow Chat Completions：<https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions>
