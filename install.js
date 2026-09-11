// aPush 安装引导脚本
// 用法: node install.js
// 读取 .env 中的数据库配置，自动建表并插入默认数据

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const DB = {
    host: process.env.DB_HOST || '127.0.0.1',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
};

if (!DB.user || !DB.password || !DB.database) {
    console.error('❌ 请先配置 .env 文件中的 DB_USER / DB_PASS / DB_NAME');
    process.exit(1);
}

(async () => {
    let conn;
    try {
        // 1. 先连接 MySQL（不指定数据库），确保库存在
        conn = await mysql.createConnection({
            host: DB.host, port: DB.port,
            user: DB.user, password: DB.password,
            charset: 'utf8mb4',
        });
        console.log(`✅ 已连接到 MySQL (${DB.host}:${DB.port})`);

        await conn.query(
            `CREATE DATABASE IF NOT EXISTS \`${DB.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
        );
        console.log(`✅ 数据库 \`${DB.database}\` 已就绪`);

        await conn.query(`USE \`${DB.database}\``);

        // 2. 读取 schema.sql，替换硬编码库名为实际库名，跳过建库/选库语句
        const schemaPath = path.join(__dirname, 'schema.sql');
        let schema = fs.readFileSync(schemaPath, 'utf8');
        // 将 schema.sql 中所有 `apush` 替换为 .env 里的实际数据库名
        schema = schema.replace(/`apush`/g, `\`${DB.database}\``);
        schema = schema.replace(/\bapush\b/g, DB.database);

        const statements = schema
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .filter(s => !/^(CREATE DATABASE|USE|DROP DATABASE)/i.test(s));

        for (const stmt of statements) {
            await conn.query(stmt);
        }
        console.log('✅ 数据表已创建');

        // 3. 写入默认来源（不存在则插入）
        const [existing] = await conn.query('SELECT id FROM sources WHERE path = ?', ['']);
        if (existing.length === 0) {
            await conn.query(
                "INSERT INTO sources (name, path, parser_mode) VALUES (?, '', 'auto')",
                ['默认来源']
            );
            console.log('✅ 已创建默认来源 (path=空, 接收所有未匹配的请求)');
        }

        console.log('\n========================================');
        console.log('  🎉 aPush 安装完成！');
        console.log(`  数据库: ${DB.database}`);
        console.log('  启动服务: node server.js');
        console.log('========================================\n');

    } catch (err) {
        console.error(`❌ 安装失败: ${err.message}`);
        if (err.code === 'ECONNREFUSED') {
            console.error('   无法连接 MySQL，请检查 DB_HOST / DB_PORT 是否正确');
        } else if (err.code === 'ER_ACCESS_DENIED_ERROR') {
            console.error('   用户名或密码错误，请检查 DB_USER / DB_PASS');
        }
        process.exit(1);
    } finally {
        if (conn) await conn.end();
    }
})();
