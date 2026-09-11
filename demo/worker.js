/**
 * demo/worker.js — aPush 官方 Demo (Cloudflare Worker)
 *
 * 只读演示：
 *  - GET  /api/manager/*   → 返回快照数据（形状与真实接口一致）
 *  * 所有写操作             → 403 demo_readonly（边缘强制，前端拦不住也白搭）
 *  - POST /api/manager/simulate → 跑真实管线（解析→规则→模板），不落库、不投递
 *  - 其余请求               → Cloudflare Assets 托管的静态前端 (public/)
 */

import { buildSnapshot } from './data.mjs';
import { simulate } from './engine.mjs';

const J = (obj, status = 200) => new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
});

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function handleApi(request, url, env) {
    const p = url.pathname;
    const method = request.method.toUpperCase();
    const snap = buildSnapshot();

    // ---- 认证：demo 免密直入 ----
    if (p === '/api/manager/check' && method === 'GET') {
        return J({ ok: true, needPassword: false, demo: true });
    }
    if (p === '/api/manager/auth' && method === 'POST') {
        return J({ ok: true, token: null });
    }

    // ---- 模拟推送（demo 唯一允许的"写"，纯内存 dry-run）----
    if (p === '/api/manager/simulate' && method === 'POST') {
        let body = {};
        try { body = await request.json(); } catch (e) {}
        try {
            return J(simulate(body, snap));
        } catch (e) {
            return J({ error: 'simulate_failed', msg: String(e && e.message || e) }, 500);
        }
    }

    // ---- 其余写操作一律拒绝 ----
    if (method !== 'GET') {
        return J({ error: 'demo_readonly', msg: '演示模式为只读：不能增删改数据。试试右下角「🧪 模拟推送」。' }, 403);
    }

    // ---- 只读数据接口（响应形状与真实路由一致）----
    if (p === '/api/manager' && method === 'GET') return J(snap.stats);
    if (p === '/api/manager/stats')         return J(snap.stats);
    if (p === '/api/manager/sources')       return J(snap.sources);
    if (p === '/api/manager/channels')      return J(snap.channels);
    if (p === '/api/manager/rules')         return J(snap.rules);
    if (p === '/api/manager/system-logs')   return J(snap.systemLogs);

    if (p === '/api/manager/messages') {
        // 前端长轮询：hold ~20s 返回空数组，避免 demo 端被轮询打爆
        if (url.searchParams.get('wait') === '1') {
            await sleep(20000);
            return J([]);
        }
        const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 200);
        const afterId = parseInt(url.searchParams.get('after_id')) || 0;
        let list = snap.messages;
        if (afterId > 0) list = list.filter(m => m.id > afterId).reverse();
        return J(list.slice(0, limit));
    }

    const dm = p.match(/^\/api\/manager\/messages\/(\d+)\/deliveries$/);
    if (dm) return J(snap.deliveriesByMsg[dm[1]] || []);

    return J({ error: 'not_found' }, 404);
}

export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname.startsWith('/api/')) {
            try {
                return await handleApi(request, url, env);
            } catch (e) {
                return J({ error: 'demo_error', msg: String(e && e.message || e) }, 500);
            }
        }
        // 静态资源：管理前端 + 资源文件（wrangler Assets 绑定）
        return env.ASSETS.fetch(request);
    },
};
