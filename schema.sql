-- aPush 数据库初始化脚本
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS apush DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE apush;

-- 推送来源配置 (简化版)
CREATE TABLE IF NOT EXISTS sources (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL COMMENT '来源名称',
    path VARCHAR(64) DEFAULT '' COMMENT 'URL 路径标识，空串=默认来源',
    parser_mode ENUM('auto','raw') NOT NULL DEFAULT 'auto' COMMENT '解析模式: auto=自动解析, raw=仅存raw_body',
    auth_token VARCHAR(128) DEFAULT '' COMMENT '鉴权Token，留空=不验证',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 推送通道
CREATE TABLE IF NOT EXISTS push_channels (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL COMMENT '通道名称',
    type VARCHAR(32) NOT NULL COMMENT '通道类型: bark|wecom|wecom-bot|dingtalk|feishu|tg|email|webhook',
    config JSON NOT NULL COMMENT '通道配置 JSON',
    template TEXT COMMENT '自定义消息模板 (空则使用通道默认模板)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 转发规则
CREATE TABLE IF NOT EXISTS rules (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(128) NOT NULL COMMENT '规则名称',
    source_id VARCHAR(64) DEFAULT '*' COMMENT '来源过滤，* 表示所有',
    target_channel_ids JSON COMMENT '目标通道 ID 数组',
    channel_templates JSON COMMENT '规则级别的通道模板覆盖 {channelId: template}',
    time_range JSON COMMENT '生效时间段 {start, end}',
    active_days VARCHAR(32) DEFAULT '1,2,3,4,5,6,0' COMMENT '生效星期 0=周日',
    logic_type VARCHAR(8) DEFAULT 'AND' COMMENT '关键词逻辑 AND|OR',
    use_regex TINYINT(1) DEFAULT 0 COMMENT '关键词是否正则',
    rewrite_rules JSON COMMENT '内容提取/清洗规则 [{source, match, replace, target, use_regex}]',
    is_active TINYINT(1) DEFAULT 0 COMMENT '是否启用',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 规则关联关键词
CREATE TABLE IF NOT EXISTS keywords (
    id INT AUTO_INCREMENT PRIMARY KEY,
    rule_id INT NOT NULL,
    word VARCHAR(256) NOT NULL COMMENT '关键词或正则表达式',
    is_active TINYINT(1) DEFAULT 1,
    FOREIGN KEY (rule_id) REFERENCES rules(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 消息记录
CREATE TABLE IF NOT EXISTS messages (
    id INT AUTO_INCREMENT PRIMARY KEY,
    source_id VARCHAR(64) NOT NULL COMMENT '来源标识',
    title VARCHAR(512) COMMENT '消息标题 (解析后)',
    content TEXT COMMENT '消息正文 (解析后)',
    app_name VARCHAR(128) COMMENT '自动识别到的应用名',
    app_id VARCHAR(256) COMMENT '自动识别到的应用ID',
    url VARCHAR(2048) COMMENT '关联链接',
    metadata JSON COMMENT '原始数据中未被映射的字段，完整保留',
    raw_body TEXT COMMENT '原始请求体，完整保留',
    icon_base64 TEXT COMMENT '图标 (data URI 或 URL)',
    rule_name VARCHAR(128) COMMENT '命中的规则名，NULL 表示被拦截',
    action ENUM('forwarded','blocked') NOT NULL DEFAULT 'blocked' COMMENT '处理动作',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_source (source_id),
    INDEX idx_rule (rule_name),
    INDEX idx_action (action),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 投递日志
CREATE TABLE IF NOT EXISTS delivery_logs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message_id INT NOT NULL COMMENT '关联消息 ID',
    channel_id INT COMMENT '通道 ID',
    channel_type VARCHAR(32) NOT NULL COMMENT '通道类型',
    channel_name VARCHAR(128) COMMENT '通道名称 (快照)',
    status ENUM('success','failed') NOT NULL COMMENT '投递结果',
    http_status INT COMMENT 'HTTP 状态码',
    error_msg TEXT COMMENT '错误信息',
    duration_ms INT COMMENT '耗时(毫秒)',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    INDEX idx_message (message_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 持久化应用资产
CREATE TABLE IF NOT EXISTS apps (
    id INT AUTO_INCREMENT PRIMARY KEY,
    app_id VARCHAR(256) NOT NULL UNIQUE,
    name VARCHAR(256),
    logo_url VARCHAR(512),
    source VARCHAR(32) DEFAULT 'manual' COMMENT '来源 itunes|manual',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
