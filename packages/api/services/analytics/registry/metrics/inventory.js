/**
 * Inventory metrics.
 *
 * All of these are snapshots: what is on the shelf right now. They declare
 * `grains: ['none']` and `comparable: false` because a snapshot broken down by
 * month would repeat today's figure across every row and read as a flat trend
 * -- a wrong number that looks entirely plausible.
 *
 * Historical stock-as-of-date IS computable from inventory_transaction, but it
 * is a different and much more expensive query. It belongs in a future
 * `inventory_history` source, not as a grain on this one.
 *
 * DAYS OF INVENTORY IS DELIBERATELY ABSENT. Stock value over cost of goods sold
 * is the textbook measure, and it was built, run against the live database, and
 * removed: the numerator is measured over the 38% of stocked parts that carry a
 * weighted average cost, the denominator over the 17% of sale lines that
 * recorded one, and dividing two numbers with unrelated coverage produced 866
 * days where the real figure is nearer 140. A single coverage badge cannot
 * disclose that, and a figure whose two halves measure different populations is
 * exactly what §3's first decision forbids. It becomes computable -- honestly --
 * once the `cost_at_sale` write path stops recording 0 for an unknown cost.
 */
const SNAPSHOT_ONLY = ['none'];

const INVENTORY_METRICS = {
    'inventory.stock_value': {
        id: 'inventory.stock_value',
        label: 'Inventory Value',
        description:
            'Value of stock currently on hand, at weighted average cost. Parts with no recorded '
            + 'cost are counted in the quantity but contribute nothing to the value, so this is '
            + 'understated rather than guessed — check the coverage badge.',
        kind: 'snapshot',
        source: 'inventory_snapshot',
        trust: 'wac_known',
        expr: (c) => `SUM(${c.stock_on_hand} * ${c.wac_cost})`,
        where: (c) => `${c.stock_on_hand} > 0`,
        format: 'currency',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.dead_stock_value': {
        id: 'inventory.dead_stock_value',
        label: 'Dead Stock Value',
        description:
            'Value of stock on hand for parts with no sale in the last 180 days. Parts never sold '
            + 'at all are included. Valued at weighted average cost. This is money already spent '
            + 'that is not coming back through the counter.',
        kind: 'snapshot',
        source: 'inventory_snapshot',
        trust: 'wac_known',
        expr: (c) => `SUM(${c.stock_on_hand} * ${c.wac_cost})`,
        where: (c) => `${c.stock_on_hand} > 0
                  AND (${c.last_sold_at} IS NULL
                       OR ${c.last_sold_at} < (CURRENT_DATE - INTERVAL '180 days'))`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.stocked_parts': {
        id: 'inventory.stocked_parts',
        label: 'Parts in Stock',
        description: 'Active, non-service parts currently holding a positive quantity on hand.',
        kind: 'snapshot',
        source: 'inventory_snapshot',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.stock_on_hand} > 0`,
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.uncosted_stocked_parts': {
        id: 'inventory.uncosted_stocked_parts',
        label: 'Stocked Parts Without a Cost',
        description:
            'Parts holding stock that carry no weighted average cost. Their stock is worth '
            + 'something but the system cannot say how much, so inventory value and every margin '
            + 'they touch are understated. Each one is fixable on the Cost Data Health page.',
        kind: 'snapshot',
        source: 'inventory_snapshot',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.stock_on_hand} > 0 AND COALESCE(${c.wac_cost}, 0) = 0`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.units_on_hand': {
        id: 'inventory.units_on_hand',
        label: 'Units in Stock',
        description:
            'Total quantity on hand across every active, non-service part. Unlike Inventory '
            + 'Value this needs no cost, so it covers the whole catalogue rather than the '
            + 'costed part of it.',
        kind: 'snapshot',
        source: 'inventory_snapshot',
        expr: (c) => `SUM(GREATEST(${c.stock_on_hand}, 0))`,
        where: (c) => `${c.stock_on_hand} > 0`,
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.dead_stock_parts': {
        id: 'inventory.dead_stock_parts',
        label: 'Dead Stock Lines',
        description:
            'Number of parts holding stock that have not sold in the last 180 days, including '
            + 'parts never sold at all. The count matters alongside the value: a few expensive '
            + 'mistakes and a thousand small ones need different answers.',
        kind: 'snapshot',
        source: 'inventory_snapshot',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.stock_on_hand} > 0
                  AND (${c.last_sold_at} IS NULL
                       OR ${c.last_sold_at} < (CURRENT_DATE - INTERVAL '180 days'))`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    /**
     * Reorder metrics. All of them read `reorder_candidates`, which is where the
     * definition of "actually needs reordering" lives -- repeat demand in the
     * last 90 days and under thirty days of cover. See registry/sources.js.
     */
    'inventory.reorder_parts': {
        id: 'inventory.reorder_parts',
        label: 'Parts to Reorder',
        description:
            'Parts that sold on at least three separate invoices in the last 90 days and now '
            + 'hold under thirty days of cover at that rate — or none at all. Deliberately NOT '
            + 'the "below reorder point" flag, which fires on thousands of parts from '
            + 'unmaintained defaults and is therefore ignored by everyone.',
        kind: 'snapshot',
        source: 'reorder_candidates',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.reorder_stock_on_hand': {
        id: 'inventory.reorder_stock_on_hand',
        label: 'On Hand',
        description: 'Units currently on hand, across the parts that need reordering.',
        kind: 'snapshot',
        source: 'reorder_candidates',
        expr: (c) => `SUM(GREATEST(${c.stock_on_hand}, 0))`,
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.reorder_demand_90d': {
        id: 'inventory.reorder_demand_90d',
        label: 'Sold (90 days)',
        description: 'Units sold in the last 90 days, across the parts that need reordering.',
        kind: 'snapshot',
        source: 'reorder_candidates',
        expr: (c) => `SUM(${c.demand_90d})`,
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.reorder_daily_demand': {
        id: 'inventory.reorder_daily_demand',
        label: 'Units per Day',
        description:
            'The last 90 days of demand expressed as a daily rate. It exists as the denominator '
            + 'of Days of Cover and is rarely worth reading on its own.',
        kind: 'snapshot',
        source: 'reorder_candidates',
        // Divided inside the aggregate so `expr` stays a bare aggregate, as the
        // builder requires. SUM(x/90) and SUM(x)/90 are the same number.
        expr: (c) => `SUM(${c.demand_90d} / 90.0)`,
        format: 'ratio',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.reorder_days_of_cover': {
        id: 'inventory.reorder_days_of_cover',
        label: 'Days of Cover',
        description:
            'How long the stock on hand lasts at the last 90 days’ selling rate. Zero means the '
            + 'part is already out. This is the number to act on: a part with four days of cover '
            + 'and steady demand will be a lost sale this week.',
        kind: 'ratio',
        numerator: 'inventory.reorder_stock_on_hand',
        denominator: 'inventory.reorder_daily_demand',
        zeroDenominator: null,
        format: 'days',
        direction: 'higher_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.reorder_units_short': {
        id: 'inventory.reorder_units_short',
        label: 'Units Short',
        description:
            'Units needed to bring each part back to thirty days of cover. A starting point for '
            + 'a purchase order, not a recommendation: it knows nothing about pack sizes, '
            + 'supplier minimums or lead times.',
        kind: 'snapshot',
        source: 'reorder_candidates',
        expr: (c) => `SUM(${c.units_short})`,
        format: 'integer',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.reorder_revenue_90d': {
        id: 'inventory.reorder_revenue_90d',
        label: 'Earned (90 days)',
        description:
            'Ex-VAT revenue these parts earned over the last 90 days. This is the consequence '
            + 'measure — the money at risk if the shelf stays empty — and it is what the reorder '
            + 'list is ranked by.',
        kind: 'snapshot',
        source: 'reorder_candidates',
        expr: (c) => `SUM(${c.revenue_90d})`,
        format: 'currency',
        direction: 'neutral',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },

    'inventory.dead_stock_share': {
        id: 'inventory.dead_stock_share',
        label: 'Dead Stock Share',
        description: 'Dead Stock Value as a percentage of total Inventory Value.',
        kind: 'ratio',
        numerator: 'inventory.dead_stock_value',
        denominator: 'inventory.stock_value',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'lower_is_better',
        comparable: false,
        grains: SNAPSHOT_ONLY,
        permission: 'analytics:view',
    },
};

module.exports = { INVENTORY_METRICS };
