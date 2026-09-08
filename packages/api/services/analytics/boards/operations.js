/**
 * The Operations board: "how well is the stock record being kept, and by whom?"
 *
 * This board measures the RECORD, not the people. That distinction is written
 * into the tile help throughout, and it is not politeness: a low count accuracy
 * means the shelf and the database disagree, which is almost always stock
 * leaving without a sale being recorded — a failure that happened long before
 * whoever counted the shelf arrived. A board that let those figures read as
 * individual performance would be both wrong and corrosive.
 *
 * Three notes on what is here and what is not:
 *
 * - **Counting is measured from the count lines, not from the performance
 *   view.** `employee_cycle_count_performance` reports `avg_speed_mins = 0` for
 *   every employee, because it times batches and no batch in this database has
 *   ever been marked COMPLETED. A zero that means "never measured" renders
 *   exactly like a zero that means "instant", so the line's own start and
 *   finish timestamps are used instead.
 * - **Counting happened in one fortnight.** Every count in this database was
 *   taken in July 2026. Over a range that does not include it, these tiles are
 *   honestly empty rather than zero.
 * - **Nothing here is valued in money.** Adjustments and reversals carry no unit
 *   cost, so a shrinkage figure would have to be priced at the part's cost
 *   today — a guess about a movement from a year ago, printed as a peso amount.
 *   Units are what was observed.
 */

const COUNT_QUERY = {
    metrics: [
        'ops.count_accuracy_pct',
        'ops.counted_lines',
        'ops.count_matches',
        'ops.count_shortfall_units',
        'ops.count_overage_units',
        'ops.count_unassigned_finds',
    ],
    dimensions: [],
    grain: null,
    compare: null,
};

const TIMING_QUERY = {
    metrics: ['ops.avg_count_minutes', 'ops.count_minutes', 'ops.count_timed_lines'],
    dimensions: [],
    grain: null,
    compare: null,
};

const CORRECTION_QUERY = {
    metrics: [
        'ops.corrections',
        'ops.correction_share',
        'ops.manual_adjustments',
        'ops.manual_adjustment_units',
        'ops.reversals',
        'ops.stock_movements',
    ],
    dimensions: [],
    grain: null,
    compare: 'previous_period',
};

const RECEIVING_QUERY = {
    metrics: ['purch.receipts', 'purch.units_received', 'purch.receipt_lines'],
    dimensions: [],
    grain: null,
    compare: 'previous_period',
};

const NOT_ABOUT_THE_COUNTER = 'This measures the stock record, not the person who counted it: a '
    + 'variance is stock that moved without being recorded, which happened before the count did.';

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

const OPERATIONS_BOARD = {
    id: 'operations',
    title: 'Operations',
    description:
        'How accurately stock is being recorded, how much work goes into correcting it, and '
        + 'where the receiving effort is going.',
    defaultPreset: 'last_90_days',
    period: 'range',
    tiles: [
        kpi('ops.count_accuracy_pct', 'ops.count_accuracy_pct', COUNT_QUERY, { lg: 3 }, {
            display: { emphasis: 'hero' },
            help: `The share of counted lines where the system already held the right quantity. ${NOT_ABOUT_THE_COUNTER}`,
            drilldown: { kind: 'page', page: 'cycle_count', params: {} },
        }),
        kpi('ops.counted_lines', 'ops.counted_lines', COUNT_QUERY, { lg: 3 }, {
            help: 'Lines somebody physically counted in the range. Lines in a batch that was '
                + 'opened and never counted are not included — work not yet done is not work '
                + 'done badly.',
        }),
        kpi('ops.count_shortfall_units', 'ops.count_shortfall_units', COUNT_QUERY, { lg: 3 }, {
            help: 'Units the system expected and the count did not find. Shown separately from '
                + 'the overage rather than netted against it: a net variance near zero can hide '
                + 'a great deal of both.',
            drilldown: { kind: 'page', page: 'stock_reconciliation', params: {} },
        }),
        kpi('ops.count_overage_units', 'ops.count_overage_units', COUNT_QUERY, { lg: 3 }, {
            help: 'Units found that the system did not know about. Stock arriving without being '
                + 'recorded is as much a control problem as stock leaving that way — it just '
                + 'looks like good news.',
        }),

        {
            id: 'ops.count_outcomes',
            type: 'bar',
            title: 'What the counts found',
            help: 'Counted lines split three ways rather than into "right" and "wrong": short '
                + 'and over are different problems with different causes.',
            span: { base: 12, md: 6, lg: 5 },
            query: {
                metrics: ['ops.counted_lines'],
                dimensions: ['count_variance_band'],
                grain: null,
                sort: { by: 'count_variance_band', dir: 'ASC' },
            },
            display: { value: 'ops.counted_lines', category: 'count_variance_band' },
            drilldown: { kind: 'page', page: 'cycle_count', params: {} },
        },
        {
            id: 'ops.counting_by_staff',
            type: 'table',
            title: 'Counting activity',
            help: `Who counted what, and how long it took. ${NOT_ABOUT_THE_COUNTER} Read the `
                + 'accuracy column as a property of the parts each person happened to be given, '
                + 'not of the person: a batch of fast-moving parts will disagree with the system '
                + 'far more often than a batch of slow ones.',
            span: { base: 12, md: 6, lg: 7 },
            query: {
                metrics: [
                    'ops.counted_lines',
                    'ops.count_accuracy_pct',
                    'ops.avg_count_minutes',
                    'ops.count_unassigned_finds',
                ],
                dimensions: ['employee'],
                grain: null,
                sort: { by: 'ops.counted_lines', dir: 'DESC' },
                limit: 15,
            },
            display: {
                columns: [
                    'ops.counted_lines',
                    'ops.count_accuracy_pct',
                    'ops.avg_count_minutes',
                    'ops.count_unassigned_finds',
                ],
                category: 'employee',
                bar: 'ops.counted_lines',
            },
            drilldown: { kind: 'filter', dimension: 'employee' },
        },

        kpi('ops.avg_count_minutes', 'ops.avg_count_minutes', TIMING_QUERY, { lg: 3 }, {
            help: 'Total counting time divided by the number of lines that recorded a start as '
                + 'well as a finish. Lines with no start time are left out of both halves rather '
                + 'than entering the average as instant counts.',
        }),
        kpi('ops.count_unassigned_finds', 'ops.count_unassigned_finds', COUNT_QUERY, { lg: 3 }, {
            help: 'Lines added by the counter because the part was on the shelf and not on the '
                + 'batch. On this data almost every counted line is one of these, which says '
                + 'more about how batches are being issued than about the shelves.',
        }),
        kpi('ops.count_matches', 'ops.count_matches', COUNT_QUERY, { lg: 3 }),
        kpi('ops.count_timed_lines', 'ops.count_timed_lines', TIMING_QUERY, { lg: 3 }),

        // --- corrections -----------------------------------------------------
        kpi('ops.correction_share', 'ops.correction_share', CORRECTION_QUERY, { lg: 3 }, {
            display: { emphasis: 'hero' },
            help: 'Manual adjustments and reversals as a share of every stock movement — how '
                + 'much of the stock work is fixing earlier stock work. Count adjustments are '
                + 'deliberately excluded: a count is the process working, not failing.',
        }),
        kpi('ops.manual_adjustments', 'ops.manual_adjustments', CORRECTION_QUERY, { lg: 3 }, {
            drilldown: { kind: 'page', page: 'inventory', params: {} },
        }),
        kpi('ops.manual_adjustment_units', 'ops.manual_adjustment_units', CORRECTION_QUERY, { lg: 3 }, {
            help: 'Counted without regard to direction, so a correction up and a correction down '
                + 'do not cancel each other out of the total.',
        }),
        kpi('ops.reversals', 'ops.reversals', CORRECTION_QUERY, { lg: 3 }, {
            help: 'Movements entered to undo an earlier one. A steady low number is ordinary '
                + 'trading; a rising line is a process going wrong upstream of the stock record.',
        }),

        {
            id: 'ops.corrections_trend',
            type: 'line',
            title: 'Corrections over time',
            help: 'Manual adjustments and reversals by period, against every movement recorded. '
                + 'The interesting shape is the ratio between them, not either line alone.',
            span: { base: 12, md: 12, lg: 7 },
            query: {
                metrics: ['ops.corrections', 'ops.correction_share', 'ops.stock_movements'],
                dimensions: ['date'],
                grain: 'auto',
                minGrain: 'month',
                compare: 'previous_period',
            },
            display: { value: 'ops.corrections' },
        },
        {
            id: 'ops.movements_by_type',
            type: 'table',
            title: 'Stock movements by type',
            help: 'Every kind of movement recorded in the range. The two cycle-count rows are '
                + 'kept apart on purpose: a variance a person reviewed and a variance the system '
                + 'applied on its own are different facts about how closely stock is controlled.',
            span: { base: 12, md: 12, lg: 5 },
            query: {
                metrics: ['ops.stock_movements'],
                dimensions: ['stock_movement_type'],
                grain: null,
                sort: { by: 'ops.stock_movements', dir: 'DESC' },
                limit: 20,
            },
            display: {
                columns: ['ops.stock_movements'],
                category: 'stock_movement_type',
                bar: 'ops.stock_movements',
            },
        },
        {
            id: 'ops.corrections_by_staff',
            type: 'table',
            title: 'Corrections by staff',
            help: 'Who is entering the corrections. High numbers usually mark the person who '
                + 'cleans up after everybody else rather than the person causing the problem, so '
                + 'this reads best alongside the movement types above.',
            span: { base: 12, md: 6, lg: 6 },
            query: {
                metrics: ['ops.corrections', 'ops.manual_adjustments', 'ops.reversals'],
                dimensions: ['employee'],
                grain: null,
                sort: { by: 'ops.corrections', dir: 'DESC' },
                topN: { n: 10, by: 'ops.corrections' },
            },
            display: {
                columns: ['ops.corrections', 'ops.manual_adjustments', 'ops.reversals'],
                category: 'employee',
                rank: true,
                bar: 'ops.corrections',
            },
            drilldown: { kind: 'filter', dimension: 'employee' },
        },
        {
            id: 'ops.adjustments_by_part',
            type: 'table',
            title: 'Parts adjusted most',
            help: 'The parts whose quantity keeps having to be corrected by hand. A part near '
                + 'the top of this list has something wrong with how it is sold, received or '
                + 'counted — the adjustment is the symptom.',
            span: { base: 12, md: 6, lg: 6 },
            query: {
                metrics: ['ops.manual_adjustments', 'ops.manual_adjustment_units'],
                dimensions: ['part'],
                grain: null,
                sort: { by: 'ops.manual_adjustments', dir: 'DESC' },
                limit: 15,
            },
            display: {
                columns: ['ops.manual_adjustments', 'ops.manual_adjustment_units'],
                category: 'part',
                rank: true,
                bar: 'ops.manual_adjustments',
            },
            drilldown: { kind: 'page', page: 'inventory', params: { search: '$row.label' } },
        },

        // --- receiving effort -------------------------------------------------
        kpi('ops.receipts', 'purch.receipts', RECEIVING_QUERY, { lg: 4 }, {
            title: 'Receipts Recorded',
            drilldown: { kind: 'page', page: 'goods_receipt_history', params: {} },
        }),
        kpi('ops.receipt_lines', 'purch.receipt_lines', RECEIVING_QUERY, { lg: 4 }),
        kpi('ops.units_received', 'purch.units_received', RECEIVING_QUERY, { lg: 4 }),

        {
            id: 'ops.receiving_by_staff',
            type: 'table',
            title: 'Receiving activity',
            help: 'Who booked the goods in. This is a workload figure, not a quality one — the '
                + 'Purchasing board carries the cost gap those receipts left behind.',
            span: { base: 12, md: 12, lg: 12 },
            query: {
                metrics: ['purch.receipts', 'purch.receipt_lines', 'purch.units_received'],
                dimensions: ['employee'],
                grain: null,
                sort: { by: 'purch.receipt_lines', dir: 'DESC' },
                topN: { n: 10, by: 'purch.receipt_lines' },
            },
            display: {
                columns: ['purch.receipts', 'purch.receipt_lines', 'purch.units_received'],
                category: 'employee',
                rank: true,
                bar: 'purch.receipt_lines',
            },
            drilldown: { kind: 'filter', dimension: 'employee' },
        },
    ],
};

module.exports = { OPERATIONS_BOARD };
