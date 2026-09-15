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

## 7. 下游 Webhook 渠道格式

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

## 8. 接入检查清单

1. HTTPS、端口和反向代理可从发送方访问。
2. `.env` 数据库配置正确，`node install.js` 已成功执行。
3. 来源 `path` 与调用 URL 一致，令牌位置正确。
4. 至少有一条启用规则，并配置目标渠道。
5. 用上面的 curl 示例发送测试消息。
6. 在流转记录确认 `forwarded` 或 `blocked`，在投递日志确认每个渠道的结果。

