/**
 * 简易内存缓存，支持 TTL 过期
 */
class Cache {
    constructor(ttlMs = 30000) {
        this.ttl = ttlMs;
        this.store = new Map();
    }

    get(key) {
        const entry = this.store.get(key);
        if (!entry) return undefined;
        if (Date.now() > entry.expireAt) {
            this.store.delete(key);
            return undefined;
        }
        return entry.value;
    }

    set(key, value) {
        this.store.set(key, {
            value,
            expireAt: Date.now() + this.ttl
        });
    }

    del(key) {
        this.store.delete(key);
    }
}

module.exports = Cache;
