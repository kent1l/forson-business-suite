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

/**
 * Aging bands for an open receivable, as an ordered CASE over the invoice's own
 * overdue days.
 *
 * Two decisions are load-bearing:
 *
 * - **"No payment terms" is a band, not a missing value.** 28 of the 39 open
 *   invoices in this database carry no due date at all, and an invoice with no
 *   due date can never become overdue. Dropping those rows would show an aging
 *   chart over a minority of the money owed; folding them into "not yet due"
 *   would assert they are healthy when the truth is that nobody agreed when
 *   they are payable. They are their own band, and they read last.
 * - **The key is an ordinal.** Ordering by the label would sort "1–30 days"
 *   before "Over 90 days" and put "31–60" before "61–90" only by accident of
 *   the digits. See `sortBy` below.
 */
const AGING_BANDS = Object.freeze([
    [0, 'Not yet due'],
    [1, '1–30 days'],
    [2, '31–60 days'],
    [3, '61–90 days'],
    [4, 'Over 90 days'],
    [5, '(No payment terms)'],
]);

const agingBandCase = (c, emit) => `CASE
        WHEN ${c.due_date} IS NULL THEN ${emit(5)}
        WHEN COALESCE(${c.days_overdue}, 0) <= 0 THEN ${emit(0)}
        WHEN ${c.days_overdue} <= 30 THEN ${emit(1)}
        WHEN ${c.days_overdue} <= 60 THEN ${emit(2)}
        WHEN ${c.days_overdue} <= 90 THEN ${emit(3)}
        ELSE ${emit(4)} END`;

/**
 * The A/R ledger's entry types, rendered in the words a person uses.
 *
 * The enum labels (`PAYMENT_SETTLED`, `PDC_BOUNCED_REVERSAL`) are accurate and
 * unreadable. The CASE is exhaustive over the enum as it stands and falls back
 * to the raw value, so a type added to `ar_ledger_entry_type` later shows up
 * as itself rather than disappearing into an "(Other)" bucket nobody can chase.
 */
const AR_ENTRY_LABELS = Object.freeze([
    ['INVOICE_POSTED', 'Invoiced to account'],
    ['PAYMENT_SETTLED', 'Payment received'],
    ['CREDIT_MEMO_APPLIED', 'Credit note applied'],
    ['CREDIT_ADJUSTMENT', 'Credit adjustment'],
    ['PDC_BOUNCED_REVERSAL', 'Bounced cheque reversed'],
    ['WITHHOLDING_TAX_CREDIT', 'Withholding tax credited'],
    ['SETTLEMENT_DISCOUNT', 'Settlement concession'],
    ['BALANCE_WRITE_DOWN', 'Balance written down'],
    ['ADJUSTMENT_REVERSAL', 'Adjustment reversed'],
]);


/**
 * The A/P ledger's entry types, in the words a person uses. Same shape and same
 * reasoning as `AR_ENTRY_LABELS`: exhaustive over the enum as it stands, with a
 * fallback to the raw value so a type added later shows up as itself instead of
 * disappearing into an unlabelled bucket.
 */
const AP_ENTRY_LABELS = Object.freeze([
    ['BILL_POSTED', 'Billed by supplier'],
    ['PAYMENT_SETTLED', 'Paid to supplier'],
    ['PDC_BOUNCED_REVERSAL', 'Our cheque bounced'],
    ['BOUNCE_FEE_PENALTY', 'Bounce fee charged to us'],
    ['DEBIT_ADJUSTMENT', 'Debit adjustment'],
    ['CREDIT_ADJUSTMENT', 'Credit adjustment'],
    ['RETURN_CREDIT', 'Credit for returned goods'],
]);

/**
 * Stock movement types.
 *
 * `inventory_transaction.trans_type` is free text rather than an enum, so the
 * fallback matters more here than it does for the ledgers: a type this list has
 * never seen reads as itself, and is therefore visible and chaseable, instead of
 * vanishing. The two cycle-count types are kept APART rather than merged --
 * "a person reviewed this variance and approved it" and "the system moved the
 * stock on its own" are different facts about how carefully stock is controlled.
 */
const STOCK_MOVEMENT_LABELS = Object.freeze([
    ['StockIn', 'Received into stock'],
    ['StockOut', 'Sold'],
    ['Refund', 'Returned by a customer'],
    ['Adjustment', 'Manual adjustment'],
    ['Reversal', 'Reversed transaction'],
    ['Cycle Count Adjustment', 'Count adjustment (reviewed)'],
    ['Cycle Count Auto-Adjustment', 'Count adjustment (automatic)'],
]);

const labelCase = (expr, pairs) => `CASE ${expr}::text
        ${pairs.map(([k, label]) => `WHEN '${k}' THEN '${label}'`).join('\n        ')}
        ELSE ${expr}::text END`;

/**
 * What a count found, as an ordered CASE over the counted quantity against the
 * quantity the system believed.
 *
 * "Counted short" and "counted over" are deliberately separate bands rather
 * than one "variance" figure. They are different problems: short is stock that
 * has left without being recorded, over is stock that arrived without being
 * recorded, and a net variance near zero can hide a great deal of both.
 */
const COUNT_VARIANCE_BANDS = Object.freeze([
    [0, 'Matched the system'],
    [1, 'Counted short'],
    [2, 'Counted over'],
]);

const countVarianceCase = (c, emit) => `CASE
        WHEN ${c.counted_qty} = ${c.system_qty} THEN ${emit(0)}
        WHEN ${c.counted_qty} < ${c.system_qty} THEN ${emit(1)}
        ELSE ${emit(2)} END`;

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

    /**
     * The month a customer FIRST bought from the business.
     *
     * This is the retention question §14 asks for, in the only shape this
     * database can answer honestly. A classic cohort grid (cohort month x months
     * since first purchase) needs years of history to say anything; twelve
     * months of it produces a triangle that is mostly empty and reads as churn.
     * Revenue in the selected period, split by the vintage of the account that
     * produced it, answers "are the customers we won a year ago still buying?"
     * with the data that actually exists.
     *
     * It is a fact about the CUSTOMER, not about the requested range, so no
     * request value reaches it — the source's own lateral supplies the date.
     */
    customer_cohort: Object.freeze({
        id: 'customer_cohort',
        label: 'Customer since',
        kind: 'attribute',
        requiresJoins: Object.freeze([]),
        // Derived from a timestamp on the source's FROM clause, but not from the
        // source's own `dateColumn`, so a source without a date could still carry
        // it. `named_invoice` is the only one that does.
        filterable: false,
        sortBy: 'key',
        valueType: 'text',
        key: (c) => `date_trunc('month', ${c.first_invoice_at} ${MANILA})`,
        keyLabel: (c) => `to_char(date_trunc('month', ${c.first_invoice_at} ${MANILA}), 'Mon YYYY')`,
    }),

    aging_bucket: Object.freeze({
        id: 'aging_bucket',
        label: 'Age',
        kind: 'attribute',
        requiresJoins: Object.freeze([]),
        // Derived from two columns rather than stored, so filtering on it would
        // mean re-deriving it in a WHERE clause. A reader who wants only the
        // overdue rows is better served by the overdue metric beside it.
        filterable: false,
        sortBy: 'key',
        valueType: 'int',
        key: (c) => agingBandCase(c, (n) => String(n)),
        keyLabel: (c) => agingBandCase(c, (n) => `'${AGING_BANDS[n][1]}'`),
    }),

    ar_entry_type: Object.freeze({
        id: 'ar_entry_type',
        label: 'Ledger movement',
        kind: 'attribute',
        requiresJoins: Object.freeze([]),
        filterable: false,
        valueType: 'text',
        key: (c) => `${c.entry_type}::text`,
        keyLabel: (c) => labelCase(c.entry_type, AR_ENTRY_LABELS),
    }),

    /**
     * Why a concession or write-down was granted.
     *
     * Reached through the `adjustment` join, which is a LEFT JOIN on a UNIQUE
     * column (`ar_adjustment.ledger_id`), so it cannot fan a ledger row out and
     * double-count its amount. Ledger entries that are not adjustments read
     * "(Not an adjustment)" rather than NULL, so they are visible in a breakdown
     * instead of collapsing into an unlabelled row.
     */
    adjustment_reason: Object.freeze({
        id: 'adjustment_reason',
        label: 'Reason',
        kind: 'attribute',
        requiresJoins: Object.freeze(['adjustment']),
        filterable: false,
        valueType: 'text',
        key: () => "COALESCE(adj.reason_code, '(none)')",
        keyLabel: () => `CASE
            WHEN adj.reason_code IS NULL THEN '(Not an adjustment)'
            ELSE initcap(replace(adj.reason_code, '_', ' ')) END`,
    }),

    /**
     * The supplier a receipt, bill or ledger entry belongs to.
     *
     * Worth reading the top supplier on this dimension before trusting any
     * chart built on it: the largest one in this database is a placeholder
     * record literally named "N/A", carrying 167 of the 336 posted receipts.
     *
     * That is deliberately NOT handled the way Phase 3 handled the walk-in
     * customer. The walk-in record is indistinguishable from a real account --
     * it has a name, and only an administrator knows which row it is -- so
     * every per-customer figure over it was a plausible wrong number and the
     * source had to refuse. "N/A" announces itself: it appears in every
     * breakdown under its own name, at the top of the ranking, and reads
     * exactly as what it is, which is that half the receipts in this business
     * are not attributed to anybody. Hiding it behind a setting would remove
     * the most important thing the purchasing data has to say.
     */
    supplier: Object.freeze({
        id: 'supplier',
        label: 'Supplier',
        kind: 'entity',
        requiresJoins: Object.freeze(['supplier']),
        filterable: true,
        valueType: 'int',
        lookup: '/suppliers',
        key: (c) => c.supplier_id,
        keyLabel: () => "COALESCE(NULLIF(s.supplier_name, ''), '(No supplier)')",
    }),

    ap_entry_type: Object.freeze({
        id: 'ap_entry_type',
        label: 'Ledger movement',
        kind: 'attribute',
        requiresJoins: Object.freeze([]),
        filterable: false,
        valueType: 'text',
        key: (c) => `${c.entry_type}::text`,
        keyLabel: (c) => labelCase(c.entry_type, AP_ENTRY_LABELS),
    }),

    stock_movement_type: Object.freeze({
        id: 'stock_movement_type',
        label: 'Movement',
        kind: 'attribute',
        requiresJoins: Object.freeze([]),
        filterable: false,
        valueType: 'text',
        key: (c) => c.trans_type,
        keyLabel: (c) => labelCase(c.trans_type, STOCK_MOVEMENT_LABELS),
    }),

    count_variance_band: Object.freeze({
        id: 'count_variance_band',
        label: 'Count result',
        kind: 'attribute',
        requiresJoins: Object.freeze([]),
        // Derived from two columns rather than stored, like every other band in
        // this file, so it is read rather than filtered on.
        filterable: false,
        sortBy: 'key',
        valueType: 'int',
        key: (c) => countVarianceCase(c, (n) => String(n)),
        keyLabel: (c) => countVarianceCase(c, (n) => `'${COUNT_VARIANCE_BANDS[n][1]}'`),
    }),

    pdc_status: Object.freeze({
        id: 'pdc_status',
        label: 'Cheque status',
        kind: 'attribute',
        requiresJoins: Object.freeze([]),
        filterable: false,
        valueType: 'text',
        key: (c) => c.pdc_status,
        keyLabel: (c) => `initcap(replace(${c.pdc_status}, '_', ' '))`,
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
