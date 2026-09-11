const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
    try {
        const [rows] = await db.query('SELECT id, name, path, parser_mode, auth_token, created_at FROM sources');
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/', async (req, res) => {
    const { name, path, parser_mode, auth_token } = req.body;
    try {
        await db.query(
            'INSERT INTO sources (name, path, parser_mode, auth_token) VALUES (?, ?, ?, ?)',
            [name, path || '', parser_mode || 'auto', auth_token || '']
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
    const { name, path, parser_mode, auth_token } = req.body;
    try {
        await db.query(
            'UPDATE sources SET name=?, path=?, parser_mode=?, auth_token=? WHERE id=?',
            [name, path || '', parser_mode || 'auto', auth_token || '', req.params.id]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM sources WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
