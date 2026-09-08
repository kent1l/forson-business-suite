const { buildStatusClause } = require('../../../helpers/invoiceStatusFilter');
const { AnalyticsRegistryError } = require('../errors');

/**
 * Fact sources.
 *
 * Each source is one FROM clause and one grain. A metric names a source; the
 * query builder emits exactly one CTE per source in play and stitches them
 * together on their shared dimension keys.
 *
 * That shape is the whole reason refunds are safe here. Sales and credit notes
 * are separate sources with different date columns, so the builder has no code
 * path that puts them in the same FROM clause -- the incident documented in
 * routes/taxReportRoutes.js:34-49, where netting a refund into its original
 * invoice's row silently rewrote already-filed VAT periods, becomes
 * structurally unrepeatable rather than a rule someone has to remember.
 *
 * `providedJoins` names joins a source's FROM clause already satisfies, so a
 * dimension requiring them needs no extra JOIN appended. `joinDeps` names joins
 * that must be emitted before another one -- reaching a credit note's customer
 * means going through its invoice first -- so a dimension can ask for the join
 * it cares about without knowing each source's join topology.
 *
 * `cols` is a frozen map from a logical name to a SQL expression. Metric
 * expressions receive only this map and never request data, which is what
 * makes them structurally incapable of carrying an injection (§7.5).
 * `__alias` is the table alias trust predicates are applied to.
 *
 * Table aliases are part of the contract: swapping a source for a materialized
 * view later must keep them, so that no metric file has to change.
 */

// `buildStatusClause` returns null when no status filter applies; the builder
// drops nulls, so sources may return them freely.
const invoiceStatusWhere = (params, opts, column) => [
    buildStatusClause(opts && opts.status, params, { defaultFilter: 'active', column }),
];

const SOURCES = Object.freeze({
    invoice_header: Object.freeze({
        id: 'invoice_header',
        label: 'Invoices',
        grain: 'invoice',
        from: 'FROM invoice i',
        dateColumn: 'i.invoice_date',
        defaultWhere: (params, opts) => invoiceStatusWhere(params, opts, 'i.status'),
        cols: Object.freeze({
            __alias: 'i',
            invoice_id: 'i.invoice_id',
            // 266 legacy (v1.0) invoices were never backfilled with an ex-VAT
            // subtotal and carry NULL. Reading the column alone drops ~486k of
            // real sales without saying so -- which is what /reports/sales-summary
            // does today. They record tax_total = 0, so total_amount is their
            // ex-VAT figure and the fallback is exact.
            revenue_ex_tax: 'COALESCE(i.subtotal_ex_tax, i.total_amount - COALESCE(i.tax_total, 0))',
            revenue_inc_tax: 'i.total_amount',
            tax: 'i.tax_total',
            amount_paid: 'i.amount_paid',
            customer_id: 'i.customer_id',
            employee_id: 'i.employee_id',
            due_date: 'i.due_date',
            // A credit sale is one settled (wholly or partly) against the customer's
            // account rather than at the counter. Written as an EXISTS so it survives
            // split payments, and so DSO's denominator excludes the walk-in cash book
            // that is 82% of revenue (see the PRD's R6).
            is_credit_sale: `EXISTS (
                SELECT 1 FROM invoice_payments ip_c
                JOIN payment_methods pm_c ON pm_c.method_id = ip_c.method_id
                WHERE ip_c.invoice_id = i.invoice_id
                  AND pm_c.settlement_type = 'on_account')`,
        }),
        joins: Object.freeze({
            customer: 'LEFT JOIN customer cu ON cu.customer_id = i.customer_id',
            employee: 'LEFT JOIN employee e ON e.employee_id = i.employee_id',
            // One invoice can carry several payments; picking the first keeps the
            // header grain intact instead of fanning the row out and double-counting
            // its revenue across every method used.
            payment_method: `LEFT JOIN LATERAL (
                SELECT ip.method_id FROM invoice_payments ip
                WHERE ip.invoice_id = i.invoice_id ORDER BY ip.payment_id LIMIT 1
              ) pm_pick ON TRUE
              LEFT JOIN payment_methods pm ON pm.method_id = pm_pick.method_id`,
        }),
        dimensions: Object.freeze(['date', 'hour_of_day', 'weekday', 'customer', 'customer_type', 'employee', 'payment_method', 'invoice_status']),
    }),

    invoice_line: Object.freeze({
        id: 'invoice_line',
        label: 'Invoice lines',
        grain: 'invoice_line',
        from: 'FROM invoice_line il JOIN invoice i ON i.invoice_id = il.invoice_id',
        // A line is periodised by its INVOICE's date; invoice_line has no date of its own.
        dateColumn: 'i.invoice_date',
        defaultWhere: (params, opts) => invoiceStatusWhere(params, opts, 'i.status'),
        cols: Object.freeze({
            __alias: 'il',
            line_id: 'il.invoice_line_id',
            invoice_id: 'il.invoice_id',
            part_id: 'il.part_id',
            quantity: 'il.quantity',
            // The ex-VAT, post-discount line figure. `tax_base` is authoritative
            // where it was captured, but 477 lines predate the tax-versioning work
            // and carry NULL; without the fallback, line-level revenue comes out
            // ~66k short of the invoice headers over the same range and every
            // margin computed from it inherits the gap.
            revenue_ex_tax: 'COALESCE(il.tax_base, (il.quantity * il.sale_price) - COALESCE(il.discount_amount, 0) - COALESCE(il.tax_amount, 0))',
            unit_cost: 'il.cost_at_sale',
            discount: 'il.discount_amount',
            customer_id: 'i.customer_id',
            employee_id: 'i.employee_id',
        }),
        joins: Object.freeze({
            part: 'JOIN part p ON p.part_id = il.part_id',
            brand: 'LEFT JOIN brand b ON b.brand_id = p.brand_id',
            group: 'LEFT JOIN "group" g ON g.group_id = p.group_id',
            customer: 'LEFT JOIN customer cu ON cu.customer_id = i.customer_id',
            employee: 'LEFT JOIN employee e ON e.employee_id = i.employee_id',
        }),
        joinDeps: Object.freeze({ brand: ['part'], group: ['part'] }),
        dimensions: Object.freeze(['date', 'hour_of_day', 'weekday', 'part', 'brand', 'group', 'customer', 'customer_type', 'employee']),
    }),

    credit_note_header: Object.freeze({
        id: 'credit_note_header',
        label: 'Credit notes',
        grain: 'credit_note',
        from: 'FROM credit_note cn',
        // THE reason refunds need their own source: a refund belongs to the period
        // the credit note was raised in, not the period of the sale it reverses.
        dateColumn: 'cn.refund_date',
        defaultWhere: () => [],
        cols: Object.freeze({
            __alias: 'cn',
            cn_id: 'cn.cn_id',
            // Same story as the invoice line, but far worse: 210 of 230 credit
            // notes carry no subtotal_ex_tax at all. Reading the column alone
            // reports ~36k of refunds against an actual ~443k. Every credit note
            // in the data records tax_total = 0, so total_amount IS the ex-VAT
            // figure for them and the fallback is exact rather than approximate.
            revenue_ex_tax: 'COALESCE(cn.subtotal_ex_tax, cn.total_amount)',
            revenue_inc_tax: 'cn.total_amount',
            tax: 'cn.tax_total',
            invoice_id: 'cn.invoice_id',
            // Reachable only through the `invoice` join, which joinDeps pulls in
            // whenever a customer dimension asks for it.
            customer_id: 'i.customer_id',
        }),
        joins: Object.freeze({
            invoice: 'LEFT JOIN invoice i ON i.invoice_id = cn.invoice_id',
            customer: 'LEFT JOIN customer cu ON cu.customer_id = i.customer_id',
        }),
        joinDeps: Object.freeze({ customer: ['invoice'] }),
        // Deliberately no 'brand'/'group'. Reaching them means joining
        // credit_note_line, which would fan the header amount out across every line
        // of the note and double-count it. A composite whose refund term cannot be
        // broken down by the requested dimension is a 400, never a partial answer.
        dimensions: Object.freeze(['date', 'customer', 'customer_type']),
    }),

    inventory_snapshot: Object.freeze({
        id: 'inventory_snapshot',
        label: 'Stock on hand',
        grain: 'part',
        from: `FROM part p
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(it.quantity), 0) AS soh
           FROM inventory_transaction it WHERE it.part_id = p.part_id) soh ON TRUE
         LEFT JOIN LATERAL (
           SELECT MAX((i2.invoice_date AT TIME ZONE 'Asia/Manila')::date) AS last_sold
           FROM invoice_line il2 JOIN invoice i2 ON i2.invoice_id = il2.invoice_id
           WHERE il2.part_id = p.part_id AND i2.status <> 'Cancelled') ls ON TRUE`,
        // Snapshot: what is on the shelf right now. No date filter is applied, and
        // metrics on this source declare grains: ['none'] so a month breakdown
        // cannot silently repeat today's figure across twelve rows.
        dateColumn: null,
        providedJoins: Object.freeze(['part']),
        defaultWhere: () => [
            'p.is_service = FALSE',
            'p.is_active = TRUE',
            'p.merged_into_part_id IS NULL',
        ],
        cols: Object.freeze({
            __alias: 'p',
            part_id: 'p.part_id',
            stock_on_hand: 'soh.soh',
            wac_cost: 'p.wac_cost',
            last_cost: 'p.last_cost',
            reorder_point: 'p.reorder_point',
            last_sold_at: 'ls.last_sold',
        }),
        joins: Object.freeze({
            brand: 'LEFT JOIN brand b ON b.brand_id = p.brand_id',
            group: 'LEFT JOIN "group" g ON g.group_id = p.group_id',
        }),
        dimensions: Object.freeze(['part', 'brand', 'group']),
    }),

    ar_balance: Object.freeze({
        id: 'ar_balance',
        label: 'A/R balances',
        grain: 'customer',
        // The ledger view is authoritative for what a customer owes.
        // Reconstructing it from invoice.amount_paid is what the AR module exists
        // to stop, and the two disagree by design during a settlement.
        from: 'FROM vw_customer_ar_balance v JOIN customer cu ON cu.customer_id = v.customer_id',
        dateColumn: null,
        // `customer` is already in the FROM here, so dimensions that ask for that
        // join are satisfied without adding one. Declared rather than assumed so
        // registry validation can still prove every dimension is reachable.
        providedJoins: Object.freeze(['customer']),
        defaultWhere: () => [],
        cols: Object.freeze({
            __alias: 'v',
            customer_id: 'v.customer_id',
            balance: 'v.ledger_balance',
            last_activity_at: 'v.last_activity_at',
        }),
        joins: Object.freeze({}),
        dimensions: Object.freeze(['customer', 'customer_type']),
    }),

    /**
     * Parts that genuinely need reordering.
     *
     * This source exists because "below the reorder point" is not a signal in
     * this database: 4,840 of 7,485 active parts are below theirs, almost all of
     * them from unmaintained defaults, and a list of 4,840 rows is a list nobody
     * reads. The PRD's §2 finding -- rank by consequence, not by flag -- is
     * therefore encoded HERE, in the candidate set, rather than left to whoever
     * writes the tile.
     *
     * A candidate is a part that:
     *   - sold on at least three separate invoices in the last 90 days. One
     *     large one-off order is a customer, not a trend, and reordering against
     *     it is how dead stock is created;
     *   - is out of stock, or holds less than 30 days of cover at that rate.
     *
     * That is 120 parts against 4,840 for the naive flag. Ranking within the set
     * is the tile's business, and the tile ranks by the revenue those parts
     * actually earned -- the consequence of not having them.
     *
     * The thresholds are literals in this file on purpose. Making them a request
     * parameter would put an untrusted number inside a WHERE clause and turn a
     * definition the whole business shares into a per-user preference.
     *
     * `defaultWhere` cannot filter a source out of existence: with no candidates
     * the metrics return zero rows, which the tile renders as "nothing needs
     * reordering" rather than as an error.
     */
    reorder_candidates: Object.freeze({
        id: 'reorder_candidates',
        label: 'Parts needing a reorder',
        grain: 'part',
        from: `FROM part p
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(it.quantity), 0) AS soh
           FROM inventory_transaction it WHERE it.part_id = p.part_id) soh ON TRUE
         LEFT JOIN LATERAL (
           SELECT COALESCE(SUM(il3.quantity), 0) AS qty,
                  COUNT(DISTINCT il3.invoice_id) AS orders,
                  COALESCE(SUM(COALESCE(il3.tax_base,
                    (il3.quantity * il3.sale_price)
                      - COALESCE(il3.discount_amount, 0)
                      - COALESCE(il3.tax_amount, 0))), 0) AS revenue
           FROM invoice_line il3 JOIN invoice i3 ON i3.invoice_id = il3.invoice_id
           WHERE il3.part_id = p.part_id
             AND i3.status <> 'Cancelled'
             AND (i3.invoice_date AT TIME ZONE 'Asia/Manila')::date
                 > (CURRENT_DATE - INTERVAL '90 days')) dem ON TRUE`,
        // A position as of now, like the stock snapshot: metrics here declare
        // grains: ['none'] so no month breakdown can repeat today's list.
        dateColumn: null,
        providedJoins: Object.freeze(['part']),
        defaultWhere: () => [
            'p.is_service = FALSE',
            'p.is_active = TRUE',
            'p.merged_into_part_id IS NULL',
            'dem.orders >= 3',
            'dem.qty > 0',
            // Parenthesised: clauses are joined with AND, and an unbracketed OR
            // here would quietly widen the whole candidate set.
            '(soh.soh <= 0 OR soh.soh < (dem.qty / 90.0) * 30)',
        ],
        cols: Object.freeze({
            __alias: 'p',
            part_id: 'p.part_id',
            stock_on_hand: 'soh.soh',
            wac_cost: 'p.wac_cost',
            reorder_point: 'p.reorder_point',
            demand_90d: 'dem.qty',
            orders_90d: 'dem.orders',
            revenue_90d: 'dem.revenue',
            // Units needed to reach thirty days of cover. Never negative: a part
            // that is short on one measure and not the other should read 0, not
            // hand a negative "shortfall" to a purchasing decision.
            units_short: "GREATEST(CEIL((dem.qty / 90.0) * 30) - soh.soh, 0)",
        }),
        joins: Object.freeze({
            brand: 'LEFT JOIN brand b ON b.brand_id = p.brand_id',
            group: 'LEFT JOIN "group" g ON g.group_id = p.group_id',
        }),
        dimensions: Object.freeze(['part', 'brand', 'group']),
    }),

    expense: Object.freeze({
        id: 'expense',
        label: 'Expenses',
        grain: 'expense',
        from: 'FROM expense ex',
        dateColumn: 'ex.expense_date',
        defaultWhere: () => ['ex.is_void = FALSE'],
        cols: Object.freeze({
            __alias: 'ex',
            expense_id: 'ex.expense_id',
            amount: 'ex.amount',
            category_id: 'ex.category_id',
        }),
        joins: Object.freeze({}),
        dimensions: Object.freeze(['date']),
    }),
});

/**
 * Expand the join names a query needs into the ordered, deduped list the source
 * must actually emit: each join's prerequisites first, and nothing the FROM
 * clause already provides.
 *
 * Callers name the join they care about ('customer'); this works out that on a
 * credit note that means joining the invoice first. Keeping that knowledge in
 * the source, not in the dimension, is what lets one dimension definition serve
 * every source.
 */
const resolveJoins = (src, names) => {
    const provided = new Set(src.providedJoins || []);
    const ordered = [];

    const visit = (name, stack) => {
        if (provided.has(name) || ordered.includes(name)) return;
        if (stack.includes(name)) {
            throw new AnalyticsRegistryError(
                `Analytics registry: circular join dependency in source '${src.id}': ${[...stack, name].join(' -> ')}`
            );
        }
        for (const dep of (src.joinDeps && src.joinDeps[name]) || []) visit(dep, [...stack, name]);
        if (!Object.prototype.hasOwnProperty.call(src.joins, name)) {
            throw new AnalyticsRegistryError(
                `Analytics registry: source '${src.id}' does not define join '${name}'`
            );
        }
        ordered.push(name);
    };

    for (const name of names) visit(name, []);
    return ordered;
};

module.exports = { SOURCES, resolveJoins };
