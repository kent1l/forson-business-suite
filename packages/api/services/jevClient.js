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

    async evaluateChoice({ question = 'choice', state, instructions, choices }) {
        if (!this.isConfigured()) return null;
        if (!Array.isArray(choices) || choices.length === 0) return null;
        const config = this.config;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
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
                        [question]: {
                            type: 'choice',
                            instructions,
                            // The Decisions API's Choice primitive accepts an
                            // object keyed by the returned option, not an array.
                            // Keeping `choices` as the local caller contract
                            // lets us validate the answer against the same set.
                            criteria: Object.fromEntries(choices.map((item) => [
                                typeof item === 'string' ? item : item.value,
                                typeof item === 'string' ? item : item.label,
                            ])),
                        },
                    },
                }),
            });
            const responseText = await response.text();
            if (!response.ok) throw new Error(`Jev choice decision failed (HTTP ${response.status})`);
            let payload;
            try { payload = JSON.parse(responseText); }
            catch { throw new Error('Jev choice decision returned invalid JSON'); }
            const answer = payload?.answers?.[question];
            const choice = answer?.choice;
            const confidence = Number(answer?.confidence);
            const allowed = new Set(choices.map((item) => typeof item === 'string' ? item : item.value));
            if (typeof choice !== 'string' || !allowed.has(choice) || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
                throw new Error('Jev choice decision returned an invalid choice or confidence');
            }
            return { choice, confidence, model: payload.model || config.model };
        } finally {
            clearTimeout(timeout);
        }
    }

    async evaluateNoul({ question = 'noul', state, instructions, criteria }) {
        if (!this.isConfigured()) return null;
        const config = this.config;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
        try {
            const response = await this.fetchImpl(config.apiUrl, {
                method: 'POST', headers: this.#headers(config), signal: controller.signal,
                body: JSON.stringify({ model: config.model, state, questions: { [question]: {
                    type: 'noul', instructions, ...(criteria ? { criteria } : {}),
                } } }),
            });
            const responseText = await response.text();
            if (!response.ok) throw new Error(`Jev noul decision failed (HTTP ${response.status})`);
            let payload;
            try { payload = JSON.parse(responseText); } catch { throw new Error('Jev noul decision returned invalid JSON'); }
            const probability = Number(payload?.answers?.[question]?.noul);
            if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new Error('Jev noul decision returned an invalid probability');
            return { probability, model: payload.model || config.model };
        } finally { clearTimeout(timeout); }
    }

    async evaluateScore({ question = 'score', state, instructions, criteria }) {
        if (!this.isConfigured() || !Array.isArray(criteria) || criteria.length < 2 || criteria.length > 10) return null;
        const config = this.config;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
        try {
            const response = await this.fetchImpl(config.apiUrl, {
                method: 'POST', headers: this.#headers(config), signal: controller.signal,
                body: JSON.stringify({ model: config.model, state, questions: { [question]: { type: 'score', instructions, criteria } } }),
            });
            const responseText = await response.text();
            if (!response.ok) throw new Error(`Jev score decision failed (HTTP ${response.status})`);
            let payload;
            try { payload = JSON.parse(responseText); } catch { throw new Error('Jev score decision returned invalid JSON'); }
            const answer = payload?.answers?.[question];
            const score = Number(answer?.score);
            const confidence = Number(answer?.confidence);
            if (!Number.isFinite(score) || score < 0 || score > criteria.length - 1 || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
                throw new Error('Jev score decision returned an invalid score or confidence');
            }
            return { score, confidence, model: payload.model || config.model };
        } finally { clearTimeout(timeout); }
    }

    #headers(config) {
        return {
            Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json',
            'HTTP-Referer': this.env.OPENROUTER_HTTP_REFERER || 'http://localhost:5173', 'X-Title': 'Forson Business Suite',
        };
    }
}

module.exports = JevClient;
