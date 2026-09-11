// 简单的事件总线 — 用于长轮询通知
const listeners = new Set();

function onNewMessage(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

function notify() {
    for (const cb of listeners) {
        try { cb(); } catch (e) {}
    }
}

module.exports = { onNewMessage, notify };
