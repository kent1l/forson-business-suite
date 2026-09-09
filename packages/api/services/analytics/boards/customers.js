/**
 * The Customers board: "who are the named accounts, and what is the exposure?"
 *
 * One decision shaped everything on it. §2 of the PRD found that a single
 * customer record — the walk-in counter — carries 82-83% of revenue and 5,658 of
 * 6,095 invoices. Every customer figure computed over the whole invoice book is
 * therefore a figure about the counter queue wearing a customer's clothes:
 * "revenue per customer" comes out at ₱135K when the truth is that 84 named
 * accounts average ₱25K and the counter took ₱9.5M.
 *
 * So this board is measured over `named_invoice`, a fact source with the counter
 * removed, and it says so in every description. The consequence is a dependency:
 * until an admin names the walk-in record under Settings → Analytics, the
 * revenue half of this board renders "not recorded yet" with instructions,
 * because there is no way to guess which row it is and guessing wrong would make
 * the page state a confident falsehood about who the business depends on.
 *
 * The credit half is deliberately NOT gated. The counter record holds a default
 * limit and no ledger balance, so it neither distorts the exposure nor needs the
 * setting — which means the board still answers a real question out of the box,
 * and the gated tiles read as one missing setting rather than as a broken page.
 *
 * Ninety days, not thirty: with 387 named-account invoices in a year, a
 * thirty-day window puts about thirty invoices behind a concentration chart, and
 * a Pareto over thirty rows describes last month rather than the business.
 */

const HEADLINE_QUERY = {
    metrics: [
        'customers.named_revenue',
        'customers.active_accounts',
        'customers.new_accounts',
        'customers.returning_accounts',
        'customers.revenue_per_account',
        'customers.avg_account_order',
        'customers.orders_per_account',
    ],
    dimensions: [],
    grain: null,
    compare: 'previous_period',
};

const CREDIT_QUERY = {
    metrics: [
        'customers.credit_limit_total',
        'customers.credit_exposure',
        'customers.credit_utilisation',
        'customers.accounts_over_limit',
        'customers.accounts_owing',
        'customers.accounts_on_hold',
    ],
    dimensions: [],
    grain: null,
    // A position as of now cannot be compared with a period, and asking would be
    // refused by the builder. Written out rather than omitted so the intent is
    // visible next to the tiles that do compare.
    compare: null,
};

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

const CUSTOMERS_BOARD = {
    id: 'customers',
    title: 'Customers',
    description:
        'The customer book with counter trade taken out of it: who the named accounts are, how '
        + 'concentrated the revenue is among them, which vintages are still buying, and how much '
        + 'credit is drawn against what was granted.',
    defaultPreset: 'last_90_days',
    tiles: [
        kpi('cust.revenue', 'customers.named_revenue', HEADLINE_QUERY, { lg: 4 }, {
            display: { emphasis: 'hero', compare: { show: true } },
            help: 'Invoiced sales to named accounts in this period. The walk-in counter record is '
                + 'excluded, so this is a small fraction of total revenue — and it is the only '
                + 'revenue figure it is meaningful to divide by a number of customers.',
        }),
        kpi('cust.accounts', 'customers.active_accounts', HEADLINE_QUERY, { lg: 4 }, {
            display: { compare: { show: true } },
            drilldown: { kind: 'page', page: 'customers', params: {} },
        }),
        kpi('cust.revenue_per_account', 'customers.revenue_per_account', HEADLINE_QUERY, { lg: 4 }, {
            display: { compare: { show: true } },
        }),

        kpi('cust.new', 'customers.new_accounts', HEADLINE_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
            help: 'Accounts whose first invoice ever falls inside this period. This database '
                + 'begins in September 2025, so over a twelve-month range nearly every account '
                + 'counts as new — the figure only means something over a window shorter than '
                + 'the history behind it.',
        }),
        kpi('cust.returning', 'customers.returning_accounts', HEADLINE_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
        }),
        kpi('cust.avg_order', 'customers.avg_account_order', HEADLINE_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
            help: 'The average size of an invoice to a named account. Compare it with Average '
                + 'Ticket on the Sales board, which is dominated by counter sales: the gap '
                + 'between the two is the difference between trade and retail.',
        }),
        kpi('cust.orders_per_account', 'customers.orders_per_account', HEADLINE_QUERY, { lg: 3 }, {
            display: { compare: { show: true } },
        }),

        // --- concentration -------------------------------------------------
        // §20.7's note: the rollup already does concentration. A Pareto is a
        // rollup with a running total, not a new query shape — so this is the
        // ordinary top-N fold with a cumulative column, and the fold is what
        // makes that column exact rather than a share of whatever fitted.
        {
            id: 'cust.concentration',
            type: 'table',
            title: 'Revenue concentration',
            help: 'The largest accounts, with a running share beside them. Read down the '
                + 'cumulative column to find how few customers make up most of the book — that '
                + 'number is the concentration risk. Everything not listed is folded into one '
                + 'row rather than dropped, so the running share reaches 100% and means it.',
            span: { base: 12, md: 12, lg: 7 },
            query: {
                metrics: ['customers.named_revenue', 'customers.named_invoices', 'customers.avg_account_order'],
                dimensions: ['customer'],
                grain: null,
                sort: { by: 'customers.named_revenue', dir: 'DESC' },
                topN: { n: 12, by: 'customers.named_revenue' },
            },
            display: {
                columns: ['customers.named_revenue', 'customers.named_invoices', 'customers.avg_account_order'],
                category: 'customer',
                rank: true,
                bar: 'customers.named_revenue',
                cumulative: 'customers.named_revenue',
            },
            drilldown: { kind: 'filter', dimension: 'customer' },
        },
        {
            id: 'cust.top_accounts',
            type: 'bar',
            title: 'Largest accounts',
            help: 'The same ranking as the table, drawn. The grey bar is everything not named '
                + 'individually, and on a healthy book it should be the largest one.',
            span: { base: 12, md: 12, lg: 5 },
            query: {
                metrics: ['customers.named_revenue'],
                dimensions: ['customer'],
                grain: null,
                sort: { by: 'customers.named_revenue', dir: 'DESC' },
                topN: { n: 8, by: 'customers.named_revenue' },
            },
            display: { value: 'customers.named_revenue', category: 'customer' },
            drilldown: { kind: 'filter', dimension: 'customer' },
        },

        // --- retention -----------------------------------------------------
        {
            id: 'cust.cohort_revenue',
            type: 'bar',
            title: 'Revenue by when the account was won',
            help: 'This period\'s revenue, split by the month each account first bought. It '
                + 'answers the retention question this database can actually answer: are the '
                + 'customers won a year ago still buying, or is the book being carried by whoever '
                + 'arrived last? A classic cohort grid needs years of history; twelve months of it '
                + 'produces a mostly-empty triangle that reads as churn.',
            span: { base: 12, md: 12, lg: 7 },
            query: {
                metrics: ['customers.named_revenue'],
                dimensions: ['customer_cohort'],
                grain: null,
                sort: { by: 'customer_cohort', dir: 'ASC' },
                limit: 24,
            },
            display: { value: 'customers.named_revenue', category: 'customer_cohort' },
        },
        {
            id: 'cust.cohort_table',
            type: 'table',
            title: 'Cohorts',
            help: 'How many accounts of each vintage bought in this period, and what each vintage '
                + 'is worth on average. A cohort whose account count has fallen away but whose '
                + 'revenue per account has held up is a retention problem, not a pricing one.',
            span: { base: 12, md: 12, lg: 5 },
            query: {
                metrics: ['customers.active_accounts', 'customers.named_revenue', 'customers.revenue_per_account'],
                dimensions: ['customer_cohort'],
                grain: null,
                sort: { by: 'customer_cohort', dir: 'ASC' },
                limit: 24,
            },
            display: {
                columns: ['customers.active_accounts', 'customers.named_revenue', 'customers.revenue_per_account'],
                category: 'customer_cohort',
            },
        },

        {
            id: 'cust.by_type',
            type: 'bar',
            title: 'Government and private accounts',
            help: 'Government customers withhold tax at source and settle on their own schedule, '
                + 'so the split matters to both cash flow and the tax return. A bar that is '
                + 'entirely private means no customer record has been marked as a government '
                + 'account, not that none exists.',
            span: { base: 12, md: 6, lg: 5 },
            query: {
                metrics: ['customers.named_revenue', 'customers.active_accounts'],
                dimensions: ['customer_type'],
                grain: null,
                sort: { by: 'customers.named_revenue', dir: 'DESC' },
            },
            display: { value: 'customers.named_revenue', category: 'customer_type' },
            drilldown: { kind: 'filter', dimension: 'customer_type' },
        },
        {
            id: 'cust.trend',
            type: 'line',
            title: 'Named account revenue over time',
            help: 'Counter trade is excluded, so this line moves with the customer book rather '
                + 'than with footfall — a quiet week at the counter cannot hide a lost account, '
                + 'and vice versa.',
            span: { base: 12, md: 6, lg: 7 },
            query: {
                metrics: ['customers.named_revenue'],
                dimensions: ['date'],
                grain: 'auto',
                minGrain: 'week',
                compare: 'previous_period',
            },
            display: {
                value: 'customers.named_revenue',
                compare: { show: true, as: 'overlay' },
            },
        },

        // --- credit exposure. Ungated: see the note at the top of this file.
        kpi('cust.credit_drawn', 'customers.credit_exposure', CREDIT_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
            help: 'What active customers owe on the A/R ledger right now. An account in credit '
                + 'does not offset another account\'s debt here — being owed by one customer is '
                + 'not cancelled by owing another.',
            drilldown: { kind: 'page', page: 'ar', params: {} },
        }),
        kpi('cust.credit_extended', 'customers.credit_limit_total', CREDIT_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
            help: 'The sum of the credit limits on active customer records. Most of these are the '
                + 'system default rather than a limit anybody decided on, so read it as what the '
                + 'settings currently permit, not as a lending position.',
        }),
        kpi('cust.credit_utilisation', 'customers.credit_utilisation', CREDIT_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
        }),
        kpi('cust.over_limit', 'customers.accounts_over_limit', CREDIT_QUERY, { lg: 3 }, {
            display: { asOf: 'now' },
            help: 'Accounts whose balance has passed the limit on their record. Each one is a '
                + 'decision somebody should have been asked to make.',
            drilldown: { kind: 'page', page: 'ar', params: {} },
        }),
        {
            id: 'cust.exposure_table',
            type: 'table',
            title: 'Who owes the most',
            help: 'Active accounts ranked by what they owe on the ledger, with the limit each was '
                + 'granted beside it. Accounts below the twelfth are added together rather than '
                + 'cut off, so the total matches Credit Drawn above. Click a row to open Accounts '
                + 'Receivable.',
            span: { base: 12, md: 12, lg: 12 },
            query: {
                metrics: ['customers.credit_exposure', 'customers.credit_limit_total', 'customers.credit_utilisation'],
                dimensions: ['customer'],
                grain: null,
                compare: null,
                sort: { by: 'customers.credit_exposure', dir: 'DESC' },
                topN: { n: 12, by: 'customers.credit_exposure' },
            },
            display: {
                columns: ['customers.credit_exposure', 'customers.credit_limit_total', 'customers.credit_utilisation'],
                category: 'customer',
                rank: true,
                bar: 'customers.credit_exposure',
            },
            drilldown: { kind: 'page', page: 'ar', params: {} },
        },
    ],
};

module.exports = { CUSTOMERS_BOARD };
