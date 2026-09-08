const {
    costedLineCondition, costedPartCondition, costedReceiptLineCondition,
} = require('../../../helpers/costCoverage');

/**
 * Named data-quality predicates -- the honesty layer.
 *
 * A metric declaring `trust: 'costed_line'` gets its aggregate wrapped in
 * `FILTER (WHERE <predicate>)` *and* triggers coverage-column emission for the
 * same rule. There is deliberately no code path in the query builder that
 * computes a trusted metric without its filter, so "margin is only ever
 * measured on data that carries a cost" is enforced by construction rather
 * than by every future author remembering it.
 *
 * The predicates themselves are NOT redefined here: they come from
 * helpers/costCoverage.js, which is also what the Reports page filters on. One
 * definition, so the two pages cannot drift into disagreeing about what a
 * costed line is.
 *
 * A rule contributes three expressions:
 *   `predicate` -- what makes a row trustworthy;
 *   `weight`    -- what the coverage ratio is measured over;
 *   `scope`     -- (optional) which rows the question applies to at all.
 * Coverage is `SUM(weight) FILTER (scope AND predicate) / SUM(weight) FILTER (scope)`,
 * reported alongside the equivalent row counts.
 */
const TRUST_RULES = Object.freeze({
    costed_line: Object.freeze({
        id: 'costed_line',
        label: 'Cost coverage',
        explanation:
            'Only invoice lines with a recorded cost are included. A line whose cost was never '
            + 'captured is stored as 0, indistinguishable from a genuinely free item, so it is '
            + 'excluded from both revenue and cost. Profit is therefore understated on a subset '
            + 'of sales rather than invented across all of them.',
        // The weight is what the coverage ratio is measured over: revenue, because
        // revenue is what actually weights the margin. Row counts are reported too,
        // and the two diverge sharply here -- a few high-value costed lines can
        // carry far more of the revenue than of the line count.
        predicate: (c) => costedLineCondition(c.__alias),
        weight: (c) => c.revenue_ex_tax,
        scope: null,
        thresholds: Object.freeze({ ok: 0.9, partial: 0.5 }),
        suppressBelow: 0,
    }),
    wac_known: Object.freeze({
        id: 'wac_known',
        label: 'Cost coverage',
        explanation:
            'Only parts with a non-zero weighted average cost are valued. Stock held against a '
            + 'part that has never carried a cost is counted in the quantity but contributes '
            + 'nothing to the value, so inventory value is understated rather than guessed.',
        predicate: (c) => costedPartCondition(c.__alias),
        // Weighted by units on hand, not by value. Value is exactly what is
        // unknown for an uncosted part, so a value-weighted ratio here would
        // divide the costed value by itself and report 100% coverage every time.
        weight: (c) => `GREATEST(${c.stock_on_hand}, 0)`,
        // Coverage is only a question about stock we actually hold; a part with no
        // stock and no cost is not a gap in the inventory valuation.
        scope: (c) => `${c.stock_on_hand} > 0`,
        thresholds: Object.freeze({ ok: 0.95, partial: 0.7 }),
        suppressBelow: 0,
    }),
    /**
     * The buying side of `costed_line`, and the largest single finding of
     * Phase 4: 1,547 of 2,679 receipt lines carry a landed cost of zero, spread
     * evenly across all twelve months rather than concentrated in a legacy
     * import. Purchase spend is measured only over the rest.
     *
     * Weighted by UNITS, not by value, for the same reason `wac_known` is:
     * value is exactly what is unknown on an uncosted line, so a value-weighted
     * ratio would divide the costed spend by itself and report 100% coverage
     * on every purchasing tile in the module.
     *
     * The scope excludes lines that received nothing -- a fully returned line
     * is not a gap in the cost data.
     */
    costed_receipt_line: Object.freeze({
        id: 'costed_receipt_line',
        label: 'Cost coverage',
        explanation:
            'Only receipt lines with a recorded landed cost are counted as spend. A line whose '
            + 'cost was never captured is stored as 0, indistinguishable from goods a supplier '
            + 'genuinely gave away, so it contributes units but no money. Purchase spend is '
            + 'therefore understated on a subset of receipts rather than guessed across all of '
            + 'them.',
        predicate: (c) => costedReceiptLineCondition(c.__alias),
        weight: (c) => `GREATEST(${c.quantity}, 0)`,
        scope: (c) => `${c.quantity} > 0`,
        thresholds: Object.freeze({ ok: 0.9, partial: 0.5 }),
        suppressBelow: 0,
    }),
});

const LEVELS = Object.freeze({ OK: 'ok', PARTIAL: 'partial', LOW: 'low', NONE: 'none' });

/**
 * Coverage level for a ratio under a rule's own thresholds.
 *
 * `none` is a distinct level, not the bottom of a scale: a 0% coverage badge
 * next to "0.00" reads as "we made no money", while "no cost data" reads as
 * "we do not know". The UI must be able to tell those apart.
 */
const levelFor = (ratio, rule) => {
    if (!(Number(ratio) > 0)) return LEVELS.NONE;
    const t = rule.thresholds;
    if (ratio >= t.ok) return LEVELS.OK;
    if (ratio >= t.partial) return LEVELS.PARTIAL;
    return LEVELS.LOW;
};

module.exports = { TRUST_RULES, LEVELS, levelFor };
