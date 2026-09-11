# aPush 使用指南

> 中文使用说明 · 在线阅读：**https://apush.cn/usage.html** · 英文快速上手见 [README.md](./README.md)

---

## 目录

1. [工作原理](#1-工作原理)
2. [安装部署](#2-安装部署)
3. [登录管理面板](#3-登录管理面板)
4. [四个核心概念](#4-四个核心概念)
5. [接收消息（Webhook 接口）](#5-接收消息webhook-接口)
6. [渠道配置速查](#6-渠道配置速查)
7. [策略与模板](#7-策略与模板)
8. [典型接入示例](#8-典型接入示例)
9. [常见问题 FAQ](#9-常见问题-faq)

---

## 1. 工作原理

一条消息在 aPush 内部的完整旅程：

```
来源(Source) → 字段解析(Parser) → 策略匹配(Rule) → 字段改写(Rewrite) → 模板渲染(Template) → 渠道投递(Channel × N)
```

- **解析**：自动识别 `title` / `content` / `appName` / `url` 等字段的几十种常见别名（`subject`、`body`、`msg`、`desp`……），无法识别的字段全部归入 `metadata`，模板里用 `{{metadata.xxx}}` 取用。
- **匹配**：按策略的条件（来源、关键词、正则、时间段、星期）判断放行或拦截；多条策略命中时取**第一条**。
- **投递**：命中后向策略勾选的**每个渠道**各推一份，渲染该渠道生效的模板，每次投递独立记录成败与耗时（流转记录页可查）。

## 2. 安装部署

**前置要求**：Node.js ≥ 18、MySQL 8.x

```bash
git clone https://github.com/5hux1n/apush.git
cd apush
npm install
cp .env.example .env      # 编辑数据库等配置
node install.js           # 初始化向导：建库建表、设置面板密码
npm start                 # 启动，默认端口 25717
```

`.env` 全部可选项：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `25717` | 服务端口 |
| `AUTH_PASSWORD` | 空 | **管理面板密码**。留空 = 不设防，公网部署务必设置 |
| `DB_HOST` / `DB_PORT` | `127.0.0.1` / `3306` | MySQL 地址 |
| `DB_NAME` / `DB_USER` / `DB_PASS` | — | 库名与账号 |
| `BARK_SERVER` | `https://api.day.app` | 全局 Bark 服务器（渠道里留空时用它） |

生产环境建议用 pm2 守护：

```bash
npm i -g pm2
pm2 start server.js --name apush && pm2 save
```

反代 + HTTPS（可选）：Nginx / Caddy / frp 均可，把 `443 → 127.0.0.1:25717` 转发即可，无特殊 header 要求。

## 3. 登录管理面板

浏览器打开 `http://<服务器IP>:25717/`：

- 设置了 `AUTH_PASSWORD` 时输入密码登录。密码只用于换取**会话令牌**（服务端内存 Map，24h 有效），后续请求都通过 `x-auth-token` 头携带，不会重复传输密码。
- 连续错 5 次会锁 10 分钟（防爆破）。
- 四个菜单：**策略配置**（规则）、**通道来源**（渠道+来源）、**流转记录**（消息流水与投递明细）、**系统日志**。

## 4. 四个核心概念

| 概念 | 作用 | 关键字段 |
|---|---|---|
| **来源 Source** | 消息入口，决定 Webhook 路径与解析方式 | `path`（URL 片段）、`auth_token`（入口令牌）、`parser_mode`（auto/raw） |
| **渠道 Channel** | 消息出口，8 种类型 | `name`、`type`、`config`（连接参数 JSON）、`template`（渠道级模板） |
| **策略 Rule** | 决定"哪些消息 → 发到哪些渠道 → 长什么样" | 关键词、时间段、目标渠道、渠道模板覆盖、rewrite 提取/清洗 |
| **模板 Template** | 控制最终推送的排版 | `{{变量}}` 占位符 |

> ⚠️ 没有**启用中**的策略命中时，消息会被直接拦截（action=`blocked`），一条也不发。新装完先建策略再测试。

## 5. 接收消息（Webhook 接口）

统一入口（GET / POST 均可，自动处理 CORS 预检）：

```
/api/webhook            ← 默认来源（path 留空）
/api/webhook/iphone     ← 来源 path = iphone
```

**传参方式三选一：**

```bash
# ① Query 参数（iPhone 快捷指令 GET 场景）
curl "http://IP:25717/api/webhook/iphone?title=你好&content=正文&appName=测试&token=***"

# ② JSON body（脚本 / 服务告警场景）
curl -X POST http://IP:25717/api/webhook \
  -H "Content-Type: application/json" \
  -d '{"title":"磁盘告警","content":"使用率 92%","appName":"Prometheus"}'

# ③ 纯文本（来源 parser_mode = raw 时，整段进 message）
curl -X POST http://IP:25717/api/webhook/nas -H "Content-Type: text/plain" -d "任意格式原文"
```

**鉴权**：来源设置了 `auth_token` 时，三处任选其一携带：`body.token` → `?token=***` → `Authorization: Bearer <token>`（按此优先级）。不对应返回 `403 token 无效`。

**响应**：立即返回 `{success, matched_rule, action, delivered, failed, deliveries[]}`——投递明细同步可见，无需查库。

## 6. 渠道配置速查

`config` 为 JSON，各类型字段：

| 类型 | 字段 | 备注 |
|---|---|---|
| `bark` | `server?`, `bark_key` | server 留空用 `.env` 的 `BARK_SERVER`；可配 JSON 模板扩展 group/sound/icon/level |
| `wecom`（企微应用） | `corpid`, `corpsecret`, `agentid`, `touser?`, `wecom_msgtype` | **必须把应用"可信域名/IP 白名单"配好**，否则 60020；msgtype 支持 text / markdown / textcard / news |
| `wecom-bot`（群机器人） | `webhook_key`, `wecom_msgtype` | 群 Webhook 地址 `key=` 后面那段 |
| `dingtalk` | `webhook_token`, `secret?`, `atMobiles?`, `msgtype` | 机器人开了「加签」才填 `secret`（自动算签名）；开了「自定义关键词」则消息必须含关键词，建议模板带前缀 |
| `feishu` | `webhook_url`, `secret?` | 飞书群自定义机器人 |
| `tg` | `bot_token`, `chat_id` | BotFather 建 bot；chat_id 支持 `@username` 或数字 ID |
| `email` | `host`, `port`, `secure`, `auth.user`, `auth.pass`, `to` | 465 端口 `secure: true`，587 用 `false`（自动 STARTTLS）；pass 用 QQ/163 的**授权码**不是登录密码 |
| `webhook`（下游） | `url`, `method?`, `headers?` | 把你收到的消息按模板原样 POST 给任何系统 |

渠道卡片里的**测试**按钮会真实发一条样例消息（占配额，钉钉/企微注意频控）。

## 7. 策略与模板

**策略条件**（全部为"与"关系）：

- 关键词：多个词按 **AND / OR** 组合，勾选正则后每个词按正则匹配（对 `appName + title + content` 拼接文本做小写匹配）
- 时间窗 `time_range`（`HH:MM~HH:MM`）+ `active_days`（`0~6` 星期）
- 来源限定：`*` 或指定来源 id

**rewrite 规则**（按序执行，先提取后清洗的用法最常见）：

```json
[{ "source": "message", "match": ".*?(\\d{6}).*", "replace": "$1",
   "target": "message", "use_regex": true, "use_regex_flags": "is" }]
```

含义：从正文提取 6 位数字，只把数字写回 `message` —— 配合 Bark 模板即可实现"验证码短信只推 6 位码"。字段既可填内置名（`title/content/message/url/metadata.xxx`），也可填解析前的原始 key。

**模板变量**：`{{title}}` `{{content}}` `{{message}}`（=content 别名） `{{app_name}}` `{{url}}` `{{source}}` `{{time}}` `{{metadata.任意字段}}`

**渲染优先级**：策略为该渠道指定的模板 → 渠道自身模板 → 内置默认模板（按渠道类型和 msgtype 选择最合适的版式）。

## 8. 典型接入示例

**iPhone 短信验证码 → Bark 只推 6 位码**

1. 来源：`path=iphone`，parser_mode auto，设一个 `auth_token`
2. 渠道：Bark（App 里复制 key）
3. 策略：关键词 `验证码`；来源限定 iphone；目标 Bark；rewrite 如上提取 6 位数字；渠道模板（Bark JSON）：
   ```json
   {"title":"🔐 {{app_name}} 验证码","body":"{{content}}","group":"验证码","sound":"bell","level":"timeSensitive","isArchive":1}
   ```
4. 快捷指令：触发条件「收到短信中包含"验证码"」→ 动作「获取 URL 内容」：
   ```
   http://IP:25717/api/webhook/iphone?title=【{{文本}}】&content={{文本}}&appName=信息&token=***
   ```
   （中文用「URL 编码」动作处理；iOS 17 可用快捷指令的变量直接拼接自动编码）

**服务器脚本 → 钉钉 + Telegram 双发**：建两条渠道，一条策略 `*` 来源 + 关键词 `告警`，勾两个渠道即可。CI 通知同理用正则 `deploy|部署|构建`。

**转发到下游系统**：渠道类型选 Webhook，模板写任意 JSON 字符串，收到的消息就会按该格式 POST 出去（对接 n8n / 自建 API / Server 酱皆可）。

## 9. 常见问题 FAQ

**Q：界面显示"离线"？** 长轮询 `/api/manager/messages?wait=1` 断了。检查服务是否存活、反代超时是否 < 30s（Nginx `proxy_read_timeout 60s`）。

**Q：消息全部被拦截？** 最常见原因——没有启用中的策略，或关键词/来源/时间窗不匹配。到**流转记录**点开该消息看投递明细，或直接在演示站右下角「🧪 模拟推送」里重放该消息观察匹配追踪。

**Q：企业微信收不到？** 企业后台 → 应用 → 接收权限 + **可信企业 IP** 白名单必配；错误码 `60020` 就是 IP 不在白名单。

**Q：钉钉 `310000` 签名不匹配？** 机器人安全设置三选一对齐：开加签→渠道必须填 `secret`；开关键词→消息里必须含该词。

**Q：Telegram 429/430？** 被限流，降低推送频率；自建 bot 默认配额约 20 条/分钟。

**Q：密码忘了？** `.env` 的 `AUTH_PASSWORD` 是唯一凭据，改完重启即可（无找回机制，数据库里不存密码）。

**Q：想先看看效果？** 免注册体验演示站 **[apush.me](https://apush.me)**（只读快照 + 模拟推送沙箱）。
