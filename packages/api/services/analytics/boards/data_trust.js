/**
 * The Data Trust board: "how much of this can I believe?"
 *
 * Every other board discloses its gaps in a badge under a figure. This one makes
 * the gaps the figures, because a badge answers "can I believe this number?"
 * while a manager also needs to ask "what do I have to fix, and is it getting
 * better?". Those are different questions with different answers and different
 * owners.
 *
 * Three rules shaped it:
 *
 * - **Every tile ends somewhere a person can act.** A data-quality number with
 *   no remediation page is a complaint. Cost Data Health, Stock Reconciliation
 *   and Cost Correction already exist; the tiles link to them.
 * - **It is ranked by consequence, like the reorder list.** "Revenue we cannot
 *   measure" leads, not "lines missing a cost" — 9,480 lines is a number nobody
 *   can hold, ₱9.2M of unmeasurable revenue is a decision.
 * - **Two of these tiles are not defects.** The legacy VAT rows and the credit
 *   notes without an ex-VAT subtotal are handled correctly by Analytics; they
 *   are here because they explain why this page and the Reports page differ,
 *   which §13's R2 predicted would be reported as a bug.
 *
 * Deliberately NOT `period: 'none'`, even though half the tiles are positions.
 * Coverage over time is the point of the board — whether the fixing is working —
 * and that needs a date range.
 */

const POSITION_QUERY = {
    metrics: [
        'inventory.uncosted_stocked_parts',
        'quality.negative_stock_parts',
        'inventory.stocked_parts',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const PERIOD_QUERY = {
    metrics: [
        'quality.cost_coverage_pct',
        'quality.costed_line_pct',
        'quality.uncosted_revenue',
        'quality.uncosted_line_count',
        'sales.line_revenue',
        'sales.line_count',
    ],
    dimensions: [],
    grain: null,
    compare: 'previous_period',
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

const DATA_TRUST_BOARD = {
    id: 'data_trust',
    title: 'Data Trust',
    description:
        'How much of the business the figures on the other boards actually describe, what is '
        + 'missing, and where to go and fix it.',
    // Twelve months, not thirty days. Whether the cost cleanup is working is a
    // question about a trend, and the two "why we differ from Reports" counts
    // are historical -- over a short recent window they read zero, which would
    // suggest there is no difference to explain when over a year there is.
    defaultPreset: 'last_12_months',
    tiles: [
        kpi('trust.coverage', 'quality.cost_coverage_pct', PERIOD_QUERY, { lg: 4 }, {
            display: { emphasis: 'hero', compare: { show: true } },
            help: 'The share of revenue in this period that carries a recorded cost. Every profit '
                + 'and margin figure in Analytics is measured over this slice and no more. '
                + 'Watching it move is the point of this board — if the work on Cost Data Health '
                + 'is paying off, this rises.',
            drilldown: { kind: 'page', page: 'cost_data_health', params: {} },
        }),
        kpi('trust.uncosted_revenue', 'quality.uncosted_revenue', PERIOD_QUERY, { lg: 4 }, {
            display: { compare: { show: true } },
            help: 'Revenue whose profit the system cannot work out. This is the consequence of '
                + 'the coverage figure in money rather than in percent, and it is the number to '
                + 'quote when deciding how much effort the cost cleanup is worth.',
            drilldown: { kind: 'page', page: 'cost_data_health', params: {} },
        }),
        kpi('trust.uncosted_lines', 'quality.uncosted_line_count', PERIOD_QUERY, { lg: 4 }, {
            display: { compare: { show: true } },
        }),

        {
            id: 'trust.coverage_trend',
            type: 'line',
            title: 'Is coverage improving?',
            help: 'Cost coverage per period. A rising line means sales are increasingly being '
                + 'recorded with a cost, which is the only thing that makes the margin figures on '
                + 'the other boards describe more of the business. A flat line means the cleanup '
                + 'is not keeping up with new sales.',
            span: { base: 12, md: 12, lg: 7 },
            query: {
                metrics: ['quality.cost_coverage_pct'],
                dimensions: ['date'],
                grain: 'auto',
                minGrain: 'week',
                compare: 'previous_period',
            },
            display: {
                value: 'quality.cost_coverage_pct',
                compare: { show: true, as: 'overlay' },
            },
        },
        {
            id: 'trust.coverage_table',
            type: 'table',
            title: 'Coverage by period',
            help: 'Both measures side by side. Cost Coverage is weighted by money; Lines With a '
                + 'Cost counts rows. A wide gap between them means the sales that recorded a cost '
                + 'are not typical in size, so margin is measured on an unrepresentative slice '
                + 'rather than merely a small one.',
            span: { base: 12, md: 12, lg: 5 },
            query: {
                metrics: [
                    'quality.cost_coverage_pct',
                    'quality.costed_line_pct',
                    'quality.uncosted_revenue',
                    'quality.uncosted_line_count',
                ],
                dimensions: ['date'],
                grain: 'auto',
                minGrain: 'month',
            },
            display: {
                columns: [
                    'quality.cost_coverage_pct',
                    'quality.costed_line_pct',
                    'quality.uncosted_revenue',
                    'quality.uncosted_line_count',
                ],
                category: 'date',
            },
        },

        {
            id: 'trust.uncosted_by_brand',
            type: 'bar',
            title: 'Unmeasurable revenue by brand',
            help: 'Where the missing costs are concentrated. Fixing the parts behind the top few '
                + 'bars buys back more coverage than working the Cost Data Health list '
                + 'alphabetically.',
            span: { base: 12, md: 12, lg: 6 },
            query: {
                metrics: ['quality.uncosted_revenue'],
                dimensions: ['brand'],
                grain: null,
                sort: { by: 'quality.uncosted_revenue', dir: 'DESC' },
                topN: { n: 8, by: 'quality.uncosted_revenue' },
            },
            display: { value: 'quality.uncosted_revenue', category: 'brand' },
            drilldown: { kind: 'filter', dimension: 'brand' },
        },
        {
            id: 'trust.uncosted_by_product',
            type: 'table',
            title: 'Fix these parts first',
            help: 'Parts whose sales carried no cost, ranked by the revenue that leaves '
                + 'unmeasurable. Working down this list is the shortest route to a coverage figure '
                + 'worth trusting. Click a row to open the part.',
            span: { base: 12, md: 12, lg: 6 },
            query: {
                metrics: ['quality.uncosted_revenue', 'quality.uncosted_line_count', 'sales.units_sold'],
                dimensions: ['part'],
                grain: null,
                sort: { by: 'quality.uncosted_revenue', dir: 'DESC' },
                limit: 15,
            },
            display: {
                columns: ['quality.uncosted_revenue', 'quality.uncosted_line_count', 'sales.units_sold'],
                category: 'part',
                rank: true,
                bar: 'quality.uncosted_revenue',
            },
            drilldown: { kind: 'page', page: 'cost_data_health', params: {} },
        },

        kpi('trust.uncosted_parts', 'inventory.uncosted_stocked_parts', POSITION_QUERY, { lg: 4 }, {
            display: { asOf: 'now' },
            help: 'Parts holding stock with no cost recorded against them. Their stock is worth '
                + 'something and the system cannot say how much, so inventory value is '
                + 'understated and every future sale of them will add to the uncosted pile.',
            drilldown: { kind: 'page', page: 'cost_data_health', params: {} },
        }),
        kpi('trust.negative_stock', 'quality.negative_stock_parts', POSITION_QUERY, { lg: 4 }, {
            display: { asOf: 'now' },
            drilldown: { kind: 'page', page: 'stock_reconciliation', params: {} },
        }),
        kpi('trust.stocked_parts', 'inventory.stocked_parts', POSITION_QUERY, { lg: 4 }, {
            display: { asOf: 'now' },
            title: 'Parts in Stock (for comparison)',
            help: 'The denominator for the two figures beside it — how many parts hold stock at '
                + 'all, so the counts above can be read as a share rather than in isolation.',
        }),

        {
            id: 'trust.legacy_rows',
            type: 'table',
            title: 'Why this page and Reports can differ',
            help: 'Neither of these is a defect, and neither needs fixing. They are the two places '
                + 'where a figure was never stored and Analytics falls back to one that is exact '
                + 'for those rows — which is why Analytics reports slightly MORE revenue and '
                + 'considerably more refunds than the Reports page over the same range. Both '
                + 'counts shrink on their own as new records are written correctly.',
            span: { base: 12, md: 12, lg: 12 },
            query: {
                metrics: [
                    'quality.legacy_untaxed_lines',
                    'quality.credit_notes_without_subtotal',
                    'sales.line_count',
                ],
                dimensions: ['date'],
                grain: 'auto',
                minGrain: 'month',
            },
            display: {
                columns: [
                    'quality.legacy_untaxed_lines',
                    'quality.credit_notes_without_subtotal',
                    'sales.line_count',
                ],
                category: 'date',
            },
        },
    ],
};

module.exports = { DATA_TRUST_BOARD };
