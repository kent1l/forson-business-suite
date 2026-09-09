/**
 * Operations metrics — how well the stock record is being kept, and by whom.
 *
 * Two sources, and one deliberate omission.
 *
 * Counting accuracy is measured from `cycle_count_line` rather than from the
 * `employee_cycle_count_performance` materialized view the plan named. That
 * view computes its speed column from batch start and completion timestamps,
 * and no batch in this database has ever been marked COMPLETED — so it reports
 * `avg_speed_mins = 0` for every employee, which renders as an instantaneous
 * count rather than as an unmeasured one. Its accuracy column is sound but has
 * no date, so it cannot answer "is counting getting better". The line table
 * carries both a timestamp and the workflow's own verdict on each line, so
 * everything here is measured there instead.
 *
 * The omission is money. `inventory_transaction.unit_cost` is NULL on every
 * adjustment, reversal and count adjustment in this database, so a valued
 * shrinkage figure would have to reach for the part's CURRENT weighted average
 * cost — today's price applied to a movement from a year ago, presented as
 * money lost. Everything here is units and counts, which is what was observed.
 */
const ALL_GRAINS = ['none', 'day', 'week', 'month', 'quarter'];

const OPERATIONS_METRICS = {
    // -----------------------------------------------------------------------
    // Counting the stock.
    // -----------------------------------------------------------------------

    'ops.counted_lines': {
        id: 'ops.counted_lines',
        label: 'Lines Counted',
        description:
            'How many part lines somebody physically counted in the period. Lines in a batch '
            + 'that was opened and never counted are not included — work not yet done is not '
            + 'work done badly.',
        kind: 'additive',
        source: 'count_line',
        readiness: 'cycle_count_data',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.count_matches': {
        id: 'ops.count_matches',
        label: 'Lines That Matched',
        description:
            'Counted lines where the shelf agreed with the system and the count workflow '
            + 'approved them automatically. Reading the workflow\'s own verdict rather than '
            + 'recomputing it keeps this figure and the Cycle Count page from drifting apart.',
        kind: 'additive',
        source: 'count_line',
        readiness: 'cycle_count_data',
        expr: () => 'COUNT(*)',
        where: (c) => c.is_match,
        format: 'integer',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.count_accuracy_pct': {
        id: 'ops.count_accuracy_pct',
        label: 'Stock Record Accuracy',
        description:
            'The share of counted lines where the system already had the right quantity. It is '
            + 'a measure of the stock RECORD, not of the person counting: a low figure means the '
            + 'shelf and the database disagree, which is usually stock leaving without a sale '
            + 'being recorded.',
        kind: 'ratio',
        numerator: 'ops.count_matches',
        denominator: 'ops.counted_lines',
        scale: 100,
        zeroDenominator: null,
        readiness: 'cycle_count_data',
        format: 'percent',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.count_shortfall_units': {
        id: 'ops.count_shortfall_units',
        label: 'Units Missing',
        description:
            'Units the system expected to find and the count did not, added up across every '
            + 'line that came up short. Reported separately from the overage rather than netted '
            + 'against it: a net variance near zero can hide a great deal of both.',
        kind: 'additive',
        source: 'count_line',
        readiness: 'cycle_count_data',
        expr: (c) => `SUM(-(${c.variance}))`,
        where: (c) => `${c.variance} < 0`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.count_overage_units': {
        id: 'ops.count_overage_units',
        label: 'Units Found',
        description:
            'Units found on the shelf that the system did not know about. Stock that arrived '
            + 'without being recorded is as much a control problem as stock that left without '
            + 'being recorded — it just looks like good news.',
        kind: 'additive',
        source: 'count_line',
        readiness: 'cycle_count_data',
        expr: (c) => `SUM(${c.variance})`,
        where: (c) => `${c.variance} > 0`,
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.count_unassigned_finds': {
        id: 'ops.count_unassigned_finds',
        label: 'Lines Added During Counting',
        description:
            'Counted lines that were not on the batch when it was issued — a part found on the '
            + 'shelf and added by the counter. On this data almost every counted line is one of '
            + 'these, which says more about how batches are being issued than about what is on '
            + 'the shelves.',
        kind: 'additive',
        source: 'count_line',
        readiness: 'cycle_count_data',
        expr: () => 'COUNT(*)',
        where: (c) => c.is_unassigned_find,
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.count_timed_lines': {
        id: 'ops.count_timed_lines',
        label: 'Lines With a Timing',
        description:
            'Counted lines that recorded when the counter started as well as when they '
            + 'finished. It is the denominator of Time per Line; lines without a start time '
            + 'drop out of both halves of that average rather than entering it as instant.',
        kind: 'additive',
        source: 'count_line',
        readiness: 'cycle_count_data',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.started_at} IS NOT NULL`,
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.count_minutes': {
        id: 'ops.count_minutes',
        label: 'Total Counting Time',
        description:
            'Every timed line\'s duration, added together. It exists as the numerator of Time '
            + 'per Line and is not a figure about the business on its own.',
        kind: 'additive',
        source: 'count_line',
        readiness: 'cycle_count_data',
        expr: (c) => `SUM(${c.minutes_taken})`,
        where: (c) => `${c.started_at} IS NOT NULL`,
        format: 'minutes',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.avg_count_minutes': {
        id: 'ops.avg_count_minutes',
        label: 'Time per Line',
        description:
            'How long a counted line takes, on average — total counting time divided by the '
            + 'number of lines that were timed. A true mean weighted by lines, not an average '
            + 'of daily averages, which would let one line counted on a quiet day outweigh two '
            + 'hundred counted on a busy one.',
        kind: 'ratio',
        numerator: 'ops.count_minutes',
        denominator: 'ops.count_timed_lines',
        zeroDenominator: null,
        readiness: 'cycle_count_data',
        format: 'minutes',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    // -----------------------------------------------------------------------
    // Correcting the stock.
    //
    // Sales and receipts are the movements the business intends. Adjustments and
    // reversals are the ones that fix something, and how many of those there are
    // is a measure of how well the intended ones are being recorded.
    // -----------------------------------------------------------------------

    'ops.stock_movements': {
        id: 'ops.stock_movements',
        label: 'Stock Movements',
        description: 'Every recorded movement of stock in the period, of any kind.',
        kind: 'additive',
        source: 'stock_movement',
        expr: () => 'COUNT(*)',
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.manual_adjustments': {
        id: 'ops.manual_adjustments',
        label: 'Manual Adjustments',
        description:
            'Stock movements somebody entered by hand to correct a quantity, outside a sale, a '
            + 'receipt or a count. Each one is a quantity that had gone wrong somewhere else.',
        kind: 'additive',
        source: 'stock_movement',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.trans_type} = 'Adjustment'`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.manual_adjustment_units': {
        id: 'ops.manual_adjustment_units',
        label: 'Units Adjusted by Hand',
        description:
            'How many units those manual adjustments moved, counted without regard to '
            + 'direction, so that a correction up and a correction down do not cancel out.',
        kind: 'additive',
        source: 'stock_movement',
        expr: (c) => `SUM(ABS(${c.quantity}))`,
        where: (c) => `${c.trans_type} = 'Adjustment'`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.reversals': {
        id: 'ops.reversals',
        label: 'Reversed Transactions',
        description:
            'Movements entered to undo an earlier one — a sale voided, a receipt taken back. '
            + 'Steady low numbers are ordinary trading; a rising line is a process going wrong '
            + 'upstream of the stock record.',
        kind: 'additive',
        source: 'stock_movement',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.trans_type} = 'Reversal'`,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.count_adjustments': {
        id: 'ops.count_adjustments',
        label: 'Count Adjustments',
        description:
            'Stock movements raised by a cycle count to bring the system into line with what was '
            + 'on the shelf, whether a person approved the variance or the system applied it '
            + 'automatically.',
        kind: 'additive',
        source: 'stock_movement',
        expr: () => 'COUNT(*)',
        where: (c) => `${c.trans_type} IN ('Cycle Count Adjustment', 'Cycle Count Auto-Adjustment')`,
        format: 'integer',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.corrections': {
        id: 'ops.corrections',
        label: 'Corrections',
        description:
            'Manual adjustments and reversals together — every movement whose purpose was to fix '
            + 'something rather than to record a sale or a delivery. Count adjustments are '
            + 'deliberately excluded: a count is the process working, not failing.',
        kind: 'composite',
        terms: [
            { metric: 'ops.manual_adjustments', sign: 1 },
            { metric: 'ops.reversals', sign: 1 },
        ],
        exposeComponents: true,
        format: 'integer',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'ops.correction_share': {
        id: 'ops.correction_share',
        label: 'Correction Rate',
        description:
            'Corrections as a percentage of all stock movements. It is the cleanest single '
            + 'measure of how much of the stock work is fixing earlier stock work.',
        kind: 'ratio',
        numerator: 'ops.corrections',
        denominator: 'ops.stock_movements',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },
};

module.exports = { OPERATIONS_METRICS };
