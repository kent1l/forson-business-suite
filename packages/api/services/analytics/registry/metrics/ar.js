/**
 * Accounts receivable metrics.
 *
 * Balances come from the ledger view, which is authoritative. They are
 * snapshots -- what is owed right now -- not period figures.
 *
 * The ledger itself only starts in August 2026, so anything shaped like an A/R
 * *trend* is registered with `readiness: 'ar_ledger_data'` and stays out of the
 * Phase 0 boards. Plotting three weeks as a trend line is how a chart lies.
 */
const SNAPSHOT_ONLY = ['none'];

const AR_METRICS = {
    'ar.balance': {
        id: 'ar.balance',
        label: 'A/R Outstanding',
        description:
            'What customers currently owe, taken from the A/R ledger rather than reconstructed '
            + 'from invoice payments. This is a position as of now, not a figure for the selected '
            + 'period, so changing the date range does not change it.',
        kind: 'snapshot',
        source: 'ar_balance',
        expr: (c) => `SUM(${c.balance})`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.customers_owing': {
        id: 'ar.customers_owing',
        label: 'Customers Owing',
        description: 'Number of customers with a non-zero balance on the A/R ledger right now.',
        kind: 'snapshot',
        source: 'ar_balance',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.balance} <> 0`,
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.dso': {
        id: 'ar.dso',
        label: 'Days Sales Outstanding',
        description:
            'Average days to collect, measured over CREDIT sales only. Walk-in cash sales are '
            + 'excluded — including them would drag the figure toward zero and hide a real '
            + 'collection problem in the credit book. The A/R ledger only begins in August 2026, '
            + 'so this describes a short window rather than a trend.',
        kind: 'ratio',
        numerator: 'ar.balance',
        denominator: 'sales.credit_revenue',
        scale: { context: 'days_in_range' },
        zeroDenominator: null,
        format: 'days',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
        readiness: 'ar_ledger_data',
    },
};

module.exports = { AR_METRICS };
