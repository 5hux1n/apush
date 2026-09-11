const express = require('express');
const router = express.Router();
const db = require('../db');

// --- 统计数据 ---

router.get('/', async (req, res) => {
    try {
        const [todayCount] = await db.query('SELECT COUNT(*) as count FROM messages WHERE DATE(created_at) = CURDATE()');
        const [blockCount] = await db.query("SELECT COUNT(*) as count FROM messages WHERE DATE(created_at) = CURDATE() AND action = 'blocked'");
        const [topApp] = await db.query('SELECT app_name, COUNT(*) as count FROM messages GROUP BY app_name ORDER BY count DESC LIMIT 1');
        const [lastLog] = await db.query("SELECT created_at FROM messages WHERE action = 'forwarded' ORDER BY created_at DESC LIMIT 1");

        res.json({
            today_total: todayCount[0].count,
            today_blocked: blockCount[0].count,
            top_app: topApp[0] ? topApp[0].app_name : '无',
            last_push: lastLog[0] ? lastLog[0].created_at : null
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
