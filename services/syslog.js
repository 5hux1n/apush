// 系统运行日志 — 环形缓冲区，记录关键事件
const MAX = 500;

const levels = { info: '信息', warn: '警告', error: '错误' };

const buffer = [];

function push(level, msg, detail) {
    const entry = {
        level,
        msg,
        detail: detail || '',
        time: new Date().toISOString()
    };
    buffer.unshift(entry);
    if (buffer.length > MAX) buffer.length = MAX;
    return entry;
}

function info(msg, detail)  { return push('info',  msg, detail); }
function warn(msg, detail)  { return push('warn',  msg, detail); }
function error(msg, detail) { return push('error', msg, detail); }

function getLogs(limit = 100, minLevel) {
    let list = buffer;
    if (minLevel) {
        const order = { error: 0, warn: 1, info: 2 };
        list = buffer.filter(e => order[e.level] <= (order[minLevel] || 2));
    }
    return list.slice(0, limit);
}

module.exports = { info, warn, error, getLogs };
