require('dotenv').config();

// 检查必要的环境变量
const requiredEnv = ['DB_USER', 'DB_PASS', 'DB_NAME'];
const missingEnv = requiredEnv.filter(key => !process.env[key]);

if (missingEnv.length > 0) {
    console.error(`❌ [Config Error] 缺少必要的环境变量: ${missingEnv.join(', ')}`);
    console.error(`💡 请复制 .env.example 为 .env 并填写相应配置`);
    process.exit(1); // 配置错误直接退出，避免启动半吊子服务
}

const config = {
    // 服务端口
    port: parseInt(process.env.PORT, 10) || 25717,

    // 管理界面访问密码 (留空=不启用)
    authPassword: process.env.AUTH_PASSWORD || '',

    // 数据库配置
    db: {
        host: process.env.DB_HOST || '127.0.0.1', // 默认本机
        port: parseInt(process.env.DB_PORT, 10) || 3306,
        user: process.env.DB_USER,      // 必须通过 .env 提供
        password: process.env.DB_PASS,  // 必须通过 .env 提供
        database: process.env.DB_NAME,  // 必须通过 .env 提供
    }
};

module.exports = config;