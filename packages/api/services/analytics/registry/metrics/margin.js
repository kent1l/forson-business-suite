const ALL_GRAINS = ['none', 'day', 'week', 'month', 'quarter'];

/**
 * Margin metrics.
 *
 * Every metric here declares `trust: 'costed_line'`, which the query builder
 * turns into a FILTER on the aggregate *and* a coverage measurement of what
 * that filter excluded. There is no way to ask for gross profit without also
 * getting the answer to "over how much of the period?".
 *
 * A metric carrying a trust rule is left NULL, not 0, when nothing in the group
 * qualified. "We measured no profit here" and "profit here was zero" are
 * different statements and the UI has to be able to tell them apart.
 *
 * Six months from now, changing what gross margin means should mean editing
 * this file and nothing else. That is the acceptance criterion for the whole
 * analytics design.
 */
const MARGIN_METRICS = {
    'margin.costed_revenue': {
        id: 'margin.costed_revenue',
        label: 'Costed Revenue',
        description:
            'Ex-VAT revenue on the invoice lines that carry a recorded cost. This is the slice of '
            + 'sales that margin can actually be measured over, and the denominator of Gross Margin.',
        kind: 'additive',
        source: 'invoice_line',
        trust: 'costed_line',
        expr: (c) => `SUM(${c.revenue_ex_tax})`,
        format: 'currency',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'margin.cogs': {
        id: 'margin.cogs',
        label: 'Cost of Goods Sold',
        description:
            'Cost of the goods on invoice lines that carry a recorded cost, at the cost captured '
            + 'when the sale was made. Lines with no recorded cost contribute nothing to this '
            + 'figure and are excluded from Costed Revenue too, so the two always describe the '
            + 'same set of lines.',
        kind: 'additive',
        source: 'invoice_line',
        trust: 'costed_line',
        expr: (c) => `SUM(${c.quantity} * ${c.unit_cost})`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'margin.gross_profit': {
        id: 'margin.gross_profit',
        label: 'Gross Profit',
        description:
            'Ex-VAT revenue minus cost of goods sold, computed ONLY over invoice lines with a '
            + 'recorded cost. Lines with no cost are excluded from both sides, so this is a true '
            + 'profit on a subset of sales — never an estimate over all sales. Check the coverage '
            + 'badge before reading it as the period’s profit.',
        kind: 'additive',
        source: 'invoice_line',
        trust: 'costed_line',
        expr: (c) => `SUM(${c.revenue_ex_tax} - (${c.quantity} * ${c.unit_cost}))`,
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'margin.gross_margin_pct': {
        id: 'margin.gross_margin_pct',
        label: 'Gross Margin',
        description:
            'Gross Profit as a percentage of Costed Revenue. The denominator is costed revenue, '
            + 'not total revenue — dividing by total revenue would silently dilute the margin by '
            + 'the share of sales with no cost data, which is most of them.',
        kind: 'ratio',
        numerator: 'margin.gross_profit',
        denominator: 'margin.costed_revenue',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },
};

module.exports = { MARGIN_METRICS };
