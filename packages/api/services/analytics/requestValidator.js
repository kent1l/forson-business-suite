const { AnalyticsRequestError } = require('./errors');
const { METRICS, DIMENSIONS, GRAINS, mustResolve } = require('./registry');
const { COMPARE_MODES, PRESETS, resolvePreset, daysBetweenInclusive, isIsoDate, today } = require('./periods');
const { userHasPermission } = require('../../middleware/authMiddleware');
const { KNOWN_INVOICE_STATUSES } = require('../../helpers/invoiceStatusFilter');

/**
 * The capability envelope, enforced before a single character of SQL is built.
 *
 * These are not arbitrary. The dataset is small, but the analytics page shares a
 * connection pool with the POS counter, and a request that asks for eight
 * metrics across three dimensions over three years is a request nobody actually
 * wants an answer to.
 */
const BUDGET = Object.freeze({
    maxMetrics: 8,
    maxDimensions: 2,
    maxTopN: 50,
    maxFilters: 4,
    maxFilterValues: 200,
    maxRangeDays: 731,
    maxRowsJson: 500,
    maxRowsCsv: 5000,
    maxBatchQueries: 12,
    timeoutMs: 8000,
});

const asArray = (v) => {
    if (v === undefined || v === null) return [];
    return Array.isArray(v) ? v : [v];
};

/**
 * Turn a request body into a fully resolved QuerySpec, or throw.
 *
 * Everything downstream receives registry objects, never the caller's strings.
 * `mustResolve` uses hasOwnProperty rather than `in`, so `__proto__` and
 * `constructor` resolve to nothing rather than to an Object.prototype member.
 */
function parseQueryRequest(body, req, { forCsv = false } = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new AnalyticsRequestError(400, 'A query body is required.');
    }

    // --- metrics
    const metricIds = asArray(body.metrics);
    if (metricIds.length === 0) throw new AnalyticsRequestError(400, 'At least one metric is required.');
    if (metricIds.length > BUDGET.maxMetrics) {
        throw new AnalyticsRequestError(400, `A single query may ask for at most ${BUDGET.maxMetrics} metrics; this one asked for ${metricIds.length}.`);
    }
    const metrics = [];
    for (const id of metricIds) {
        const metric = mustResolve(METRICS, id, 'metric');
        // Permission is per metric, not per route: a restricted metric is stripped
        // from /meta and refused here, so a hand-written request cannot reach it.
        if (!userHasPermission(req, metric.permission)) {
            throw new AnalyticsRequestError(403, `You do not have permission to view '${metric.label}'.`, {
                metric: metric.id, permission: metric.permission,
            });
        }
        if (!metrics.some((m) => m.id === metric.id)) metrics.push(metric);
    }

    // --- grain
    let grain = null;
    if (body.grain !== undefined && body.grain !== null && body.grain !== 'none') {
        if (!Object.prototype.hasOwnProperty.call(GRAINS, body.grain)) {
            throw new AnalyticsRequestError(400, `Unknown grain: ${JSON.stringify(body.grain)}`, {
                valid: Object.keys(GRAINS),
            });
        }
        grain = body.grain;
    }

    // --- dimensions. A grain is meaningless without the date dimension, so ask
    // for one and get the other; the alternative is a 400 for a request whose
    // intent was never ambiguous.
    const dimensionIds = asArray(body.dimensions).map(String);
    if (grain && !dimensionIds.includes('date')) dimensionIds.unshift('date');
    if (!grain && dimensionIds.includes('date')) {
        throw new AnalyticsRequestError(400, "Breaking down by 'date' needs a grain (day, week, month or quarter).");
    }
    if (dimensionIds.length > BUDGET.maxDimensions) {
        throw new AnalyticsRequestError(400, `A single query may break down by at most ${BUDGET.maxDimensions} dimensions.`);
    }
    const dimensions = [];
    for (const id of dimensionIds) {
        const dim = mustResolve(DIMENSIONS, id, 'dimension');
        if (!dimensions.some((d) => d.id === dim.id)) dimensions.push(dim);
    }
    // `date` always leads, so the frontend can read a trend off column 0 without
    // caring what order the board spec happened to list dimensions in.
    dimensions.sort((a, b) => (a.id === 'date' ? -1 : b.id === 'date' ? 1 : 0));

    // --- date range
    const dateRange = parseDateRange(body.dateRange);
    const days = daysBetweenInclusive(dateRange.from, dateRange.to);
    if (days > BUDGET.maxRangeDays) {
        throw new AnalyticsRequestError(400, `A date range may span at most ${BUDGET.maxRangeDays} days; this one spans ${days}.`);
    }

    // --- comparison
    let compare = null;
    if (body.compare) {
        const mode = COMPARE_MODES[body.compare];
        if (!mode) {
            throw new AnalyticsRequestError(400, `Unknown comparison: ${JSON.stringify(body.compare)}`, {
                valid: Object.keys(COMPARE_MODES),
            });
        }
        // Phase 0 deliberately compares only headline figures and date trends.
        // Dimensioned comparison roughly doubles the pivot's complexity for a tile
        // nobody has asked for yet.
        const dimIds = dimensions.map((d) => d.id);
        if (dimIds.length > 0 && !(dimIds.length === 1 && dimIds[0] === 'date')) {
            throw new AnalyticsRequestError(400, 'A comparison is available on headline figures and on trends over time, not on a breakdown by category.');
        }
        compare = { mode: mode.id, dateRange: mode.resolve(dateRange) };
    }

    // --- filters
    const filters = parseFilters(body.filters);

    // --- sort
    let sort = null;
    if (body.sort && body.sort.by) {
        const dir = String(body.sort.dir || 'DESC').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
        const by = String(body.sort.by);
        const known = metrics.some((m) => m.id === by) || dimensions.some((d) => d.id === by);
        if (!known) {
            throw new AnalyticsRequestError(400, `Cannot sort by '${by}': it is not one of the requested metrics or dimensions.`, {
                valid: [...metrics.map((m) => m.id), ...dimensions.map((d) => d.id)],
            });
        }
        sort = { by, dir };
    }

    // --- top-N with an 'Other' rollup
    const topN = parseTopN(body.topN, { metrics, dimensions, sort });

    // --- limit. Always applied: when the row count meets it the response says so,
    // because a chart that silently shows the first 200 of 800 categories lies.
    const maxRows = forCsv ? BUDGET.maxRowsCsv : BUDGET.maxRowsJson;
    const requested = Number(body.limit);
    let limit = Number.isFinite(requested) && requested > 0
        ? Math.min(Math.floor(requested), maxRows)
        : maxRows;
    // A rollup returns n rows plus the fold. A tile that set both `limit: 8` and
    // `topN: { n: 8 }` would otherwise cut the 'Other' row off the bottom --
    // silently losing the very total the rollup exists to state.
    if (topN) limit = Math.max(limit, topN.n + 1);

    // --- source options
    const status = body.status === undefined ? undefined : String(body.status);
    if (status !== undefined && status !== 'active' && status !== 'all'
        && !String(status).split(',').every((s) => KNOWN_INVOICE_STATUSES.includes(s.trim()))) {
        throw new AnalyticsRequestError(400, `Unknown invoice status filter: ${JSON.stringify(status)}`, {
            valid: ['active', 'all', ...KNOWN_INVOICE_STATUSES],
        });
    }

    return {
        metrics,
        dimensions,
        filters,
        grain,
        dateRange,
        compare,
        sort,
        topN,
        limit,
        sourceOptions: { status },
        context: { days_in_range: days },
    };
}

/**
 * A top-N rollup: keep the largest `n` categories and fold everything else into
 * one 'Other' row, server-side.
 *
 * Deliberately narrow. It applies to exactly one categorical breakdown, because
 * that is the only shape whose fold has an unambiguous meaning: across two
 * dimensions "the rest" could be the rest of either, and against a date grain it
 * would mean a different set of categories in every period. A caller who wants a
 * plain top ten with no fold sets `limit` instead -- there is no `other: false`,
 * so a rollup always states what it left out.
 */
function parseTopN(raw, { metrics, dimensions, sort }) {
    if (raw === undefined || raw === null || raw === false) return null;
    if (typeof raw !== 'object' || Array.isArray(raw)) {
        throw new AnalyticsRequestError(400, 'topN must be an object, as { n, by }.');
    }

    if (dimensions.length !== 1 || dimensions[0].id === 'date') {
        throw new AnalyticsRequestError(
            400,
            "A top-N rollup applies to exactly one category breakdown. Across two dimensions, or over a period, 'Other' would not name a single group of things.",
            { dimensions: dimensions.map((d) => d.id) }
        );
    }

    const n = Number(raw.n);
    if (!Number.isInteger(n) || n < 1 || n > BUDGET.maxTopN) {
        throw new AnalyticsRequestError(
            400,
            `topN.n must be a whole number between 1 and ${BUDGET.maxTopN}; received ${JSON.stringify(raw.n)}.`
        );
    }

    // Ranked by a metric the query already asks for, so the ordering the reader
    // sees and the ordering the fold was decided by cannot come apart.
    const by = raw.by !== undefined && raw.by !== null
        ? String(raw.by)
        : ((sort && sort.by) || metrics[0].id);
    if (!metrics.some((m) => m.id === by)) {
        throw new AnalyticsRequestError(
            400,
            `Cannot rank a top-N by '${by}': it is not one of the requested metrics.`,
            { valid: metrics.map((m) => m.id) }
        );
    }

    return { n, by };
}

function parseDateRange(raw) {
    if (raw && typeof raw === 'object' && raw.preset) {
        const range = resolvePreset(String(raw.preset));
        if (!range) {
            throw new AnalyticsRequestError(400, `Unknown date preset: ${JSON.stringify(raw.preset)}`, {
                valid: Object.keys(PRESETS),
            });
        }
        return range;
    }
    if (!raw || !isIsoDate(raw.from) || !isIsoDate(raw.to)) {
        throw new AnalyticsRequestError(400, 'A date range is required, as {from, to} in YYYY-MM-DD or {preset}.', {
            presets: Object.keys(PRESETS),
        });
    }
    if (raw.from > raw.to) {
        throw new AnalyticsRequestError(400, 'The date range starts after it ends.');
    }
    if (raw.to > today()) {
        // Not an error: an open-ended "this month" is normal. Clamp so the
        // comparison arithmetic is not measuring against days that have not
        // happened yet.
        return { from: raw.from, to: today() };
    }
    return { from: raw.from, to: raw.to };
}

function parseFilters(raw) {
    if (!raw) return [];
    const entries = Array.isArray(raw)
        ? raw.map((f) => [f && f.dimension, f && f.values])
        : Object.entries(raw);

    if (entries.length > BUDGET.maxFilters) {
        throw new AnalyticsRequestError(400, `A single query may carry at most ${BUDGET.maxFilters} filters.`);
    }

    const filters = [];
    for (const [dimId, rawValues] of entries) {
        const values = asArray(rawValues);
        if (values.length === 0) continue;   // an empty picker is no filter, not an impossible one
        const dim = mustResolve(DIMENSIONS, dimId, 'dimension');
        if (!dim.filterable) {
            throw new AnalyticsRequestError(400, `'${dim.label}' cannot be filtered on.`);
        }
        if (values.length > BUDGET.maxFilterValues) {
            throw new AnalyticsRequestError(400, `A filter may carry at most ${BUDGET.maxFilterValues} values; '${dim.label}' carried ${values.length}.`);
        }
        // The cast is registry-controlled, so a caller cannot decide how its own
        // values are interpreted. Free-text (LIKE) filters are deliberately not
        // supported: they are where an injection review gets interesting for no
        // user benefit.
        const coerced = dim.valueType === 'int'
            ? values.map((v) => {
                const n = Number(v);
                if (!Number.isInteger(n)) {
                    throw new AnalyticsRequestError(400, `'${dim.label}' is filtered by id; received ${JSON.stringify(v)}.`);
                }
                return n;
            })
            : values.map((v) => String(v));

        if (dim.values && dim.valueType === 'text') {
            for (const v of coerced) {
                if (!dim.values.includes(v)) {
                    throw new AnalyticsRequestError(400, `Unknown value for '${dim.label}': ${JSON.stringify(v)}`, {
                        valid: [...dim.values],
                    });
                }
            }
        }
        filters.push({ dimension: dim, op: 'in', values: coerced });
    }
    return filters;
}

module.exports = { parseQueryRequest, BUDGET };
