const ALL_GRAINS = ['none', 'day', 'week', 'month', 'quarter'];
const SNAPSHOT_ONLY = ['none'];

/**
 * Customer metrics.
 *
 * THE ONE THING TO UNDERSTAND ABOUT THIS FILE. Every period metric here is
 * measured over `named_invoice`, not `invoice_header`, and that is not a
 * refinement — it is the difference between a figure and a falsehood.
 *
 * §2 of the PRD found that one customer record, the walk-in counter, carries
 * 82-83% of revenue and 5,658 of 6,095 invoices. Divide anything by a customer
 * count over `invoice_header` and the answer describes the counter queue: over
 * twelve months the business looks like 85 accounts averaging ₱135K each, when
 * the truth is 84 named accounts averaging ₱25K and a counter that took ₱9.5M.
 * Phase 2's concentration insight worked around this by subtracting the walk-in
 * row after the query. Phase 3 makes it structural: the counter is not in the
 * source, so a metric defined here cannot include it.
 *
 * The cost is a dependency. `named_invoice` cannot be built until an admin names
 * the walk-in record in Settings → Analytics, so every metric on it declares
 * `readiness: 'walkin_customer_identified'` and the tiles render "not recorded
 * yet" with instructions rather than a wrong number. That trade is the right way
 * round: the module exists to refuse plausible wrong answers.
 *
 * Credit exposure is the exception and is NOT gated. It is measured over
 * `customer_credit`, where the counter record holds a default limit and no
 * balance, so it neither distorts the total nor needs the setting — which means
 * the Customers board still answers a real question out of the box.
 */
const CUSTOMER_METRICS = {
    'customers.named_revenue': {
        id: 'customers.named_revenue',
        label: 'Named Account Revenue',
        description:
            'Ex-VAT invoiced sales to named accounts in the period — the walk-in counter record '
            + 'is excluded. This is the revenue that belongs to a customer relationship rather '
            + 'than to footfall, and it is the only revenue figure it is meaningful to divide by '
            + 'a number of customers.',
        kind: 'additive',
        source: 'named_invoice',
        readiness: 'walkin_customer_identified',
        expr: (c) => `SUM(${c.revenue_ex_tax})`,
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'customers.named_invoices': {
        id: 'customers.named_invoices',
        label: 'Named Account Invoices',
        description:
            'Invoices raised against a named account in the period. Counter sales are excluded, '
            + 'so this is a fraction of the total invoice count and is meant to be.',
        kind: 'additive',
        source: 'named_invoice',
        readiness: 'walkin_customer_identified',
        expr: (c) => `COUNT(DISTINCT ${c.invoice_id})`,
        format: 'integer',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'customers.active_accounts': {
        id: 'customers.active_accounts',
        label: 'Active Accounts',
        description:
            'Named customers who bought at least once in the period. Unlike Customers Served on '
            + 'the Sales board, this does not count the walk-in record, so it really is a number '
            + 'of accounts.',
        kind: 'additive',
        source: 'named_invoice',
        readiness: 'walkin_customer_identified',
        expr: (c) => `COUNT(DISTINCT ${c.customer_id})`,
        format: 'integer',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'customers.new_accounts': {
        id: 'customers.new_accounts',
        label: 'New Accounts',
        description:
            'Accounts whose very first invoice — ever, not merely their first in this range — '
            + 'falls inside the period. Note that this database begins in September 2025, so over '
            + 'a twelve-month range almost every account counts as new; the figure is only '
            + 'meaningful over a window shorter than the history behind it.',
        kind: 'additive',
        source: 'named_invoice',
        readiness: 'walkin_customer_identified',
        expr: (c) => `COUNT(DISTINCT ${c.customer_id})`,
        where: (c) => c.is_first_invoice,
        format: 'integer',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'customers.returning_accounts': {
        id: 'customers.returning_accounts',
        label: 'Returning Accounts',
        description:
            'Accounts that bought in the period and had bought before it. Active Accounts minus '
            + 'New Accounts, computed after aggregation so it holds per period rather than per '
            + 'invoice.',
        kind: 'composite',
        terms: [
            { metric: 'customers.active_accounts', sign: 1 },
            { metric: 'customers.new_accounts', sign: -1 },
        ],
        exposeComponents: true,
        readiness: 'walkin_customer_identified',
        format: 'integer',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'customers.revenue_per_account': {
        id: 'customers.revenue_per_account',
        label: 'Revenue per Account',
        description:
            'Named account revenue divided by the number of accounts that bought. The figure the '
            + 'walk-in record makes meaningless on every other board, which is why it lives here.',
        kind: 'ratio',
        numerator: 'customers.named_revenue',
        denominator: 'customers.active_accounts',
        zeroDenominator: null,
        readiness: 'walkin_customer_identified',
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'customers.orders_per_account': {
        id: 'customers.orders_per_account',
        label: 'Orders per Account',
        description:
            'How many times a typical account bought in the period. Rising means the same '
            + 'customers are coming back more often, which is usually cheaper than winning new '
            + 'ones.',
        kind: 'ratio',
        numerator: 'customers.named_invoices',
        denominator: 'customers.active_accounts',
        zeroDenominator: null,
        readiness: 'walkin_customer_identified',
        format: 'ratio',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'customers.avg_account_order': {
        id: 'customers.avg_account_order',
        label: 'Average Account Order',
        description:
            'Named account revenue divided by the number of invoices to named accounts. Compare '
            + 'it with Average Ticket on the Sales board: that one is dominated by counter sales, '
            + 'and the gap between the two is the difference between trade and retail.',
        kind: 'ratio',
        numerator: 'customers.named_revenue',
        denominator: 'customers.named_invoices',
        zeroDenominator: null,
        readiness: 'walkin_customer_identified',
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    // -----------------------------------------------------------------------
    // Credit exposure. Positions as of now, and NOT gated on the walk-in
    // setting -- see the note at the top of this file.
    // -----------------------------------------------------------------------

    'customers.credit_limit_total': {
        id: 'customers.credit_limit_total',
        label: 'Credit Extended',
        description:
            'The sum of the credit limits granted to active customers. Note that most of these '
            + 'are the system default rather than a limit anyone decided on, so read this as the '
            + 'exposure the settings currently permit, not as a considered lending position.',
        kind: 'snapshot',
        source: 'customer_credit',
        expr: (c) => `SUM(${c.credit_limit})`,
        format: 'currency',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'customers.credit_exposure': {
        id: 'customers.credit_exposure',
        label: 'Credit Drawn',
        description:
            'What active customers currently owe on the A/R ledger, counting only accounts that '
            + 'are in debt. An account in credit is not negative exposure, so it does not offset '
            + 'another account\'s balance here.',
        kind: 'snapshot',
        source: 'customer_credit',
        expr: (c) => `SUM(${c.balance})`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'customers.credit_utilisation': {
        id: 'customers.credit_utilisation',
        label: 'Credit Utilisation',
        description:
            'Credit drawn as a percentage of credit extended. Low is not automatically good — on '
            + 'mostly-default limits it mainly says the limits are larger than the trade.',
        kind: 'ratio',
        numerator: 'customers.credit_exposure',
        denominator: 'customers.credit_limit_total',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'customers.accounts_over_limit': {
        id: 'customers.accounts_over_limit',
        label: 'Accounts Over Their Limit',
        description:
            'Active customers whose ledger balance exceeds the credit limit on their record. Each '
            + 'one is a decision someone should have been asked to make.',
        kind: 'snapshot',
        source: 'customer_credit',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.balance} > ${c.credit_limit}`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'customers.accounts_owing': {
        id: 'customers.accounts_owing',
        label: 'Accounts in Debt',
        description: 'Active customers with a positive balance on the A/R ledger right now.',
        kind: 'snapshot',
        source: 'customer_credit',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.balance} > 0`,
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'customers.accounts_on_hold': {
        id: 'customers.accounts_on_hold',
        label: 'Accounts on Credit Hold',
        description:
            'Active customers flagged so that no further credit sale can be made to them until '
            + 'somebody lifts the hold.',
        kind: 'snapshot',
        source: 'customer_credit',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.credit_hold} = TRUE`,
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },
};

module.exports = { CUSTOMER_METRICS };
