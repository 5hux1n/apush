const express = require('express');
const router = express.Router();
const db = require('../db');
const filterEngine = require('../services/filterEngine');
const { safeParse } = require('../utils');

const invalidateCache = () => {
    filterEngine.rulesCache.del('active_rules');
    filterEngine.kwCache.store.clear();
};

// --- 规则管理 ---

router.get('/', async (req, res) => {
    try {
        const [rules] = await db.query('SELECT * FROM rules ORDER BY id DESC');
        for (let rule of rules) {
            const [kws] = await db.query('SELECT * FROM keywords WHERE rule_id = ?', [rule.id]);
            rule.keywords = kws || [];
            rule.target_channel_ids = safeParse(rule.target_channel_ids, []);
            rule.time_range = safeParse(rule.time_range, { start: '', end: '' });
            rule.rewrite_rules = safeParse(rule.rewrite_rules, []);
            rule.channel_templates = safeParse(rule.channel_templates, {});
        }
        res.json(rules);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

router.post('/', async (req, res) => {
    const { name, source_id, time_range, active_days, logic_type, use_regex, target_channel_ids, channel_templates, rewrite_rules } = req.body;
    try {
        const [result] = await db.query(
            'INSERT INTO rules (name, source_id, time_range, active_days, logic_type, use_regex, target_channel_ids, channel_templates, rewrite_rules) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, source_id || '*', JSON.stringify(time_range || {}), active_days || '1,2,3,4,5,6,0', logic_type || 'AND', use_regex ? 1 : 0, JSON.stringify(target_channel_ids || []), JSON.stringify(channel_templates || {}), JSON.stringify(rewrite_rules || [])]
        );
        invalidateCache();
        res.json({ id: result.insertId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
    const { name, source_id, target_apps, time_range, active_days, logic_type, use_regex, target_channel_ids, channel_templates, is_active, rewrite_rules } = req.body;
    try {
        await db.query(
            'UPDATE rules SET name=?, source_id=?, time_range=?, active_days=?, logic_type=?, use_regex=?, target_channel_ids=?, channel_templates=?, is_active=?, rewrite_rules=? WHERE id=?',
            [name, source_id, JSON.stringify(time_range || {}), active_days, logic_type, use_regex ? 1 : 0, JSON.stringify(target_channel_ids || []), JSON.stringify(channel_templates || {}), is_active ? 1 : 0, JSON.stringify(rewrite_rules || []), req.params.id]
        );
        invalidateCache();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM rules WHERE id = ?', [req.params.id]);
        invalidateCache();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/duplicate', async (req, res) => {
    try {
        const ruleId = req.params.id;
        const [result] = await db.query(
            `INSERT INTO rules (name, source_id, time_range, active_days, logic_type, use_regex, target_channel_ids, channel_templates, rewrite_rules, is_active)
             SELECT CONCAT('[复刻] ', name), source_id, time_range, active_days, logic_type, use_regex, target_channel_ids, channel_templates, rewrite_rules, 0
             FROM rules WHERE id = ?`,
            [ruleId]
        );
        if (result.affectedRows === 0) return res.status(404).json({ error: '原策略不存在' });

        const newRuleId = result.insertId;
        const [keywords] = await db.query('SELECT word, is_active FROM keywords WHERE rule_id = ?', [ruleId]);
        if (keywords.length > 0) {
            const values = keywords.map(kw => [newRuleId, kw.word, kw.is_active]);
            await db.query('INSERT INTO keywords (rule_id, word, is_active) VALUES ?', [values]);
        }
        invalidateCache();
        res.json({ success: true, newId: newRuleId });
    } catch (e) {
        console.error('复制策略失败:', e);
        res.status(500).json({ error: '复制策略失败: ' + e.message });
    }
});

// --- 关键词管理 ---

router.post('/keywords', async (req, res) => {
    const { rule_id, word } = req.body;
    try {
        const [res_kw] = await db.query('INSERT INTO keywords (rule_id, word) VALUES (?, ?)', [rule_id, word]);
        invalidateCache();
        res.json({ id: res_kw.insertId });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/keywords/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM keywords WHERE id = ?', [req.params.id]);
        invalidateCache();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
