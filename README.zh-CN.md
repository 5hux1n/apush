<p align="center">
  <img src="https://img.shields.io/badge/aPush-v1.0-007aff?style=flat-square" alt="aPush">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/node-18%2B-brightgreen?style=flat-square" alt="node">
</p>

<p align="center">
  <a href="./README.md">English</a> · <b>简体中文</b>
</p>

<h1 align="center">aPush</h1>

> 自托管推送中转站。让你的消息，从任意入口，抵达任意终端。

aPush 是一个轻量级的自托管消息中转服务：接收来自各种来源的消息（iPhone 快捷指令、安卓短信转发、监控告警、任意 Webhook），经过可配置的规则匹配与模板加工后，转发到多个输出渠道 —— Bark、企业微信、钉钉、飞书、Telegram、邮件、自定义 Webhook。

---

## 🧪 在线演示

完整管理界面 + 内置演示数据，**全站只读**：所有写请求在边缘直接 403（不是只在界面上藏按钮）。内置「🧪 模拟推送」玩法：真实跑一遍 **解析 → 规则匹配 → 字段提取 → 模板渲染 → 通道分发** 全管线，纯内存 dry-run，不落库、不真实投递，随便玩。

**[apush.me[demo] →](https://apush.me)** · **[使用指南](https://apush.cn/usage.html)**（中文） · [User Guide](./USAGE.md)

在 Cloudflare Workers 上部署你自己的演示实例（免费额度即可，无需数据库）：

```bash
cd demo
npx wrangler login
npx wrangler deploy
```

---

## 功能特性

- **多来源接入** — 一个服务，多条 Webhook 路径，每条可独立设置解析模式
- **智能解析** — 自动识别 title / content / appName 等字段，未识别字段自动归入 metadata
- **灵活的策略引擎** — 关键词匹配、正则过滤、字段提取、内容清洗（rewrite 规则）
- **8 种输出渠道** — Bark / 企业微信应用 / 企业微信机器人 / 钉钉 / 飞书 / Telegram / 邮件 / Webhook
- **多种消息类型** — 企业微信应用：text / markdown / textcard / news；企微机器人 / 钉钉：text / markdown
- **消息模板** — 每个渠道独立配置 `{{变量}}` 模板，自由拼接推送内容
- **流转记录** — 消息全生命周期可查：接收 → 命中 → 送达
- **系统日志** — 启动、报错、投递状态，运行状况实时可见
- **零构建** — 纯 Node.js + Express + MySQL，无需打包器，clone 即跑

---

## 快速开始

### 环境要求
- Node.js 18+
- MySQL 8.0+

### 安装部署

```bash
git clone https://github.com/5hux1n/apush.git
cd apush
npm install
cp .env.example .env   # 填写数据库配置
node install.js        # 初始化数据库
node server.js         # 启动服务（默认端口 25717）
```

浏览器打开 `http://localhost:25717` → 配置消息来源、推送渠道、匹配规则 → 开始接收推送。

---

## 架构流程

```
消息来源（iPhone / 安卓 / 服务器 / Webhook）
   │
   ▼ POST/GET /api/webhook[/:path]
┌──────────────┐
│   解析引擎    │  auto → title、content、app、metadata
│   Parser     │  raw  → 仅保留 raw_body
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   策略引擎    │  关键词 / 正则 / 时间段匹配
│   Policy     │  rewrite 规则（提取与清洗）
└──────┬───────┘
       │  命中规则 → 转发
       ▼
┌──────────────┐
│   模板引擎    │  {{title}} {{content}} {{metadata.xxx}}
│   Template   │  按渠道独立定制
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   推送分发    │  Bark / 企微 / 钉钉 / 飞书
│   Pusher     │  Telegram / 邮件 / 自定义 Webhook
└──────────────┘
```

---

## API

向 aPush 推送消息（任意方法、任意 Content-Type 均可）：

```
GET  /api/webhook[/:path]?title=告警&content=CPU+90%
POST /api/webhook[/:path]  （JSON / 表单 / 纯文本）
```

自动识别字段：`title`、`content` / `message` / `body`、`appName`、`appID`、`url`、`icon`；其余字段一律归入 `metadata`，模板中以 `{{metadata.xxx}}` 引用。

---

## 环境变量

| 变量 | 默认值 | 必填 | 说明 |
|------|--------|------|------|
| `PORT` | 25717 | 否 | 服务端口 |
| `DB_HOST` | 127.0.0.1 | 否 | MySQL 地址 |
| `DB_PORT` | 3306 | 否 | MySQL 端口 |
| `DB_NAME` | apush | 是 | 数据库名 |
| `DB_USER` | root | 是 | 数据库用户 |
| `DB_PASS` | — | 是 | 数据库密码 |
| `AUTH_PASSWORD` | — | 否 | 管理界面访问密码（留空 = 不启用） |

---

## 技术栈

- **运行时**：Node.js、Express 5
- **数据库**：MySQL 8（mysql2）
- **前端**：Vue 3 CDN 直引（无构建步骤）
- **SMTP**：纯 Node.js `tls` / `net` 实现（零第三方依赖）
- **模板**：自研 `{{变量}}` 模板引擎

---

## 许可证

MIT © 2026

---

<p align="center">
  <a href="https://apush.cn">官网</a> ·
  <a href="https://github.com/5hux1n/apush">GitHub</a>
</p>
