/**
 * The Profitability board: "where does margin actually come from?"
 *
 * §14 says every tile here is "gated behind the coverage badge", and on this
 * data that is not a formality. Cost is recorded on about a fifth of revenue, so
 * every figure on this board is a true statement about a minority of the
 * business. Three things follow, and they are the whole design of the board:
 *
 * 1. **The board opens with what it cannot see.** The first tile is Cost
 *    Coverage, not Gross Profit. A reader who takes the margin figure away
 *    without the coverage figure has been misled by the layout, whatever the
 *    badge underneath said.
 * 2. **Every money tile carries `coverage: { rule: 'costed_line' }`.** No
 *    exceptions, including the ones where it looks redundant.
 * 3. **The margin distribution shows the uncosted band.** A distribution over
 *    only the measurable lines would be a chart about a fifth of the business
 *    presented as the whole — which is the exact failure this module exists to
 *    prevent.
 *
 * Operating-P&L tiles are registered and render "not being recorded yet" until
 * the Expenses and Payroll modules carry data. They are on the board from day
 * one so that they light up on their own.
 */

const COVERAGE = { show: true, rule: 'costed_line' };

const HEADLINE_QUERY = {
    metrics: [
        'quality.cost_coverage_pct',
        'margin.gross_profit',
        'margin.gross_margin_pct',
        'margin.costed_revenue',
        'margin.cogs',
        'sales.line_revenue',
        'quality.uncosted_revenue',
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

const PROFITABILITY_BOARD = {
    id: 'profitability',
    title: 'Profitability',
    description:
        'Where margin comes from — measured only over the sales that recorded a cost. '
        + 'Read the coverage figure first; it says how much of the business the rest of this '
        + 'board describes.',
    defaultPreset: 'last_90_days',
    tiles: [
        // Deliberately the first tile on the board. See the note at the top.
        kpi('profitability.coverage', 'quality.cost_coverage_pct', { lg: 4 }, {
            display: { emphasis: 'hero', compare: { show: true } },
            help: 'The share of revenue that carries a recorded cost. Every other figure on this '
                + 'board is measured over this slice and no more. At 20%, a margin of 33% is a '
                + 'true statement about a fifth of the business — not an estimate of all of it.',
            drilldown: { kind: 'page', page: 'cost_data_health', params: {} },
        }),
        kpi('profitability.gross_profit', 'margin.gross_profit', { lg: 4 }, {
            display: { compare: { show: true }, coverage: COVERAGE },
        }),
        kpi('profitability.gross_margin', 'margin.gross_margin_pct', { lg: 4 }, {
            display: { compare: { show: true }, coverage: COVERAGE },
        }),

        {
            id: 'profitability.margin_trend',
            type: 'line',
            title: 'Margin over time',
            help: 'Gross margin per period, on costed lines only. Before reading a movement here '
                + 'as the business getting better or worse, check the coverage table below: a '
                + 'margin that rises while coverage falls has told you a different, smaller set '
                + 'of sales was measured, not that anything improved.',
            span: { base: 12, md: 12, lg: 7 },
            query: {
                metrics: ['margin.gross_margin_pct'],
                dimensions: ['date'],
                grain: 'auto',
                minGrain: 'week',
                compare: 'previous_period',
            },
            display: {
                value: 'margin.gross_margin_pct',
                compare: { show: true, as: 'overlay' },
                coverage: COVERAGE,
            },
        },
        {
            id: 'profitability.coverage_over_time',
            type: 'table',
            title: 'How much of each period we could measure',
            help: 'Read the margin column and the coverage column together. They are the same '
                + 'statement: this margin, over this much of the period.',
            span: { base: 12, md: 12, lg: 5 },
            query: {
                metrics: [
                    'sales.line_revenue',
                    'margin.costed_revenue',
                    'quality.cost_coverage_pct',
                    'margin.gross_margin_pct',
                ],
                dimensions: ['date'],
                grain: 'auto',
                minGrain: 'month',
            },
            display: {
                columns: [
                    'sales.line_revenue',
                    'margin.costed_revenue',
                    'quality.cost_coverage_pct',
                    'margin.gross_margin_pct',
                ],
                category: 'date',
                coverage: { show: true, rule: 'costed_line', perRow: true },
            },
        },

        {
            id: 'profitability.margin_distribution',
            type: 'bar',
            title: 'Where the revenue sits, by margin',
            help: 'Ex-VAT revenue grouped by the margin each sale line made. "(No cost recorded)" '
                + 'is shown as a band of its own and is normally the largest one — that is '
                + 'revenue whose margin is unknown, not revenue that made nothing. "Sold at a '
                + 'loss" is the band worth acting on: those are sales that cost more than they '
                + 'earned, and the system is sure of it.',
            span: { base: 12, md: 12, lg: 6 },
            query: {
                metrics: ['sales.line_revenue', 'sales.line_count'],
                dimensions: ['margin_band'],
                grain: null,
                sort: { by: 'margin_band', dir: 'ASC' },
            },
            display: { value: 'sales.line_revenue', category: 'margin_band' },
        },
        {
            id: 'profitability.by_brand',
            type: 'bar',
            title: 'Gross profit by brand',
            help: 'Measured over costed lines only, so a brand whose sales never recorded a cost '
                + 'shows nothing here however well it sold. Check it against Revenue by brand on '
                + 'the Sales board before concluding a brand is unprofitable.',
            span: { base: 12, md: 12, lg: 6 },
            query: {
                metrics: ['margin.gross_profit'],
                dimensions: ['brand'],
                grain: null,
                sort: { by: 'margin.gross_profit', dir: 'DESC' },
                topN: { n: 8, by: 'margin.gross_profit' },
            },
            display: {
                value: 'margin.gross_profit',
                category: 'brand',
                coverage: COVERAGE,
            },
            drilldown: { kind: 'filter', dimension: 'brand' },
        },

        {
            id: 'profitability.by_product',
            type: 'table',
            title: 'Most profitable products',
            help: 'The same figures as the Profitability by Product report, from the same '
                + 'definitions. A dash means that product’s sales carried no recorded cost — it '
                + 'does not mean the product made nothing.',
            span: { base: 12, md: 12, lg: 6 },
            query: {
                metrics: [
                    'margin.gross_profit',
                    'margin.gross_margin_pct',
                    'sales.line_revenue',
                    'sales.units_sold',
                ],
                dimensions: ['part'],
                grain: null,
                sort: { by: 'margin.gross_profit', dir: 'DESC' },
                topN: { n: 12, by: 'margin.gross_profit' },
            },
            display: {
                columns: [
                    'margin.gross_profit',
                    'margin.gross_margin_pct',
                    'sales.line_revenue',
                    'sales.units_sold',
                ],
                category: 'part',
                rank: true,
                bar: 'margin.gross_profit',
                coverage: { show: true, rule: 'costed_line', perRow: true },
            },
            drilldown: { kind: 'page', page: 'inventory', params: { search: '$row.label' } },
        },
        {
            id: 'profitability.losses',
            type: 'table',
            title: 'Sold at a loss',
            help: 'Products whose recorded cost came to more than they sold for, worst first. '
                + 'Because these are measured on lines that DID record a cost, the system is sure '
                + 'of them — a mispriced item, a cost entered in the wrong unit, or genuine '
                + 'clearance. No rollup here: a to-do list does not need an "Other" row.',
            span: { base: 12, md: 12, lg: 6 },
            query: {
                metrics: [
                    'margin.gross_profit',
                    'margin.gross_margin_pct',
                    'margin.costed_revenue',
                    'margin.cogs',
                ],
                dimensions: ['part'],
                grain: null,
                sort: { by: 'margin.gross_profit', dir: 'ASC' },
                limit: 15,
            },
            display: {
                columns: [
                    'margin.gross_profit',
                    'margin.gross_margin_pct',
                    'margin.costed_revenue',
                    'margin.cogs',
                ],
                category: 'part',
                rank: true,
                coverage: { show: true, rule: 'costed_line', perRow: true },
            },
            drilldown: { kind: 'page', page: 'inventory', params: { search: '$row.label' } },
        },

        kpi('profitability.costed_revenue', 'margin.costed_revenue', { lg: 3 }, {
            display: { compare: { show: true }, coverage: COVERAGE },
        }),
        kpi('profitability.cogs', 'margin.cogs', { lg: 3 }, {
            display: { compare: { show: true }, coverage: COVERAGE },
        }),
        kpi('profitability.uncosted_revenue', 'quality.uncosted_revenue', { lg: 3 }, {
            display: { compare: { show: true } },
            drilldown: { kind: 'page', page: 'cost_data_health', params: {} },
        }),
        kpi('profitability.line_revenue', 'sales.line_revenue', { lg: 3 }),

        // Registered from day one, dark until the modules carry data.
        kpi('profitability.operating_expenses', 'finance.operating_expenses', { lg: 6 }, {
            query: {
                metrics: ['finance.operating_expenses'],
                dimensions: [],
                grain: null,
                compare: 'previous_period',
            },
        }),
        kpi('profitability.net_profit', 'finance.net_profit', { lg: 6 }, {
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

module.exports = { PROFITABILITY_BOARD };
