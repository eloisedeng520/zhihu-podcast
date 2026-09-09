# 听见 · 知乎内容播客化

从知乎黑客松精选知识内容出发，用 DeepSeek 生成有原文依据的双人播客文字稿，再通过腾讯云 TTS 合成两位主播的声音。

## 当前功能

- 获取知乎精选知识列表与正文，按标题、简介、标签筛选。
- 生成观点大纲、双人对话稿，并逐段进行 AI 原文核对。
- 支持先生成文字稿，后接入语音；保留原文引用以便对照。
- 腾讯云双音色朗读、长句拆分、WAV 合并与音频进度播放。
- 保存节目与分阶段进度，失败后可重试。

DeepSeek 文字稿生成已经实际验证。腾讯云适配已通过模拟接口测试，真实声音仍需配置有效凭证后验证。目标时长仅供参考，实际时长以合成音频为准。AI 核对不替代人工审阅。

## 本地启动

需要 Node.js 22.13 或更新版本；测试使用 Node.js 24 验证。

```bash
npm ci
cp .env.example .env
npm run dev
```

打开终端输出的 Local 地址。服务默认使用 3000 端口，已被占用时会自动选择其他端口。

在 `.env` 中配置文本模型：

```dotenv
LLM_URL=https://api.deepseek.com/chat/completions
LLM_API_KEY=你的密钥
LLM_MODEL=deepseek-v4-flash
```

腾讯云语音配置：

```dotenv
TTS_PROVIDER=tencent
TENCENT_SECRET_ID=你的SecretId
TENCENT_SECRET_KEY=你的SecretKey
TTS_HOST_VOICE=101001
TTS_GUEST_VOICE=101004
```

详见 [腾讯云 TTS 接入说明](TENCENT-TTS.md)。密钥只保存在后端环境变量中，`.env` 已被 Git 忽略。配置修改后重启服务。没有语音凭证时仍可生成文字稿。

## 验证

```bash
npm test
npx tsc --noEmit
npm run build
```

测试覆盖原文处理、引用核验、任务重试、腾讯云请求签名、语音拆分合并与 Range 音频响应。测试使用模拟服务，不消耗 API 额度。

## 技术结构

- React / vinext / Vite：页面与开发构建。
- Cloudflare Worker：后端接口与外部模型调用。
- D1：节目、文字稿与制作进度。
- R2：语音片段及合并音频。
- `app/`：发现、制作、文字稿与播放页面。
- `server/`：内容接入、脚本生成、核对、TTS 与存储。
- `tests/`：自动化测试。
- `docs/PRD.md`：产品规划，包含尚未实现的后续功能。

## 部署与内容来源

`.openai/hosting.json` 保留本项目的 Sites 项目标识与 D1/R2 绑定。本地密钥不会自动上传到线上，线上运行需要单独配置服务环境变量。将代码推送到 GitHub 不等于部署网站。

内容来自知乎黑客松专用知识接口，不是知乎全站搜索接口。列表数量和接口可用性可能随赛事变化；原文版权及归属属于相应作者与权利人。应用展示来源与作者，播客由 AI 改编及合成，不代表作者本人参与录制。
