const express = require('express');
const router = express.Router();
const db = require('../db');
const pusher = require('../services/pusher');

// --- 推送通道管理 ---

router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT * FROM push_channels ORDER BY id DESC');
        const channels = rows.map(row => {
            if (typeof row.config === 'string') {
                try { row.config = JSON.parse(row.config); } catch (e) {}
            }
            return row;
        });
        res.json(channels);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
    const { name, type, config, template } = req.body;
    try {
        await db.query('INSERT INTO push_channels (name, type, config, template) VALUES (?, ?, ?, ?)', [name, type, JSON.stringify(config), template || null]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
    const { name, type, config, template } = req.body;
    try {
        await db.query('UPDATE push_channels SET name=?, type=?, config=?, template=? WHERE id=?', [name, type, JSON.stringify(config), template || null, req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM push_channels WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/test', async (req, res) => {
    try {
        const { type, config, template } = req.body || {};
        if (!type || !config) return res.status(400).json({ error: '缺少 type 或 config' });

        const notif = {
            title: '测试通知 - aPush',
            message: `这是一条用于验证通道配置的测试通知（时间：${new Date().toLocaleString()}）`,
            appID: 'apush_test',
            appName: 'aPush',
            icon: ''
        };
        // 有自定义模板则传入，否则 sendWithConfig 走默认模板
        const result = await pusher.sendWithConfig(type, config, notif, '测试通知', null, {}, template || null);
        res.json({ success: true, result: result || null });
    } catch (e) {
        console.error('通道测试失败:', e);
        res.status(500).json({ error: e.message || '测试失败' });
    }
});

module.exports = router;
