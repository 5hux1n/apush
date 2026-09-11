const mysql = require('mysql2/promise');
const config = require('./config');

// 创建连接池
const pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4', // 强制字符集，支持 Emoji
    timezone: '+08:00', // 强制东八区，或者使用 'Z' (UTC) 根据需求调整
    dateStrings: true   // 建议开启：返回时间字符串而不是 Date 对象，避免自动时区转换困扰
});

// 启动时进行一次连接测试
(async () => {
    try {
        const connection = await pool.getConnection();
        console.log(`✅ [Database] 成功连接到数据库: ${config.db.database} @ ${config.db.host}`);
        connection.release();
    } catch (err) {
        console.error('❌ [Database] 数据库连接失败:');
        console.error(`   代码: ${err.code}`);
        console.error(`   信息: ${err.message}`);
        // 数据库连不上，服务启动没有意义
        process.exit(1); 
    }
})();

module.exports = pool;