/**
 * 自动解析引擎 — 将任意格式的入站数据映射为 aPush 标准字段
 *
 * 字段别名表（按优先级匹配）：
 *   title   ← title / text / subject / caption / name / summary
 *   content ← content / desp / body / message / text / description / data / msg
 *   appName ← appName / app_name / sender / from / source / app
 *   appId   ← appID / app_id / bundleId / package / appId
 *   url     ← url / link / href / source_url
 *   icon    ← icon / logo / image / avatar / icon_url
 *
 * 未匹配的键值对全部存入 metadata JSON。
 * 特殊键名 'metadata' 本身的值深度合并到 metadata 中。
 */

const ALIAS = {
    title:  ['title','text','subject','caption','name','summary'],
    content:['content','desp','body','message','text','description','data','msg'],
    appName:['appName','app_name','sender','from','source','app'],
    appId:  ['appID','app_id','bundleId','package','appId'],
    url:    ['url','link','href','source_url'],
    icon:   ['icon','logo','image','avatar','icon_url']
};

// 需要从 metadata 中排除的键（已经被映射到标准字段，不必重复保留）
const MAPPED_KEYS = new Set(
    Object.values(ALIAS).flat()
);

/**
 * 从键值对对象中自动提取标准字段
 * @param {Object} kv — 扁平的键值对 { key: value }
 * @returns {{ title, content, appName, appId, url, icon, metadata }}
 */
function parse(kv) {
    if (!kv || typeof kv !== 'object') {
        return { title:'', content: String(kv||''), appName:'', appId:'', url:'', icon:'', metadata:{} };
    }

    const result = { title:'', content:'', appName:'', appId:'', url:'', icon:'', metadata:{} };

    const findValue = (aliases) => {
        for (const a of aliases) {
            if (kv[a] !== undefined && kv[a] !== null && kv[a] !== '') {
                return kv[a];
            }
        }
        return null;
    };

    result.title   = findValue(ALIAS.title)   || '';
    result.content = findValue(ALIAS.content) || '';
    result.appName = findValue(ALIAS.appName) || '';
    result.appId   = findValue(ALIAS.appId)   || '';
    result.url     = findValue(ALIAS.url)     || '';
    result.icon    = findValue(ALIAS.icon)    || '';

    // 剩余字段存入 metadata
    for (const [k, v] of Object.entries(kv)) {
        if (MAPPED_KEYS.has(k)) continue;
        // 如果调用方传了 metadata 对象，深度合并
        if (k === 'metadata' && typeof v === 'object' && v !== null && !Array.isArray(v)) {
            Object.assign(result.metadata, v);
        } else {
            result.metadata[k] = v;
        }
    }

    return result;
}

module.exports = { parse, MAPPED_KEYS };
