/**
 * Dimensions and the closed grain map.
 *
 * A dimension contributes two expressions: a stable `key` used for grouping and
 * joining across sources, and a `label` for display. Both are functions of the
 * source's frozen `cols` map and never of request input.
 *
 * `valueType` decides the array cast a filter is pushed with, so the cast is
 * registry-controlled rather than inferred from whatever the caller sent.
 *
 * `needsDateColumn` marks a dimension derived from the source's own date column.
 * A source with no date -- the stock snapshot, the A/R ledger view -- cannot
 * answer it, and both the registry's load-time check and the query builder's
 * per-request check read this flag rather than special-casing 'date' by name.
 *
 * `sortBy` says which of the two expressions carries the dimension's natural
 * order. For a brand or a part that is the label -- nobody wants a chart ordered
 * by brand id. For a period or a margin band it is the KEY: the bands read
 * "(No cost recorded), Sold at a loss, 0-10%, 10-25%..." in that order because
 * the key is an ordinal, where ordering them by their labels would sort "10-25%"
 * before "0-10%" alphabetically and quietly scramble a distribution.
 */

const { costedLineCondition } = require('../../../helpers/costCoverage');

// The one place this module names a time zone. Everything downstream periodises
// on the Manila calendar, so a dimension derived from a timestamp must too.
const MANILA = "AT TIME ZONE 'Asia/Manila'";

/**
 * Margin bands, as an ordered CASE over the line's own margin.
 *
 * The bands are ordinals so they sort into a sensible order on their own, and
 * band 0 -- "(No cost recorded)" -- is a real, visible band rather than rows
 * quietly dropped. That is the whole reason this dimension is worth having: on
 * this data the uncosted band carries ₱9.2M of the ₱11.5M, and a margin
 * distribution that showed only the measurable ₱2.3M would be a chart about the
 * fifth of the business we happen to know about, presented as the whole.
 *
 * What counts as a costed line comes from helpers/costCoverage.js, the same
 * definition the trust rules and the Reports page use. It is NOT restated here.
 */
const MARGIN_BANDS = Object.freeze([
    [0, '(No cost recorded)'],
    [1, 'No revenue'],
    [2, 'Sold at a loss'],
    [3, '0–10%'],
    [4, '10–25%'],
    [5, '25–40%'],
    [6, '40% or more'],
]);

const marginBandCase = (c, emit) => {
    const rev = c.revenue_ex_tax;
    const profit = `(${rev} - (${c.quantity} * ${c.unit_cost}))`;
    const pct = `(${profit} / NULLIF(${rev}, 0))`;
    return `CASE
        WHEN NOT (${costedLineCondition(c.__alias)}) THEN ${emit(0)}
        WHEN ${rev} <= 0 THEN ${emit(1)}
        WHEN ${pct} < 0 THEN ${emit(2)}
        WHEN ${pct} < 0.10 THEN ${emit(3)}
        WHEN ${pct} < 0.25 THEN ${emit(4)}
        WHEN ${pct} < 0.40 THEN ${emit(5)}
        ELSE ${emit(6)} END`;
};

const DIMENSIONS = Object.freeze({
    date: Object.freeze({
        id: 'date',
        label: 'Period',
        kind: 'time',
        requiresJoins: Object.freeze([]),
        filterable: false,
        needsDateColumn: true,
        sortBy: 'key',
        valueType: 'text',
        key: (c, src, ctx) =>
            `date_trunc('${ctx.grainUnit}', ${src.dateColumn} ${MANILA})`,
        keyLabel: (c, src, ctx) =>
            `to_char(date_trunc('${ctx.grainUnit}', ${src.dateColumn} ${MANILA}), '${ctx.dateFormat}')`,
    }),
    /**
     * Hour of the trading day, in Manila local time.
     *
     * Deliberately NOT a grain. A grain slices a period into consecutive
     * buckets; this folds every day in the range onto the same 24 hours, which
     * is what makes "when should the second cashier start" answerable at all.
     * Pairing it with `weekday` gives the staffing heatmap; the two together are
     * the whole reason this dimension exists.
     */
    hour_of_day: Object.freeze({
        id: 'hour_of_day',
        label: 'Hour of day',
        kind: 'time',
        requiresJoins: Object.freeze([]),
        filterable: false,
        needsDateColumn: true,
        valueType: 'int',
        key: (c, src) => `EXTRACT(HOUR FROM ${src.dateColumn} ${MANILA})::int`,
        // Written out rather than to_char'd off the timestamp so the label is a
        // pure function of the key, and a GROUP BY on both cannot split an hour.
        keyLabel: (c, src) =>
            `lpad(EXTRACT(HOUR FROM ${src.dateColumn} ${MANILA})::text, 2, '0') || ':00'`,
    }),
    /**
     * Day of the week, Monday first (ISO), in Manila local time.
     *
     * The key is the ISO number so the heatmap's rows sort Mon-Sun on their own
     * rather than alphabetically; the label is the short day name.
     */
    weekday: Object.freeze({
        id: 'weekday',
        label: 'Day of week',
        kind: 'time',
        requiresJoins: Object.freeze([]),
        filterable: false,
        needsDateColumn: true,
        valueType: 'int',
        key: (c, src) => `EXTRACT(ISODOW FROM ${src.dateColumn} ${MANILA})::int`,
        keyLabel: (c, src) => `to_char(${src.dateColumn} ${MANILA}, 'Dy')`,
    }),
    brand: Object.freeze({
        id: 'brand',
        label: 'Brand',
        kind: 'entity',
        requiresJoins: Object.freeze(['part', 'brand']),
        filterable: true,
        valueType: 'int',
        lookup: '/brands',
        key: () => 'b.brand_id',
        keyLabel: () => "COALESCE(b.brand_name, '(No brand)')",
    }),
    group: Object.freeze({
        id: 'group',
        label: 'Group',
        kind: 'entity',
        requiresJoins: Object.freeze(['part', 'group']),
        filterable: true,
        valueType: 'int',
        lookup: '/groups',
        key: () => 'g.group_id',
        keyLabel: () => "COALESCE(g.group_name, '(No group)')",
    }),
    part: Object.freeze({
        id: 'part',
        label: 'Part',
        kind: 'entity',
        requiresJoins: Object.freeze(['part']),
        filterable: true,
        valueType: 'int',
        lookup: '/parts',
        key: (c) => c.part_id,
        keyLabel: () => '(SELECT pv.display_name FROM public.parts_view pv WHERE pv.part_id = p.part_id)',
    }),
    customer: Object.freeze({
        id: 'customer',
        label: 'Customer',
        kind: 'entity',
        requiresJoins: Object.freeze(['customer']),
        filterable: true,
        valueType: 'int',
        lookup: '/customers',
        key: (c) => c.customer_id,
        keyLabel: () => "COALESCE(NULLIF(cu.company_name, ''), cu.first_name || ' ' || cu.last_name)",
    }),
    customer_type: Object.freeze({
        id: 'customer_type',
        label: 'Customer type',
        kind: 'attribute',
        requiresJoins: Object.freeze(['customer']),
        filterable: true,
        valueType: 'text',
        values: Object.freeze(['PRIVATE', 'GOVERNMENT']),
        key: () => "COALESCE(cu.customer_type, 'PRIVATE')",
        keyLabel: () => "COALESCE(cu.customer_type, 'PRIVATE')",
    }),
    employee: Object.freeze({
        id: 'employee',
        label: 'Staff',
        kind: 'entity',
        requiresJoins: Object.freeze(['employee']),
        filterable: true,
        valueType: 'int',
        lookup: '/employees',
        key: (c) => c.employee_id,
        keyLabel: () => "e.first_name || ' ' || e.last_name",
    }),
    payment_method: Object.freeze({
        id: 'payment_method',
        label: 'Payment method',
        kind: 'entity',
        requiresJoins: Object.freeze(['payment_method']),
        filterable: true,
        valueType: 'int',
        key: () => 'pm.method_id',
        keyLabel: () => "COALESCE(pm.name, '(Unpaid)')",
    }),
    invoice_status: Object.freeze({
        id: 'invoice_status',
        label: 'Invoice status',
        kind: 'attribute',
        requiresJoins: Object.freeze([]),
        filterable: true,
        valueType: 'text',
        key: () => 'i.status',
        keyLabel: () => 'i.status',
    }),
    margin_band: Object.freeze({
        id: 'margin_band',
        label: 'Margin band',
        kind: 'attribute',
        requiresJoins: Object.freeze([]),
        // Deliberately not filterable. The band is derived from two columns
        // rather than stored, so filtering on it would mean re-deriving it in a
        // WHERE clause -- and a reader who wants only the loss-making lines is
        // better served by sorting the table than by a filter that silently
        // changes every other tile on the board.
        filterable: false,
        sortBy: 'key',
        valueType: 'int',
        key: (c) => marginBandCase(c, (n) => String(n)),
        keyLabel: (c) => marginBandCase(c, (n) => `'${MARGIN_BANDS[n][1]}'`),
    }),
});

/**
 * The ONLY place a grain string reaches SQL. Every value here is a literal in
 * this file, so the interpolation in `DIMENSIONS.date` cannot carry request
 * input even before the validator rejects an unknown grain.
 */
const GRAINS = Object.freeze({
    day: Object.freeze({ id: 'day', label: 'Day', unit: 'day', dateFormat: 'YYYY-MM-DD', interval: '1 day' }),
    week: Object.freeze({ id: 'week', label: 'Week', unit: 'week', dateFormat: 'IYYY-"W"IW', interval: '1 week' }),
    month: Object.freeze({ id: 'month', label: 'Month', unit: 'month', dateFormat: 'YYYY-MM', interval: '1 month' }),
    quarter: Object.freeze({ id: 'quarter', label: 'Quarter', unit: 'quarter', dateFormat: 'YYYY-"Q"Q', interval: '3 months' }),
});

const GRAIN_KEYS = Object.freeze(['none', ...Object.keys(GRAINS)]);

module.exports = { DIMENSIONS, GRAINS, GRAIN_KEYS };
