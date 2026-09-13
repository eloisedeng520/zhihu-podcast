# 知乎 OAuth 接入

页面提供「连接知乎」、连接状态和退出入口。Worker 的 `/api/auth/zhihu/*` 路由处理授权；不依赖 Next 路由或 `process.env`。未配置时，访客仍可使用现有播客功能。

## 配置

在后端运行环境配置（本地可沿用项目忽略的环境文件，线上使用部署 Secret）：

- `ZHIHU_APP_ID`：应用 ID。
- `ZHIHU_OAUTH_APP_KEY`：应用密钥，兼容旧名称 `ZHIHU_APP_KEY`，新名称优先。
- `ZHIHU_REDIRECT_URI`：登记的完整公网 HTTPS 回调地址，如 `https://<部署域名>/api/auth/zhihu/callback`。localhost 只用于页面预览，不作为真实授权回调；不允许 query 或 fragment。从其他地址点击连接时，会先跳转到登记的网站源，再发起授权。
- `DB`：现有 D1 绑定。新增表包含在 `drizzle/0003_zhihu_oauth.sql`，运行时也会幂等初始化。

配置后重启开发服务。授权入口会将其他端口或域名的请求转到登记的网站源；回调仍严格校验源地址，且不转发回调参数。回调地址需与知乎登记值完全一致；端口自动变化时应回到登记的端口运行。

## 协议与安全

依据仓库 `zhihu/references/oauth.md`、`hackathon-oauth.md` 实现。用户提供的飞书页面本次只读取到加载页，尚未核对正文。

授权跳转到 `https://openapi.zhihu.com/authorize`；回调优先读取 `authorization_code`，兼容 `code`；后端向 `https://openapi.zhihu.com/access_token` 提交表单字段 `app_id/app_key/grant_type/redirect_uri/code`。以实际 `access_token` 判断成功，不将业务 `code: 20000` 当失败。有效期来自 `expires_in`，最多保存一天，不推断刷新能力。

每次授权生成独立随机 state 和浏览器关联 Cookie，D1 只保存摘要，十分钟过期。回调通过原子删除校验并消费 state，避免串号及重放。**当前参考资料记录知乎可能不回传 state；本实现会拒绝这种回调，不使用仅 Cookie 的降级校验。需要平台确认 state 支持后才能真实跑通。**

OAuth Token 以 AES-GCM 加密存入 D1，密钥由后端 App Key 派生；浏览器仅持有随机 HttpOnly、SameSite=Lax 会话 Cookie，HTTPS 下附加 Secure。服务端只存会话 ID 摘要。更换 App Key 会使旧连接失效。退出删除当前会话，过期记录在后续 OAuth 请求中清理。退出不等同于撤销知乎侧授权，现有资料未提供撤销接口。回调失败只返回固定错误类别，不返回上游原始响应或凭证。

## 范围

本次接入建立的是知乎授权连接，不将 Token 当用户 ID。资料未提供可验证的用户信息 endpoint / schema，所以没有显示猜测的昵称，也没有将本地收藏、节目或历史记录迁移到知乎账号。现有内容接口与访客数据规则保持原有行为。

后续调用个人数据时，只能在后端使用 `readZhihuToken()`，同时发送开放平台 `Authorization: Bearer <Access Secret>`、`X-OAuth-Token`、`X-Request-Timestamp`。Access Secret 与 App Key 是不同凭证。未经授权、Token 过期或用户接口返回鉴权失败时，应停止操作，不回退到开发者账号。

## 验证

`npm test` 覆盖实际 API 分发、state 错配/缺失/重放、Token 换取表单、过期、退出和凭证不泄漏。测试使用 SQLite 与模拟知乎响应，不代表真实授权成功。

真实验收：部署到公网 HTTPS → 配置应用并登记一致的公网回调 → 从登记的网站源点「连接知乎」→ 用户亲自在知乎确认 → 回调包含原 state → 页面显示「知乎已连接」→ 退出后状态变为未连接。若显示无法校验授权，先检查平台是否回传 state，不要删除校验。

## 我的收听访问规则

「我的收听」须建立有效知乎连接后才能加载和展示历史收听、收藏、稍后再听、提问及统计数量。未连接显示连接入口；退出、过期或状态检查失败会收起并清空页面列表。对应列表接口也要求有效会话，未连接返回 401。从书架发起授权会在返回后打开书架。此规则是访问门槛，数据归属仍沿用现有规则，不代表已实现知乎账号间的数据隔离或同步。

## 导入 zhihu-hackathon 后的排查结论

已安装个人 Skill：`~/.codex/skills/zhihu-hackathon`。来源为下载目录的同名文件夹；内附官方 Skill ZIP 的 SHA-256 已与快照说明一致。没有运行初始化器覆盖现有听见项目。

根据该 Skill 的 `references/oauth-boundary.md`，localhost、127.0.0.1 只能预览，真实登录须先部署并使用公网 HTTPS 回调。当前 `.env` 仍为 `http://localhost:3000/api/auth/zhihu/callback`，不满足这个联调前提。此前 303 跳转及知乎 302 登录页仅证明入口可达，不能证明授权配置有效；当前错误停留在知乎侧，尚无平台错误码来单独证明最终根因。

适配现有项目的下一步：

1. 沿用当前 Cloudflare Worker + D1 + R2 架构部署应用，取得稳定公网 HTTPS 域名。保留现有 D1、R2 绑定与迁移，不用 Skill 的 Node Hello World 替换项目。
2. 将后端 `ZHIHU_REDIRECT_URI` 设置为 `https://<部署域名>/api/auth/zhihu/callback`，并把同一个地址登记到知乎赛事／应用管理页面。模板的 `/auth/callback` 是模板路由，本项目实际路由不同，不能直接照抄。
3. 在部署 Secret 中设置 `ZHIHU_OAUTH_APP_KEY`，公开配置设置 `ZHIHU_APP_ID`。本地 `.env` 不会自动成为线上配置，不应上传到代码包。
4. 用户从公网网站发起授权并亲自确认。只有成功回到应用才能验证 App Key 与 Token 交换。
5. 如要读取知乎创作、关注或收藏，还需独立的 `ZHIHU_ACCESS_SECRET`。它不是 App Key；五项用户数据接口按 Skill 说明分别验收。应用本地的「我的收听」与知乎收藏数据不是同一功能。

还需处理的实现差异：

- Skill 示例兼容 `access_token` / `data.access_token` / `Data.access_token`，当前实现只读顶层；后续联调应补齐这三种结构并验证 expires_in，不把业务 code=20000 当失败。
- Skill 示例允许不回传 state，但要求标记为「仅适合临时联调」；当前应用拒绝缺失 state 的回调。公网部署后仍需确认平台是否回传，不能为了进入个人书架而直接移除校验。
- 示例只在 Node 内存保存 Token；现有 Worker 采用 D1 加密会话，属于不同的持久化方案。不能宣称它是原样套用 Skill 模板，正式上线前仍需审视有效期、退出清理与数据归属。

当前状态：Skill 已安装、接入分析完成；公网部署、回调登记及真实授权仍未验证。
