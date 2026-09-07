const db = require('../../db');
const { AnalyticsRequestError } = require('./errors');
const {
    METRICS, DIMENSIONS, GRAINS, FORMATS, TRUST_RULES, READINESS_PROBES, REGISTRY_VERSION,
} = require('./registry');
const { READINESS_TTL_MS } = require('./registry/readiness');
const { PRESETS, COMPARE_MODES } = require('./periods');
const { parseQueryRequest, BUDGET } = require('./requestValidator');
const { buildQuery } = require('./queryBuilder');
const { executeAll, coerceRows } = require('./executor');
const { shapeResponse } = require('./responseShaper');
const { boardFor, listBoards } = require('./boards');
const cache = require('./analyticsCache');
const { AnalyticsCache } = require('./analyticsCache');
const { userHasPermission } = require('../../middleware/authMiddleware');

/**
 * Public surface of the analytics service. Routes do HTTP; this does analytics.
 */

const canSeeMetric = (req) => (metricId) => {
    const metric = METRICS[metricId];
    return !!metric && userHasPermission(req, metric.permission);
};

// --- readiness ------------------------------------------------------------
// Cheap EXISTS probes, cached, so a scaffolded module renders "not being
// recorded yet" without the frontend ever issuing a query that would answer
// with a confident zero.
let readinessCache = null;

async function getReadiness({ fresh = false } = {}) {
    if (!fresh && readinessCache && Date.now() < readinessCache.expiresAt) {
        return readinessCache.value;
    }
    const value = {};
    for (const probe of Object.values(READINESS_PROBES)) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const res = await db.query(probe.sql);
            value[probe.id] = !!(res.rows[0] && res.rows[0].ready);
        } catch (err) {
            // A probe that cannot run is not evidence that data exists.
            console.error(`Analytics readiness probe '${probe.id}' failed:`, err.message);
            value[probe.id] = false;
        }
    }
    readinessCache = { value, expiresAt: Date.now() + READINESS_TTL_MS };
    return value;
}

// --- meta -----------------------------------------------------------------

async function getMeta(req, { fresh = false } = {}) {
    const visible = canSeeMetric(req);
    const readiness = await getReadiness({ fresh });

    const metrics = Object.values(METRICS)
        .filter((m) => visible(m.id))
        .map((m) => ({
            id: m.id,
            label: m.label,
            description: m.description,
            kind: m.kind,
            format: m.format,
            direction: m.direction,
            comparable: m.comparable,
            grains: [...m.grains],
            trust: m.trust || null,
            readiness: m.readiness || null,
            components: m.kind === 'composite' && m.exposeComponents
                ? m.terms.map((t) => ({ metric: t.metric, sign: t.sign }))
                : null,
        }));

    return {
        version: REGISTRY_VERSION,
        metrics,
        dimensions: Object.values(DIMENSIONS).map((d) => ({
            id: d.id,
            label: d.label,
            kind: d.kind,
            filterable: d.filterable,
            valueType: d.valueType,
            lookup: d.lookup || null,
            values: d.values ? [...d.values] : null,
        })),
        grains: Object.values(GRAINS).map((g) => ({ id: g.id, label: g.label })),
        presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label })),
        compareModes: Object.values(COMPARE_MODES).map((c) => ({ id: c.id, label: c.label })),
        formats: FORMATS,
        trustRules: Object.values(TRUST_RULES).map((r) => ({
            id: r.id, label: r.label, explanation: r.explanation, thresholds: r.thresholds,
        })),
        readiness,
        budget: BUDGET,
        permissions: {
            financials: userHasPermission(req, 'analytics:financials'),
            export: userHasPermission(req, 'analytics:export'),
        },
    };
}

// --- query ----------------------------------------------------------------

/**
 * A metric whose module is not yet in use is refused rather than answered.
 * Returning "operating expenses: ₱0.00" when nothing is being recorded is a
 * confident wrong answer; the frontend uses /meta's readiness flags to render
 * the honest state instead, and never gets here.
 */
async function assertReady(spec) {
    const gated = spec.metrics.filter((m) => m.readiness);
    if (gated.length === 0) return;
    const readiness = await getReadiness();
    for (const m of gated) {
        if (!readiness[m.readiness]) {
            throw new AnalyticsRequestError(
                409,
                `${READINESS_PROBES[m.readiness].emptyMessage} '${m.label}' will appear once it is.`,
                { metric: m.id, readiness: m.readiness }
            );
        }
    }
}

function prepare(body, req, opts = {}) {
    const spec = parseQueryRequest(body, req, opts);
    const built = buildQuery(spec);
    return { spec, ...built };
}

async function runBatch(requests, req, { fresh = false, timeoutMs = BUDGET.timeoutMs } = {}) {
    const prepared = [];
    for (const item of requests) {
        try {
            // eslint-disable-next-line no-await-in-loop
            const p = prepare(item.body, req, item.opts || {});
            // eslint-disable-next-line no-await-in-loop
            await assertReady(p.spec);
            prepared.push({ key: item.key, ...p, cacheKey: AnalyticsCache.key(p.text, p.values) });
        } catch (err) {
            prepared.push({ key: item.key, error: err });
        }
    }

    const toRun = [];
    for (const p of prepared) {
        if (p.error) continue;
        const hit = fresh ? null : cache.get(p.cacheKey);
        if (hit) {
            p.result = { ...hit.value, meta: { ...hit.value.meta, cached: true, cacheAgeMs: hit.ageMs } };
        } else {
            toRun.push(p);
        }
    }

    if (toRun.length > 0) {
        const started = Date.now();
        // One client, one snapshot: every tile on the board sees the same
        // database, so a KPI card and the chart under it cannot disagree.
        const results = await executeAll(
            toRun.map((p) => ({ text: p.text, values: p.values })),
            { timeoutMs }
        );
        const elapsedMs = Date.now() - started;
        toRun.forEach((p, i) => {
            const rows = coerceRows(results[i].rows, p.plan.columnMap);
            const shaped = shapeResponse({
                rows,
                plan: p.plan,
                spec: p.spec,
                meta: { cached: false, cacheAgeMs: 0, elapsedMs, generatedAt: new Date().toISOString() },
            });
            cache.set(p.cacheKey, shaped);
            p.result = shaped;
        });
    }

    return prepared.map((p) => ({ key: p.key, result: p.result || null, error: p.error || null }));
}

async function runQuery(body, req, opts = {}) {
    const [only] = await runBatch([{ key: 'q', body, opts }], req, opts);
    if (only.error) throw only.error;
    return only.result;
}

/** Build the statement without running it. Admin-only; invaluable for debugging. */
function explainQuery(body, req) {
    const { text, values, plan } = prepare(body, req);
    return { text, values, plan };
}

/**
 * Drop both caches. Used by tests, and by /meta?fresh=1 so an admin who has just
 * recorded the first expense sees that tile light up without waiting out the
 * readiness TTL.
 */
const clearCaches = () => {
    readinessCache = null;
    cache.clear();
};

module.exports = {
    clearCaches,
    getMeta,
    getReadiness,
    runQuery,
    runBatch,
    explainQuery,
    getBoard: (boardId, req) => boardFor(boardId, canSeeMetric(req)),
    listBoards: (req) => listBoards(canSeeMetric(req)),
    canSeeMetric,
    BUDGET,
    cache,
};
