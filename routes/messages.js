const express = require('express');
const router = express.Router();
const db = require('../db');
const events = require('../services/events');

// --- 消息记录 (支持长轮询) ---

router.get('/', async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const afterId = parseInt(req.query.after_id) || 0;
        const wantWait = req.query.wait === '1' && afterId > 0;

        const query = async () => {
            let sql = 'SELECT id, source_id, app_name, app_id, title, content, url, metadata, rule_name, action, created_at FROM messages';
            let params = [];
            if (afterId > 0) {
                sql += ' WHERE id > ?';
                params.push(afterId);
            }
            sql += ' ORDER BY created_at DESC LIMIT ?';
            params.push(limit);
            const [rows] = await db.query(sql, params);
            return rows;
        };

        if (!wantWait) {
            return res.json(await query());
        }

        // 长轮询：先查一次，有数据立刻返回；没有则等最多 25 秒
        const immediate = await query();
        if (immediate.length > 0) {
            return res.json(immediate);
        }

        let done = false;
        const unsub = events.onNewMessage(() => {
            if (!done) {
                done = true;
                clearTimeout(timer);
                unsub();
                query().then(rows => res.json(rows)).catch(() => res.json([]));
            }
        });

        const timer = setTimeout(() => {
            if (!done) {
                done = true;
                unsub();
                res.json([]);
            }
        }, 25000);

        req.on('close', () => {
            if (!done) { done = true; clearTimeout(timer); unsub(); }
        });

    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM messages WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/all', async (req, res) => {
    try {
        await db.query('DELETE FROM messages');
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// --- 投递日志 ---

router.get('/:id/deliveries', async (req, res) => {
    try {
        const [rows] = await db.query(
            'SELECT id, channel_type, channel_name, status, http_status, error_msg, duration_ms, created_at FROM delivery_logs WHERE message_id = ? ORDER BY id ASC',
            [req.params.id]
        );
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
