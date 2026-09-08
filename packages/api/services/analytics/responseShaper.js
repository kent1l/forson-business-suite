const { METRICS, TRUST_RULES, FORMATS } = require('./registry');
const { levelFor } = require('./registry/trust');
const { compareLabel } = require('./periods');

/**
 * Turn raw result rows into the response the frontend renders.
 *
 * Three things happen here that deliberately do not happen in SQL:
 *
 * - **Totals are computed in JS.** Additive leaves are summable and derivations
 *   are pure functions of them, so a total and its rows provably agree, and
 *   there is one less branch in the query builder. Row-level ratios are never
 *   summed -- a total margin is derived from total profit over total costed
 *   revenue, not averaged across periods.
 * - **The comparison is aligned by ordinal, not by date.** Month 3 of the
 *   current range lines up with month 3 of the previous one. Matching on the
 *   date key instead produces garbage the moment the comparison is a year back.
 * - **`compare.available` is a first-class answer.** With twelve months of
 *   history, most year-on-year comparisons have nothing to compare against, and
 *   a -100% on a KPI card reads as a business collapse rather than as absent
 *   data.
 */

/** Mirrors the SQL derivation exactly, including how NULL propagates. */
function evaluateMetric(metricId, leafValue, ctx) {
    const m = METRICS[metricId];
    if (m.kind === 'additive' || m.kind === 'snapshot') {
        const v = leafValue(metricId);
        return v === undefined ? null : v;
    }
    if (m.kind === 'composite') {
        let total = 0;
        for (const term of m.terms) {
            const v = evaluateMetric(term.metric, leafValue, ctx);
            if (v === null) return null;
            total += term.sign * v;
        }
        return total;
    }
    const den = evaluateMetric(m.denominator, leafValue, ctx);
    if (den === null || den === 0) {
        return m.zeroDenominator === undefined ? null : m.zeroDenominator;
    }
    const num = evaluateMetric(m.numerator, leafValue, ctx);
    if (num === null) return null;
    const scale = typeof m.scale === 'number'
        ? m.scale
        : (m.scale && m.scale.context ? ctx[m.scale.context] : 1);
    return (num * scale) / den;
}

const round = (value, format) => {
    if (value === null || !Number.isFinite(value)) return value === null ? null : null;
    const decimals = (FORMATS[format] || FORMATS.ratio).decimals;
    const factor = 10 ** Math.min(decimals + 4, 10);
    return Math.round(value * factor) / factor;
};

function coverageFromCounters(rule, counters) {
    const def = TRUST_RULES[rule];
    const valueRatio = counters.denValue > 0 ? counters.numValue / counters.denValue : 0;
    const rowRatio = counters.denRows > 0 ? counters.numRows / counters.denRows : 0;
    return {
        rule,
        label: def.label,
        explanation: def.explanation,
        valueRatio,
        rowRatio,
        numValue: counters.numValue,
        denValue: counters.denValue,
        numRows: counters.numRows,
        denRows: counters.denRows,
        level: levelFor(valueRatio, def),
    };
}

const emptyCounters = () => ({ numValue: 0, denValue: 0, numRows: 0, denRows: 0 });

function shapeResponse({ rows, plan, spec, meta = {} }) {
    const dims = plan.dimensionOrder;
    const hasDate = dims.some((d) => d.id === 'date');
    const ctx = spec.context || {};

    const readRow = (row) => {
        const values = {};
        for (const metricId of plan.requestedMetrics) {
            const col = plan.metricColumns[metricId];
            values[metricId] = round(row[col], METRICS[metricId].format);
        }
        // Composite components ride along so a KPI can show "1.11M gross - 84k
        // refunds" without a second request.
        const components = {};
        for (const leafId of plan.leafMetrics) {
            if (values[leafId] === undefined) {
                components[leafId] = round(row[plan.metricColumns[leafId]], METRICS[leafId].format);
            }
        }
        const coverage = {};
        for (const cov of plan.coverageRules) {
            coverage[cov.rule] = coverageFromCounters(cov.rule, {
                numValue: Number(row[cov.columns.num]) || 0,
                denValue: Number(row[cov.columns.den]) || 0,
                numRows: Number(row[cov.columns.numRows]) || 0,
                denRows: Number(row[cov.columns.denRows]) || 0,
            });
        }
        return {
            key: dims.map((d) => row[d.key]),
            label: dims.map((d) => row[d.label]),
            dimensions: dims.map((d) => ({ id: d.id, key: row[d.key], label: row[d.label] })),
            values,
            components,
            coverage,
            // The folded tail, flagged rather than inferred from the label: a
            // brand genuinely called "Other" must not be styled, filtered or
            // drilled into as though it were the rollup. `rollupCount` is how
            // many categories the row stands for -- 1 everywhere but the fold.
            ...(plan.rollup
                ? {
                    rollup: row[plan.rollup.column] === true,
                    rollupCount: Number(row[plan.rollup.countColumn]) || 0,
                }
                : {}),
        };
    };

    const current = [];
    const previous = [];
    for (const row of rows) {
        (Number(row.bucket) === 1 ? previous : current).push(row);
    }

    // The ordinal within its own range, so a trend and its overlay line up
    // without any date arithmetic on the client.
    current.forEach((r, i) => { r.__ordinal = i; });
    previous.forEach((r, i) => { r.__ordinal = i; });

    const shapedPrevious = previous.map((row) => ({ ordinal: row.__ordinal, ...readRow(row) }));
    const previousByOrdinal = new Map(shapedPrevious.map((r) => [r.ordinal, r]));

    const shaped = current.map((row) => {
        const base = readRow(row);
        base.periodIndex = hasDate ? row.__ordinal : 0;
        if (spec.compare) {
            const prior = previousByOrdinal.get(row.__ordinal) || null;
            base.compare = prior
                ? withDeltas(base.values, prior.values)
                : { available: false, values: {}, delta: {}, deltaPct: {} };
        }
        return base;
    });

    const totals = buildTotals({ rows: current, plan, ctx });
    const priorTotals = spec.compare && previous.length
        ? buildTotals({ rows: previous, plan, ctx })
        : null;
    if (spec.compare) {
        totals.compare = priorTotals
            ? withDeltas(totals.values, priorTotals.values)
            : { available: false, values: {}, delta: {}, deltaPct: {} };
    }

    return {
        meta: {
            metrics: plan.requestedMetrics,
            dimensions: dims.map((d) => d.id),
            grain: plan.grain,
            dateRange: spec.dateRange,
            compare: spec.compare
                ? {
                    mode: spec.compare.mode,
                    dateRange: spec.compare.dateRange,
                    label: compareLabel(spec.compare.mode, spec.compare.dateRange),
                    available: previous.length > 0,
                }
                : null,
            rowCount: shaped.length,
            // Silence here is how a chart lies: say so when there was more.
            truncated: shaped.length >= plan.limit,
            // A rollup is the honest alternative to truncation: nothing was
            // dropped, the tail is on screen as one row, and the tile says how
            // many categories it stands for.
            rollup: plan.rollup
                ? {
                    n: plan.rollup.n,
                    by: plan.rollup.by,
                    // Categories folded into 'Other'. Zero means every category
                    // fitted, and the tile should not claim otherwise.
                    folded: shaped.reduce((n, r) => (r.rollup ? n + r.rollupCount : n), 0),
                }
                : null,
            ...meta,
        },
        rows: shaped,
        totals,
        coverage: totals.coverage,
    };
}

function withDeltas(currentValues, priorValues) {
    const delta = {};
    const deltaPct = {};
    for (const [metricId, value] of Object.entries(currentValues)) {
        const prior = priorValues[metricId];
        if (value === null || prior === null || prior === undefined) {
            delta[metricId] = null;
            deltaPct[metricId] = null;
            continue;
        }
        delta[metricId] = round(value - prior, METRICS[metricId].format);
        // A percentage change from zero is undefined, not infinite growth.
        deltaPct[metricId] = prior === 0 ? null : ((value - prior) / Math.abs(prior)) * 100;
    }
    return { available: true, values: priorValues, delta, deltaPct };
}

/**
 * Totals over the rows actually returned. When `meta.truncated` is set those are
 * not all the rows, and the tile says so rather than presenting a partial sum as
 * the whole.
 */
function buildTotals({ rows, plan, ctx }) {
    const leafSums = new Map();
    const leafSeen = new Map();
    for (const leafId of plan.leafMetrics) {
        leafSums.set(leafId, 0);
        leafSeen.set(leafId, false);
    }

    const coverageCounters = new Map(plan.coverageRules.map((c) => [c.rule, emptyCounters()]));

    for (const row of rows) {
        for (const leafId of plan.leafMetrics) {
            const v = row[plan.metricColumns[leafId]];
            if (v === null || v === undefined) continue;
            // Mirrors the rollup's fold exactly, so a table's total row and its
            // 'Other' row are combined by the same rule. Adding up each
            // customer's oldest overdue invoice would give a number of days that
            // means nothing and still looks like a figure.
            leafSums.set(leafId, METRICS[leafId].fold === 'max'
                ? (leafSeen.get(leafId) ? Math.max(leafSums.get(leafId), Number(v)) : Number(v))
                : leafSums.get(leafId) + Number(v));
            leafSeen.set(leafId, true);
        }
        for (const cov of plan.coverageRules) {
            const c = coverageCounters.get(cov.rule);
            c.numValue += Number(row[cov.columns.num]) || 0;
            c.denValue += Number(row[cov.columns.den]) || 0;
            c.numRows += Number(row[cov.columns.numRows]) || 0;
            c.denRows += Number(row[cov.columns.denRows]) || 0;
        }
    }

    // A trusted leaf that was NULL on every row stays NULL in the total: nothing
    // was measured, which is not the same as measuring zero.
    const leafValue = (id) => (leafSeen.get(id) ? leafSums.get(id) : (METRICS[id].trust ? null : 0));

    const values = {};
    for (const metricId of plan.requestedMetrics) {
        values[metricId] = round(evaluateMetric(metricId, leafValue, ctx), METRICS[metricId].format);
    }
    const components = {};
    for (const leafId of plan.leafMetrics) {
        if (values[leafId] === undefined) {
            components[leafId] = round(leafValue(leafId), METRICS[leafId].format);
        }
    }
    const coverage = {};
    for (const [rule, counters] of coverageCounters) {
        coverage[rule] = coverageFromCounters(rule, counters);
    }

    return { values, components, coverage };
}

module.exports = { shapeResponse, evaluateMetric, coverageFromCounters };
