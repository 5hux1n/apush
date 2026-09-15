# aPush Webhook 接收端部署与接口规范

本文说明如何部署 aPush 的 Webhook 接收端，以及发送方必须遵循的请求格式、字段映射、鉴权和响应约定。

## 1. 接收端部署

### 运行环境

- Node.js 18 或更高版本
- MySQL 8.0 或更高版本
- 可从发送方访问的 HTTP(S) 地址

### 安装与初始化

```bash
git clone https://github.com/5hux1n/apush.git
cd apush
npm install
cp .env.example .env
```

编辑 `.env`，至少填写 `DB_NAME`、`DB_USER` 和 `DB_PASS`。生产环境建议同时设置 `AUTH_PASSWORD`，保护管理面板。

```bash
node install.js
npm start
```

服务默认监听 `25717` 端口。公网部署时，建议用 Nginx/Caddy 将 HTTPS 反向代理到 `127.0.0.1:25717`，并使用进程管理器保持服务运行：

```bash
npm install -g pm2
pm2 start server.js --name apush
pm2 save
```

### 创建 Webhook 来源

在管理面板的“来源”中创建来源：

| 配置项 | 说明 |
|---|---|
| 名称 | 便于识别的来源名称 |
| `path` | URL 路径片段，例如 `nas`，完整地址为 `/api/webhook/nas`；留空使用默认来源 |
| `parser_mode` | `auto` 自动识别字段；`raw` 保留原文并以正文兜底 |
| `auth_token` | 可选。设置后必须通过请求体、查询参数或 `Authorization: Bearer <token>` 提交相同令牌 |

创建来源后，还需创建至少一条启用的规则并选择目标渠道；没有命中启用规则的消息会记录为 `blocked`，不会转发。

## 2. 接口地址与请求方式

```text
GET  https://your-domain.example/api/webhook
POST https://your-domain.example/api/webhook
GET  https://your-domain.example/api/webhook/<path>
POST https://your-domain.example/api/webhook/<path>
```

`<path>` 只能使用来源配置中的路径片段。路径匹配优先；未匹配时会回退到默认来源，若不存在默认来源则使用数据库中的第一条来源。

支持的请求体：

- `application/json`：对象字段直接参与解析
- `application/x-www-form-urlencoded`：表单字段参与解析
- `text/plain`：整段文本作为 `content`；无法解析为 JSON 时也按此处理
- GET 查询参数：会与请求体合并，查询参数优先覆盖同名请求体字段

请求体上限为 20 MB。服务端会保存原始请求内容（`rawBody`），数据库字段最多保留 65535 字节。

## 3. 标准字段与自动映射

`parser_mode=auto` 时，aPush 按下表别名寻找第一个非空值。字段名区分大小写。

| 标准字段 | 推荐字段名 | 支持的别名 | 处理结果 |
|---|---|---|---|
| 标题 | `title` | `text`, `subject`, `caption`, `name`, `summary` | 消息标题，最多 500 字符 |
| 正文 | `content` | `desp`, `body`, `message`, `text`, `description`, `data`, `msg` | 消息正文，最多 10000 字符 |
| 应用名 | `appName` | `app_name`, `sender`, `from`, `source`, `app` | 来源应用名称 |
| 应用 ID | `appID` | `app_id`, `bundleId`, `package`, `appId` | 来源应用标识 |
| 链接 | `url` | `link`, `href`, `source_url` | 关联 URL |
| 图标 | `icon` | `logo`, `image`, `avatar`, `icon_url` | URL 或 data URI |

建议发送方使用 `title`、`content`、`appName`、`appID`、`url`、`icon` 这组标准名称，避免别名冲突（例如 `text` 同时可作为标题和正文别名，标题优先）。

未被映射的字段会完整放入 `metadata`。如果发送 `metadata` 为对象，其键会与其他未映射字段合并；模板可用 `{{metadata.xxx}}` 或 `{{metadata_json}}` 读取。

`parser_mode=raw` 不做自动字段映射，原文保存到 `raw_body`；正文依次使用 `content`、`desp`、`body` 或原始请求内容兜底。

## 4. 鉴权

当来源设置了 `auth_token`，以下任一位置可提交令牌（优先级从高到低）：

1. 请求体 `token`
2. 查询参数 `token`
3. `Authorization: Bearer <token>` 请求头

令牌不匹配返回 HTTP `403`：

```json
{"success":false,"error":"token 无效"}
```

生产环境应使用 HTTPS，令牌不要写入公开日志或前端代码。

## 5. 请求示例

### JSON（推荐）

```bash
curl -X POST 'https://your-domain.example/api/webhook/nas' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -d '{
    "title": "磁盘告警",
    "content": "Disk 2 SMART 状态异常",
    "appName": "Synology",
    "appID": "nas-01",
    "url": "https://nas.example/alerts/123",
    "severity": "critical",
    "metadata": {"host": "nas-01", "disk": 2}
  }'
```

### GET 查询参数

```bash
curl 'https://your-domain.example/api/webhook/monitor?title=CPU%20告警&content=使用率%2090%25&token=YOUR_TOKEN'
```

### 纯文本

```bash
curl -X POST 'https://your-domain.example/api/webhook/nas' \
  -H 'Content-Type: text/plain; charset=utf-8' \
  --data-binary 'Disk 2 SMART 状态异常'
```

## 6. 响应与处理语义

成功接收后立即返回 HTTP `200`，响应固定为：

```json
{"success":true}
```

返回成功表示请求已被接收并进入异步规则处理，不代表所有下游渠道投递成功。请在管理面板的消息流转记录和系统日志中查看规则命中、渠道投递状态及错误信息。

常见状态码：

| 状态码 | 含义 |
|---|---|
| `200` | 已接收；可能随后被规则拦截或转发 |
| `403` | 来源令牌无效 |
| `500` | 服务端处理异常；检查 Node.js 与数据库日志 |

## 7. 输出渠道配置与接收方要求

每个输出渠道在管理面板中保存为一条 `push_channels` 记录：`type` 决定渠道，`config` 保存 JSON 配置，`template` 可选。以下字段名以当前程序实际读取的名称为准。

### Bark（iOS）

```json
{"bark_key":"设备 Key","server_url":"https://api.day.app"}
```

`bark_key` 必填，`server_url` 可选，留空使用 `https://api.day.app`。aPush 优先 POST JSON 到 `<server_url>/<bark_key>`，失败时回退为 Bark 路径格式 GET。模板应渲染为 JSON，可使用 Bark 的 `title`、`body`、`sound`、`group`、`icon`、`url`、`level` 等字段。

### 企业微信应用消息

```json
{"corp_id":"ww企业ID","agent_id":1000002,"secret":"应用Secret","user_id":"@all","wecom_msgtype":"textcard"}
```

`corp_id`、`agent_id`、`secret` 必填；`user_id` 可选，默认 `@all`。`wecom_msgtype` 支持 `text`、`markdown`、`textcard`（默认）和 `news`。aPush 先调用企业微信 `gettoken`，再向 `message/send` POST JSON；后台必须配置应用可见范围、发送权限及可信 IP，否则可能返回 `60020`。

### 企业微信群机器人

```json
{"webhook_url":"https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=xxx","msgtype":"markdown"}
```

`webhook_url` 必填且须包含 `key`；`msgtype` 为 `text` 或 `markdown`，默认 `text`。发送体分别为 `{"msgtype":"text","text":{"content":"文本"}}` 或 `{"msgtype":"markdown","markdown":{"content":"# Markdown"}}`。

### 钉钉群机器人

```json
{"webhook_url":"https://oapi.dingtalk.com/robot/send?access_token=xxx","secret":"SECxxx","msgtype":"markdown"}
```

`webhook_url` 必填；启用“加签”时必须填写 `secret`，aPush 会按钉钉规则计算 HMAC-SHA256，并追加 `timestamp`、`sign`；未启用则留空。`msgtype` 支持 `text` 和 `markdown`（默认 `markdown`）。启用关键词安全策略时，模板正文必须包含关键词。

### 飞书群机器人

```json
{"webhook_url":"https://open.feishu.cn/open-apis/bot/v2/hook/xxx"}
```

`webhook_url` 必填。aPush 固定 POST 交互式卡片 JSON，包含标题、正文和来源时间；飞书后台的关键词、IP 或签名安全设置必须匹配。

### Telegram Bot

```json
{"bot_token":"123456:ABC...","chat_id":"-1001234567890"}
```

两个字段都必填。aPush POST 到 Telegram `sendMessage`，请求体包含 `chat_id`、`text`、`parse_mode=HTML` 和 `disable_web_page_preview=true`。Bot 必须已加入目标群并具备发言权限。

### 邮件（SMTP）

```json
{"smtp_host":"smtp.example.com","smtp_port":465,"smtp_user":"sender@example.com","smtp_pass":"授权码","to":"receiver@example.com"}
```

`smtp_host`、`smtp_user`、`smtp_pass`、`to` 必填；端口默认 `465`，465 使用 TLS，587 使用 STARTTLS。`smtp_pass` 通常填写服务商授权码；程序以 `smtp_user` 作为发件人，正文按 HTML 发送，当前支持单个收件人。

### 自定义 Webhook

```json
{"webhook_url":"https://example.com/api/receive"}
```

`webhook_url` 必填。aPush 始终 POST JSON，不额外添加鉴权头；接收方应接受 `Content-Type: application/json` 并返回 2xx。需要签名、特殊 Header 或非 JSON 协议时，请在 n8n、API Gateway 等中间层转换。

## 8. 下游 Webhook 默认格式

aPush 作为发送方转发到自定义 Webhook 渠道时，默认 POST JSON：

```json
{
  "title": "标题",
  "content": "正文",
  "app": "应用名",
  "metadata": {},
  "time": "2026-09-16T00:00:00.000Z"
}
```

在渠道或规则模板中可以自定义 JSON，并使用 `{{title}}`、`{{content}}`、`{{app_name}}`、`{{app_id}}`、`{{url}}`、`{{icon}}`、`{{metadata.xxx}}`、`{{metadata_json}}`、`{{created_at}}` 和 `{{rule_name}}`。模板必须渲染为合法 JSON，否则会使用内置兜底载荷。

## 9. 接入检查清单

1. HTTPS、端口和反向代理可从发送方访问。
2. `.env` 数据库配置正确，`node install.js` 已成功执行。
3. 来源 `path` 与调用 URL 一致，令牌位置正确。
4. 至少有一条启用规则，并配置目标渠道。
5. 用上面的 curl 示例发送测试消息。
6. 在流转记录确认 `forwarded` 或 `blocked`，在投递日志确认每个渠道的结果。
