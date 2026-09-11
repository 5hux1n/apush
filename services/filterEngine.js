const db = require('../db');
const pusher = require('./pusher');
const Cache = require('./cache');
const syslog = require('./syslog');
const events = require('./events');
const { safeParse, escapeRegExp } = require('../utils');

const rulesCache = new Cache(30000);
const kwCache = new Cache(30000);

/**
 * 从 notification 中按 source 取值
 * source 可以是: title, message(content), appName, appID, url, rawBody, metadata.xxx
 */
const getSourceValue = (notif, source) => {
    if (!source) return '';
    if (source === 'rawBody') return notif.rawBody || '';
    if (source.startsWith('metadata.')) {
        const key = source.substring(9);
        try { return JSON.stringify(notif.metadata?.[key] || '').replace(/^"|"$/g, ''); }
        catch { return String(notif.metadata?.[key] || ''); }
    }
    // 标准字段映射
    const fieldMap = { title:'title', message:'message', content:'message', appName:'appName', appID:'appID', url:'url' };
    const prop = fieldMap[source] || source;
    return notif[prop] || '';
};

/**
 * 将替换结果写入 notif 的指定 target
 */
const setTargetValue = (notif, target, value) => {
    const fieldMap = { title:'title', message:'message', content:'message', appName:'appName', appID:'appID', url:'url' };
    const prop = fieldMap[target] || 'message';
    notif[prop] = value;
};

const filterEngine = {
    async process(notif, sourceId) {
        try {
            let rules = rulesCache.get('active_rules');
            if (!rules) {
                const [rows] = await db.query('SELECT * FROM rules WHERE is_active = 1');
                rules = rows;
                rulesCache.set('active_rules', rules);
            }

            const ruleIds = rules.map(r => r.id).filter(id => id != null);
            let keywordsByRule = {};
            if (ruleIds.length > 0) {
                const cacheKey = 'active_kws_' + ruleIds.sort().join(',');
                keywordsByRule = kwCache.get(cacheKey);
                if (!keywordsByRule) {
                    const placeholder = ruleIds.map(() => '?').join(',');
                    const [allKws] = await db.query(
                        `SELECT rule_id, word FROM keywords WHERE rule_id IN (${placeholder}) AND is_active = 1`,
                        ruleIds
                    );
                    keywordsByRule = allKws.reduce((m, k) => {
                        m[k.rule_id] = m[k.rule_id] || [];
                        m[k.rule_id].push(k);
                        return m;
                    }, {});
                    kwCache.set(cacheKey, keywordsByRule);
                }
            }

            const fullText = `[${notif.appName}] ${notif.title} ${notif.message}`.toLowerCase();
            const now = new Date();
            const currentMin = now.getHours() * 60 + now.getMinutes();
            const currentDay = now.getDay();

            let matchedRule = null;

            for (const rule of rules) {
                if (rule.source_id !== '*' && rule.source_id !== sourceId) continue;

                const activeDays = (rule.active_days || '1,2,3,4,5,6,0').split(',').map(Number);
                if (!activeDays.includes(currentDay)) continue;

                const timeRange = safeParse(rule.time_range, null);
                if (timeRange && timeRange.start && timeRange.end) {
                    const [sH, sM] = timeRange.start.split(':').map(Number);
                    const [eH, eM] = timeRange.end.split(':').map(Number);
                    const sMin = sH * 60 + sM;
                    const eMin = eH * 60 + eM;
                    if (sMin <= eMin) {
                        if (currentMin < sMin || currentMin > eMin) continue;
                    } else {
                        if (currentMin < sMin && currentMin > eMin) continue;
                    }
                }

                const keywords = keywordsByRule[rule.id] || [];
                if (keywords.length > 0) {
                    const isRegex = rule.use_regex === 1;
                    const results = keywords.map(kw => {
                        if (isRegex) {
                            try { return new RegExp(kw.word, 'i').test(fullText); } catch (e) { return false; }
                        } else {
                            return fullText.includes(kw.word.toLowerCase());
                        }
                    });
                    const isMatch = rule.logic_type === 'AND' ? results.every(v => v) : results.some(v => v);
                    if (!isMatch) continue;
                }

                matchedRule = rule;
                break;
            }

            // 规则匹配后：先执行字段提取，再执行内容清洗
            if (matchedRule) {
                const rewrites = safeParse(matchedRule.rewrite_rules, []);

                // Phase 1: 字段提取 (有 source 和 target 的规则)
                for (const rw of rewrites) {
                    if (!rw.source || !rw.target) continue;
                    try {
                        const sourceVal = getSourceValue(notif, rw.source);
                        if (!sourceVal) continue;

                        let result;
                        if (rw.match) {
                            const isRegex = rw.use_regex !== false;
                            let regex;
                            if (isRegex) {
                                regex = new RegExp(rw.match, rw.use_regex_flags || 'i');
                            } else {
                                regex = new RegExp(escapeRegExp(rw.match), 'ig');
                            }
                            result = sourceVal.replace(regex, rw.replace || '');
                        } else {
                            result = sourceVal;
                        }
                        setTargetValue(notif, rw.target, result);
                    } catch (e) {
                        console.error(`[Extract] 规则执行失败: ${e.message}`);
                    }
                }

                // Phase 2: 内容清洗 (没有 source 的旧式 rewrite，直接替换 title/message)
                for (const rw of rewrites) {
                    if (rw.source) continue; // 跳过提取规则
                    try {
                        let regex;
                        if (rw.use_regex) {
                            regex = new RegExp(rw.match, 'gi');
                        } else {
                            regex = new RegExp(escapeRegExp(rw.match), 'gi');
                        }
                        if (notif.title) notif.title = notif.title.replace(regex, rw.replace);
                        if (notif.message) notif.message = notif.message.replace(regex, rw.replace);
                    } catch (e) {
                        console.error(`[Rewrite] 规则执行失败: ${e.message}`);
                    }
                }
            }

            let iconBase64 = null;
            if (typeof notif.icon === 'string' && notif.icon.trim() !== '') {
                iconBase64 = notif.icon;
            }

            const [msgRes] = await db.query(
                'INSERT INTO messages (source_id, title, content, app_name, app_id, url, metadata, raw_body, icon_base64, rule_name, action) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                [
                    sourceId,
                    notif.title || '',
                    notif.message || '',
                    notif.appName || '',
                    notif.appID || '',
                    notif.url || '',
                    JSON.stringify(notif.metadata || {}),
                    (notif.rawBody || '').substring(0, 65535),
                    iconBase64,
                    matchedRule ? matchedRule.name : null,
                    matchedRule ? 'forwarded' : 'blocked'
                ]
            );

            // 通知长轮询客户端有新消息
            events.notify();

            if (!matchedRule) {
                syslog.warn('消息被拦截', `${notif.appName}: 未命中任何规则`);
                return;
            }

            syslog.info('命中规则', `[${matchedRule.name}] ${notif.appName}: ${(notif.title || notif.message || '').substring(0, 60)}`);

            const targetChannelIds = safeParse(matchedRule.target_channel_ids, []);
            const channelTemplates = safeParse(matchedRule.channel_templates, {});

            if (targetChannelIds.length > 0) {
                const messageId = msgRes.insertId;
                const results = await Promise.all(
                    targetChannelIds.map(id => {
                        const ruleTemplate = channelTemplates[id] || null;
                        return pusher.send(id, notif, matchedRule.name, messageId, {}, ruleTemplate);
                    })
                );

                const deliveries = results.map((r, i) => ({ channelId: targetChannelIds[i], ...r }));

                if (deliveries.length > 0) {
                    const [channels] = await db.query(
                        'SELECT id, name, type FROM push_channels WHERE id IN (?)',
                        [deliveries.map(d => d.channelId)]
                    );
                    const chanMap = {};
                    channels.forEach(c => { chanMap[c.id] = c; });

                    const values = deliveries.map(d => {
                        const ch = chanMap[d.channelId] || {};
                        return [
                            messageId, d.channelId, ch.type || '', ch.name || '',
                            d.success ? 'success' : 'failed',
                            d.success ? 200 : null,
                            d.error ? d.error.substring(0, 500) : null,
                            d.duration_ms || 0
                        ];
                    });

                    const placeholders = values.map(() => '(?,?,?,?,?,?,?,?)').join(',');
                    await db.query(
                        `INSERT INTO delivery_logs (message_id, channel_id, channel_type, channel_name, status, http_status, error_msg, duration_ms) VALUES ${placeholders}`,
                        values.flat()
                    );

                    // 记录投递结果到系统日志
                    for (const d of deliveries) {
                        if (!d.success) {
                            syslog.error('投递失败', `${d.channelId}: ${d.error || '未知错误'}`);
                        }
                    }
                }
            }

        } catch (e) {
            console.error('引擎处理出错:', e);
        }
    }
};

filterEngine.rulesCache = rulesCache;
filterEngine.kwCache = kwCache;
module.exports = filterEngine;
