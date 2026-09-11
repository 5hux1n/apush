/**
 * demo/test.mjs — 本地冒烟测试（不需要 wrangler / Cloudflare）
 * 用法: node demo/test.mjs
 */
import worker from './worker.js';

const env = { ASSETS: { fetch: () => new Response('static:'+new URL(event.url).pathname) } };
const call = (path, init) => worker.fetch(new Request('http://demo' + path, init), env);
const J = (p) => call(p).then(async r => ({ status: r.status, body: await r.json() }));

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  ✅', name); }
    else { fail++; console.log('  ❌', name, extra); }
};

console.log('== GET 接口形状 ==');
let r = await J('/api/manager/check');
ok('check → demo:true', r.body.ok === true && r.body.demo === true);

r = await J('/api/manager');
ok('stats 字段齐全', ['today_total','today_blocked','top_app','last_push'].every(k => k in r.body), JSON.stringify(r.body));

r = await J('/api/manager/sources');
ok('sources=3', Array.isArray(r.body) && r.body.length === 3);

r = await J('/api/manager/channels');
ok('channels=5, config 是对象', r.body.length === 5 && typeof r.body[0].config === 'object');

r = await J('/api/manager/rules');
ok('rules=4, keywords 内嵌, JSON 字段已解', r.body.length === 4 && Array.isArray(r.body.find(x=>x.id===1).keywords) && Array.isArray(r.body.find(x=>x.id===1).rewrite_rules));

r = await J('/api/manager/messages?limit=50');
ok('messages 最新在前 & 字段齐全', r.body[0].id > r.body[r.body.length-1].id && 'created_at' in r.body[0] && 'source_id' in r.body[0]);

const firstMsgId = (await J('/api/manager/messages')).body.find(m => m.action === 'forwarded').id;
r = await J(`/api/manager/messages/${firstMsgId}/deliveries`);
ok('deliveries 有数据', Array.isArray(r.body) && r.body.length > 0, 'msg ' + firstMsgId);

r = await J('/api/manager/system-logs');
ok('system-logs 形状 {level,msg,detail,time}', r.body.length > 0 && r.body[0].level && r.body[0].time);

console.log('== 写操作保护 ==');
r = await call('/api/manager/sources', { method: 'POST', body: '{}' });
ok('POST sources → 403', r.status === 403);
r = await call('/api/manager/rules/1', { method: 'PUT', body: '{}' });
ok('PUT rules → 403', r.status === 403);
r = await call('/api/manager/messages/all', { method: 'DELETE' });
ok('DELETE messages → 403', r.status === 403);

console.log('== 模拟推送管线 ==');
r = await call('/api/manager/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    source_id: 'iphone',
    payload: { title: '【支付宝】登录验证码 382915', content: '您正在登录，验证码 382915', appName: '信息', appID: 'com.apple.MobileSMS', device: 'iPhone' }
}) });
let d = await r.json();
ok('验证码命中规则1', d.matching.matched && d.matching.matched.name === '短信验证码直达', JSON.stringify(d.matching));
ok('提取出 6 位码', d.rewritten.after.message === '382915', '→ ' + d.rewritten.after.message);
ok('metadata 含 device', d.parsed.metadata.device === 'iPhone');
ok('Bark 渲染 payload', d.deliveries.length === 1 && d.deliveries[0].payload.body === '382915' && d.deliveries[0].payload.title === '🔐 信息 验证码', JSON.stringify(d.deliveries));
ok('action=forwarded', d.action === 'forwarded');

r = await call('/api/manager/simulate', { method: 'POST', body: JSON.stringify({ source_id: 'iphone', payload: { title: '日历提醒', content: '明早开会', appName: '日历' } }) });
d = await r.json();
ok('非验证码被拦截', d.action === 'blocked' && d.deliveries.length === 0, JSON.stringify(d.matching));

r = await call('/api/manager/simulate', { method: 'POST', body: JSON.stringify({ source_id: 'default', payload: { title: 'apush@main 部署成功', content: 'Run #285', appName: 'GitHub' } }) });
d = await r.json();
ok('CI 通知命中规则3 → 2 通道', d.action === 'forwarded' && d.deliveries.length === 2, JSON.stringify(d.deliveries && d.deliveries.map(x=>x.channel_name)));

r = await call('/api/manager/simulate', { method: 'POST', body: JSON.stringify({ source_id: 'nas', payload: { any: 'raw stuff' } }) });
d = await r.json();
ok('raw 模式命中 NAS 规则', d.action === 'forwarded' && d.deliveries.length === 2);

console.log('== 长轮询 ==');
const t0 = Date.now();
r = await J('/api/manager/messages?wait=1&after_id=99999');
const held = Date.now() - t0;
ok('wait=1 hold ≥ 1s 且返回 []', Array.isArray(r.body) && r.body.length === 0 && held > 1000, held + 'ms');

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
