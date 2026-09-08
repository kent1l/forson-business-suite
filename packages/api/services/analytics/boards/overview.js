/**
 * The Overview board: "how are we doing versus last period?"
 *
 * Board specs live server-side, as JS modules rather than JSON, for three
 * reasons. Permission filtering has to happen here anyway -- a tile citing a
 * financials-only metric must be stripped for a user without that permission,
 * and a client-side copy of that rule is the copy that goes wrong. Boot-time
 * validation catches a tile referencing a renamed metric as a startup crash
 * instead of a blank tile in production. And the eventual move to
 * user-customizable boards is then free: rows from a table pass through the same
 * validator as these.
 *
 * `display` carries only layout and overrides -- never a label, format, unit,
 * direction or colour. Those come from /meta keyed by metric id, which is what
 * makes "adding a metric to a board is one registry entry and one board entry"
 * literally true.
 *
 * Several KPI tiles deliberately share one identical `query`. The batch context
 * dedupes them into a single round trip, and each tile picks its own figure out
 * of the shared result with `display.value`.
 *
 * Every categorical breakdown declares `topN` rather than a bare `limit`. With
 * 444 brands and 767 groups, a plain limit shows the largest eight and says
 * nothing about the other four hundred; the rollup puts the remainder on screen
 * as one row, so what is drawn adds up to the period.
 */

const HEADLINE_QUERY = {
    metrics: [
        'sales.net_revenue',
        'sales.gross_revenue',
        'margin.gross_profit',
        'margin.gross_margin_pct',
        'sales.invoice_count',
        'sales.avg_ticket',
        'sales.refund_rate',
    ],
    dimensions: [],
    grain: null,
    compare: 'previous_period',
};

const POSITION_QUERY = {
    metrics: [
        'ar.balance',
        'inventory.stock_value',
        'inventory.dead_stock_value',
        'inventory.uncosted_stocked_parts',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const kpi = (id, value, span, extra = {}) => ({
    id,
    type: 'kpi',
    span: { base: 12, md: 6, lg: 3, ...(span || {}) },
    display: { value, ...(extra.display || {}) },
    query: extra.query || HEADLINE_QUERY,
    ...(extra.drilldown ? { drilldown: extra.drilldown } : {}),
    ...(extra.title ? { title: extra.title } : {}),
});

const OVERVIEW_BOARD = {
    id: 'overview',
    title: 'Overview',
    description: 'How the business is doing this period, and against the period before it.',
    defaultPreset: 'last_30_days',
    tiles: [
        kpi('overview.net_revenue', 'sales.net_revenue', { lg: 4 }, {
            display: {
                emphasis: 'hero',
                compare: { show: true },
                // A correctly periodised refund can pull net revenue down without any
                // drop in selling. Showing the components by default is what stops
                // that being read as a sales collapse.
                components: { show: 'always', metrics: ['sales.gross_revenue', 'sales.refunds'] },
            },
            drilldown: {
                kind: 'page',
                page: 'sales_history',
                params: { startDate: '$dateRange.from', endDate: '$dateRange.to' },
            },
        }),
        {
            id: 'overview.revenue_trend',
            type: 'line',
            title: 'Revenue over time',
            span: { base: 12, md: 12, lg: 8 },
            query: {
                metrics: ['sales.net_revenue'],
                dimensions: ['date'],
                // 'auto' rather than a fixed grain: a month grain over a 30-day
                // range draws a line between two points, which says nothing.
                grain: 'auto',
                compare: 'previous_period',
            },
            display: {
                value: 'sales.net_revenue',
                series: ['sales.net_revenue'],
                compare: { show: true, as: 'overlay' },
            },
        },

        kpi('overview.gross_profit', 'margin.gross_profit', { lg: 3 }, {
            display: { compare: { show: true }, coverage: { show: true, rule: 'costed_line' } },
        }),
        kpi('overview.gross_margin', 'margin.gross_margin_pct', { lg: 3 }, {
            display: { compare: { show: true }, coverage: { show: true, rule: 'costed_line' } },
        }),
        kpi('overview.invoice_count', 'sales.invoice_count', { lg: 3 }, {
            display: { compare: { show: true } },
        }),
        kpi('overview.avg_ticket', 'sales.avg_ticket', { lg: 3 }, {
            display: { compare: { show: true } },
        }),

        kpi('overview.ar_balance', 'ar.balance', { lg: 3 }, {
            query: POSITION_QUERY,
            display: { asOf: 'now' },
            drilldown: { kind: 'page', page: 'ar', params: {} },
        }),
        kpi('overview.inventory_value', 'inventory.stock_value', { lg: 3 }, {
            query: POSITION_QUERY,
            display: { asOf: 'now', coverage: { show: true, rule: 'wac_known' } },
            drilldown: { kind: 'page', page: 'inventory', params: {} },
        }),
        kpi('overview.dead_stock', 'inventory.dead_stock_value', { lg: 3 }, {
            query: POSITION_QUERY,
            display: { asOf: 'now' },
            drilldown: { kind: 'page', page: 'inventory', params: {} },
        }),
        kpi('overview.uncosted_parts', 'inventory.uncosted_stocked_parts', { lg: 3 }, {
            query: POSITION_QUERY,
            title: 'Stocked Parts Without a Cost',
            display: { asOf: 'now' },
            drilldown: { kind: 'page', page: 'cost_data_health', params: {} },
        }),

        {
            id: 'overview.revenue_by_brand',
            type: 'bar',
            title: 'Revenue by brand',
            help: 'The largest brands by ex-VAT revenue in this period. There are hundreds of '
                + 'brands in the catalogue, so everything outside the top eight is added into '
                + '"Other" — the bars therefore account for all of the period’s line revenue '
                + 'rather than for as much of it as fitted on the chart.',
            span: { base: 12, md: 12, lg: 6 },
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
            id: 'overview.top_products',
            type: 'table',
            title: 'Top products',
            help: 'Ranked by ex-VAT revenue, with every other part added into "Other" so the '
                + 'column totals are the period’s whole line revenue. Gross profit is measured '
                + 'only over lines that recorded a cost.',
            span: { base: 12, md: 12, lg: 6 },
            query: {
                metrics: ['sales.line_revenue', 'sales.units_sold', 'margin.gross_profit'],
                dimensions: ['part'],
                grain: null,
                sort: { by: 'sales.line_revenue', dir: 'DESC' },
                topN: { n: 10, by: 'sales.line_revenue' },
            },
            display: {
                columns: ['sales.line_revenue', 'sales.units_sold', 'margin.gross_profit'],
                category: 'part',
                rank: true,
                bar: 'sales.line_revenue',
                coverage: { show: true, rule: 'costed_line' },
            },
        },

        {
            id: 'overview.cost_coverage',
            type: 'table',
            title: 'How much of this we can measure',
            help: 'Margin is computed only over sales lines that carry a recorded cost. This is '
                + 'how much of each month that was.',
            span: { base: 12, md: 12, lg: 8 },
            query: {
                metrics: ['sales.line_revenue', 'margin.costed_revenue', 'margin.gross_margin_pct'],
                dimensions: ['date'],
                // Coverage is a question about periods, not days; `minGrain` keeps
                // a 30-day range from turning this into thirty rows.
                grain: 'auto',
                minGrain: 'month',
            },
            display: {
                columns: ['sales.line_revenue', 'margin.costed_revenue', 'margin.gross_margin_pct'],
                category: 'date',
                coverage: { show: true, rule: 'costed_line', perRow: true },
            },
        },
        kpi('overview.net_profit', 'finance.net_profit', { lg: 4 }, {
            query: {
                metrics: ['finance.net_profit'],
                dimensions: [],
                grain: null,
                compare: null,
            },
            display: { compare: { show: false } },
        }),
    ],
};

module.exports = { OVERVIEW_BOARD };
