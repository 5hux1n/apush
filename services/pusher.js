const axios = require('axios');
const crypto = require('crypto');
const { sendMail } = require('./mailer');
const { render, DEFAULT_TEMPLATES } = require('./template');
const { formatDate, safeParse } = require('../utils');

const escapeHtml = (str) => {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};

// 按 corpid 缓存 token
const wecomTokenCache = {};

/**
 * 解析模板：规则模板 > 通道模板 > 默认模板
 * msgtype 用于 wecom/wecom-bot/dingtalk 区分消息子类型
 */
const resolveTemplate = (channelType, channelTemplate, ruleTemplate, msgtype) => {
    if (ruleTemplate) return ruleTemplate;
    if (channelTemplate) return channelTemplate;
    if (msgtype) {
        const typed = DEFAULT_TEMPLATES[channelType + '-' + msgtype];
        if (typed !== undefined) return typed;
    }
    return DEFAULT_TEMPLATES[channelType] || null;
};

const pusher = {
    async getWeComToken(corpId, secret) {
        const now = Date.now() / 1000;
        const cacheKey = `${corpId}:${secret}`;
        const entry = wecomTokenCache[cacheKey];
        if (entry && entry.token && now < entry.expire) return entry.token;
        try {
            const res = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpId}&corpsecret=${secret}`);
            if (res.data.errcode === 0) {
                wecomTokenCache[cacheKey] = { token: res.data.access_token, expire: now + 7000 };
                return res.data.access_token;
            }
            console.error('获取企业微信Token失败:', res.data);
        } catch (e) {
            console.error('企业微信Token网络错误:', e.message);
        }
        return null;
    },

    // channelId, notif, ruleName, messageId, pushParams, ruleTemplate
    async send(channelId, notif, ruleName, messageId, pushParams, ruleTemplate) {
        const db = require('../db');
        const [rows] = await db.query('SELECT * FROM push_channels WHERE id = ?', [channelId]);
        if (rows.length === 0) return { success: false, error: '通道不存在', duration_ms: 0 };

        const channel = rows[0];
        const channelConfig = (typeof channel.config === 'string') ? JSON.parse(channel.config) : channel.config;
        const start = Date.now();

        // 模板变量上下文
        const ctx = {
            ...notif,
            message: notif.message,
            source_id: notif.source_id || '',
            rule_name: ruleName,
            created_at: formatDate(),
            metadata_json: JSON.stringify(notif.metadata || {})
        };

        const wecomMsgtype = channelConfig.wecom_msgtype || 'textcard';
        const tpl = resolveTemplate(channel.type, channel.template, ruleTemplate,
            channel.type === 'wecom' ? wecomMsgtype : (channel.type === 'wecom-bot' || channel.type === 'dingtalk' ? channelConfig.msgtype : null));

        const deliver = async () => {
            switch (channel.type) {
                case 'bark':
                    {
                        const key = channelConfig.bark_key;
                        if (!key) throw new Error('缺少 bark_key');
                        const barkServer = channelConfig.server_url || 'https://api.day.app';

                        const tplJson = tpl || DEFAULT_TEMPLATES.bark;
                        let payload;
                        try {
                            payload = JSON.parse(render(tplJson, notif, { rule_name: ruleName, source_id: channel.source_id }));
                        } catch (e) {
                            payload = { title: notif.title, body: notif.message, group: notif.appName };
                        }
                        Object.keys(payload).forEach(k => {
                            if (payload[k] === '' || payload[k] === null || payload[k] === undefined) delete payload[k];
                        });

                        try {
                            await axios.post(`${barkServer}/${key}`, payload);
                        } catch (errPost) {
                            const t = encodeURIComponent(payload.title || '');
                            const b = encodeURIComponent(payload.body || '');
                            const qs = [];
                            for (const [k, v] of Object.entries(payload)) {
                                if (k === 'title' || k === 'body') continue;
                                qs.push(`${k}=${encodeURIComponent(String(v))}`);
                            }
                            const query = qs.length > 0 ? '?' + qs.join('&') : '';
                            await axios.get(`${barkServer}/${key}/${t}/${b}${query}`);
                        }
                    }
                    break;

                case 'wecom':
                    {
                        const msgtype = wecomMsgtype;
                        const token = await pusher.getWeComToken(channelConfig.corp_id, channelConfig.secret);
                        if (!token) throw new Error('获取企业微信 token 失败');
                        const ctx = { rule_name: ruleName, source_id: channel.source_id };

                        const baseBody = {
                            touser: channelConfig.user_id || '@all',
                            msgtype,
                            agentid: parseInt(channelConfig.agent_id) || 0,
                        };

                        if (msgtype === 'text') {
                            const text = render(tpl, notif, ctx);
                            baseBody.text = { content: text };
                        } else if (msgtype === 'markdown') {
                            const md = render(tpl, notif, ctx);
                            baseBody.markdown = { content: md };
                        } else if (msgtype === 'news') {
                            const newsTpl = tpl || DEFAULT_TEMPLATES['wecom-news'];
                            let articles;
                            try {
                                const raw = JSON.parse(render(newsTpl, notif, ctx));
                                articles = raw.articles || [raw];
                            } catch (e) {
                                articles = [{ title: notif.title || notif.appName, description: notif.message || '', url: notif.url || '' }];
                            }
                            baseBody.news = { articles };
                        } else {
                            // textcard (默认)
                            const descBody = tpl ? render(tpl, notif, ctx) : notif.message;
                            const desc = `<div class="gray">${formatDate()}</div> <div class="normal">${descBody}</div><div class="highlight">来源: ${escapeHtml(notif.appName)}</div>`;
                            baseBody.textcard = {
                                title: notif.title || notif.appName,
                                description: desc,
                                url: pushParams.url || notif.url || 'https://apush.cn',
                                btntxt: '查看详情'
                            };
                        }

                        const res = await axios.post(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, baseBody);
                        if (res.data && res.data.errcode !== 0) throw new Error('errcode=' + res.data.errcode);
                    }
                    break;

                case 'webhook':
                    {
                        const webhookUrl = channelConfig.webhook_url;
                        if (!webhookUrl) throw new Error('缺少 webhook_url');
                        const body = tpl ? JSON.parse(render(tpl, notif, { rule_name: ruleName, source_id: channel.source_id })) : {
                            title: notif.title,
                            content: notif.message,
                            app: notif.appName,
                            metadata: notif.metadata || {},
                            time: new Date().toISOString()
                        };
                        await axios.post(webhookUrl, body);
                    }
                    break;

                case 'tg':
                    {
                        const botToken = channelConfig.bot_token;
                        const chatId = channelConfig.chat_id;
                        if (!botToken || !chatId) throw new Error('缺少 bot_token 或 chat_id');
                        const text = render(tpl, notif, { rule_name: ruleName, source_id: channel.source_id });
                        await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                            chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true
                        });
                    }
                    break;

                case 'wecom-bot':
                    {
                        const webhookUrl = channelConfig.webhook_url;
                        if (!webhookUrl) throw new Error('缺少 webhook_url');
                        const botMsgtype = channelConfig.msgtype || 'text';
                        const content = render(tpl, notif, { rule_name: ruleName, source_id: channel.source_id });
                        const payload = botMsgtype === 'markdown'
                            ? { msgtype: 'markdown', markdown: { content } }
                            : { msgtype: 'text', text: { content } };
                        const res = await axios.post(webhookUrl, payload);
                        if (res.data && res.data.errcode !== 0) throw new Error('errcode=' + res.data.errcode);
                    }
                    break;

                case 'dingtalk':
                    {
                        const webhookUrl = channelConfig.webhook_url;
                        if (!webhookUrl) throw new Error('缺少 webhook_url');
                        const secret = channelConfig.secret;
                        let url = webhookUrl;
                        if (secret) {
                            const ts = Date.now();
                            const sign = crypto.createHmac('sha256', secret).update(ts + '\n' + secret).digest('base64');
                            url = `${webhookUrl}&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
                        }
                        const dMsgtype = channelConfig.msgtype || 'markdown';
                        const text = render(tpl, notif, { rule_name: ruleName, source_id: channel.source_id });
                        const dingPayload = dMsgtype === 'text'
                            ? { msgtype: 'text', text: { content: text } }
                            : { msgtype: 'markdown', markdown: { title: notif.title || notif.appName, text } };
                        const res = await axios.post(url, dingPayload);
                        if (res.data && res.data.errcode !== 0) throw new Error('errcode=' + res.data.errcode);
                    }
                    break;

                case 'email':
                    {
                        const { smtp_host, smtp_port, smtp_user, smtp_pass, to } = channelConfig;
                        if (!smtp_host || !smtp_user || !smtp_pass || !to) throw new Error('SMTP 配置不完整');
                        const subject = notif.title || notif.appName;
                        const html = render(tpl, notif, { rule_name: ruleName, source_id: channel.source_id });
                        await sendMail({ host: smtp_host, port: parseInt(smtp_port) || 465, user: smtp_user, pass: smtp_pass, from: smtp_user, to, subject, html });
                    }
                    break;

                case 'feishu':
                    {
                        const webhookUrl = channelConfig.webhook_url;
                        if (!webhookUrl) throw new Error('缺少 webhook_url');
                        const contentBody = tpl ? render(tpl, notif, { rule_name: ruleName, source_id: channel.source_id }) : (notif.message || '无内容');
                        const res = await axios.post(webhookUrl, {
                            msg_type: 'interactive',
                            card: {
                                header: { title: { tag: 'plain_text', content: notif.title || notif.appName }, template: 'blue' },
                                elements: [
                                    { tag: 'div', text: { tag: 'lark_md', content: contentBody } },
                                    { tag: 'hr' },
                                    { tag: 'note', elements: [{ tag: 'plain_text', content: `${formatDate()} · 来源: ${notif.appName}` }] }
                                ]
                            }
                        });
                        if (res.data && res.data.StatusCode !== 0) throw new Error('StatusCode=' + res.data.StatusCode);
                    }
                    break;
            }
        };

        try {
            await deliver();
            return { success: true, error: null, duration_ms: Date.now() - start };
        } catch (e) {
            const errMsg = e.response?.data ? JSON.stringify(e.response.data) : e.message;
            return { success: false, error: errMsg, duration_ms: Date.now() - start };
        }
    },

    // 测试发送 (customTpl 来自用户自定义模板，优先级高于默认)
    async sendWithConfig(type, channelConfig, notif, ruleName, logId, pushParams, customTpl) {
        const tpl = customTpl || DEFAULT_TEMPLATES[type] || null;
        const start = Date.now();

        const deliver = async () => {
            switch (type) {
                case 'bark':
                    {
                        const key = channelConfig.bark_key;
                        if (!key) throw new Error('缺少 bark_key');
                        const barkServer = channelConfig.server_url || 'https://api.day.app';

                        const tplJson = tpl || DEFAULT_TEMPLATES.bark;
                        let payload;
                        try {
                            payload = JSON.parse(render(tplJson, notif, { rule_name: ruleName || '测试', source_id: 'test' }));
                        } catch (e) {
                            payload = { title: notif.title, body: notif.message, group: notif.appName };
                        }
                        Object.keys(payload).forEach(k => {
                            if (payload[k] === '' || payload[k] === null || payload[k] === undefined) delete payload[k];
                        });

                        try {
                            await axios.post(`${barkServer}/${key}`, payload);
                        } catch (errPost) {
                            const t = encodeURIComponent(payload.title || '');
                            const b = encodeURIComponent(payload.body || '');
                            const qs = [];
                            for (const [k, v] of Object.entries(payload)) {
                                if (k === 'title' || k === 'body') continue;
                                qs.push(`${k}=${encodeURIComponent(String(v))}`);
                            }
                            const query = qs.length > 0 ? '?' + qs.join('&') : '';
                            await axios.get(`${barkServer}/${key}/${t}/${b}${query}`);
                        }
                    }
                    break;

                case 'wecom':
                    {
                        const msgtype = channelConfig.wecom_msgtype || 'textcard';
                        const token = await pusher.getWeComToken(channelConfig.corp_id, channelConfig.secret);
                        if (!token) throw new Error('获取企业微信 token 失败');
                        const ctx = { rule_name: ruleName || '测试', source_id: 'test' };

                        const baseBody = {
                            touser: channelConfig.user_id || '@all',
                            msgtype,
                            agentid: parseInt(channelConfig.agent_id) || 0,
                        };

                        if (msgtype === 'text') {
                            const text = tpl ? render(tpl, notif, ctx) : notif.message;
                            baseBody.text = { content: text };
                        } else if (msgtype === 'markdown') {
                            const md = tpl ? render(tpl, notif, ctx) : notif.message;
                            baseBody.markdown = { content: md };
                        } else if (msgtype === 'news') {
                            const newsTpl = tpl || DEFAULT_TEMPLATES['wecom-news'];
                            let articles;
                            try {
                                const raw = JSON.parse(render(newsTpl, notif, ctx));
                                articles = raw.articles || [raw];
                            } catch (e) {
                                articles = [{ title: notif.title || notif.appName, description: notif.message || '', url: notif.url || '' }];
                            }
                            baseBody.news = { articles };
                        } else {
                            const descBody = tpl ? render(tpl, notif, ctx) : notif.message;
                            const desc = `<div class="gray">${formatDate()}</div> <div class="normal">${descBody}</div><div class="highlight">来源: ${escapeHtml(notif.appName)}</div>`;
                            baseBody.textcard = {
                                title: notif.title || notif.appName,
                                description: desc,
                                url: pushParams.url || notif.url || 'https://apush.cn',
                                btntxt: '查看详情'
                            };
                        }

                        const res = await axios.post(`https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${token}`, baseBody);
                        if (res.data && res.data.errcode !== 0) throw new Error('errcode=' + res.data.errcode);
                    }
                    break;

                case 'tg':
                    {
                        const token = channelConfig.bot_token;
                        const chatId = channelConfig.chat_id;
                        if (!token || !chatId) throw new Error('缺少 bot_token 或 chat_id');
                        const text = render(tpl, notif, { rule_name: ruleName || '测试', source_id: 'test' });
                        const res = await axios.post(`https://api.telegram.org/bot${token}/sendMessage`, {
                            chat_id: chatId, text, parse_mode: 'HTML', disable_web_page_preview: true
                        });
                        if (res.data && res.data.ok) return { ok: true };
                        throw new Error('Telegram 返回异常');
                    }

                case 'wecom-bot':
                    {
                        if (!channelConfig.webhook_url) throw new Error('缺少 webhook_url');
                        const botMsgtype = channelConfig.msgtype || 'text';
                        const content = render(tpl, notif, { rule_name: ruleName || '测试', source_id: 'test' });
                        const payload = botMsgtype === 'markdown'
                            ? { msgtype: 'markdown', markdown: { content } }
                            : { msgtype: 'text', text: { content } };
                        const res = await axios.post(channelConfig.webhook_url, payload);
                        if (res.data && res.data.errcode === 0) return { ok: true };
                        throw new Error('errcode=' + (res.data?.errcode));
                    }

                case 'dingtalk':
                    {
                        if (!channelConfig.webhook_url) throw new Error('缺少 webhook_url');
                        let url = channelConfig.webhook_url;
                        if (channelConfig.secret) {
                            const ts = Date.now();
                            const sign = crypto.createHmac('sha256', channelConfig.secret).update(ts + '\n' + channelConfig.secret).digest('base64');
                            url = `${channelConfig.webhook_url}&timestamp=${ts}&sign=${encodeURIComponent(sign)}`;
                        }
                        const dMsgtype = channelConfig.msgtype || 'markdown';
                        const text = render(tpl, notif, { rule_name: ruleName || '测试', source_id: 'test' });
                        const dingPayload = dMsgtype === 'text'
                            ? { msgtype: 'text', text: { content: text } }
                            : { msgtype: 'markdown', markdown: { title: notif.title || '测试', text } };
                        const res = await axios.post(url, dingPayload);
                        if (res.data && res.data.errcode === 0) return { ok: true };
                        throw new Error('errcode=' + (res.data?.errcode));
                    }

                case 'email':
                    {
                        const { smtp_host, smtp_port, smtp_user, smtp_pass, to } = channelConfig;
                        if (!smtp_host || !smtp_user || !smtp_pass || !to) throw new Error('SMTP 配置不完整');
                        const subject = notif.title || notif.appName;
                        const html = render(tpl, notif, { rule_name: ruleName || '测试', source_id: 'test' });
                        await sendMail({ host: smtp_host, port: parseInt(smtp_port) || 465, user: smtp_user, pass: smtp_pass, from: smtp_user, to, subject, html });
                        return { ok: true };
                    }

                case 'feishu':
                    {
                        if (!channelConfig.webhook_url) throw new Error('缺少 webhook_url');
                        const contentBody = render(tpl, notif, { rule_name: ruleName || '测试', source_id: 'test' });
                        const res = await axios.post(channelConfig.webhook_url, {
                            msg_type: 'interactive',
                            card: {
                                header: { title: { tag: 'plain_text', content: notif.title || notif.appName }, template: 'blue' },
                                elements: [
                                    { tag: 'div', text: { tag: 'lark_md', content: contentBody } },
                                    { tag: 'hr' },
                                    { tag: 'note', elements: [{ tag: 'plain_text', content: `${formatDate()} · 来源: ${notif.appName}` }] }
                                ]
                            }
                        });
                        if (res.data && res.data.StatusCode === 0) return { ok: true };
                        throw new Error('StatusCode=' + res.data.StatusCode);
                    }

                case 'webhook':
                    {
                        if (!channelConfig.webhook_url) throw new Error('缺少 webhook_url');
                        const body = tpl ? JSON.parse(render(tpl, notif, { rule_name: ruleName || '测试', source_id: 'test' })) : {
                            title: notif.title, content: notif.message, app: notif.appName, time: new Date().toISOString()
                        };
                        await axios.post(channelConfig.webhook_url, body);
                        return { ok: true };
                    }

                default:
                    throw new Error('不支持的通道类型: ' + type);
            }
        };

        try {
            await deliver();
            return { ok: true };
        } catch (e) {
            throw e;
        }
    }
};

module.exports = pusher;
