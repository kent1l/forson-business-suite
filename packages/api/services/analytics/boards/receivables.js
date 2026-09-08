/**
 * The Receivables & Cash board: "who owes us, and how fast do we collect?"
 *
 * This board exists to hold two figures next to each other that do not agree,
 * and to say why.
 *
 * `ar.balance` reads the A/R ledger, which is authoritative for what the A/R
 * module manages and begins at the cutover on 19 August 2026. `ar.open_balance`
 * reads every invoice that still carries a money balance, including the ones
 * raised before the ledger existed. Over this database they come to ₱202,507 and
 * ₱241,807. Neither is wrong; they answer different questions. Publishing one and
 * hiding the other is how a reader ends up trusting a number whose scope they
 * cannot see, so both lead the board and the difference between them is a metric
 * of its own.
 *
 * What is NOT counted as owed: the 312 pre-cutover invoices worth ₱1.49M that
 * were deliberately written off when the ledger went live (migration
 * 20260906_10). They still carry a balance on the invoice row. Reading the
 * invoice book without excluding them reports an exposure eight times the real
 * one — which is exactly what `invoice_aging` does, and why this board does not
 * use it.
 *
 * Three further rules:
 *
 * - **No trend over the ledger longer than the ledger.** §2 said not to plot
 *   three weeks as a trend; the movement chart is here because it is the only
 *   honest way to show collections, and every one of its tiles carries the era
 *   in its help text rather than leaving the reader to infer it from a line that
 *   starts at zero.
 * - **"No terms" is a first-class band.** 28 of 39 open invoices carry no due
 *   date at all, so most of the money owed can never appear as overdue. An
 *   aging chart that only bucketed overdue days would show a healthy book by
 *   omitting the majority of it.
 * - **Every tile ends somewhere a person can act** — Accounts Receivable, A/R
 *   Concessions, Cheques & Treasury. A receivables figure with no page behind it
 *   is a complaint.
 *
 * Thirty days by default. The ledger holds three weeks; a longer window would
 * make the movement tiles mostly empty, and the position tiles do not move with
 * the picker anyway.
 */

const POSITION_QUERY = {
    metrics: [
        'ar.balance',
        'ar.open_balance',
        'ar.ledger_gap',
        'ar.customers_owing',
        'ar.open_invoices',
        'ar.overdue_balance',
        'ar.untermed_balance',
        'ar.oldest_overdue_days',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const SHARE_QUERY = {
    metrics: ['ar.overdue_share', 'ar.untermed_share', 'ar.open_balance'],
    dimensions: [],
    grain: null,
    compare: null,
};

const MOVEMENT_QUERY = {
    metrics: [
        'ar.invoiced_to_account',
        'ar.collections',
        'ar.collection_rate',
        'ar.concessions_granted',
        'ar.write_downs',
        'ar.adjustments_reversed',
        'ar.bounced_cheque_value',
    ],
    dimensions: [],
    grain: null,
    compare: 'previous_period',
};

const PDC_QUERY = {
    metrics: ['ar.pdc_outstanding_value', 'ar.pdc_outstanding_count', 'ar.pdc_bounced_value'],
    dimensions: [],
    grain: null,
    compare: null,
};

const LEDGER_ERA =
    'The A/R ledger begins on 18 August 2026, when the module went live. Over a range that '
    + 'starts earlier this reads as a collapse in activity when the truth is that there is no '
    + 'ledger to read — check the date picker before drawing a conclusion from the shape.';

const kpi = (id, value, query, span, extra = {}) => ({
    id,
    type: 'kpi',
    span: { base: 12, md: 6, lg: 3, ...(span || {}) },
    display: { value, ...(extra.display || {}) },
    query,
    ...(extra.drilldown ? { drilldown: extra.drilldown } : {}),
    ...(extra.title ? { title: extra.title } : {}),
    ...(extra.help ? { help: extra.help } : {}),
});

const RECEIVABLES_BOARD = {
    id: 'receivables',
    title: 'Receivables & Cash',
    description:
        'What is owed, how old it is, what moved through the A/R ledger, and which cheques have '
        + 'not cleared. Two different answers to "what are we owed" are shown side by side, '
        + 'because they measure different things.',
    defaultPreset: 'last_30_days',
    tiles: [
        kpi('ar.position', 'ar.open_balance', POSITION_QUERY, { lg: 4 }, {
            display: { emphasis: 'hero', asOf: 'now' },
            title: 'Owed on Open Invoices',
            help: 'Every invoice that has not been settled, cancelled or written off, net of any '
                + 'credit note against it. This is the whole invoice book — including invoices '
                + 'raised before the A/R ledger existed — so it is the larger of the two figures '
                + 'and the one to quote as total exposure.',
            drilldown: { kind: 'page', page: 'ar', params: {} },
        }),
        kpi('ar.ledger_balance', 'ar.balance', POSITION_QUERY, { lg: 4 }, {
            display: { asOf: 'now' },
            title: 'On the A/R Ledger',
            help: 'The same question asked of the A/R ledger, which is authoritative for what the '
                + 'A/R module manages and knows only invoices raised since 19 August 2026. It is '
                + 'lower than the figure beside it, and that difference is the next tile.',
            drilldown: { kind: 'page', page: 'ar', params: {} },
        }),
        kpi('ar.gap', 'ar.ledger_gap', POSITION_QUERY, { lg: 4 }, {
            display: { asOf: 'now' },
            help: 'The difference between the two figures beside this one: money owed on invoices '
                + 'the ledger does not carry, almost all of it raised before the ledger went '
                + 'live. It is not an error in either number — it is the size of the gap, stated '
                + 'rather than hidden. It shrinks on its own as the older invoices settle.',
        }),

        kpi('ar.overdue', 'ar.overdue_balance', POSITION_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
            help: 'Owed on invoices past their due date. Read it together with the tile beside '
                + 'it: an invoice with no agreed terms can never become overdue however long it '
                + 'sits, so a low figure here is not by itself good news.',
            drilldown: { kind: 'page', page: 'ar', params: {} },
        }),
        kpi('ar.untermed', 'ar.untermed_balance', POSITION_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
            help: 'Owed on invoices that carry no due date at all. This money can never appear in '
                + 'an aging report, however old it gets, because nobody ever agreed when it was '
                + 'payable. On this data it is the majority of what is owed.',
            drilldown: { kind: 'page', page: 'ar', params: {} },
        }),
        kpi('ar.open_count', 'ar.open_invoices', POSITION_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
        }),
        kpi('ar.accounts_owing', 'ar.customers_owing', POSITION_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
        }),

        {
            id: 'ar.aging',
            type: 'bar',
            title: 'How old is what we are owed',
            help: '"No payment terms" is a band here, not a missing value. An invoice without a '
                + 'due date cannot be overdue, so leaving those rows out would draw a healthy '
                + 'aging chart over a minority of the money and folding them into "not yet due" '
                + 'would claim they are fine. They read last because they are the least '
                + 'answerable, not the least urgent.',
            span: { base: 12, md: 12, lg: 7 },
            query: {
                metrics: ['ar.open_balance', 'ar.open_invoices'],
                dimensions: ['aging_bucket'],
                grain: null,
                compare: null,
                sort: { by: 'aging_bucket', dir: 'ASC' },
            },
            display: { value: 'ar.open_balance', category: 'aging_bucket' },
        },
        {
            id: 'ar.shares',
            type: 'table',
            title: 'What the aging chart can and cannot tell you',
            help: 'The two shares side by side. The higher the "no terms" share, the less an '
                + 'aging report says about this business — and the more of collections is a '
                + 'conversation rather than a process.',
            span: { base: 12, md: 12, lg: 5 },
            query: {
                metrics: ['ar.open_balance', 'ar.overdue_balance', 'ar.untermed_balance'],
                dimensions: ['aging_bucket'],
                grain: null,
                compare: null,
                sort: { by: 'aging_bucket', dir: 'ASC' },
            },
            display: {
                columns: ['ar.open_balance', 'ar.overdue_balance', 'ar.untermed_balance'],
                category: 'aging_bucket',
                bar: 'ar.open_balance',
            },
        },

        {
            id: 'ar.by_customer',
            type: 'table',
            title: 'Who owes us',
            help: 'Open invoice balances by account, largest first, with the overdue portion '
                + 'beside the total. Everything below the fifteenth account is added together '
                + 'rather than cut off, so the total at the bottom is the whole book and matches '
                + 'the figure at the top of this board. Click a row to open Accounts Receivable.',
            span: { base: 12, md: 12, lg: 12 },
            query: {
                metrics: ['ar.open_balance', 'ar.overdue_balance', 'ar.open_invoices', 'ar.oldest_overdue_days'],
                dimensions: ['customer'],
                grain: null,
                compare: null,
                sort: { by: 'ar.open_balance', dir: 'DESC' },
                // A rollup rather than a bare limit. With a limit the footer
                // total is the sum of the rows that fitted, and a table whose
                // total disagrees with the hero KPI above it reads as a bug in
                // one of them. Note this is also the tile that made
                // `ar.oldest_overdue_days` declare `fold: 'max'`: 'Other' shows
                // the oldest invoice among the accounts it folded, not the sum
                // of their ages.
                topN: { n: 15, by: 'ar.open_balance' },
            },
            display: {
                columns: ['ar.open_balance', 'ar.overdue_balance', 'ar.open_invoices', 'ar.oldest_overdue_days'],
                category: 'customer',
                rank: true,
                bar: 'ar.open_balance',
            },
            drilldown: { kind: 'page', page: 'ar', params: {} },
        },

        // --- ledger movement. Everything below here is a PERIOD figure and
        // moves with the date picker, unlike everything above it.
        kpi('ar.collected', 'ar.collections', MOVEMENT_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
            help: `Payments settled against customer accounts in this period. ${LEDGER_ERA}`,
        }),
        kpi('ar.charged', 'ar.invoiced_to_account', MOVEMENT_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
            help: `What was charged to customer accounts in this period. ${LEDGER_ERA}`,
        }),
        kpi('ar.collection_rate', 'ar.collection_rate', MOVEMENT_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
            help: 'Collected as a percentage of charged, within the same period. Above 100% means '
                + 'older balances were being paid down; below means the book grew. It is not a '
                + 'collection rate on this period\'s own invoices — a payment settles whatever is '
                + 'oldest, not what was raised this month.',
        }),
        kpi('ar.dso', 'ar.dso', {
            metrics: ['ar.dso', 'ar.balance', 'sales.credit_revenue'],
            dimensions: [],
            grain: null,
            compare: null,
        }, { lg: 3 }, {
            help: 'Days Sales Outstanding, over credit sales only — walk-in cash sales are '
                + 'excluded, because including 82% of revenue that is settled at the counter '
                + 'would drag the figure toward zero and hide a real problem in the credit book. '
                + `Treat it as an indication, not a trend: ${LEDGER_ERA}`,
        }),

        {
            id: 'ar.movement_trend',
            type: 'line',
            title: 'Charged and collected over time',
            help: `Money onto accounts against money off them, per period. ${LEDGER_ERA}`,
            span: { base: 12, md: 12, lg: 7 },
            query: {
                metrics: ['ar.collections'],
                dimensions: ['date'],
                grain: 'auto',
                minGrain: 'day',
                compare: 'previous_period',
            },
            display: {
                value: 'ar.collections',
                compare: { show: true, as: 'overlay' },
            },
        },
        {
            id: 'ar.movement_table',
            type: 'table',
            title: 'What moved on the ledger',
            help: 'Every kind of movement recorded against customer accounts in this period, with '
                + 'its signed effect on the book: positive grew it, negative shrank it. This is '
                + 'the whole story of the receivable in one table, and it reconciles — the '
                + `movements add up to the change in the balance. ${LEDGER_ERA}`,
            span: { base: 12, md: 12, lg: 5 },
            query: {
                metrics: ['ar.ledger_movement', 'ar.ledger_entries'],
                dimensions: ['ar_entry_type'],
                grain: null,
                sort: { by: 'ar.ledger_movement', dir: 'ASC' },
            },
            display: {
                columns: ['ar.ledger_movement', 'ar.ledger_entries'],
                category: 'ar_entry_type',
            },
        },

        kpi('ar.concessions', 'ar.concessions_granted', MOVEMENT_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
            help: 'Settlement discounts written off customer balances in this period — money that '
                + 'was invoiced and then agreed not to be collected. Gross: reversals are counted '
                + 'separately rather than netted off, because the ledger does not record which '
                + 'kind of adjustment a reversal cancels.',
            drilldown: { kind: 'page', page: 'ar_concessions', params: {} },
        }),
        kpi('ar.write_downs', 'ar.write_downs', MOVEMENT_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
            drilldown: { kind: 'page', page: 'ar_concessions', params: {} },
        }),
        kpi('ar.reversed', 'ar.adjustments_reversed', MOVEMENT_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
            drilldown: { kind: 'page', page: 'ar_concessions', params: {} },
        }),
        kpi('ar.bounced', 'ar.bounced_cheque_value', MOVEMENT_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
            help: 'Cheques that failed to clear in this period, putting the balance back onto the '
                + 'customer account. Each one is a payment that was recorded, counted on, and '
                + 'then taken away again.',
            drilldown: { kind: 'page', page: 'cheques_treasury', params: {} },
        }),

        {
            id: 'ar.concessions_by_reason',
            type: 'table',
            title: 'Why balances were given up',
            help: 'Concessions and write-downs in this period by the reason recorded against '
                + 'them. A reason that grows quietly is usually discretion widening rather than '
                + 'circumstances changing. Click through to A/R Concessions to see the '
                + 'individual authorisations.',
            span: { base: 12, md: 12, lg: 7 },
            query: {
                metrics: ['ar.concessions_granted', 'ar.write_downs', 'ar.ledger_entries'],
                dimensions: ['adjustment_reason'],
                grain: null,
                sort: { by: 'ar.concessions_granted', dir: 'DESC' },
                limit: 12,
            },
            display: {
                columns: ['ar.concessions_granted', 'ar.write_downs', 'ar.ledger_entries'],
                category: 'adjustment_reason',
            },
            drilldown: { kind: 'page', page: 'ar_concessions', params: {} },
        },

        kpi('ar.pdc_value', 'ar.pdc_outstanding_value', PDC_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
            help: 'Cheques taken from customers that have not cleared the bank. Held, deposited '
                + 'and bounced cheques are all counted here: none of them is cash yet.',
            drilldown: { kind: 'page', page: 'cheques_treasury', params: {} },
        }),
        kpi('ar.pdc_count', 'ar.pdc_outstanding_count', PDC_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
            drilldown: { kind: 'page', page: 'cheques_treasury', params: {} },
        }),
        kpi('ar.pdc_bounced', 'ar.pdc_bounced_value', PDC_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
            drilldown: { kind: 'page', page: 'cheques_treasury', params: {} },
        }),
        kpi('ar.untermed_share', 'ar.untermed_share', SHARE_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
            help: 'The share of what is owed that sits on invoices with no payment terms. The '
                + 'higher it is, the less an aging report tells you about this business.',
        }),

        {
            id: 'ar.pdc_pipeline',
            type: 'table',
            title: 'Cheques in the pipeline',
            help: 'Uncleared cheques by their state. "Bounced" means the balance has already come '
                + 'back onto the customer\'s account and somebody owes that customer a '
                + 'conversation; the others are still money on the way.',
            span: { base: 12, md: 12, lg: 5 },
            query: {
                metrics: ['ar.pdc_outstanding_value', 'ar.pdc_outstanding_count'],
                dimensions: ['pdc_status'],
                grain: null,
                compare: null,
                sort: { by: 'ar.pdc_outstanding_value', dir: 'DESC' },
            },
            display: {
                columns: ['ar.pdc_outstanding_value', 'ar.pdc_outstanding_count'],
                category: 'pdc_status',
                bar: 'ar.pdc_outstanding_value',
            },
            drilldown: { kind: 'page', page: 'cheques_treasury', params: {} },
        },
    ],
};

module.exports = { RECEIVABLES_BOARD };
