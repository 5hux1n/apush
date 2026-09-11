/**
 * 安全解析 JSON，失败时返回默认值
 */
const safeParse = (data, defaultVal) => {
    if (!data) return defaultVal;
    if (typeof data === 'object') return data;
    try { return JSON.parse(data); } catch (e) { return defaultVal; }
};

/**
 * 按点号路径从对象中取值
 */
const getValue = (obj, path) => {
    if (!path) return undefined;
    return path.split('.').reduce((acc, part) => acc && acc[part], obj);
};

/**
 * 转义正则特殊字符
 */
const escapeRegExp = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 格式化日期为 MM-DD HH:mm
 */
const formatDate = () => {
    const d = new Date();
    return `${d.getMonth() + 1}-${d.getDate()} ${d.getHours()}:${d.getMinutes()}`;
};

module.exports = { safeParse, getValue, escapeRegExp, formatDate };
