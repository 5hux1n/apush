// 管理界面密码保护中间件
// 支持暴力破解防护：IP 级别限流 + 账号锁定
const crypto = require('crypto');

const tokens = new Map();
const TOKEN_TTL = 24 * 60 * 60 * 1000;

// 暴力破解防护: IP -> {count, lockUntil}
const attempts = new Map();
const MAX_ATTEMPTS = 10;         // 连续错误上限
const LOCK_MINUTES = 15;         // 锁定时长
const CLEANUP_INTERVAL = 600_000; // 10分钟清理过期记录

setInterval(() => {
    const now = Date.now();
    for (const [tok, exp] of tokens) {
        if (now > exp) tokens.delete(tok);
    }
    for (const [ip, rec] of attempts) {
        if (now > rec.lockUntil && now - rec.lastAttempt > CLEANUP_INTERVAL) {
            attempts.delete(ip);
        }
    }
}, 3600_000);

function issueToken() {
    const tok = crypto.randomBytes(32).toString('hex');
    tokens.set(tok, Date.now() + TOKEN_TTL);
    return tok;
}

function validateToken(tok) {
    if (!tok) return false;
    const exp = tokens.get(tok);
    if (!exp || Date.now() > exp) {
        tokens.delete(tok);
        return false;
    }
    tokens.set(tok, Date.now() + TOKEN_TTL);
    return true;
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim()
        || req.headers['x-real-ip']
        || req.socket.remoteAddress
        || 'unknown';
}

function middleware(config) {
    const pwd = config.authPassword;
    if (!pwd) return (req, res, next) => next();

    return (req, res, next) => {
        if (req.path === '/auth' && req.method === 'POST') return next();
        const tok = req.headers['x-auth-token'];
        if (validateToken(tok)) return next();
        res.status(401).json({ error: 'unauthorized', needPassword: true });
    };
}

function loginHandler(config) {
    return (req, res) => {
        const pwd = config.authPassword;
        if (!pwd) return res.json({ ok: true, token: null });

        const ip = getClientIP(req);
        const rec = attempts.get(ip);
        const now = Date.now();

        // 检查是否被锁定
        if (rec && rec.lockUntil > now) {
            const remain = Math.ceil((rec.lockUntil - now) / 60000);
            return res.status(429).json({
                ok: false,
                error: `尝试过多，请 ${remain} 分钟后再试`
            });
        }

        const { password } = req.body || {};
        if (password === pwd) {
            attempts.delete(ip);
            res.json({ ok: true, token: issueToken() });
        } else {
            // 记录失败尝试
            const entry = rec || { count: 0, lastAttempt: 0, lockUntil: 0 };
            entry.count++;
            entry.lastAttempt = now;
            if (entry.count >= MAX_ATTEMPTS) {
                entry.lockUntil = now + LOCK_MINUTES * 60000;
                return res.status(429).json({
                    ok: false,
                    error: `密码错误次数过多，已锁定 ${LOCK_MINUTES} 分钟`
                });
            }
            attempts.set(ip, entry);
            const left = MAX_ATTEMPTS - entry.count;
            res.status(401).json({
                ok: false,
                error: `密码错误，还剩 ${left} 次尝试机会`
            });
        }
    };
}

function checkHandler(config) {
    return (req, res) => {
        if (!config.authPassword) return res.json({ ok: true, needPassword: false });
        const tok = req.headers['x-auth-token'];
        if (validateToken(tok)) return res.json({ ok: true });
        res.status(401).json({ ok: false, needPassword: true });
    };
}

module.exports = { middleware, loginHandler, checkHandler };
