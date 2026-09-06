/**
 * Cost coverage helpers.
 *
 * Most parts in this system carry `wac_cost = 0` because they were created or
 * imported without a cost, and both sale write paths copy that value straight
 * into `invoice_line.cost_at_sale`. The result is that "we don't know what this
 * cost" and "this cost nothing" are stored identically as 0.
 *
 * Any report that subtracts cost from revenue without excluding those lines
 * reports the full sale price as profit. This module is the single definition of
 * which lines carry a usable cost, so every profit figure in the system filters
 * the same way and can state how much of the revenue it actually measured.
 *
 * A line with cost 0 might genuinely be a free good, but current data cannot
 * distinguish that from a missing cost, so it is excluded. Profit is therefore
 * understated rather than invented -- the honest direction.
 */

/**
 * SQL predicate selecting invoice lines whose cost can be trusted.
 * @param {string} alias table alias for `invoice_line` (e.g. 'il')
 */
const costedLineCondition = (alias) =>
    `(${alias}.cost_at_sale IS NOT NULL AND ${alias}.cost_at_sale > 0)`;

/**
 * SQL predicate selecting parts whose weighted average cost can be trusted.
 * Used when costing refunds, which have no cost snapshot of their own.
 * @param {string} alias table alias for `part` (e.g. 'p')
 */
const costedPartCondition = (alias) =>
    `(${alias}.wac_cost IS NOT NULL AND ${alias}.wac_cost > 0)`;

/**
 * Coverage levels drive how the UI presents a profit figure. Below `low` the
 * figure is too thin to lead with; at zero there is nothing to show at all and
 * the caller must render "no cost data" rather than a confident 0.
 */
const COVERAGE_LEVELS = Object.freeze({
    OK: 'ok',
    PARTIAL: 'partial',
    LOW: 'low',
    NONE: 'none',
});

const levelFor = (ratio) => {
    if (!(ratio > 0)) return COVERAGE_LEVELS.NONE;
    if (ratio >= 0.9) return COVERAGE_LEVELS.OK;
    if (ratio >= 0.5) return COVERAGE_LEVELS.PARTIAL;
    return COVERAGE_LEVELS.LOW;
};

/**
 * Build the coverage object returned alongside every profit figure.
 *
 * `valueRatio` (revenue-weighted) is the headline: it is what actually weights
 * the profit. `rowRatio` is reported too because the two diverge sharply here --
 * a handful of high-value costed lines can carry most of the revenue.
 *
 * @param {object} input
 * @param {number} input.costedRevenue revenue on lines with a usable cost
 * @param {number} input.totalRevenue  revenue on all lines in scope
 * @param {number} [input.costedLines] count of lines with a usable cost
 * @param {number} [input.totalLines]  count of all lines in scope
 */
const buildCostCoverage = ({ costedRevenue, totalRevenue, costedLines, totalLines }) => {
    const num = Number(costedRevenue) || 0;
    const den = Number(totalRevenue) || 0;
    const numRows = Number(costedLines) || 0;
    const denRows = Number(totalLines) || 0;

    const valueRatio = den > 0 ? num / den : 0;

    return {
        basis: 'costed_lines',
        label: 'Cost coverage',
        explanation:
            'Profit is measured only on lines that carry a recorded cost. Lines whose cost was '
            + 'never captured are excluded from both revenue and cost, so profit reflects a '
            + 'subset of sales rather than an estimate across all of them.',
        costedRevenue: num,
        totalRevenue: den,
        costedLines: numRows,
        totalLines: denRows,
        valueRatio,
        rowRatio: denRows > 0 ? numRows / denRows : 0,
        level: levelFor(valueRatio),
    };
};

module.exports = {
    costedLineCondition,
    costedPartCondition,
    buildCostCoverage,
    COVERAGE_LEVELS,
};
