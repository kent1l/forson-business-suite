/**
 * Per-model 429 / 5xx rate-limit cooldown and deprecation tracker.
 */
class CircuitBreaker {
    constructor() {
        this.rateLimitedUntil = new Map(); // key -> timestamp
        this.deprecatedModels = new Set();  // key -> boolean
    }

    _getKey(provider, model) {
        if (!provider) return String(model);
        return `${provider}:${model}`;
    }

    /**
     * Triggers a cool-down for a specific provider and model candidate.
     */
    triggerCooldown(provider, model, durationMs = 60000) {
        const key = this._getKey(provider, model);
        const until = Date.now() + durationMs;
        this.rateLimitedUntil.set(key, until);
        if (model) {
            this.rateLimitedUntil.set(model, until);
        }
        console.warn(`[CircuitBreaker] Cooldown triggered for ${key} until ${new Date(until).toISOString()}`);
    }

    /**
     * Checks if candidate model is currently in cooldown.
     */
    isCoolingDown(provider, model) {
        const now = Date.now();
        const key = this._getKey(provider, model);
        const untilKey = this.rateLimitedUntil.get(key);
        if (untilKey && untilKey > now) return true;

        if (model) {
            const untilModel = this.rateLimitedUntil.get(model);
            if (untilModel && untilModel > now) return true;
        }

        return false;
    }

    getCooldownUntil(provider, model) {
        const key = this._getKey(provider, model);
        return this.rateLimitedUntil.get(key) || (model ? this.rateLimitedUntil.get(model) : undefined) || 0;
    }

    /**
     * Marks a model as permanently deprecated/unsupported (e.g. HTTP 404).
     */
    markDeprecated(provider, model) {
        const key = this._getKey(provider, model);
        this.deprecatedModels.add(key);
        if (model) {
            this.deprecatedModels.add(model);
        }
        console.error(`[CircuitBreaker] Model marked as deprecated: ${key}`);
    }

    /**
     * Checks if a model is deprecated.
     */
    isDeprecated(provider, model) {
        const key = this._getKey(provider, model);
        return this.deprecatedModels.has(key) || (model ? this.deprecatedModels.has(model) : false);
    }

    /**
     * Clears all cooldowns and deprecations (useful for tests).
     */
    reset() {
        this.rateLimitedUntil.clear();
        this.deprecatedModels.clear();
    }
}

const circuitBreakerInstance = new CircuitBreaker();
module.exports = circuitBreakerInstance;
