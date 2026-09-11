<p align="center">
  <img src="https://img.shields.io/badge/aPush-v1.0-007aff?style=flat-square" alt="aPush">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="license">
  <img src="https://img.shields.io/badge/node-18%2B-brightgreen?style=flat-square" alt="node">
</p>

<p align="center">
  <b>English</b> · <a href="./README.zh-CN.md">简体中文</a>
</p>

<h1 align="center">aPush</h1>

> Self-hosted push notification relay. Route your messages from anywhere to everywhere.

aPush is a lightweight, self-hosted middleware that receives messages from various sources (iPhone Shortcuts, Android SMS, monitoring tools, any webhook) and forwards them through configurable rules to multiple output channels — Bark, WeChat Work, DingTalk, Feishu, Telegram, Email, and custom webhooks.

---

## Features

- **Multi-source** — one server, multiple webhook paths, each with independent parser mode
- **Smart parsing** — auto-detects title/content/appName fields; unmatched fields land in metadata
- **Flexible policy engine** — keyword matching, regex filtering, field extraction, content cleaning
- **8 output channels** — Bark / WeCom App / WeCom Bot / DingTalk / Feishu / Telegram / Email / Webhook
- **Multiple message types** — WeCom App: text/markdown/textcard/news; WeCom Bot/DingTalk: text/markdown
- **Message templates** — `{{variable}}` syntax per channel, compose push payloads freely
- **Flow records** — complete message lifecycle tracking: receive → match → deliver
- **System logs** — real-time operational visibility: startup, errors, delivery status
- **Zero build** — plain Node.js + Express + MySQL, no bundler needed

---

## Quick Start

### Prerequisites
- Node.js 18+
- MySQL 8.0+

### Install

```bash
git clone https://github.com/5hux1n/apush.git
cd apush
npm install
cp .env.example .env   # edit DB credentials
node install.js        # initialize database
node server.js         # start on port 25717
```

Open `http://localhost:25717` → configure sources, channels, policies → start receiving.

---

## Architecture

```
Source (iPhone / Android / Server / Webhook)
   │
   ▼ POST/GET /api/webhook[/:path]
┌──────────────┐
│   Parser     │  auto → title, content, app, metadata
│   Engine     │  raw  → raw_body only
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Policy     │  keywords / regex / time range
│   Engine     │  rewrite_rules (extract & clean)
└──────┬───────┘
       │  matched → forward
       ▼
┌──────────────┐
│   Template   │  {{title}} {{content}} {{metadata.xxx}}
│   Engine     │  per-channel customization
└──────┬───────┘
       │
       ▼
┌──────────────┐
│   Pusher     │  Bark / WeCom / DingTalk / Feishu
│   Dispatcher │  Telegram / Email / Custom Webhook
└──────────────┘
```

---

## API

Push to aPush (any method, any content-type):

```
GET  /api/webhook[/:path]?title=Alert&content=CPU+90%
POST /api/webhook[/:path]  (JSON / form / plain text)
```

Fields auto-parsed: `title`, `content`/`message`/`body`, `appName`, `appID`, `url`, `icon`. Everything else → `metadata`.

---

## Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `PORT` | 25717 | No | Server port |
| `DB_HOST` | 127.0.0.1 | No | MySQL host |
| `DB_PORT` | 3306 | No | MySQL port |
| `DB_NAME` | apush | Yes | Database name |
| `DB_USER` | root | Yes | Database user |
| `DB_PASS` | — | Yes | Database password |
| `AUTH_PASSWORD` | — | No | Admin panel password (empty = no auth) |

---

## Tech Stack

- **Runtime**: Node.js, Express 5
- **Database**: MySQL 8 (mysql2)
- **Frontend**: Vue 3 CDN (no build step)
- **SMTP**: Pure Node.js `tls`/`net` (zero dependency)
- **Templates**: Custom `{{variable}}` engine

---

## License

MIT © 2026

---

<p align="center">
  <a href="https://apush.cn">Website</a> ·
  <a href="https://github.com/5hux1n/apush">GitHub</a>
</p>
