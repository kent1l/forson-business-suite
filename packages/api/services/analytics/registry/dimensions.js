/**
 * Dimensions and the closed grain map.
 *
 * A dimension contributes two expressions: a stable `key` used for grouping and
 * joining across sources, and a `label` for display. Both are functions of the
 * source's frozen `cols` map and never of request input.
 *
 * `valueType` decides the array cast a filter is pushed with, so the cast is
 * registry-controlled rather than inferred from whatever the caller sent.
 */
const DIMENSIONS = Object.freeze({
    date: Object.freeze({
        id: 'date',
        label: 'Period',
        kind: 'time',
        requiresJoins: Object.freeze([]),
        filterable: false,
        valueType: 'text',
        key: (c, src, ctx) =>
            `date_trunc('${ctx.grainUnit}', ${src.dateColumn} AT TIME ZONE 'Asia/Manila')`,
        keyLabel: (c, src, ctx) =>
            `to_char(date_trunc('${ctx.grainUnit}', ${src.dateColumn} AT TIME ZONE 'Asia/Manila'), '${ctx.dateFormat}')`,
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
