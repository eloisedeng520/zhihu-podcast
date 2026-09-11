# 腾讯云 TTS 接入

现有流程：DeepSeek 生成并核对双人稿 → 腾讯云逐段朗读 → WAV 保存与合并 → 页面播放。

## 配置

1. 在 [腾讯云语音合成控制台](https://console.cloud.tencent.com/tts)开通服务，确认账户额度和所选音色可用。
2. 在 [API 密钥管理](https://console.cloud.tencent.com/cam/capi)取得具有 `tts:TextToVoice` 权限的 SecretId 和 SecretKey。
3. 填入本地 `.env` 中的 `TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`，保存后重启本地服务。不要填写到前端或提交到仓库。

```dotenv
TTS_PROVIDER=tencent
TENCENT_SECRET_ID=
TENCENT_SECRET_KEY=
TENCENT_SESSION_TOKEN=
TTS_HOST_VOICE=101001
TTS_GUEST_VOICE=101004
TTS_GUEST_VOICES=101004,101005,101006
```

默认主持人为智瑜（女声），单篇讲述人使用 `TTS_GUEST_VOICE`。多人圆桌按照答主顺序，从 `TTS_GUEST_VOICES` 音色池稳定分配不同音色；未配置音色池时自动回退到原来的单一嘉宾音色。所有音色需从[官方音色列表](https://cloud.tencent.com/document/product/1073/92668)选择账户已开通、支持基础语音合成和 16 kHz 的不同数字 ID。使用临时凭证时还需填写 `TENCENT_SESSION_TOKEN`。

腾讯云模式不使用 `TTS_API_KEY`、`TTS_URL`、`TTS_MODEL`，也不需要额外 AppID。DeepSeek 配置保持独立。

## 使用与验证

服务状态会显示“腾讯云 TTS · 双音色朗读”。配置就绪只代表字段完整；实际权限、额度及音色以合成调用结果为准。

从“我的收听”打开已通过原文核对的文字稿，继续生成即可。未配置语音时仍可生成文字稿。自动按句拆分长发言，不截断文字；全部子片段成功后才保存该段音频。后续段落失败时，已保存的段落保留；如果同一段内部的子请求失败，重试会重新合成该段。

本地 `.env` 不会自动同步到线上。部署时需通过 Sites 的运行环境变量配置相同字段。

协议依据：[TextToVoice](https://cloud.tencent.com/document/product/1073/37995)、[TC3 签名](https://cloud.tencent.com/document/product/213/30654)。适配器使用 Worker 原生 Web Crypto 签名，不依赖 Node 网络 SDK。
