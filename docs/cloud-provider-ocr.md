# 云端 OCR 服务商模式（以硅基流动为例）

本插件从 `v0.2.0` 起支持 `OCR 后端模式 = 云端 OpenAI 兼容 OCR`。

## 目标

- Bob 里切换到云端模式后可以直接识别出字
- 以硅基流动为例，使用 `PaddlePaddle/PaddleOCR-VL-1.5`

## Bob 配置项（硅基流动推荐值）

- `OCR 后端模式`：`云端 OpenAI 兼容 OCR`
- `云端 Base URL`：`https://api.siliconflow.cn/v1`
- `云端 API Key`：你的 SiliconFlow API Key
- `云端模型名`：`PaddlePaddle/PaddleOCR-VL-1.5`
- `云端图像细节`：`high`
- `云端 OCR 指令`：保持默认即可

> 你也可以把 Base URL 直接填成完整端点：`https://api.siliconflow.cn/v1/chat/completions`。

## 接口约定

- 插件按 OpenAI 兼容多模态格式发起 `POST /chat/completions`
- 图片会以内联 Base64 Data URL 发送
- 默认 `stream=false`，一次性返回识别结果

## 常见报错

### 1) 插件校验失败：HTTP 404

说明：通常是 Base URL 填错（不是 OpenAI 兼容入口）。

排查：

1. 改为 `https://api.siliconflow.cn/v1`
2. 或改为 `https://api.siliconflow.cn/v1/chat/completions`
3. 重新在 Bob 中校验插件

### 2) 插件校验失败：401/403

说明：API Key 错误、过期或无权限。

排查：

1. 检查是否粘贴了完整 Key（无多余空格）
2. 在硅基流动控制台确认 Key 有效和账户额度正常

### 3) OCR 返回空文本

说明：模型成功返回但内容未被解析为文本。

排查：

1. `云端图像细节` 调到 `high`
2. 使用默认 `云端 OCR 指令`
3. 确认模型确实支持图像输入

## 参考

- SiliconFlow OpenAI 兼容接口：[https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions](https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions)
- SiliconFlow 视觉能力示例：[https://docs.siliconflow.cn/cn/userguide/capabilities/vision](https://docs.siliconflow.cn/cn/userguide/capabilities/vision)
- PaddleOCR-VL（含 SiliconFlow 调用示例）：[https://www.paddleocr.ai/main/version3.x/module_usage/doc_img_orientation_classification.html](https://www.paddleocr.ai/main/version3.x/module_usage/doc_img_orientation_classification.html)
