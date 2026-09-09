/**
 * The Inventory board: "what is on the shelf, what is stuck there, and what is
 * about to run out".
 *
 * Declared `period: 'none'`. Every figure here is a position as of now, and the
 * two windows it does use -- 180 days for dead stock, 90 days for reorder demand
 * -- are properties of those definitions, not of the board's date picker. A
 * picker that changed nothing would be worse than no picker: the reader would
 * assume the numbers moved with it. The frontend hides the range and comparison
 * controls for a board declared this way and says "as of now" instead.
 *
 * Keeping the board purely snapshot is also what keeps that claim true. A single
 * period-dependent tile here would make the hidden picker a lie, so a future
 * "sales versus stock" tile belongs on the Sales board or on a board of its own.
 */

const POSITION_QUERY = {
    metrics: [
        'inventory.stock_value',
        'inventory.units_on_hand',
        'inventory.stocked_parts',
        'inventory.uncosted_stocked_parts',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const DEAD_STOCK_QUERY = {
    metrics: [
        'inventory.dead_stock_value',
        'inventory.dead_stock_share',
        'inventory.dead_stock_parts',
        'inventory.stock_value',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const REORDER_QUERY = {
    metrics: [
        'inventory.reorder_parts',
        'inventory.reorder_units_short',
        'inventory.reorder_revenue_90d',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const kpi = (id, value, query, span, extra = {}) => ({
    id,
    type: 'kpi',
    span: { base: 12, md: 6, lg: 3, ...(span || {}) },
    // A snapshot has nothing to compare against; `asOf` is what the tile says
    // instead of a delta arrow.
    display: { asOf: 'now', value, ...(extra.display || {}) },
    query,
    ...(extra.drilldown ? { drilldown: extra.drilldown } : {}),
    ...(extra.title ? { title: extra.title } : {}),
    ...(extra.help ? { help: extra.help } : {}),
});

const INVENTORY_BOARD = {
    id: 'inventory',
    title: 'Inventory',
    description: 'Stock on hand, the money standing still in it, and what needs reordering.',
    defaultPreset: 'last_30_days',
    period: 'none',
    tiles: [
        kpi('inventory.stock_value', 'inventory.stock_value', POSITION_QUERY, { lg: 3 }, {
            display: { emphasis: 'hero', coverage: { show: true, rule: 'wac_known' } },
            drilldown: { kind: 'page', page: 'inventory', params: {} },
        }),
        kpi('inventory.units_on_hand', 'inventory.units_on_hand', POSITION_QUERY, { lg: 3 }),
        kpi('inventory.stocked_parts', 'inventory.stocked_parts', POSITION_QUERY, { lg: 3 }),
        kpi('inventory.uncosted_parts', 'inventory.uncosted_stocked_parts', POSITION_QUERY, { lg: 3 }, {
            drilldown: { kind: 'page', page: 'cost_data_health', params: {} },
        }),

        kpi('inventory.dead_stock_value', 'inventory.dead_stock_value', DEAD_STOCK_QUERY, { lg: 4 }, {
            display: { coverage: { show: true, rule: 'wac_known' } },
            help: 'Stock that has not sold in 180 days, valued at weighted average cost. Parts '
                + 'that have never sold at all are included. This is money already spent that is '
                + 'not coming back through the counter, and it is the largest single finding in '
                + 'this dataset.',
        }),
        kpi('inventory.dead_stock_share', 'inventory.dead_stock_share', DEAD_STOCK_QUERY, { lg: 4 }),
        kpi('inventory.dead_stock_parts', 'inventory.dead_stock_parts', DEAD_STOCK_QUERY, { lg: 4 }),

        {
            id: 'inventory.reorder_list',
            type: 'table',
            title: 'Reorder first',
            help: 'Parts that sold on at least three separate invoices in the last 90 days and '
                + 'now hold under thirty days of cover — ranked by what they earned over those '
                + '90 days, so the top of the list is the money most at risk. This is '
                + 'deliberately NOT the "below reorder point" flag, which fires on thousands of '
                + 'parts from unmaintained defaults. Units short is a starting point for a '
                + 'purchase order, not a recommendation: it knows nothing about pack sizes, '
                + 'supplier minimums or lead times.',
            span: { base: 12, md: 12, lg: 12 },
            query: {
                metrics: [
                    'inventory.reorder_revenue_90d',
                    'inventory.reorder_demand_90d',
                    'inventory.reorder_stock_on_hand',
                    'inventory.reorder_days_of_cover',
                    'inventory.reorder_units_short',
                ],
                dimensions: ['part'],
                grain: null,
                sort: { by: 'inventory.reorder_revenue_90d', dir: 'DESC' },
                limit: 25,
            },
            display: {
                columns: [
                    'inventory.reorder_revenue_90d',
                    'inventory.reorder_demand_90d',
                    'inventory.reorder_stock_on_hand',
                    'inventory.reorder_days_of_cover',
                    'inventory.reorder_units_short',
                ],
                category: 'part',
                rank: true,
                bar: 'inventory.reorder_revenue_90d',
            },
            // Straight into the part's own row on the Inventory page, where the
            // stock can actually be adjusted.
            drilldown: { kind: 'page', page: 'inventory', params: { search: '$row.label' } },
        },

        kpi('inventory.reorder_parts', 'inventory.reorder_parts', REORDER_QUERY, { lg: 4 }),
        kpi('inventory.reorder_units_short', 'inventory.reorder_units_short', REORDER_QUERY, { lg: 4 }),
        kpi('inventory.reorder_revenue_90d', 'inventory.reorder_revenue_90d', REORDER_QUERY, { lg: 4 }, {
            title: 'Revenue Behind the Reorder List',
        }),

        {
            id: 'inventory.value_by_brand',
            type: 'bar',
            title: 'Stock value by brand',
            help: 'Where the money on the shelf is sitting. Valued at weighted average cost, so '
                + 'parts with no recorded cost contribute nothing — check the coverage badge.',
            span: { base: 12, md: 6, lg: 6 },
            query: {
                metrics: ['inventory.stock_value'],
                dimensions: ['brand'],
                grain: null,
                sort: { by: 'inventory.stock_value', dir: 'DESC' },
                topN: { n: 8, by: 'inventory.stock_value' },
            },
            display: {
                value: 'inventory.stock_value',
                category: 'brand',
                coverage: { show: true, rule: 'wac_known' },
            },
            drilldown: { kind: 'filter', dimension: 'brand' },
        },
        {
            id: 'inventory.dead_stock_by_brand',
            type: 'bar',
            title: 'Dead stock by brand',
            help: 'The 180-day-unsold value, by brand. Read it against the chart beside it: a '
                + 'brand that is large in both is simply big, one that is small on the left and '
                + 'large here is the buying mistake.',
            span: { base: 12, md: 6, lg: 6 },
            query: {
                metrics: ['inventory.dead_stock_value'],
                dimensions: ['brand'],
                grain: null,
                sort: { by: 'inventory.dead_stock_value', dir: 'DESC' },
                topN: { n: 8, by: 'inventory.dead_stock_value' },
            },
            display: {
                value: 'inventory.dead_stock_value',
                category: 'brand',
                coverage: { show: true, rule: 'wac_known' },
            },
            drilldown: { kind: 'filter', dimension: 'brand' },
        },

        {
            id: 'inventory.by_group',
            type: 'table',
            title: 'Stock by group',
            help: 'Every product group, with the tail beyond the top twelve folded into "Other" '
                + 'so the column totals are the whole catalogue.',
            span: { base: 12, md: 12, lg: 12 },
            query: {
                metrics: [
                    'inventory.stock_value',
                    'inventory.units_on_hand',
                    'inventory.dead_stock_value',
                    'inventory.dead_stock_share',
                ],
                dimensions: ['group'],
                grain: null,
                sort: { by: 'inventory.stock_value', dir: 'DESC' },
                topN: { n: 12, by: 'inventory.stock_value' },
            },
            display: {
                columns: [
                    'inventory.stock_value',
                    'inventory.units_on_hand',
                    'inventory.dead_stock_value',
                    'inventory.dead_stock_share',
                ],
                category: 'group',
                rank: true,
                bar: 'inventory.stock_value',
                coverage: { show: true, rule: 'wac_known' },
            },
            drilldown: { kind: 'filter', dimension: 'group' },
        },
    ],
};

module.exports = { INVENTORY_BOARD };
