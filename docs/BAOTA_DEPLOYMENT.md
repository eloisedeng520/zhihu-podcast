# 宝塔 Node 部署

此构建使用 Node.js 自带的 SQLite 保存节目数据，并将生成的音频保存到本地磁盘。Node 服务只监听 `127.0.0.1:3000`，由宝塔 Nginx 对外提供 HTTP/HTTPS。

## 1. 本地生成部署包

需要 Node.js 22.13 或更高版本：

```bash
npm ci
npm test
npm run build:node
```

构建完成后，只需上传 `dist/standalone` 目录中的内容。该目录已经包含运行依赖，服务器不需要再次执行 `npm install`。

构建脚本不会打包数百 MB 的原始图片快照；页面运行时使用内容记录中保存的知乎原图地址。

## 2. 上传文件

在宝塔文件管理器中创建：

```text
/www/wwwroot/tingjian-podcast
/www/wwwroot/tingjian-podcast-data/audio
```

将本地 `dist/standalone` 中的全部内容上传到 `/www/wwwroot/tingjian-podcast`。最终应能看到：

```text
/www/wwwroot/tingjian-podcast/baota-start.mjs
/www/wwwroot/tingjian-podcast/server.js
/www/wwwroot/tingjian-podcast/dist/
/www/wwwroot/tingjian-podcast/public/
```

不要上传本地 `.env`。

## 3. 配置生产环境

复制部署包中的 `.env.production.example` 为 `.env.production`，填写服务端密钥，并设置持久化路径：

```dotenv
SQLITE_DATABASE_PATH=/www/wwwroot/tingjian-podcast-data/app.db
AUDIO_STORAGE_PATH=/www/wwwroot/tingjian-podcast-data/audio
VINEXT_TRUST_PROXY=1
HOST=127.0.0.1
PORT=3000
```

若启用知乎账号登录，还需配置 `ZHIHU_APP_ID`、`ZHIHU_OAUTH_APP_KEY` 和已在知乎登记的公网 HTTPS `ZHIHU_REDIRECT_URI`。OAuth 用户接口直接使用用户授权得到的 Access Token，不需要另配 Access Secret。公网 IP 的 HTTP 地址不能作为真实 OAuth 回调。

然后在宝塔终端执行：

```bash
chown -R www:www /www/wwwroot/tingjian-podcast /www/wwwroot/tingjian-podcast-data
chmod 750 /www/wwwroot/tingjian-podcast-data
chmod 600 /www/wwwroot/tingjian-podcast/.env.production
```

API 密钥不得写入网页代码、提交到 Git 或发送到聊天中。

## 4. 添加 Node 项目

进入宝塔的“网站 → Node 项目 → 添加 Node 项目”，填写：

```text
项目目录：/www/wwwroot/tingjian-podcast
启动文件：baota-start.mjs
Node 版本：22.13 或更高
运行用户：www
项目端口：3000
开机启动：开启
```

只运行一个应用实例。SQLite 不适合使用 PM2 cluster 模式启动多个写入进程。

启动后在宝塔终端检查：

```bash
curl -I http://127.0.0.1:3000/
curl http://127.0.0.1:3000/api/status
```

首页应返回 `200`，状态接口中的“节目存储”应显示 `configured: true`。

## 5. 配置反向代理

为域名添加网站，然后在“站点设置 → 反向代理”中将请求代理到：

```text
http://127.0.0.1:3000
```

确保 Nginx 传递以下请求头；宝塔生成的反向代理配置通常已经包含它们：

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

阿里云防火墙只需对公网开放 80 和 443，不要开放 3000、SQLite 文件或音频存储目录。

## 6. 更新和备份

更新时重新运行 `npm run build:node`，停止宝塔 Node 项目，再替换程序目录。不要覆盖 `/www/wwwroot/tingjian-podcast-data`。

备份前先停止 Node 项目，然后备份：

```text
/www/wwwroot/tingjian-podcast-data/app.db
/www/wwwroot/tingjian-podcast-data/audio/
```

恢复时也应先停止 Node 项目，恢复两个位置后再启动。

## 常见问题

- `502 Bad Gateway`：Node 项目未启动，或端口不是 3000。
- 写请求返回 `403`：检查 `VINEXT_TRUST_PROXY=1` 和 `X-Forwarded-Proto`。
- “节目存储尚未就绪”：部署的不是 `build:node` 生成的包，或本地数据目录无写权限。
- `SQLITE_CANTOPEN`：检查数据目录是否存在、运行用户是否为 `www`、目录是否可写。
- 音频无法播放：检查 `AUDIO_STORAGE_PATH` 权限和磁盘剩余空间。
