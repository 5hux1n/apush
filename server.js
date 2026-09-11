const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const config = require('./config');
const auth = require('./services/auth');

const db = require('./db');

const app = express();
const port = config.port;

app.use(cors());
app.use(bodyParser.json({ limit: '20mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Auth: 登录/验证接口不受保护
app.post('/api/manager/auth', auth.loginHandler(config));
app.get('/api/manager/check', auth.checkHandler(config));

// 管理接口密码保护
app.use('/api/manager', auth.middleware(config));

app.use('/api/webhook', require('./routes/webhook'));
app.use('/api/manager/rules', require('./routes/rules'));
app.use('/api/manager/channels', require('./routes/channels'));
app.use('/api/manager/sources', require('./routes/sources'));
app.use('/api/manager/messages', require('./routes/messages'));
app.use('/api/manager/system-logs', require('./routes/system-logs'));
app.use('/api/manager', require('./routes/stats'));

const syslog = require('./services/syslog');

const server = app.listen(port, () => {
    syslog.info('服务启动', `端口 ${port}`);
    console.log(`
    ======================================
    🚀 aPush 系统已就绪
    🔗 服务地址: http://localhost:${config.port}
    📡 监听端口: ${port}
    --------------------------------------
    `);
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

async function shutdown(signal) {
    syslog.info('服务关闭', `收到 ${signal}`);
    console.log(`\n🛑 收到 ${signal}，正在优雅关闭...`);
    server.close(() => console.log('✅ HTTP 服务已关闭'));
    try { await db.end(); console.log('✅ 数据库连接池已释放'); } catch (e) {}
    process.exit(0);
}