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
const ALL_GRAINS = ['none', 'day', 'week', 'month', 'quarter'];

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

    // -----------------------------------------------------------------------
    // The open invoice book.
    //
    // A SECOND, DIFFERENT ANSWER to "what are we owed", and the reason the
    // Receivables board shows both. `ar.balance` above reads the A/R ledger,
    // which begins at the 2026-08-19 cutover; these read every invoice that
    // still carries a balance, including those raised before it. Over this
    // database they come to ₱241,807 and ₱202,507 — neither is wrong, they
    // answer different questions, and picking one and hiding the other is how a
    // reader ends up trusting a figure whose scope they cannot see.
    //
    // What is deliberately NOT counted here: the 312 pre-cutover invoices worth
    // ₱1.49M that were written off when the ledger went live (migration
    // 20260906_10). They still carry a balance on the invoice row, and counting
    // them would report an exposure eight times the real one.
    // -----------------------------------------------------------------------

    'ar.open_balance': {
        id: 'ar.open_balance',
        label: 'Open Invoice Balance',
        description:
            'What is still owed across every invoice that has not been settled, cancelled or '
            + 'written off — net of any credit note raised against it. A position as of now, so '
            + 'changing the date range does not change it. Compare with A/R Outstanding, which '
            + 'reads the ledger and therefore only knows invoices raised since the ledger began.',
        kind: 'snapshot',
        source: 'open_receivable',
        expr: (c) => `SUM(${c.balance})`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.open_invoices': {
        id: 'ar.open_invoices',
        label: 'Open Invoices',
        description: 'How many invoices still carry a balance right now.',
        kind: 'snapshot',
        source: 'open_receivable',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.overdue_balance': {
        id: 'ar.overdue_balance',
        label: 'Overdue Balance',
        description:
            'Owed on invoices whose due date has passed. An invoice with no agreed payment terms '
            + 'can never be overdue and is NOT counted here — see Balance With No Terms, which is '
            + 'usually the larger figure on this data.',
        kind: 'snapshot',
        source: 'open_receivable',
        expr: (c) => `SUM(${c.balance})`,
        where: (c) => `COALESCE(${c.days_overdue}, 0) > 0`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.untermed_balance': {
        id: 'ar.untermed_balance',
        label: 'Balance With No Terms',
        description:
            'Owed on invoices that carry no due date at all. This money can never appear as '
            + 'overdue, however long it sits, because nobody ever agreed when it was payable — so '
            + 'an aging report that only looks at overdue balances misses it entirely.',
        kind: 'snapshot',
        source: 'open_receivable',
        expr: (c) => `SUM(${c.balance})`,
        where: (c) => `${c.due_date} IS NULL`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.untermed_share': {
        id: 'ar.untermed_share',
        label: 'Share With No Terms',
        description:
            'Balance With No Terms as a percentage of everything owed. The higher this is, the '
            + 'less an aging report tells you.',
        kind: 'ratio',
        numerator: 'ar.untermed_balance',
        denominator: 'ar.open_balance',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.overdue_share': {
        id: 'ar.overdue_share',
        label: 'Share Overdue',
        description: 'Overdue Balance as a percentage of everything owed.',
        kind: 'ratio',
        numerator: 'ar.overdue_balance',
        denominator: 'ar.open_balance',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.oldest_overdue_days': {
        id: 'ar.oldest_overdue_days',
        label: 'Oldest Overdue',
        description:
            'How many days past its due date the most overdue open invoice is. Invoices with no '
            + 'terms are counted as zero, because there is no date for them to be past.',
        kind: 'snapshot',
        source: 'open_receivable',
        expr: (c) => `MAX(COALESCE(${c.days_overdue}, 0))`,
        // The registry's first metric that is not a SUM or a COUNT, and the
        // reason `fold` exists. Adding up each customer's oldest overdue invoice
        // produces a number in days that means nothing at all, and it would have
        // appeared in the total row of any table broken down by customer looking
        // entirely plausible.
        fold: 'max',
        format: 'days',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.ledger_gap': {
        id: 'ar.ledger_gap',
        label: 'Not on the Ledger',
        description:
            'The open invoice balance minus the A/R ledger balance. It is the money owed on '
            + 'invoices the ledger does not know about — almost all of it raised before the '
            + 'ledger went live on 19 August 2026. It is not an error in either figure; it is the '
            + 'size of the difference between them, stated rather than hidden.',
        kind: 'composite',
        terms: [
            { metric: 'ar.open_balance', sign: 1 },
            { metric: 'ar.balance', sign: -1 },
        ],
        exposeComponents: true,
        format: 'currency',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    // -----------------------------------------------------------------------
    // Ledger movement. Every one of these is gated on `ar_ledger_data`, and
    // every TREND over them must carry an era notice in the tile: the ledger
    // begins on 2026-08-18, so a twelve-month chart is eleven months of a flat
    // zero that reads as a collapse in collections rather than as absent
    // history.
    // -----------------------------------------------------------------------

    'ar.invoiced_to_account': {
        id: 'ar.invoiced_to_account',
        label: 'Charged to Accounts',
        description:
            'What was posted to customer accounts in the period — the credit side of the trade, '
            + 'taken from the A/R ledger rather than from invoices, so it counts what the ledger '
            + 'actually recorded.',
        kind: 'additive',
        source: 'ar_ledger',
        readiness: 'ar_ledger_data',
        expr: (c) => `SUM(${c.amount})`,
        where: (c) => `${c.entry_type} = 'INVOICE_POSTED'`,
        format: 'currency',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ar.collections': {
        id: 'ar.collections',
        label: 'Collected',
        description:
            'Payments settled against customer accounts in the period. The ledger stores these as '
            + 'negative movements; the sign is flipped here so the figure reads as money in.',
        kind: 'additive',
        source: 'ar_ledger',
        readiness: 'ar_ledger_data',
        expr: (c) => `SUM(-${c.amount})`,
        where: (c) => `${c.entry_type} = 'PAYMENT_SETTLED'`,
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ar.collection_rate': {
        id: 'ar.collection_rate',
        label: 'Collected vs Charged',
        description:
            'What was collected in the period as a percentage of what was charged to accounts in '
            + 'the same period. Above 100% means older balances were being paid down; below means '
            + 'the book is growing. It is NOT a collection rate on this period\'s own invoices — '
            + 'a payment settles whatever is oldest, not what was raised this month.',
        kind: 'ratio',
        numerator: 'ar.collections',
        denominator: 'ar.invoiced_to_account',
        scale: 100,
        zeroDenominator: null,
        readiness: 'ar_ledger_data',
        format: 'percent',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ar.concessions_granted': {
        id: 'ar.concessions_granted',
        label: 'Concessions Granted',
        description:
            'Settlement discounts written off a customer\'s balance in the period — money that was '
            + 'invoiced and then agreed not to be collected. Gross: see Adjustments Reversed for '
            + 'the ones that were later undone.',
        kind: 'additive',
        source: 'ar_ledger',
        readiness: 'ar_ledger_data',
        expr: (c) => `SUM(-${c.amount})`,
        where: (c) => `${c.entry_type} = 'SETTLEMENT_DISCOUNT'`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ar.write_downs': {
        id: 'ar.write_downs',
        label: 'Balances Written Down',
        description:
            'Bad debt written off customer accounts in the period. Gross, for the same reason as '
            + 'Concessions Granted.',
        kind: 'additive',
        source: 'ar_ledger',
        readiness: 'ar_ledger_data',
        expr: (c) => `SUM(-${c.amount})`,
        where: (c) => `${c.entry_type} = 'BALANCE_WRITE_DOWN'`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ar.adjustments_reversed': {
        id: 'ar.adjustments_reversed',
        label: 'Adjustments Reversed',
        description:
            'Concessions and write-downs that were undone in the period, putting the balance back '
            + 'on the account. Shown on its own rather than netted off either figure: the ledger '
            + 'does not record which kind of adjustment a reversal cancels, so subtracting it '
            + 'from one of them would be a guess presented as arithmetic.',
        kind: 'additive',
        source: 'ar_ledger',
        readiness: 'ar_ledger_data',
        expr: (c) => `SUM(${c.amount})`,
        where: (c) => `${c.entry_type} = 'ADJUSTMENT_REVERSAL'`,
        format: 'currency',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ar.bounced_cheque_value': {
        id: 'ar.bounced_cheque_value',
        label: 'Bounced Cheques',
        description:
            'Cheques that failed to clear in the period, putting the balance back on the '
            + 'customer\'s account. Each one is a payment that was recorded, spent against, and '
            + 'then taken away again.',
        kind: 'additive',
        source: 'ar_ledger',
        readiness: 'ar_ledger_data',
        expr: (c) => `SUM(${c.amount})`,
        where: (c) => `${c.entry_type} = 'PDC_BOUNCED_REVERSAL'`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ar.ledger_movement': {
        id: 'ar.ledger_movement',
        label: 'Net Movement',
        description:
            'The signed sum of every ledger entry in the period: positive means the book grew, '
            + 'negative means it shrank. Broken down by movement type, this is the whole story of '
            + 'what happened to the receivable in one table.',
        kind: 'additive',
        source: 'ar_ledger',
        readiness: 'ar_ledger_data',
        expr: (c) => `SUM(${c.amount})`,
        format: 'currency',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ar.ledger_entries': {
        id: 'ar.ledger_entries',
        label: 'Ledger Entries',
        description: 'How many movements were recorded against customer accounts in the period.',
        kind: 'additive',
        source: 'ar_ledger',
        readiness: 'ar_ledger_data',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    // -----------------------------------------------------------------------
    // The cheque pipeline. Positions: what is in the safe or with the bank
    // today, not how many cheques were taken in last month.
    // -----------------------------------------------------------------------

    'ar.pdc_outstanding_value': {
        id: 'ar.pdc_outstanding_value',
        label: 'Cheques Not Yet Cleared',
        description:
            'The value of cheques taken from customers that have not cleared the bank. Held, '
            + 'deposited and bounced cheques are all counted: none of them is cash yet.',
        kind: 'snapshot',
        source: 'pdc_outstanding',
        expr: (c) => `SUM(${c.amount})`,
        format: 'currency',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.pdc_outstanding_count': {
        id: 'ar.pdc_outstanding_count',
        label: 'Cheques in the Pipeline',
        description: 'How many customer cheques have not yet cleared.',
        kind: 'snapshot',
        source: 'pdc_outstanding',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'ar.pdc_bounced_value': {
        id: 'ar.pdc_bounced_value',
        label: 'Bounced and Unresolved',
        description:
            'Cheques that failed to clear and are still sitting in that state. Each one is a '
            + 'balance that came back onto a customer account and a conversation somebody owes '
            + 'that customer.',
        kind: 'snapshot',
        source: 'pdc_outstanding',
        expr: (c) => `SUM(${c.amount})`,
        where: (c) => `${c.pdc_status} = 'BOUNCED'`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },
};

module.exports = { AR_METRICS };
