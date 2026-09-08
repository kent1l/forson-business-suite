/**
 * The Sales board: "what did we sell, to whom, and when".
 *
 * This board is the test of the Phase 0 design. Every tile on it is a registry
 * entry plus the spec below -- no new route, no new SQL, and the only new React
 * component in Phase 1 is the heatmap, which is a genuinely new *shape* rather
 * than a new question. If a future addition here needs a component, that is the
 * signal to stop and work out why before writing one.
 *
 * Every categorical breakdown declares `topN`. That is not a display preference:
 * there are 444 brands and 767 groups in this catalogue, so a chart without a
 * fold either draws a legend nobody can read or silently shows the largest eight
 * and lets the reader believe that is all of them. The fold is computed
 * server-side over the whole period, so the 'Other' row is the true remainder
 * and the tile's totals reconcile with the ledger.
 */

const HEADLINE_QUERY = {
    metrics: [
        'sales.net_revenue',
        'sales.gross_revenue',
        'sales.invoice_count',
        'sales.avg_ticket',
        'sales.units_sold',
        'sales.lines_per_invoice',
        'sales.refund_rate',
    ],
    dimensions: [],
    grain: null,
    compare: 'previous_period',
};

const kpi = (id, value, span, extra = {}) => ({
    id,
    type: 'kpi',
    span: { base: 12, md: 6, lg: 3, ...(span || {}) },
    display: { compare: { show: true }, value, ...(extra.display || {}) },
    query: extra.query || HEADLINE_QUERY,
    ...(extra.drilldown ? { drilldown: extra.drilldown } : {}),
    ...(extra.title ? { title: extra.title } : {}),
    ...(extra.help ? { help: extra.help } : {}),
});

const SALES_BOARD = {
    id: 'sales',
    title: 'Sales',
    description: 'What sold, to whom, through which till, and at what time of day.',
    defaultPreset: 'last_30_days',
    tiles: [
        kpi('sales.net_revenue', 'sales.net_revenue', { lg: 4 }, {
            display: {
                emphasis: 'hero',
                compare: { show: true },
                components: { show: 'always', metrics: ['sales.gross_revenue', 'sales.refunds'] },
            },
            drilldown: {
                kind: 'page',
                page: 'sales_history',
                params: { startDate: '$dateRange.from', endDate: '$dateRange.to' },
            },
        }),
        {
            id: 'sales.revenue_trend',
            type: 'line',
            title: 'Revenue over time',
            span: { base: 12, md: 12, lg: 8 },
            query: {
                metrics: ['sales.net_revenue'],
                dimensions: ['date'],
                grain: 'auto',
                compare: 'previous_period',
            },
            display: {
                value: 'sales.net_revenue',
                compare: { show: true, as: 'overlay' },
            },
        },

        kpi('sales.invoice_count', 'sales.invoice_count', { lg: 3 }),
        kpi('sales.avg_ticket', 'sales.avg_ticket', { lg: 3 }),
        kpi('sales.units_sold', 'sales.units_sold', { lg: 3 }),
        kpi('sales.lines_per_invoice', 'sales.lines_per_invoice', { lg: 3 }),

        {
            id: 'sales.hour_weekday',
            type: 'heatmap',
            title: 'When the counter is busy',
            help: 'Ex-VAT invoiced sales for every hour of every weekday, added up across the '
                + 'whole period. Read it for staffing: the darkest cells are when a second '
                + 'person at the counter earns their hour. A grey cell is an hour that sold '
                + 'nothing at all; the palest blue is an hour that sold very little — the two '
                + 'are drawn differently on purpose. The colour scale runs straight from zero '
                + 'to the busiest cell, so a cell twice as dark really did take twice as much.',
            span: { base: 12, md: 12, lg: 12 },
            query: {
                metrics: ['sales.gross_revenue', 'sales.invoice_count'],
                dimensions: ['weekday', 'hour_of_day'],
                grain: null,
            },
            display: {
                value: 'sales.gross_revenue',
                rows: 'weekday',
                columns: 'hour_of_day',
                secondary: 'sales.invoice_count',
            },
        },

        {
            id: 'sales.by_brand',
            type: 'bar',
            title: 'Revenue by brand',
            help: 'The largest brands by ex-VAT revenue. Everything outside the top eight is '
                + 'added into "Other", so the bars add up to the period’s full line revenue '
                + 'rather than to whatever fitted on the chart.',
            span: { base: 12, md: 6, lg: 6 },
            query: {
                metrics: ['sales.line_revenue'],
                dimensions: ['brand'],
                grain: null,
                sort: { by: 'sales.line_revenue', dir: 'DESC' },
                topN: { n: 8, by: 'sales.line_revenue' },
            },
            display: { value: 'sales.line_revenue', category: 'brand' },
            drilldown: { kind: 'filter', dimension: 'brand' },
        },
        {
            id: 'sales.by_group',
            type: 'bar',
            title: 'Revenue by group',
            help: 'The largest product groups by ex-VAT revenue, with the remaining hundreds '
                + 'folded into "Other".',
            span: { base: 12, md: 6, lg: 6 },
            query: {
                metrics: ['sales.line_revenue'],
                dimensions: ['group'],
                grain: null,
                sort: { by: 'sales.line_revenue', dir: 'DESC' },
                topN: { n: 8, by: 'sales.line_revenue' },
            },
            display: { value: 'sales.line_revenue', category: 'group' },
            drilldown: { kind: 'filter', dimension: 'group' },
        },

        {
            id: 'sales.top_products',
            type: 'table',
            title: 'Top products',
            help: 'Ranked by ex-VAT revenue. Gross profit is measured only over the lines that '
                + 'recorded a cost, so a blank in that column means the cost was never captured '
                + 'rather than that the item made nothing.',
            span: { base: 12, md: 12, lg: 7 },
            query: {
                metrics: ['sales.line_revenue', 'sales.units_sold', 'margin.gross_profit'],
                dimensions: ['part'],
                grain: null,
                sort: { by: 'sales.line_revenue', dir: 'DESC' },
                topN: { n: 12, by: 'sales.line_revenue' },
            },
            display: {
                columns: ['sales.line_revenue', 'sales.units_sold', 'margin.gross_profit'],
                category: 'part',
                rank: true,
                bar: 'sales.line_revenue',
                coverage: { show: true, rule: 'costed_line' },
            },
            drilldown: { kind: 'page', page: 'inventory', params: { search: '$row.label' } },
        },
        {
            id: 'sales.top_customers',
            type: 'table',
            title: 'Top customers',
            help: 'Named accounts by ex-VAT revenue. One record — "Walk-in Customer" — carries '
                + 'the whole counter trade and is around 82% of revenue, so it will sit at the '
                + 'top and is not a single buyer.',
            span: { base: 12, md: 12, lg: 5 },
            query: {
                metrics: ['sales.gross_revenue', 'sales.invoice_count', 'sales.avg_ticket'],
                dimensions: ['customer'],
                grain: null,
                sort: { by: 'sales.gross_revenue', dir: 'DESC' },
                topN: { n: 10, by: 'sales.gross_revenue' },
            },
            display: {
                columns: ['sales.gross_revenue', 'sales.invoice_count', 'sales.avg_ticket'],
                category: 'customer',
                rank: true,
                bar: 'sales.gross_revenue',
            },
            drilldown: { kind: 'filter', dimension: 'customer' },
        },

        {
            id: 'sales.by_staff',
            type: 'bar',
            title: 'Revenue by staff',
            help: 'Ex-VAT invoiced sales by the employee recorded on the invoice. This measures '
                + 'who rang the sale up, which is not the same as who won it.',
            span: { base: 12, md: 6, lg: 6 },
            query: {
                metrics: ['sales.gross_revenue'],
                dimensions: ['employee'],
                grain: null,
                sort: { by: 'sales.gross_revenue', dir: 'DESC' },
                topN: { n: 8, by: 'sales.gross_revenue' },
            },
            display: { value: 'sales.gross_revenue', category: 'employee' },
            drilldown: { kind: 'filter', dimension: 'employee' },
        },
        {
            id: 'sales.by_payment_method',
            type: 'bar',
            title: 'Revenue by payment method',
            help: 'Ex-VAT invoiced sales by the first payment recorded against the invoice. An '
                + 'invoice settled in two ways is counted once, under the first — so read this '
                + 'as the shape of the till, not as an exact split.',
            span: { base: 12, md: 6, lg: 6 },
            query: {
                metrics: ['sales.gross_revenue'],
                dimensions: ['payment_method'],
                grain: null,
                sort: { by: 'sales.gross_revenue', dir: 'DESC' },
                topN: { n: 6, by: 'sales.gross_revenue' },
            },
            display: { value: 'sales.gross_revenue', category: 'payment_method' },
        },

        kpi('sales.refund_rate', 'sales.refund_rate', { lg: 4 }, {
            help: 'Refunds as a share of gross revenue, each counted in the period it was '
                + 'raised. A credit note against an earlier month lands here, not there.',
        }),
        // Registered from day one, dark until a cashier records the first line
        // discount. A discount rate of 0.0% across 11,540 lines would read as
        // "we never discount" where the truth is that the field is not in use.
        kpi('sales.discount_rate', 'sales.discount_rate', { lg: 4 }, {
            query: {
                metrics: ['sales.discount_rate', 'sales.discount_given'],
                dimensions: [],
                grain: null,
                compare: 'previous_period',
            },
        }),
        kpi('sales.discount_given', 'sales.discount_given', { lg: 4 }, {
            query: {
                metrics: ['sales.discount_rate', 'sales.discount_given'],
                dimensions: [],
                grain: null,
                compare: 'previous_period',
            },
        }),
    ],
};

module.exports = { SALES_BOARD };
