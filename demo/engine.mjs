/**
 * demo/engine.mjs — aPush 核心管线的纯函数移植（供 demo Worker 使用）
 *
 * 逻辑与 services/parser.js + services/filterEngine.js + services/template.js
 * 保持一致，但零 DB 依赖：数据从快照注入，跑完只返回结果，不落库、不投递。
 */

// ---------- utils ----------
export const safeParse = (data, defaultVal) => {
    if (!data) return defaultVal;
    if (typeof data === 'object') return data;
    try { return JSON.parse(data); } catch (e) { return defaultVal; }
};
const escapeRegExp = (str) => String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const formatDate = () => {
    const d = new Date();
    return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
};

// ---------- parser (services/parser.js 移植) ----------
const ALIAS = {
    title:  ['title','text','subject','caption','name','summary'],
    content:['content','desp','body','message','text','description','data','msg'],
    appName:['appName','app_name','sender','from','source','app'],
    appId:  ['appID','app_id','bundleId','package','appId'],
    url:    ['url','link','href','source_url'],
    icon:   ['icon','logo','image','avatar','icon_url']
};
const MAPPED_KEYS = new Set(Object.values(ALIAS).flat());

export function parseInbound(kv) {
    if (!kv || typeof kv !== 'object') {
        return { title:'', content: String(kv||''), appName:'', appId:'', url:'', icon:'', metadata:{} };
    }
    const result = { title:'', content:'', appName:'', appId:'', url:'', icon:'', metadata:{} };
    const findValue = (aliases) => {
        for (const a of aliases) {
            if (kv[a] !== undefined && kv[a] !== null && kv[a] !== '') return kv[a];
        }
        return null;
    };
    result.title   = findValue(ALIAS.title)   || '';
    result.content = findValue(ALIAS.content) || '';
    result.appName = findValue(ALIAS.appName) || '';
    result.appId   = findValue(ALIAS.appId)   || '';
    result.url     = findValue(ALIAS.url)     || '';
    result.icon    = findValue(ALIAS.icon)    || '';
    for (const [k, v] of Object.entries(kv)) {
        if (MAPPED_KEYS.has(k)) continue;
        if (k === 'metadata' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
            Object.assign(result.metadata, v);
        } else {
            result.metadata[k] = v;
        }
    }
    return result;
}

// ---------- template (services/template.js 移植) ----------
export function render(template, notif, opts = {}) {
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
    result = result.replace(/\{\{metadata\.(\w+)\}\}/g, (_, key) =>
        (notif.metadata && notif.metadata[key] !== undefined) ? String(notif.metadata[key]) : '');
    result = result.replace(/\{\{(\w+)\}\}/g, (_, key) =>
        vars[key] !== undefined ? String(vars[key]) : `{{${key}}}`);
    return result;
}

export const DEFAULT_TEMPLATES = {
    bark: JSON.stringify({ title:'{{title}}', body:'{{content}}', group:'{{app_name}}', icon:'{{icon}}', url:'{{url}}', isArchive:1, level:'active' }),
    wecom: null,
    'wecom-text': '{{title}}\n\n{{content}}',
    'wecom-markdown': '## {{title}}\n\n{{content}}\n\n> {{app_name}} · {{created_at}}',
    'wecom-textcard': null,
    'wecom-news': JSON.stringify({ articles:[{ title:'{{title}}', description:'{{content}}', url:'{{url}}', picurl:'{{icon}}' }] }),
    'wecom-bot': '{{title}}\n\n{{content}}\n\n{{app_name}} · {{created_at}}',
    'wecom-bot-markdown': '## {{title}}\n\n{{content}}\n\n> {{app_name}} · {{created_at}}',
    dingtalk: '## {{title}}\n\n{{content}}\n\n---\n{{app_name}} · {{created_at}}',
    'dingtalk-text': '{{title}}\n\n{{content}}\n\n{{app_name}} · {{created_at}}',
    feishu: null,
    tg: '<b>{{title}}</b>\n\n{{content}}\n\n<i>{{app_name}} · {{created_at}}</i>',
    email: '<h3>{{title}}</h3>\n<p>{{content}}</p>\n<hr>\n<small>{{app_name}} · {{created_at}}</small>',
    webhook: JSON.stringify({ title:'{{title}}', content:'{{content}}', app_name:'{{app_name}}', app_id:'{{app_id}}', url:'{{url}}', metadata:'{{metadata_json}}', time:'{{created_at}}' })
};

// 规则模板 > 通道模板 > 默认模板 (pusher.resolveTemplate 移植)
function resolveTemplate(channelType, channelTemplate, ruleTemplate, msgtype) {
    if (ruleTemplate) return ruleTemplate;
    if (channelTemplate) return channelTemplate;
    if (msgtype) {
        const typed = DEFAULT_TEMPLATES[channelType + '-' + msgtype];
        if (typed !== undefined) return typed;
    }
    return DEFAULT_TEMPLATES[channelType] || null;
}

// ---------- filter (services/filterEngine.js 匹配段移植) ----------
const getSourceValue = (notif, source) => {
    if (!source) return '';
    if (source === 'rawBody') return notif.rawBody || '';
    if (source.startsWith('metadata.')) {
        const key = source.substring(9);
        try { return JSON.stringify(notif.metadata?.[key] || '').replace(/^"|"$/g, ''); }
        catch { return String(notif.metadata?.[key] || ''); }
    }
    const fieldMap = { title:'title', message:'message', content:'message', appName:'appName', appID:'appID', url:'url' };
    return notif[fieldMap[source] || source] || '';
};
const setTargetValue = (notif, target, value) => {
    const fieldMap = { title:'title', message:'message', content:'message', appName:'appName', appID:'appID', url:'url' };
    notif[fieldMap[target] || 'message'] = value;
};

export function matchAndRewrite(notif, rules, sourceId, now = new Date()) {
    const fullText = `[${notif.appName}] ${notif.title} ${notif.message}`.toLowerCase();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    const currentDay = now.getDay();
    const trace = [];
    let matchedRule = null;

    for (const rule of rules.filter(r => r.is_active)) {
        const t = { rule: rule.name, pass: false, reason: '' };
        if (rule.source_id !== '*' && String(rule.source_id) !== String(sourceId)) { t.reason = '来源不匹配'; trace.push(t); continue; }
        const activeDays = (rule.active_days || '1,2,3,4,5,6,0').split(',').map(Number);
        if (!activeDays.includes(currentDay)) { t.reason = '不在生效星期'; trace.push(t); continue; }
        const timeRange = safeParse(rule.time_range, null);
        if (timeRange && timeRange.start && timeRange.end) {
            const [sH, sM] = timeRange.start.split(':').map(Number);
            const [eH, eM] = timeRange.end.split(':').map(Number);
            const sMin = sH * 60 + sM, eMin = eH * 60 + eM;
            const inRange = sMin <= eMin
                ? !(currentMin < sMin || currentMin > eMin)
                : !(currentMin < sMin && currentMin > eMin);
            if (!inRange) { t.reason = '不在生效时间段'; trace.push(t); continue; }
        }
        const keywords = rule.keywords || [];
        if (keywords.length > 0) {
            const isRegex = rule.use_regex === 1 || rule.use_regex === true;
            const hitWords = [];
            const results = keywords.map(kw => {
                let hit;
                if (isRegex) { try { hit = new RegExp(kw.word, 'i').test(fullText); } catch { hit = false; } }
                else hit = fullText.includes(String(kw.word).toLowerCase());
                if (hit) hitWords.push(kw.word);
                return hit;
            });
            const isMatch = rule.logic_type === 'AND' ? results.every(Boolean) : results.some(Boolean);
            if (!isMatch) { t.reason = `关键词未命中 (${rule.logic_type})`; trace.push(t); continue; }
            t.hitWords = hitWords;
        }
        t.pass = true;
        trace.push(t);
        matchedRule = rule;
        break;
    }

    const before = { title: notif.title, message: notif.message };
    const appliedRewrites = [];
    if (matchedRule) {
        const rewrites = safeParse(matchedRule.rewrite_rules, []);
        for (const rw of rewrites) {
            if (!rw.source || !rw.target) continue;
            try {
                const sourceVal = getSourceValue(notif, rw.source);
                if (!sourceVal) continue;
                let result;
                if (rw.match) {
                    const isRegex = rw.use_regex !== false;
                    const regex = isRegex
                        ? new RegExp(rw.match, rw.use_regex_flags || 'i')
                        : new RegExp(escapeRegExp(rw.match), 'ig');
                    result = String(sourceVal).replace(regex, rw.replace || '');
                } else result = sourceVal;
                setTargetValue(notif, rw.target, result);
                appliedRewrites.push({ type: 'extract', desc: `${rw.source} → ${rw.target}`, from: String(sourceVal).slice(0, 200), to: String(result).slice(0, 200) });
            } catch (e) { appliedRewrites.push({ type: 'extract', error: e.message }); }
        }
        for (const rw of rewrites) {
            if (rw.source) continue;
            try {
                const regex = new RegExp(rw.use_regex ? rw.match : escapeRegExp(rw.match), 'gi');
                if (notif.title) notif.title = notif.title.replace(regex, rw.replace);
                if (notif.message) notif.message = notif.message.replace(regex, rw.replace);
                appliedRewrites.push({ type: 'clean', desc: `清洗: ${rw.match} ⇒ ${rw.replace}` });
            } catch (e) { appliedRewrites.push({ type: 'clean', error: e.message }); }
        }
    }
    return { matchedRule, trace, appliedRewrites, before };
}

// ---------- 完整管线模拟（不落库、不投递） ----------
export function simulate(body, snap) {
    // sourceId 语义与 webhook.js 一致：source.path || 'default'
    let src;
    if (body.source_id != null && body.source_id !== '') {
        const want = String(body.source_id);
        src = snap.sources.find(s => (s.path || 'default') === want) || snap.sources.find(s => String(s.id) === want);
    }
    if (!src) src = snap.sources[0];
    const srcId = src ? (src.path || 'default') : 'default';
    const payload = body.payload || {};
    const rawStr = typeof payload === 'string' ? payload : JSON.stringify(payload);

    let notif;
    if (src && src.parser_mode === 'raw') {
        notif = { title:'', message: rawStr, appName:'App', appID:'Unknown', url:'', icon:'', metadata:{}, rawBody: rawStr };
    } else {
        const parsed = parseInbound(payload);
        notif = {
            title: String(parsed.title || '').slice(0, 500),
            message: String(parsed.content || '').slice(0, 10000),
            appName: String(parsed.appName || 'App'),
            appID: String(parsed.appId || 'Unknown'),
            url: parsed.url || '', icon: parsed.icon || '',
            metadata: parsed.metadata, rawBody: rawStr
        };
    }

    const { matchedRule, trace, appliedRewrites, before } = matchAndRewrite(notif, snap.rules, srcId);

    const deliveries = [];
    if (matchedRule) {
        const targetIds = safeParse(matchedRule.target_channel_ids, []);
        const channelTemplates = safeParse(matchedRule.channel_templates, {});
        for (const id of targetIds) {
            const ch = snap.channels.find(c => String(c.id) === String(id));
            if (!ch) continue;
            const cfg = safeParse(ch.config, {});
            const msgtype = ch.type === 'wecom' ? (cfg.wecom_msgtype || 'textcard')
                : (ch.type === 'wecom-bot' || ch.type === 'dingtalk' ? cfg.msgtype : null);
            const ruleTpl = channelTemplates[id] || null;
            const tpl = resolveTemplate(ch.type, ch.template || null, ruleTpl, msgtype);
            const rendered = render(tpl || '', notif, { source_id: srcId, rule_name: matchedRule.name, created_at: formatDate() });
            let payloadPreview = rendered;
            try { payloadPreview = JSON.parse(rendered); } catch (e) {}
            deliveries.push({
                channel_id: ch.id, channel_name: ch.name, channel_type: ch.type,
                template_source: ruleTpl ? '规则模板' : (ch.template ? '通道模板' : '默认模板'),
                msgtype: msgtype || (ch.type === 'wecom' ? 'textcard' : null),
                payload: payloadPreview
            });
        }
    }

    return {
        source: { id: src && src.id, name: src && src.name, parser_mode: src && src.parser_mode },
        parsed: { title: notif.title, content: notif.message, app_name: notif.appName, app_id: notif.appID, url: notif.url, metadata: notif.metadata },
        rewritten: { before, after: { title: notif.title, message: notif.message }, rules: appliedRewrites },
        matching: { trace, matched: matchedRule ? { name: matchedRule.name, logic_type: matchedRule.logic_type } : null },
        action: matchedRule ? 'forwarded' : 'blocked',
        deliveries
    };
}
