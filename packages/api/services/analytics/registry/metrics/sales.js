const ALL_GRAINS = ['none', 'day', 'week', 'month', 'quarter'];

/**
 * Sales metrics.
 *
 * `expr` returns a bare aggregate. The query builder adds the FILTER clause
 * (from the metric's own `where` and from its trust rule, combined) and the
 * COALESCE. Metrics therefore cannot place -- or forget -- a trust filter.
 *
 * Gross revenue and refunds are separate metrics on separate sources because
 * they are periodised by different dates. Net revenue is the composite of the
 * two, computed after aggregation, so `net = gross - refunds` holds per period
 * rather than per invoice.
 */
const SALES_METRICS = {
    'sales.gross_revenue': {
        id: 'sales.gross_revenue',
        label: 'Gross Revenue',
        description:
            'Invoiced sales excluding VAT, counted in the period the invoice was issued. '
            + 'Cancelled invoices are excluded. Refunds are NOT deducted — see Net Revenue.',
        kind: 'additive',
        source: 'invoice_header',
        expr: (c) => `SUM(${c.revenue_ex_tax})`,
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'sales.refunds': {
        id: 'sales.refunds',
        label: 'Refunds',
        description:
            'Credit notes excluding VAT, counted in the period the credit note was issued — NOT '
            + 'the period of the original sale. A refund of an August sale raised in September '
            + 'appears in September.',
        kind: 'additive',
        source: 'credit_note_header',
        expr: (c) => `SUM(${c.revenue_ex_tax})`,
        format: 'currency',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'sales.net_revenue': {
        id: 'sales.net_revenue',
        label: 'Net Revenue',
        description:
            'Gross Revenue minus Refunds, each counted in its own period. This is the headline '
            + 'revenue figure. A large refund can pull a period down without any drop in selling.',
        kind: 'composite',
        terms: [
            { metric: 'sales.gross_revenue', sign: 1 },
            { metric: 'sales.refunds', sign: -1 },
        ],
        exposeComponents: true,
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'sales.invoice_count': {
        id: 'sales.invoice_count',
        label: 'Invoices',
        description: 'Number of invoices issued in the period. Cancelled invoices are excluded.',
        kind: 'additive',
        source: 'invoice_header',
        expr: (c) => `COUNT(DISTINCT ${c.invoice_id})`,
        format: 'integer',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'sales.units_sold': {
        id: 'sales.units_sold',
        label: 'Units Sold',
        description: 'Total quantity across all invoice lines in the period.',
        kind: 'additive',
        source: 'invoice_line',
        expr: (c) => `SUM(${c.quantity})`,
        format: 'integer',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'sales.line_revenue': {
        id: 'sales.line_revenue',
        label: 'Line Revenue',
        description:
            'Ex-VAT, post-discount revenue summed from invoice lines. Equal to Gross Revenue at '
            + 'the invoice level; use this one when breaking revenue down by part, brand or group, '
            + 'which only exist on the line.',
        kind: 'additive',
        source: 'invoice_line',
        expr: (c) => `SUM(${c.revenue_ex_tax})`,
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'sales.credit_revenue': {
        id: 'sales.credit_revenue',
        label: 'Credit Sales',
        description:
            'Ex-VAT revenue on invoices settled against a customer account rather than at the '
            + 'counter. Walk-in cash sales are excluded. This is the denominator for Days Sales '
            + 'Outstanding: including cash sales, which are 82% of revenue, would drag DSO toward '
            + 'zero and hide a genuine collection problem in the credit book.',
        kind: 'additive',
        source: 'invoice_header',
        expr: (c) => `SUM(${c.revenue_ex_tax})`,
        where: (c) => c.is_credit_sale,
        format: 'currency',
        direction: 'neutral',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'sales.avg_ticket': {
        id: 'sales.avg_ticket',
        label: 'Average Ticket',
        description:
            'Gross Revenue divided by invoice count. Deliberately uses GROSS, not net: a refund '
            + 'reverses a sale, it does not make the original transaction smaller. Note that most '
            + 'invoices are walk-in counter sales, so this is a counter-retail average.',
        kind: 'ratio',
        numerator: 'sales.gross_revenue',
        denominator: 'sales.invoice_count',
        zeroDenominator: null,
        format: 'currency',
        direction: 'higher_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },

    'sales.refund_rate': {
        id: 'sales.refund_rate',
        label: 'Refund Rate',
        description:
            'Refunds as a percentage of Gross Revenue, each counted in its own period. Because '
            + 'the two are periodised separately, a month with heavy refunds against earlier '
            + 'sales can exceed its own selling.',
        kind: 'ratio',
        numerator: 'sales.refunds',
        denominator: 'sales.gross_revenue',
        scale: 100,
        zeroDenominator: null,
        format: 'percent',
        direction: 'lower_is_better',
        comparable: true,
        grains: ALL_GRAINS,
        permission: 'analytics:view',
    },
};

module.exports = { SALES_METRICS };
