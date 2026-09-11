/**
 * demo/data.mjs — 演示数据快照
 *
 * 不依赖数据库：所有"库数据"在这里以相对时间偏移定义，
 * buildSnapshot() 在每次请求时按当前时间物化，
 * 所以演示站的数据永远是"新鲜的"（消息都发生在最近几分钟~几天内）。
 */

const fmt = (d) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

// ---- 配置对象 ----
const SOURCES = [
    { id: 1, name: '默认来源',   path: '',        parser_mode: 'auto', auth_token: '' },
    { id: 2, name: 'iPhone 快捷指令', path: 'iphone', parser_mode: 'auto', auth_token: 'demo-tk-9f3a' },
    { id: 3, name: 'NAS 监控',   path: 'nas',     parser_mode: 'raw',  auth_token: '' },
];

const CHANNELS = [
    { id: 1, name: '我的 iPhone (Bark)', type: 'bark',
      config: { server: 'https://api.day.app', bark_key: 'DEMO-REDACTED-KEY' },
      template: null },
    { id: 2, name: '企业微信 · 工作通知', type: 'wecom',
      config: { corpid: 'ww00000000demo', corpsecret: '***', agentid: '1000002', wecom_msgtype: 'text' },
      template: '{{title}}\n\n{{content}}\n\n—— 来自 aPush' },
    { id: 3, name: '钉钉 · 运维告警群', type: 'dingtalk',
      config: { webhook_token: 'demo-ding-token', secret: '***', msgtype: 'markdown' },
      template: null },
    { id: 4, name: 'Telegram 频道', type: 'tg',
      config: { bot_token: '1234567:DEMO-REDACTED', chat_id: '@apush_demo' },
      template: null },
    { id: 5, name: '下游服务 (Webhook)', type: 'webhook',
      config: { url: 'https://example.com/hooks/apush' },
      template: null },
];

const RULES = [
    {
        id: 4, name: '营销短信拦截（示例·未启用）', source_id: '*',
        target_channel_ids: [], channel_templates: {},
        time_range: {}, active_days: '1,2,3,4,5,6,0',
        logic_type: 'OR', use_regex: 0, rewrite_rules: [], is_active: 0,
        keywords: [{ id: 20, word: '退订回T', is_active: 1 }],
    },
    {
        id: 3, name: '部署与 CI 通知', source_id: '*',
        target_channel_ids: [2, 4], channel_templates: {},
        time_range: {}, active_days: '1,2,3,4,5,6,0',
        logic_type: 'OR', use_regex: 1, rewrite_rules: [], is_active: 1,
        keywords: [{ id: 15, word: 'deploy|部署|构建|build', is_active: 1 }],
    },
    {
        id: 2, name: 'NAS 系统告警', source_id: 'nas',
        target_channel_ids: [1, 3], channel_templates: {},
        time_range: { start: '', end: '' }, active_days: '1,2,3,4,5,6,0',
        logic_type: 'OR', use_regex: 0, rewrite_rules: [], is_active: 1,
        keywords: [],
    },
    {
        id: 1, name: '短信验证码直达', source_id: 'iphone',
        target_channel_ids: [1],
        channel_templates: { '1': JSON.stringify({ title: '🔐 {{app_name}} 验证码', body: '{{content}}', group: '验证码', sound: 'bell', level: 'timeSensitive', url: '{{url}}', isArchive: 1 }) },
        time_range: {}, active_days: '1,2,3,4,5,6,0',
        logic_type: 'OR', use_regex: 0, is_active: 1,
        rewrite_rules: [
            { source: 'message', match: '.*?(\\d{6}).*', replace: '$1', target: 'message', use_regex: true, use_regex_flags: 'is' },
        ],
        keywords: [{ id: 11, word: '验证码', is_active: 1 }, { id: 12, word: 'code', is_active: 1 }],
    },
];

// ---- 消息流水（offset_min = 距"现在"多少分钟前）----
const MESSAGES = [
    { off: 3,    src: 'iphone', app: '信息',        appid: 'com.apple.MobileSMS',   title: '【支付宝】登录验证码 382915', c: '您正在支付宝登录，验证码 382915，5 分钟内有效，请勿泄露。', rule: '短信验证码直达', act: 'forwarded', dl: [{ch:1,dur:86}] },
    { off: 17,   src: 'nas', app: 'NAS',         appid: 'Synology',              title: '硬盘 2 SMART 预警', c: 'Disk 2 (ST4000) 出现 3 个重映射扇区，建议尽快备份。', rule: 'NAS 系统告警', act: 'forwarded', dl: [{ch:1,dur:74},{ch:3,dur:1204,err:'钉钉机器人签名校验失败，请检查密钥配置',st:'failed'}] },
    { off: 41,   src: 'iphone', app: '信息',        appid: 'com.apple.MobileSMS',   title: '【微信】验证码 662148', c: '662148 是您的微信登录验证码，5 分钟内有效。如非本人操作请忽略。', rule: '短信验证码直达', act: 'forwarded', dl: [{ch:1,dur:65}] },
    { off: 58,   src: 'default', app: 'GitHub Actions', appid: 'github-actions',     title: 'apush@main 部署成功', c: 'Run #284 成功 (2m14s)，已发布 v1.0.0。', rule: '部署与 CI 通知', act: 'forwarded', dl: [{ch:2,dur:310},{ch:4,dur:980}] },
    { off: 96,   src: 'default', app: '天气助手',     appid: 'com.demo.weather',      title: '明日有暴雨', c: '北京明日 18:00 起暴雨，请注意出行。', rule: null, act: 'blocked', dl: [] },
    { off: 122,  src: 'iphone', app: '信息',        appid: 'com.apple.MobileSMS',   title: '【京东】验证码 104238', c: '您的验证码为 104238，用于登录京东 App。', rule: '短信验证码直达', act: 'forwarded', dl: [{ch:1,dur:71}] },
    { off: 160,  src: 'nas', app: 'NAS',         appid: 'Synology',              title: '存储池降级', c: 'StoragePool1 已降级，RAID 冗余丢失。', rule: 'NAS 系统告警', act: 'forwarded', dl: [{ch:1,dur:69},{ch:3,dur:1180}] },
    { off: 233,  src: 'iphone', app: '日历',        appid: 'com.apple.CalendarMobile', title: '19:30 周会提醒', c: '产品周会 19:30 · 3 号楼会议室', rule: null, act: 'blocked', dl: [] },
    { off: 305,  src: 'default', app: '快递100',     appid: 'kuaidi100',             title: '包裹已签收', c: 'SF1324***78 已签收，感谢使用顺丰。', rule: null, act: 'blocked', dl: [] },
    { off: 480,  src: 'default', app: '营销短信',     appid: 'unknown',              title: '年终大促！点击领取优惠券', c: '尊享年终大促，回复T退订', rule: null, act: 'blocked', dl: [] },
    { off: 640,  src: 'iphone', app: '信息',        appid: 'com.apple.MobileSMS',   title: '【招商银行】验证码 559023', c: '转账验证码 559023，有效期 10 分钟，切勿告知他人。', rule: '短信验证码直达', act: 'forwarded', dl: [{ch:1,dur:78}] },
    { off: 810,  src: 'default', app: 'GitHub Actions', appid: 'github-actions',     title: 'notifier@dev 构建失败', c: 'Run #283 失败：npm test exit 1', rule: '部署与 CI 通知', act: 'forwarded', dl: [{ch:2,dur:295},{ch:4,dur:1002}] },
    { off: 1450, src: 'nas', app: 'NAS',         appid: 'Synology',              title: '备份任务完成', c: 'HyperBackup 任务 #12 完成，增量 1.2GB。', rule: 'NAS 系统告警', act: 'forwarded', dl: [{ch:1,dur:66},{ch:3,dur:1105}] },
    { off: 1720, src: 'default', app: 'App Store',   appid: 'com.apple.AppStore',    title: '应用更新：Things 3', c: 'Your apps have been updated.', rule: null, act: 'blocked', dl: [] },
    { off: 2100, src: 'iphone', app: '信息',        appid: 'com.apple.MobileSMS',   title: '【12306】车票已兑现', c: '您的订单 G102 09-25 已出票成功。', rule: null, act: 'blocked', dl: [] },
    { off: 2600, src: 'default', app: '服务器监控',   appid: 'prometheus',            title: 'CPU 使用率超阈值 90%', c: 'host: vps-02 持续 5 分钟 CPU>90%', rule: null, act: 'blocked', dl: [] },
    { off: 3200, src: 'iphone', app: '信息',        appid: 'com.apple.MobileSMS',   title: '【淘宝】验证码 736102', c: '短信验证码 736102', rule: '短信验证码直达', act: 'forwarded', dl: [{ch:1,dur:73}] },
    { off: 4100, src: 'default', app: 'GitHub Actions', appid: 'github-actions',     title: 'apush@main 部署成功', c: 'Run #282 成功，健康检查通过。', rule: '部署与 CI 通知', act: 'forwarded', dl: [{ch:2,dur:302},{ch:4,dur:995}] },
    { off: 5300, src: 'nas', app: 'NAS',         appid: 'Synology',              title: '固件更新可用', c: 'DSM 7.2.2-72806 可更新。', rule: 'NAS 系统告警', act: 'forwarded', dl: [{ch:1,dur:61},{ch:3,dur:1120}] },
    { off: 6600, src: 'default', app: '营销短信',     appid: 'unknown',              title: '积分即将过期提醒', c: '您的 3200 积分将于本周末过期，回复T退订', rule: null, act: 'blocked', dl: [] },
    { off: 8000, src: 'iphone', app: '信息',        appid: 'com.apple.MobileSMS',   title: '【iCloud】Apple ID 登录验证码', c: 'Code: 448201', rule: '短信验证码直达', act: 'forwarded', dl: [{ch:1,dur:82}] },
    { off: 9100, src: 'default', app: '快递100',     appid: 'kuaidi100',             title: '包裹派送中', c: 'JD0512***33 派送中，预计 14:00 前送达。', rule: null, act: 'blocked', dl: [] },
];

const SYSLOG_TPL = [
    { off: 60,  level: 'info',  msg: '服务启动',      detail: '端口 25717 · demo 实例（只读模式）' },
    { off: 3,   level: 'info',  msg: '命中规则',      detail: '[短信验证码直达] 信息: 【支付宝】登录验证码 382915' },
    { off: 17,  level: 'error', msg: '投递失败',      detail: '3: 钉钉机器人签名校验失败，请检查密钥配置' },
    { off: 17,  level: 'info',  msg: '命中规则',      detail: '[NAS 系统告警] NAS: 硬盘 2 SMART 预警' },
    { off: 58,  level: 'info',  msg: '命中规则',      detail: '[短信验证码直达] 信息: 【微信】验证码 662148' },
    { off: 96,  level: 'warn',  msg: '消息被拦截',    detail: '天气助手: 未命中任何规则' },
    { off: 480, level: 'warn',  msg: '消息被拦截',    detail: '营销短信: 未命中任何规则' },
    { off: 810, level: 'info',  msg: '命中规则',      detail: '[部署与 CI 通知] GitHub Actions: notifier@dev 构建失败' },
];

/**
 * 按当前时间物化快照（所有时间戳都"新鲜"）
 */
export function buildSnapshot(nowMs = Date.now()) {
    const now = new Date(nowMs);
    const ago = (min) => fmt(new Date(nowMs - min * 60000));
    const agoIso = (min) => new Date(nowMs - min * 60000).toISOString();

    // 消息：从旧到新编号 id
    const ordered = [...MESSAGES].sort((a, b) => b.off - a.off);
    const messages = [];
    const deliveriesByMsg = {};
    ordered.forEach((m, i) => {
        const id = i + 1;
        messages.push({
            id, source_id: m.src, app_name: m.app, app_id: m.appid,
            title: m.title, content: m.c, url: '',
            metadata: m.appid === 'github-actions' ? { repo: 'apush', run: Math.round(284 - i) } : {},
            rule_name: m.rule, action: m.act, created_at: ago(m.off),
        });
        deliveriesByMsg[id] = m.dl.map((d, j) => {
            const ch = CHANNELS.find(c => c.id === d.ch) || {};
            return {
                id: id * 100 + j, message_id: id, channel_id: d.ch,
                channel_type: ch.type, channel_name: ch.name,
                status: d.st || 'success', http_status: d.st === 'failed' ? 200 : 200,
                error_msg: d.err || null, duration_ms: d.dur, created_at: ago(m.off),
            };
        });
    });

    const todayStr = fmt(now).slice(0, 10);
    const todayMsgs = messages.filter(m => m.created_at.startsWith(todayStr));
    const forwarded = messages.filter(m => m.action === 'forwarded').sort((a, b) => b.created_at.localeCompare(a.created_at));
    const appCount = {};
    messages.forEach(m => { appCount[m.app_name] = (appCount[m.app_name] || 0) + 1; });
    const topApp = Object.entries(appCount).sort((a, b) => b[1] - a[1])[0];

    return {
        sources: SOURCES.map(s => ({ ...s, created_at: ago(14400) })),
        channels: CHANNELS.map(c => ({ ...c, config: c.config, created_at: ago(14400), updated_at: ago(2880) })),
        rules: RULES.map(r => ({
            ...r,
            target_channel_ids: r.target_channel_ids,
            channel_templates: r.channel_templates,
            time_range: r.time_range,
            rewrite_rules: r.rewrite_rules,
            created_at: ago(14400), updated_at: ago(2880),
        })),
        messages: [...messages].reverse(), // 前端按最新在前
        deliveriesByMsg,
        stats: {
            today_total: todayMsgs.length,
            today_blocked: todayMsgs.filter(m => m.action === 'blocked').length,
            top_app: topApp ? topApp[0] : '无',
            last_push: forwarded[0] ? forwarded[0].created_at : null,
        },
        systemLogs: SYSLOG_TPL.map(e => ({ level: e.level, msg: e.msg, detail: e.detail, time: agoIso(e.off) })),
    };
}
