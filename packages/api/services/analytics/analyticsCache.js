const crypto = require('crypto');

/**
 * In-memory query cache. Mirrors services/ai/core/aiCache.js -- Map, SHA-256
 * key, TTL, FIFO eviction -- because there is no reason for a second caching
 * idiom in this codebase.
 *
 * The key is the SQL text plus its parameter values. The SQL already encodes the
 * caller's permission-filtered metric set, so no separate user dimension is
 * needed: two users who may see the same numbers get the same statement, and
 * two who may not cannot produce the same one.
 *
 * 60 seconds: long enough to absorb a board's render storm and a user flipping
 * between tabs, short enough that a sale made at the counter shows up while the
 * cashier is still standing there. Tiles report their cache age and offer a
 * refresh, so a stale figure is visibly stale rather than quietly wrong.
 */
class AnalyticsCache {
    constructor(ttlMs = 60 * 1000, maxEntries = 200) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.cache = new Map();
    }

    static key(text, values) {
        return crypto.createHash('sha256').update(`${text}::${JSON.stringify(values)}`).digest('hex');
    }

    get(key) {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }
        return { value: entry.value, ageMs: Date.now() - entry.storedAt };
    }

    set(key, value) {
        if (value === undefined || value === null) return;
        if (this.cache.size >= this.maxEntries) {
            const oldest = this.cache.keys().next().value;
            if (oldest !== undefined) this.cache.delete(oldest);
        }
        this.cache.set(key, { value, storedAt: Date.now(), expiresAt: Date.now() + this.ttlMs });
    }

    setTtl(ttlMs) {
        if (Number.isFinite(ttlMs) && ttlMs >= 0) this.ttlMs = ttlMs;
    }

    clear() {
        this.cache.clear();
    }
}

module.exports = new AnalyticsCache();
module.exports.AnalyticsCache = AnalyticsCache;
