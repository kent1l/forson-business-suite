/**
 * Insight rules — the deterministic layer behind the insights panel.
 *
 * §14 of the PRD deferred this to after Phase 2 for a reason worth restating at
 * the top of the file it produced: **generated prose is the highest-risk part of
 * this feature, because it reads like a colleague talking and is therefore
 * trusted more than a number is.** On data this uneven, a confident sentence is
 * far more dangerous than a confident figure.
 *
 * Four rules follow from that, and none of them is negotiable:
 *
 * 1. **No LLM, ever.** Every sentence here is a template in this file with
 *    values substituted into it. Nothing is generated at runtime. §15 puts this
 *    out of scope through Phase 4; this file is what "deterministic rules only"
 *    means in practice.
 * 2. **Every insight cites the metrics it came from and carries their coverage.**
 *    A reader must be able to click through and disprove it. An insight that
 *    cannot be checked is an opinion.
 * 3. **The server sends a template and typed values, not a finished string.**
 *    Formatting belongs to /meta, keyed by metric id, exactly as it does for
 *    tiles — so "₱1.98M" and "60.4%" are written the same way in a sentence as
 *    on the tile it came from, and a currency change moves both.
 * 4. **Thresholds live here, named, never inline in a condition.** They are on
 *    their way to being admin-tunable; a rule whose number is buried in its own
 *    logic cannot be tuned without an engineer.
 *
 * A rule receives an evaluation context and returns whether it fires:
 *
 *   v(metricId)     the metric's total for the period
 *   d(metricId)     percentage change against the comparison period, or null
 *   prev(metricId)  the comparison period's total, or null
 *   rows            the result rows, for rules that need a breakdown
 *   t               this rule's own thresholds
 *   settings        the analytics settings, for the few rules that need one
 *
 * `when` must be total about missing data. Every one of these metrics can be
 * null -- that is the whole point of the module -- and `null > 25` is false in
 * JavaScript but `null < 25` is TRUE, which would fire a "coverage is low"
 * insight on a period with no data at all.
 */

const SEVERITIES = new Set(['info', 'warning', 'critical']);

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

const INSIGHT_RULES = Object.freeze({
    'insight.cost_coverage': Object.freeze({
        id: 'insight.cost_coverage',
        severity: 'warning',
        boards: Object.freeze(['overview', 'profitability', 'data_trust']),
        thresholds: Object.freeze({ coveragePct: 80 }),
        query: Object.freeze({
            metrics: Object.freeze([
                'quality.cost_coverage_pct',
                'quality.uncosted_line_count',
                'quality.uncosted_revenue',
            ]),
        }),
        when: ({ v, t }) => {
            const coverage = num(v('quality.cost_coverage_pct'));
            // Null means nothing sold, not that coverage is zero.
            return coverage !== null && coverage < t.coveragePct;
        },
        template:
            'Profit and margin are measured on only {coverage} of what you sold. '
            + '{lines} sale lines carry no cost, covering {revenue} of revenue whose profit '
            + 'cannot be worked out at all.',
        values: ({ v }) => ({
            coverage: { metric: 'quality.cost_coverage_pct', value: v('quality.cost_coverage_pct') },
            lines: { metric: 'quality.uncosted_line_count', value: v('quality.uncosted_line_count') },
            revenue: { metric: 'quality.uncosted_revenue', value: v('quality.uncosted_revenue') },
        }),
        cites: Object.freeze(['quality.cost_coverage_pct', 'quality.uncosted_line_count', 'quality.uncosted_revenue']),
        action: Object.freeze({ page: 'cost_data_health', label: 'Fix cost data' }),
    }),

    'insight.dead_stock': Object.freeze({
        id: 'insight.dead_stock',
        severity: 'warning',
        boards: Object.freeze(['overview', 'inventory']),
        thresholds: Object.freeze({ sharePct: 25 }),
        query: Object.freeze({
            metrics: Object.freeze([
                'inventory.dead_stock_value',
                'inventory.dead_stock_share',
                'inventory.dead_stock_parts',
            ]),
        }),
        when: ({ v, t }) => {
            const share = num(v('inventory.dead_stock_share'));
            return share !== null && share > t.sharePct;
        },
        template:
            '{value} of stock — {share} of everything on the shelf, across {parts} parts — '
            + 'has not sold in 180 days. That is money already spent that is not coming back '
            + 'through the counter.',
        values: ({ v }) => ({
            value: { metric: 'inventory.dead_stock_value', value: v('inventory.dead_stock_value') },
            share: { metric: 'inventory.dead_stock_share', value: v('inventory.dead_stock_share') },
            parts: { metric: 'inventory.dead_stock_parts', value: v('inventory.dead_stock_parts') },
        }),
        cites: Object.freeze(['inventory.dead_stock_value', 'inventory.dead_stock_share', 'inventory.dead_stock_parts']),
        action: Object.freeze({ board: 'inventory', label: 'Open Inventory' }),
    }),

    'insight.reorder': Object.freeze({
        id: 'insight.reorder',
        severity: 'critical',
        boards: Object.freeze(['overview', 'inventory']),
        thresholds: Object.freeze({ minParts: 1 }),
        query: Object.freeze({
            metrics: Object.freeze(['inventory.reorder_parts', 'inventory.reorder_revenue_90d']),
        }),
        when: ({ v, t }) => {
            const parts = num(v('inventory.reorder_parts'));
            return parts !== null && parts >= t.minParts;
        },
        // The window is 30 days, not the PRD's original 14: the sentence has to
        // describe what `reorder_candidates` actually selects, or the reader
        // cannot reconcile it with the list it links to.
        template:
            '{parts} parts that sell steadily are down to under a month of stock, or are out '
            + 'already. They took {revenue} over the last 90 days, and that is what an empty '
            + 'shelf puts at risk.',
        values: ({ v }) => ({
            parts: { metric: 'inventory.reorder_parts', value: v('inventory.reorder_parts') },
            revenue: { metric: 'inventory.reorder_revenue_90d', value: v('inventory.reorder_revenue_90d') },
        }),
        cites: Object.freeze(['inventory.reorder_parts', 'inventory.reorder_revenue_90d']),
        action: Object.freeze({ board: 'inventory', label: 'See the reorder list' }),
    }),

    'insight.uncosted_parts': Object.freeze({
        id: 'insight.uncosted_parts',
        severity: 'info',
        boards: Object.freeze(['overview', 'inventory', 'data_trust']),
        thresholds: Object.freeze({ minParts: 500 }),
        query: Object.freeze({
            metrics: Object.freeze(['inventory.uncosted_stocked_parts', 'inventory.stocked_parts']),
        }),
        when: ({ v, t }) => {
            const parts = num(v('inventory.uncosted_stocked_parts'));
            return parts !== null && parts >= t.minParts;
        },
        template:
            '{uncosted} of your {stocked} stocked parts carry no cost at all, so their stock '
            + 'is worth something the system cannot state — and every sale of them adds to the '
            + 'revenue whose profit is unknown.',
        values: ({ v }) => ({
            uncosted: { metric: 'inventory.uncosted_stocked_parts', value: v('inventory.uncosted_stocked_parts') },
            stocked: { metric: 'inventory.stocked_parts', value: v('inventory.stocked_parts') },
        }),
        cites: Object.freeze(['inventory.uncosted_stocked_parts', 'inventory.stocked_parts']),
        action: Object.freeze({ page: 'cost_data_health', label: 'Fix cost data' }),
    }),

    'insight.period_movement': Object.freeze({
        id: 'insight.period_movement',
        severity: 'info',
        boards: Object.freeze(['overview', 'sales']),
        thresholds: Object.freeze({ movePct: 10, minBaselineShare: 0.2 }),
        query: Object.freeze({
            metrics: Object.freeze(['sales.net_revenue']),
            compare: 'previous_period',
        }),
        when: ({ v, d, prev, t }) => {
            const move = num(d('sales.net_revenue'));
            // `null` here means there was no comparable period at all — with only
            // twelve months of history that is common, and it is not a movement
            // of zero.
            if (move === null || Math.abs(move) < t.movePct) return false;

            // The baseline has to be a baseline. On "last 12 months" the period
            // before it is mostly older than the database, so the comparison came
            // out as "revenue is up 10,025%" — arithmetically correct and a
            // confident falsehood about the business. A prior period holding less
            // than a fifth of this one's revenue is partial history, not a
            // movement, and the trend chart shows it honestly where a sentence
            // cannot. §13's R13 in the direction nobody expected it.
            const current = num(v('sales.net_revenue'));
            const before = num(prev('sales.net_revenue'));
            if (current === null || before === null) return false;
            if (Math.abs(before) < Math.abs(current) * t.minBaselineShare) return false;
            return true;
        },
        template: 'Revenue is {direction} {move} against the previous period — {current} against {previous}.',
        values: ({ v, d, prev }) => {
            const move = num(d('sales.net_revenue'));
            return {
                direction: { value: move !== null && move < 0 ? 'down' : 'up', format: 'text' },
                move: { value: move === null ? null : Math.abs(move), format: 'percent' },
                current: { metric: 'sales.net_revenue', value: v('sales.net_revenue') },
                previous: { metric: 'sales.net_revenue', value: prev('sales.net_revenue') },
            };
        },
        cites: Object.freeze(['sales.net_revenue']),
        action: Object.freeze({ board: 'sales', label: 'Open Sales' }),
    }),

    'insight.refund_spike': Object.freeze({
        id: 'insight.refund_spike',
        severity: 'warning',
        boards: Object.freeze(['overview', 'sales']),
        thresholds: Object.freeze({ risePct: 50, floorPct: 1 }),
        query: Object.freeze({
            metrics: Object.freeze(['sales.refund_rate', 'sales.refunds']),
            compare: 'previous_period',
        }),
        when: ({ v, prev, t }) => {
            const now = num(v('sales.refund_rate'));
            const before = num(prev('sales.refund_rate'));
            // A rise from 0.01% to 0.02% is a 100% increase and means nothing, so
            // the rate must also clear a floor before this is worth saying.
            if (now === null || before === null || before <= 0) return false;
            if (now < t.floorPct) return false;
            return ((now - before) / before) * 100 >= t.risePct;
        },
        template:
            'Refunds are running at {rate} of revenue, up from {previous}. Remember these are '
            + 'counted when the credit note was raised, so a large refund of an earlier month’s '
            + 'sale lands in this one.',
        values: ({ v, prev }) => ({
            rate: { metric: 'sales.refund_rate', value: v('sales.refund_rate') },
            previous: { metric: 'sales.refund_rate', value: prev('sales.refund_rate') },
        }),
        cites: Object.freeze(['sales.refund_rate', 'sales.refunds']),
        action: Object.freeze({ board: 'sales', label: 'Open Sales' }),
    }),

    'insight.customer_concentration': Object.freeze({
        id: 'insight.customer_concentration',
        severity: 'info',
        boards: Object.freeze(['overview', 'sales', 'customers']),
        thresholds: Object.freeze({ sharePct: 20 }),
        query: Object.freeze({
            // Phase 3 moved this off `sales.gross_revenue`. The counter is now
            // excluded in SQL, by the `named_invoice` fact source, rather than
            // subtracted from the rows afterwards — so the sentence and the
            // Customers board it links to are computed from one definition of
            // "named account" instead of two that could drift apart.
            metrics: Object.freeze(['customers.named_revenue']),
            dimensions: Object.freeze(['customer']),
            // The fold makes the denominator exact: nothing was truncated, so a
            // share of the total really is a share of the period.
            topN: Object.freeze({ n: 6, by: 'customers.named_revenue' }),
        }),
        concentrationMetric: 'customers.named_revenue',
        // Still declared, and still load-bearing. The metric's own readiness gate
        // covers the same ground, but this rule is the one that would announce
        // which customer the business depends on, and it should refuse for a
        // reason stated in the rule rather than only as a side effect of how its
        // source happens to be built.
        requiresSetting: 'ANALYTICS_WALKIN_CUSTOMER_ID',
        when: ({ named, t }) => named !== null && named.sharePct >= t.sharePct,
        template:
            '{name} is {share} of everything sold to named accounts ({value} of {total}). '
            + 'Walk-in counter trade is excluded, so this is concentration among the customers '
            + 'you invoice.',
        values: ({ named }) => ({
            name: { value: named ? named.label : null, format: 'text' },
            share: { value: named ? named.sharePct : null, format: 'percent' },
            value: { metric: 'customers.named_revenue', value: named ? named.value : null },
            total: { metric: 'customers.named_revenue', value: named ? named.namedTotal : null },
        }),
        cites: Object.freeze(['customers.named_revenue']),
        action: Object.freeze({ board: 'customers', label: 'Open Customers' }),
    }),

    /**
     * The Phase 3 finding worth saying out loud.
     *
     * 28 of the 39 open invoices in this database carry no due date, which is
     * most of the money owed. An aging report shows those invoices as neither
     * current nor overdue — they simply are not in it — so a manager reading a
     * clean aging chart concludes the book is healthy when more than half of it
     * has never been given a date to be late against.
     */
    'insight.receivables_no_terms': Object.freeze({
        id: 'insight.receivables_no_terms',
        severity: 'warning',
        boards: Object.freeze(['overview', 'receivables']),
        thresholds: Object.freeze({ sharePct: 25 }),
        query: Object.freeze({
            metrics: Object.freeze(['ar.untermed_share', 'ar.untermed_balance', 'ar.open_balance']),
        }),
        when: ({ v, t }) => {
            const share = num(v('ar.untermed_share'));
            // Null means nothing is owed at all, not that the share is zero.
            return share !== null && share > t.sharePct;
        },
        template:
            '{value} of the {total} you are owed — {share} of it — sits on invoices with no '
            + 'payment terms. That money can never appear as overdue however long it goes '
            + 'unpaid, so an aging report is describing the smaller half of the book.',
        values: ({ v }) => ({
            value: { metric: 'ar.untermed_balance', value: v('ar.untermed_balance') },
            total: { metric: 'ar.open_balance', value: v('ar.open_balance') },
            share: { metric: 'ar.untermed_share', value: v('ar.untermed_share') },
        }),
        cites: Object.freeze(['ar.untermed_balance', 'ar.open_balance', 'ar.untermed_share']),
        action: Object.freeze({ page: 'ar', label: 'Open Accounts Receivable' }),
    }),

    'insight.overdue_receivables': Object.freeze({
        id: 'insight.overdue_receivables',
        severity: 'warning',
        boards: Object.freeze(['receivables']),
        thresholds: Object.freeze({ sharePct: 20 }),
        query: Object.freeze({
            metrics: Object.freeze(['ar.overdue_share', 'ar.overdue_balance', 'ar.oldest_overdue_days']),
        }),
        when: ({ v, t }) => {
            const share = num(v('ar.overdue_share'));
            return share !== null && share > t.sharePct;
        },
        template:
            '{value} is past its due date — {share} of everything owed — and the oldest open '
            + 'invoice is {oldest} overdue.',
        values: ({ v }) => ({
            value: { metric: 'ar.overdue_balance', value: v('ar.overdue_balance') },
            share: { metric: 'ar.overdue_share', value: v('ar.overdue_share') },
            oldest: { metric: 'ar.oldest_overdue_days', value: v('ar.oldest_overdue_days') },
        }),
        cites: Object.freeze(['ar.overdue_balance', 'ar.overdue_share', 'ar.oldest_overdue_days']),
        action: Object.freeze({ page: 'ar', label: 'Open Accounts Receivable' }),
    }),

    /**
     * The two answers to "what are we owed" differ, and the gap is worth a
     * sentence rather than a footnote — a reader who takes one figure from this
     * board and the other from Accounts Receivable will otherwise believe one of
     * them is broken.
     */
    'insight.ar_ledger_gap': Object.freeze({
        id: 'insight.ar_ledger_gap',
        severity: 'info',
        boards: Object.freeze(['receivables']),
        thresholds: Object.freeze({ sharePct: 10 }),
        query: Object.freeze({
            metrics: Object.freeze(['ar.ledger_gap', 'ar.open_balance', 'ar.balance']),
        }),
        when: ({ v, t }) => {
            const gap = num(v('ar.ledger_gap'));
            const open = num(v('ar.open_balance'));
            if (gap === null || open === null || open <= 0) return false;
            return (Math.abs(gap) / open) * 100 > t.sharePct;
        },
        template:
            '{gap} of the {open} owed is on invoices the A/R ledger does not carry — almost all '
            + 'of it raised before the ledger went live. Both figures on this board are correct; '
            + 'this is the size of the difference between them.',
        values: ({ v }) => ({
            gap: { metric: 'ar.ledger_gap', value: v('ar.ledger_gap') },
            open: { metric: 'ar.open_balance', value: v('ar.open_balance') },
        }),
        cites: Object.freeze(['ar.ledger_gap', 'ar.open_balance', 'ar.balance']),
        action: Object.freeze({ page: 'ar', label: 'Open Accounts Receivable' }),
    }),

    'insight.credit_over_limit': Object.freeze({
        id: 'insight.credit_over_limit',
        severity: 'warning',
        boards: Object.freeze(['customers']),
        thresholds: Object.freeze({ minAccounts: 1 }),
        query: Object.freeze({
            metrics: Object.freeze([
                'customers.accounts_over_limit',
                'customers.accounts_owing',
                'customers.credit_exposure',
            ]),
        }),
        when: ({ v, t }) => {
            const over = num(v('customers.accounts_over_limit'));
            return over !== null && over >= t.minAccounts;
        },
        template:
            '{over} of the {owing} accounts currently in debt have gone past the credit limit on '
            + 'their record, against {exposure} owed in total. Each one is a decision somebody '
            + 'should have been asked to make.',
        values: ({ v }) => ({
            over: { metric: 'customers.accounts_over_limit', value: v('customers.accounts_over_limit') },
            owing: { metric: 'customers.accounts_owing', value: v('customers.accounts_owing') },
            exposure: { metric: 'customers.credit_exposure', value: v('customers.credit_exposure') },
        }),
        cites: Object.freeze([
            'customers.accounts_over_limit',
            'customers.accounts_owing',
            'customers.credit_exposure',
        ]),
        action: Object.freeze({ page: 'ar', label: 'Open Accounts Receivable' }),
    }),
});

module.exports = { INSIGHT_RULES, SEVERITIES };
