const { METRICS } = require('./registry');
const { INSIGHT_RULES } = require('./registry/insights');

/**
 * Evaluate the insight rules for a board and a period.
 *
 * Everything a rule needs comes from the same query path every tile uses, so an
 * insight and the tile it cites cannot disagree: same registry, same coverage,
 * same cache, same snapshot.
 *
 * The output is deliberately NOT a finished sentence. Each insight carries its
 * template, its typed values, the metric ids it was derived from and their
 * coverage. The frontend formats the values from /meta, so a figure written into
 * a sentence is written exactly as it is on the tile it came from — and a reader
 * who does not believe the sentence can follow the citation to the number.
 */

const PLACEHOLDER = /\{(\w+)\}/g;

/** A rule is dropped, not degraded, if the user cannot see everything it cites. */
const visibleTo = (rule, canSee) => rule.cites.every(canSee)
    && (rule.query.metrics || []).every(canSee);

/** Nor may it run if a metric it needs belongs to a module not yet in use. */
const readyFor = (rule, readiness) => (rule.query.metrics || []).every((id) => {
    const gate = METRICS[id] && METRICS[id].readiness;
    return !gate || readiness[gate];
});

/**
 * Named-account concentration, computed off a rolled-up customer breakdown.
 *
 * Split out because it is the only rule that needs more than the period totals,
 * and because the arithmetic is worth being able to read: the walk-in record is
 * removed from BOTH the ranking and the denominator, so the answer is a share of
 * invoiced trade rather than a share of everything.
 */
function namedConcentration(rows, totals, walkInId) {
    if (walkInId === null) return null;
    const metric = 'sales.gross_revenue';
    const total = Number(totals.values[metric]);
    if (!Number.isFinite(total) || total <= 0) return null;

    let walkIn = 0;
    let top = null;
    for (const row of rows) {
        // The fold is not a customer, and must not be ranked as one.
        if (row.rollup) continue;
        const value = Number(row.values[metric]) || 0;
        if (Number(row.key[0]) === walkInId) { walkIn = value; continue; }
        if (!top || value > top.value) top = { label: row.label[0], value };
    }

    const namedTotal = total - walkIn;
    if (!top || namedTotal <= 0) return null;
    return { ...top, namedTotal, sharePct: (top.value / namedTotal) * 100 };
}

function contextFor(result, rule, settings) {
    const totals = result.totals || { values: {} };
    const compare = totals.compare || null;

    const v = (metricId) => {
        const value = totals.values[metricId];
        return value === undefined ? null : value;
    };
    const prev = (metricId) => {
        if (!compare || !compare.available) return null;
        const value = compare.values[metricId];
        return value === undefined ? null : value;
    };
    const d = (metricId) => {
        if (!compare || !compare.available) return null;
        const value = compare.deltaPct[metricId];
        return value === undefined ? null : value;
    };

    const walkInId = Number.parseInt(settings.ANALYTICS_WALKIN_CUSTOMER_ID, 10);
    return {
        v,
        prev,
        d,
        rows: result.rows || [],
        totals,
        coverage: result.coverage || {},
        settings,
        t: rule.thresholds || {},
        named: namedConcentration(
            result.rows || [],
            totals,
            Number.isInteger(walkInId) ? walkInId : null
        ),
    };
}

/**
 * A sentence with a hole in it is worse than no sentence. If a rule fires but
 * one of its values came back null — which can happen when a metric is measured
 * over nothing — the insight is dropped rather than rendered with a dash in the
 * middle of a claim.
 */
function complete(template, values) {
    const names = [...template.matchAll(PLACEHOLDER)].map((m) => m[1]);
    return names.every((name) => {
        const slot = values[name];
        return slot && slot.value !== null && slot.value !== undefined;
    });
}

/**
 * Build the query bodies the rules on this board need, deduped: several rules
 * asking the same question cost one round trip, exactly as tiles do.
 */
function planFor(rules, { dateRange, compare }) {
    const byKey = new Map();
    for (const rule of rules) {
        const body = {
            metrics: [...rule.query.metrics],
            dimensions: [...(rule.query.dimensions || [])],
            grain: null,
            dateRange,
            ...(rule.query.topN ? { topN: { ...rule.query.topN } } : {}),
            ...(rule.query.sort ? { sort: { ...rule.query.sort } } : {}),
            // A rule can ask for a comparison; the board can only turn one off.
            ...(rule.query.compare && compare ? { compare: rule.query.compare } : {}),
        };
        const key = JSON.stringify(body);
        if (!byKey.has(key)) byKey.set(key, { key, body, rules: [] });
        byKey.get(key).rules.push(rule);
    }
    return [...byKey.values()];
}

/**
 * @param {object} deps  { runBatch, canSeeMetric, readiness, settings }
 */
async function evaluateInsights({ boardId, dateRange, compare = true }, req, deps) {
    const { runBatch, canSee, readiness, settings } = deps;

    const applicable = Object.values(INSIGHT_RULES).filter((rule) =>
        rule.boards.includes(boardId)
        && visibleTo(rule, canSee)
        && readyFor(rule, readiness)
        // A rule that depends on a setting an admin has not filled in stays
        // dark. Guessing the value would be worse than saying nothing.
        && (!rule.requiresSetting || String(settings[rule.requiresSetting] || '').trim() !== ''));

    if (applicable.length === 0) return { insights: [], evaluated: 0 };

    const groups = planFor(applicable, { dateRange, compare });
    const outcomes = await runBatch(
        groups.map((g, i) => ({ key: String(i), body: g.body })),
        req
    );
    const resultByKey = new Map(outcomes.map((o) => [o.key, o]));

    const insights = [];
    let failed = 0;
    groups.forEach((group, i) => {
        const outcome = resultByKey.get(String(i));
        // One failing rule must not blank the panel, and a rule that could not be
        // evaluated says nothing rather than something reassuring.
        if (!outcome || outcome.error || !outcome.result) {
            failed += 1;
            if (outcome && outcome.error) {
                console.error(`Analytics insights: a rule group failed: ${outcome.error.message}`);
            }
            return;
        }

        for (const rule of group.rules) {
            let ctx;
            let fires = false;
            try {
                ctx = contextFor(outcome.result, rule, settings);
                fires = !!rule.when(ctx);
            } catch (err) {
                console.error(`Analytics insight '${rule.id}' failed to evaluate:`, err.message);
                continue;
            }
            if (!fires) continue;

            const values = rule.values(ctx);
            if (!complete(rule.template, values)) continue;

            insights.push({
                id: rule.id,
                severity: rule.severity,
                template: rule.template,
                values,
                cites: [...rule.cites],
                // The coverage of whatever the insight was derived from, so a
                // sentence about margin carries the same disclosure the tile does.
                coverage: outcome.result.coverage || {},
                action: rule.action ? { ...rule.action } : null,
                thresholds: { ...(rule.thresholds || {}) },
            });
        }
    });

    // Most severe first: a part about to run out outranks a period movement.
    const order = { critical: 0, warning: 1, info: 2 };
    insights.sort((a, b) => order[a.severity] - order[b.severity]);

    // An empty panel has to mean "nothing worth saying". If NOTHING could be
    // evaluated, that is a failure wearing the same face, and the caller is told
    // so rather than shown a reassuring blank.
    return {
        insights,
        evaluated: applicable.length,
        degraded: failed > 0,
        ...(failed === groups.length ? { failed: true } : {}),
    };
}

module.exports = { evaluateInsights, namedConcentration };
