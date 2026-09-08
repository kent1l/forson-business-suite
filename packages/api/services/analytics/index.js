const db = require('../../db');
const { AnalyticsRequestError } = require('./errors');
const {
    METRICS, DIMENSIONS, GRAINS, FORMATS, TRUST_RULES, READINESS_PROBES, REGISTRY_VERSION,
} = require('./registry');
const { READINESS_TTL_MS } = require('./registry/readiness');
const { PRESETS, COMPARE_MODES } = require('./periods');
const { parseQueryRequest, parseDateRange, BUDGET } = require('./requestValidator');
const { buildQuery } = require('./queryBuilder');
const { executeAll, coerceRows } = require('./executor');
const { shapeResponse } = require('./responseShaper');
const { boardFor, listBoards, BOARDS } = require('./boards');
const { evaluateInsights } = require('./insights');
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

// The permission every analytics caller holds. runInternalQuery refuses to run
// anything narrower, so the trusted path cannot become a way around the
// per-metric grants.
const BASE_PERMISSION = 'analytics:view';

/**
 * Run a spec written in server code, for a route that enforces its own
 * permission.
 *
 * This exists so `/reports/profitability-by-product` can take its figures from
 * this registry instead of keeping a second copy of the profit SQL — the drift
 * §13's R2 predicted, and the reason the two pages disagreed before PR #171.
 *
 * Two things make it safe, and both must stay true:
 *
 * - **The body must be authored in server code, never assembled from a request.**
 *   The metric ids in the calling route are literals. Passing a caller's body
 *   here would hand them every metric in the registry.
 * - **It refuses any metric that requires more than `analytics:view`.** A future
 *   author cannot reach an `analytics:financials` figure through it, whatever
 *   permission their route happens to check.
 */
async function runInternalQuery(body, req, opts = {}) {
    for (const id of [].concat(body.metrics || [])) {
        const metric = METRICS[id];
        if (metric && metric.permission !== BASE_PERMISSION) {
            throw new AnalyticsRequestError(
                500,
                `Analytics: '${id}' requires '${metric.permission}' and cannot be read through an internal query.`
            );
        }
    }
    const [only] = await runBatch([{ key: 'q', body, opts: { ...opts, trusted: true } }], req, opts);
    if (only.error) throw only.error;
    return only.result;
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

/**
 * The insights panel (PRD §14), deferred until after Phase 2 by owner decision
 * and delivered here.
 *
 * Rules are evaluated server-side, against the same query path and the same
 * snapshot the board's tiles use, so a sentence and the tile it cites cannot
 * disagree. `settings` is read per call rather than cached: a threshold an admin
 * has just changed should take effect on the next refresh.
 */
async function getInsights({ boardId, dateRange, compare }, req) {
    if (!BOARDS[boardId]) {
        throw new AnalyticsRequestError(404, `Unknown board: ${JSON.stringify(boardId)}`, {
            valid: Object.keys(BOARDS),
        });
    }
    // Resolved up front, and deliberately before any rule runs. A bad preset
    // would otherwise fail inside every rule's own query, and the panel would
    // come back empty with a 200 — reading as "nothing stands out" when the
    // truth is "the request was wrong". Silence on this panel has to mean one
    // thing only. Resolving once also guarantees every rule sees the same range.
    const resolved = parseDateRange(dateRange);

    const [readiness, settings] = await Promise.all([getReadiness(), getSettings()]);
    return evaluateInsights({ boardId, dateRange: resolved, compare }, req, {
        runBatch,
        canSee: canSeeMetric(req),
        readiness,
        settings,
    });
}

/**
 * The ANALYTICS_* settings, as a plain map. Read straight from the settings
 * table so an admin's change is live, and failing soft: an insight that needs a
 * setting stays dark if the read fails, which is the same thing it does when the
 * setting is simply unset.
 */
async function getSettings() {
    try {
        const res = await db.query(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'ANALYTICS\\_%'"
        );
        return Object.fromEntries(res.rows.map((r) => [r.setting_key, r.setting_value]));
    } catch (err) {
        console.error('Analytics could not read its settings:', err.message);
        return {};
    }
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
    runInternalQuery,
    getInsights,
    runBatch,
    explainQuery,
    getBoard: (boardId, req) => boardFor(boardId, canSeeMetric(req)),
    listBoards: (req) => listBoards(canSeeMetric(req)),
    canSeeMetric,
    BUDGET,
    cache,
};
