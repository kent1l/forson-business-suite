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
