/**
 * 消息模板引擎 — 将 {{变量}} 替换为 notification 中的实际值
 *
 * 可用变量：
 *   {{title}}         消息标题
 *   {{content}}       消息正文
 *   {{app_name}}      应用名
 *   {{app_id}}        应用 ID
 *   {{source_id}}     来源标识
 *   {{url}}           关联链接
 *   {{icon}}          图标
 *   {{metadata.xxx}}  metadata 中的字段
 *   {{metadata_json}} metadata 完整 JSON
 *   {{created_at}}    接收时间 (渲染时传入)
 *   {{rule_name}}     命中规则名 (渲染时传入)
 */

const { formatDate } = require('../utils');

const render = (template, notif, opts = {}) => {
    if (!template) return '';

    const vars = {
        ...opts,
        title: notif.title || '',
        content: notif.message || '',
        app_name: notif.appName || '',
        app_id: notif.appID || '',
        source_id: opts.source_id || '',
        url: notif.url || '',
        icon: notif.icon || '',
        metadata_json: JSON.stringify(notif.metadata || {}),
        created_at: opts.created_at || formatDate(),
        rule_name: opts.rule_name || ''
    };

    let result = template;

    // 先替换 metadata.xxx
    result = result.replace(/\{\{metadata\.(\w+)\}\}/g, (_, key) => {
        if (notif.metadata && notif.metadata[key] !== undefined) {
            return String(notif.metadata[key]);
        }
        return '';
    });

    // 替换标准变量
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key) => {
        if (vars[key] !== undefined) return String(vars[key]);
        return `{{${key}}}`;
    });

    return result;
};

/**
 * 各通道类型的默认模板
 */
const DEFAULT_TEMPLATES = {
    // Bark: JSON payload → 渲染后 parse 为对象 POST 到 Bark 服务端
    // 可用字段: title, body, sound, icon, group, url, isArchive, automaticallyCopy, copy, level, badge
    bark: JSON.stringify({
        title: '{{title}}',
        body: '{{content}}',
        group: '{{app_name}}',
        icon: '{{icon}}',
        url: '{{url}}',
        isArchive: 1,
        level: 'active'
    }),

	// 企业微信应用消息: 按 msgtype 提供不同默认模板
    // textcard = 卡片 (当前默认), text = 纯文本, markdown = 富文本, news = 图文
    wecom: null, // 兼容旧配置 (无 msgtype 时等同 textcard)
    'wecom-text': [
        '{{title}}',
        '',
        '{{content}}'
    ].join('\n'),
    'wecom-markdown': [
        '## {{title}}',
        '',
        '{{content}}',
        '',
        '> {{app_name}} · {{created_at}}'
    ].join('\n'),
    'wecom-textcard': null, // textcard 有固定 title/description/url 结构
    'wecom-news': JSON.stringify({
        articles: [{
            title: '{{title}}',
            description: '{{content}}',
            url: '{{url}}',
            picurl: '{{icon}}'
        }]
    }),

    'wecom-bot': [
        '{{title}}',
        '',
        '{{content}}',
        '',
        '{{app_name}} · {{created_at}}'
    ].join('\n').replace(/^\n+/, ''),
    // 企业微信机器人 markdown
    'wecom-bot-markdown': [
        '## {{title}}',
        '',
        '{{content}}',
        '',
        '> {{app_name}} · {{created_at}}'
    ].join('\n'),

    dingtalk: [
        '## {{title}}',
        '',
        '{{content}}',
        '',
        '---',
        '{{app_name}} · {{created_at}}'
    ].join('\n'),
    // 钉钉纯文本
    'dingtalk-text': [
        '{{title}}',
        '',
        '{{content}}',
        '',
        '{{app_name}} · {{created_at}}'
    ].join('\n'),

    // 飞书卡片: 模板只控制 elements 中的正文内容
    feishu: null,

    tg: [
        '<b>{{title}}</b>',
        '',
        '{{content}}',
        '',
        '<i>{{app_name}} · {{created_at}}</i>'
    ].join('\n'),

    email: [
        '<h3>{{title}}</h3>',
        '<p>{{content}}</p>',
        '<hr>',
        '<small>{{app_name}} · {{created_at}}</small>'
    ].join('\n'),

    webhook: JSON.stringify({
        title: '{{title}}',
        content: '{{content}}',
        app_name: '{{app_name}}',
        app_id: '{{app_id}}',
        url: '{{url}}',
        metadata: '{{metadata_json}}',
        time: '{{created_at}}'
    })
};

module.exports = { render, DEFAULT_TEMPLATES };
