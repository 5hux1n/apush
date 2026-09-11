const express = require('express');
const router = express.Router();
const db = require('../db');
const filterEngine = require('../services/filterEngine');
const parser = require('../services/parser');

/**
 * aPush 统一 Webhook 入口
 *
 * 支持：
 *   GET  /api/webhook[/:path]?title=xxx&content=xxx
 *   POST /api/webhook[/:path]  (JSON / form / 纯文本)
 *
 * 解析逻辑：
 *   1. 先从 body 解析键值对
 *   2. query string 参数合并覆盖
 *   3. 走自动解析引擎 → title/content/appName/appId/url/icon/metadata
 */

// 根据请求提取原始 body 和键值对
async function extractPayload(req) {
    const kv = {};
    let rawBody = '';

    const contentType = req.headers['content-type'] || '';

    // 1. 解析 body
    if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
        // JSON 或 form → 已经是对象
        Object.assign(kv, req.body);
        rawBody = JSON.stringify(req.body);
    } else if (req.body && typeof req.body === 'string') {
        rawBody = req.body;
        // 尝试 JSON parse
        try {
            const obj = JSON.parse(req.body);
            if (typeof obj === 'object' && obj !== null) {
                Object.assign(kv, obj);
            }
        } catch {
            // 非 JSON 字符串 → 全文当 content
            kv.content = req.body;
        }
    } else if (req.body && Buffer.isBuffer(req.body)) {
        const str = req.body.toString('utf-8');
        rawBody = str;
        try {
            const obj = JSON.parse(str);
            if (typeof obj === 'object' && obj !== null) Object.assign(kv, obj);
            else kv.content = str;
        } catch {
            kv.content = str;
        }
    }

    // 2. query string 参数合并覆盖
    if (req.query && typeof req.query === 'object') {
        for (const [k, v] of Object.entries(req.query)) {
            if (v !== undefined && v !== null && k !== '') {
                kv[k] = v;
            }
        }
    }

    // 如果没有 body 只有 query，rawBody 补上
    if (!rawBody) {
        rawBody = new URLSearchParams(req.query || {}).toString();
    }

    return { kv, rawBody };
}

// 匹配来源：路径匹配优先，空路径作为默认来源
async function resolveSource(req) {
    const path = req.params.path || '';
    const [sources] = path
        ? await db.query('SELECT * FROM sources WHERE path = ?', [path])
        : await db.query('SELECT * FROM sources WHERE path = ?', ['']);

    if (sources.length > 0) return sources[0];

    // 回退：path 为 '' 找不到就取第一条 source
    const [fallback] = await db.query('SELECT * FROM sources LIMIT 1');
    return fallback[0] || null;
}

// 路由：支持 /api/webhook 和 /api/webhook/:path
router.all(['/', '/:path'], async (req, res) => {
    try {
        const source = await resolveSource(req);

        // Token 鉴权：优先 body.token → query.token → Header Authorization
        if (source && source.auth_token) {
            const clientToken =
                (req.body && req.body.token) ||
                (req.query && req.query.token) ||
                (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
            if (clientToken !== source.auth_token) {
                return res.status(403).json({ success: false, error: 'token 无效' });
            }
        }

        const sourceId = source ? (source.path || 'default') : 'default';

        // 提取并解析 payload
        const { kv, rawBody } = await extractPayload(req);

        let parsed;
        if (source && source.parser_mode === 'raw') {
            // raw 模式：全量存入 raw_body，不做自动解析
            parsed = {
                title: '',
                content: '',
                appName: '',
                appId: '',
                url: '',
                icon: '',
                metadata: {}
            };
            // content 兜底
            parsed.content = kv.content || kv.desp || kv.body || rawBody || '';
        } else {
            parsed = parser.parse(kv);
        }

        // 无 content 时用 raw_body 兜底
        if (!parsed.content && rawBody) {
            parsed.content = rawBody.substring(0, 4096);
        }

        const notification = {
            title: String(parsed.title || '').substring(0, 500),
            message: String(parsed.content || '').substring(0, 10000),
            appName: String(parsed.appName || 'App'),
            appID: String(parsed.appId || 'Unknown'),
            icon: String(parsed.icon || ''),
            url: String(parsed.url || ''),
            metadata: parsed.metadata || {},
            rawBody: rawBody || ''
        };

        res.json({ success: true });

        const log = require('../services/syslog');
        log.info('接收消息', `${notification.appName}: ${(notification.title || notification.message || '').substring(0, 80)}`);

        filterEngine.process(notification, sourceId);

    } catch (e) {
        console.error('Webhook接收失败:', e);
        if (!res.headersSent) res.status(500).send('Error');
    }
});

module.exports = router;
