'use strict';

/**
 * Minimal server-side Jev decision client.
 *
 * Jev is served through OpenRouter's Decisions API. Supplying the existing
 * server-side OPENROUTER_API_KEY enables it; omitting that key leaves callers
 * on their deterministic local fallback.
 */
class JevClient {
    constructor({ env = process.env, fetchImpl = global.fetch, logger = console } = {}) {
        this.env = env;
        this.fetchImpl = fetchImpl;
        this.logger = logger;
    }

    get config() {
        const timeout = Number(this.env.JEV_TIMEOUT_MS || 3500);
        return {
            apiUrl: String(this.env.OPENROUTER_DECISIONS_URL || 'https://openrouter.ai/api/alpha/decisions').trim(),
            apiKey: String(this.env.OPENROUTER_API_KEY || '').trim(),
            model: String(this.env.JEV_MODEL || 'typesafe/jev-1.13').trim(),
            timeoutMs: Number.isFinite(timeout) ? Math.max(250, Math.min(timeout, 30000)) : 3500,
            enabled: this.env.JEV_ENABLED !== 'false',
        };
    }

    isConfigured() {
        const { apiUrl, apiKey, enabled } = this.config;
        return enabled && Boolean(apiUrl && apiKey && this.fetchImpl);
    }

    // Bump this when the duplicate prompt/criteria below change. Entity scans
    // use it to invalidate only decisions made under an older prompt.
    get duplicateDecisionCacheKey() {
        return { model: this.config.model, promptVersion: 'duplicate-v1' };
    }

    async evaluateDuplicate({ entityType, left, right }) {
        if (!this.isConfigured()) return null;
        const config = this.config;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
        const state = {
            entity_type: entityType,
            left: { name: left.name, code: left.code || null },
            right: { name: right.name, code: right.code || null },
        };

        try {
            const response = await this.fetchImpl(config.apiUrl, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${config.apiKey}`,
                    'Content-Type': 'application/json',
                    Accept: 'application/json',
                    'HTTP-Referer': this.env.OPENROUTER_HTTP_REFERER || 'http://localhost:5173',
                    'X-Title': 'Forson Business Suite',
                },
                signal: controller.signal,
                body: JSON.stringify({
                    model: config.model,
                    state,
                    questions: {
                        duplicate: {
                            type: 'noul',
                            instructions: `Are these two ${entityType} records the same real-world ${entityType}, despite spelling, abbreviation, punctuation, or code variation?`,
                            criteria: {
                                true: 'They identify the same real-world entity and should be reviewed as a possible merge.',
                                false: 'They are distinct entities and must not be merged.',
                            },
                        },
                    },
                }),
            });
            const responseText = await response.text();
            if (!response.ok) {
                const error = new Error(`Jev duplicate decision failed (HTTP ${response.status})`);
                error.status = response.status;
                throw error;
            }
            let payload;
            try { payload = JSON.parse(responseText); }
            catch { throw new Error('Jev duplicate decision returned invalid JSON'); }
            const probability = Number(payload?.answers?.duplicate?.noul);
            if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
                throw new Error('Jev duplicate decision returned an invalid Noul probability');
            }
            return { probability, model: payload.model || config.model };
        } finally {
            clearTimeout(timeout);
        }
    }
}

module.exports = JevClient;
