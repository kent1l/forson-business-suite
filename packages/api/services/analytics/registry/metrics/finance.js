const ALL_GRAINS = ['none', 'day', 'week', 'month', 'quarter'];

/**
 * Operating-P&L metrics — registered now, dark until the data exists.
 *
 * The Expenses module holds a handful of rows and Payroll holds none, so a true
 * net profit is not computable today. These are declared anyway because that is
 * the point of a registry: `readiness` gates them, the frontend renders "not
 * being recorded yet" and never issues the query, and the day those modules
 * carry data the tiles light up with no code change.
 *
 * They sit behind `analytics:financials`, not `analytics:view`, so a metric a
 * user may not see is stripped from /meta and refused by /query.
 */
const FINANCE_METRICS = {
    'finance.operating_expenses': {
        id: 'finance.operating_expenses',
        label: 'Operating Expenses',
        description:
            'Recorded expenses excluding cost of goods sold, counted by expense date. Voided '
            + 'expenses are excluded.',
        kind: 'additive',
        source: 'expense',
        expr: (c) => `SUM(${c.amount})`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:financials',
        readiness: 'expense_data',
    },

    'finance.net_profit': {
        id: 'finance.net_profit',
        label: 'Net Profit',
        description:
            'Gross Profit less operating expenses. Requires both the Expenses and Payroll modules '
            + 'to be in use; until they are, this is deliberately shown as not recorded rather '
            + 'than as a number that ignores most of what the business spends.',
        kind: 'composite',
        terms: [
            { metric: 'margin.gross_profit', sign: 1 },
            { metric: 'finance.operating_expenses', sign: -1 },
        ],
        exposeComponents: true,
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:financials',
        readiness: 'payroll_data',
    },
};

module.exports = { FINANCE_METRICS };
