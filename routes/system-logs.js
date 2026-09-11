const express = require('express');
const router = express.Router();
const syslog = require('../services/syslog');

router.get('/', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const minLevel = req.query.level || null;
    res.json(syslog.getLogs(limit, minLevel));
});

module.exports = router;
