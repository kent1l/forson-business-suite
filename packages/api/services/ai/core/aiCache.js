const crypto = require('crypto');

/**
 * In-memory response cache for LLM queries.
 * Prevents redundant API calls for identical prompt inputs within TTL window.
 */
class AICache {
    constructor(ttlMs = 24 * 60 * 60 * 1000, maxEntries = 500) {
        this.ttlMs = ttlMs;
        this.maxEntries = maxEntries;
        this.cache = new Map();
    }

    _hash(prompt, tier = 'default') {
        const str = `${tier}:${typeof prompt === 'string' ? prompt : JSON.stringify(prompt)}`;
        return crypto.createHash('sha256').update(str).digest('hex');
    }

    get(prompt, tier = 'default') {
        const key = this._hash(prompt, tier);
        const entry = this.cache.get(key);
        if (!entry) return null;

        if (Date.now() > entry.expiresAt) {
            this.cache.delete(key);
            return null;
        }

        return entry.value;
    }

    set(prompt, tier = 'default', value) {
        if (!value) return;
        const key = this._hash(prompt, tier);

        if (this.cache.size >= this.maxEntries) {
            // Evict oldest entry
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey) this.cache.delete(oldestKey);
        }

        this.cache.set(key, {
            value,
            expiresAt: Date.now() + this.ttlMs
        });
    }

    clear() {
        this.cache.clear();
    }
}

module.exports = new AICache();
