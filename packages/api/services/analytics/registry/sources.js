const { buildStatusClause } = require('../../../helpers/invoiceStatusFilter');
const { AnalyticsRegistryError, AnalyticsRequestError } = require('../errors');

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

/**
 * Exclude the walk-in counter record, by bound parameter.
 *
 * The walk-in id is a FACT ABOUT THIS BUSINESS that lives in the settings table
 * and cannot be inferred: the record is a customer row like any other and
 * carries roughly 83% of revenue. It reaches SQL the same way an invoice status
 * filter does -- pushed onto the live `values` array and referenced by
 * placeholder -- so §7.5's invariant holds: no byte of the statement text comes
 * from outside this file.
 *
 * It is read from the SETTINGS, never from the request body. `index.js` resolves
 * it once per batch and hands it down through the server-authored `opts`
 * argument that `trusted` also travels on.
 *
 * A source that cannot honour it REFUSES rather than quietly including the
 * counter: a "revenue per account" over 5,658 walk-in invoices plus 387 real
 * ones is a plausible wrong number, and the metrics on these sources gate on the
 * `walkin_customer_identified` readiness probe so a caller normally never gets
 * this far.
 */
const excludeWalkIn = (params, opts, column) => {
    const id = opts && opts.walkInCustomerId;
    if (!Number.isInteger(id)) {
        throw new AnalyticsRequestError(
            409,
            'This figure separates counter trade from named accounts, which needs the walk-in '
            + 'customer record to be named under Settings → Analytics.',
            { setting: 'ANALYTICS_WALKIN_CUSTOMER_ID' }
        );
    }
    params.push(id);
    return `${column} IS DISTINCT FROM $${params.length}`;
};

// The statuses an open receivable can hold. Literals here rather than a request
// option: what counts as "still owed" is a definition the whole business shares,
// and 'Written Off' in particular must never be one of them -- 312 pre-cutover
// invoices worth ₱1.49M were deliberately written off when the A/R ledger went
// live, and counting them would report an exposure eight times the real one.
const OPEN_INVOICE_STATUSES = "iwb.status IN ('Unpaid', 'Partially Paid')";

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
            // The bare column, for the Data Trust board only. Everything that
            // measures money reads `revenue_ex_tax` above; this exists purely so
            // a metric can COUNT the rows where the fallback had to be used.
            tax_base_raw: 'il.tax_base',
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
        dimensions: Object.freeze(['date', 'hour_of_day', 'weekday', 'part', 'brand', 'group', 'customer', 'customer_type', 'employee', 'margin_band']),
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
            // As above: the bare column, so the Data Trust board can count how
            // many credit notes are relying on the fallback.
            subtotal_raw: 'cn.subtotal_ex_tax',
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

    /**
     * Invoices to NAMED ACCOUNTS — the counter record excluded.
     *
     * This source is the Phase 3 answer to §2's oldest finding: one customer row
     * carries 82-83% of revenue and 5,658 of 6,095 invoices, so every
     * per-customer average computed over `invoice_header` describes the counter
     * queue rather than the customer book. Rather than leave that to whoever
     * writes a tile -- or to a rule that subtracts the walk-in row afterwards --
     * "named account" is a FACT SOURCE, and a metric defined on it cannot
     * accidentally include the counter.
     *
     * The lateral supplies each customer's first invoice date, which is what
     * makes "new account" and the cohort dimension answerable without any
     * request value reaching the SQL: an invoice is a customer's first when its
     * own date equals that minimum, a comparison between two columns of the same
     * row.
     */
    named_invoice: Object.freeze({
        id: 'named_invoice',
        label: 'Invoices to named accounts',
        grain: 'invoice',
        from: `FROM invoice i
         LEFT JOIN LATERAL (
           SELECT MIN(i0.invoice_date) AS first_at
           FROM invoice i0
           WHERE i0.customer_id = i.customer_id AND i0.status <> 'Cancelled') fa ON TRUE`,
        dateColumn: 'i.invoice_date',
        defaultWhere: (params, opts) => [
            ...invoiceStatusWhere(params, opts, 'i.status'),
            excludeWalkIn(params, opts, 'i.customer_id'),
        ],
        cols: Object.freeze({
            __alias: 'i',
            invoice_id: 'i.invoice_id',
            // Identical to invoice_header's, and deliberately restated rather
            // than shared: a source's cols map is its contract with the query
            // builder, and the two are free to diverge if the counter ever needs
            // a column the customer book does not.
            revenue_ex_tax: 'COALESCE(i.subtotal_ex_tax, i.total_amount - COALESCE(i.tax_total, 0))',
            revenue_inc_tax: 'i.total_amount',
            customer_id: 'i.customer_id',
            employee_id: 'i.employee_id',
            first_invoice_at: 'fa.first_at',
            // True on the one invoice that opened the account. A column-to-column
            // comparison, so counting distinct customers under this filter over a
            // period gives exactly the accounts won IN that period.
            is_first_invoice: 'fa.first_at = i.invoice_date',
        }),
        joins: Object.freeze({
            customer: 'LEFT JOIN customer cu ON cu.customer_id = i.customer_id',
            employee: 'LEFT JOIN employee e ON e.employee_id = i.employee_id',
        }),
        dimensions: Object.freeze(['date', 'customer', 'customer_type', 'employee', 'customer_cohort']),
    }),

    /**
     * Money still owed, at invoice grain, as of now.
     *
     * `invoice_with_balance` is the authoritative view for what a single invoice
     * still carries: it nets credit notes off the total and reads settled
     * payments rather than trusting `invoice.amount_paid` alone.
     *
     * It is NOT the same question as `ar_balance`. That one reads the A/R ledger,
     * which begins at the 2026-08-19 cutover and knows nothing of the invoices
     * raised before it. Over this database the two disagree — ₱241,807 of open
     * invoices against a ₱202,507 ledger balance — and the Receivables board
     * shows both side by side rather than picking one and hiding the other. The
     * ledger stays authoritative for what the A/R module manages; this is the
     * whole invoice book.
     *
     * No date column: an aging position is as of now. Reading it "as of" an
     * earlier date is a different and much more expensive query.
     */
    open_receivable: Object.freeze({
        id: 'open_receivable',
        label: 'Open invoices',
        grain: 'invoice',
        from: 'FROM invoice_with_balance iwb',
        dateColumn: null,
        defaultWhere: () => ['iwb.balance_due > 0', OPEN_INVOICE_STATUSES],
        cols: Object.freeze({
            __alias: 'iwb',
            invoice_id: 'iwb.invoice_id',
            customer_id: 'iwb.customer_id',
            balance: 'iwb.balance_due',
            // NULL where the invoice has no terms, and the aging dimension reads
            // that as its own band rather than as "not yet due".
            days_overdue: 'iwb.days_overdue',
            due_date: 'iwb.due_date',
            invoice_date: 'iwb.invoice_date',
        }),
        joins: Object.freeze({
            customer: 'LEFT JOIN customer cu ON cu.customer_id = iwb.customer_id',
        }),
        dimensions: Object.freeze(['customer', 'customer_type', 'aging_bucket']),
    }),

    /**
     * Credit exposure against the limit each account was granted.
     *
     * One row per active customer, whether or not they owe anything: the
     * denominator of "how much of the credit we have extended is drawn" is every
     * account with a limit, not only the ones currently in debt. The LEFT JOIN
     * is what keeps a customer at zero on the page instead of dropping them.
     *
     * The counter record is NOT excluded here, and that is deliberate: it holds a
     * default limit and no ledger balance, so it neither distorts the exposure
     * nor needs the walk-in setting. Keeping this source ungated means the
     * Customers board still answers a real question before an admin has named
     * that record.
     */
    customer_credit: Object.freeze({
        id: 'customer_credit',
        label: 'Customer credit',
        grain: 'customer',
        from: `FROM customer cu
         LEFT JOIN vw_customer_ar_balance v ON v.customer_id = cu.customer_id`,
        dateColumn: null,
        providedJoins: Object.freeze(['customer']),
        defaultWhere: () => ['cu.is_active = TRUE'],
        cols: Object.freeze({
            __alias: 'cu',
            customer_id: 'cu.customer_id',
            credit_limit: 'COALESCE(cu.credit_limit, 0)',
            // A credit balance (the customer is in front) is not negative
            // exposure; GREATEST keeps one prepaid account from cancelling out
            // another's debt in the total.
            balance: 'GREATEST(COALESCE(v.ledger_balance, 0), 0)',
            raw_balance: 'COALESCE(v.ledger_balance, 0)',
            credit_hold: 'cu.credit_hold',
        }),
        joins: Object.freeze({}),
        dimensions: Object.freeze(['customer', 'customer_type']),
    }),

    /**
     * The A/R ledger itself — what actually moved, and when.
     *
     * The ledger is append-only and immutable (see the trigger on `ar_ledger`),
     * which makes it the only place in this database where "we collected X in
     * September" is a statement about recorded events rather than a
     * reconstruction. Every metric on it is gated on the `ar_ledger_data`
     * readiness probe, and every TREND over it carries an era notice in the tile:
     * the ledger begins on 2026-08-18, so a twelve-month chart of it is eleven
     * months of a flat zero that reads as a collapse in collections.
     *
     * The `adjustment` join is a LEFT JOIN on a UNIQUE column, so it cannot fan a
     * ledger row out across several adjustments and double its amount.
     */
    ar_ledger: Object.freeze({
        id: 'ar_ledger',
        label: 'A/R ledger entries',
        grain: 'ledger_entry',
        from: 'FROM ar_ledger l',
        dateColumn: 'l.entry_date',
        defaultWhere: () => [],
        cols: Object.freeze({
            __alias: 'l',
            ledger_id: 'l.ledger_id',
            customer_id: 'l.customer_id',
            // Signed as the ledger stores it: a charge is positive, a payment or
            // a concession negative. Metrics that report a collection as a
            // positive figure negate it themselves, and say so.
            amount: 'l.amount',
            entry_type: 'l.entry_type',
        }),
        joins: Object.freeze({
            customer: 'LEFT JOIN customer cu ON cu.customer_id = l.customer_id',
            adjustment: 'LEFT JOIN ar_adjustment adj ON adj.ledger_id = l.ledger_id',
        }),
        dimensions: Object.freeze(['date', 'customer', 'customer_type', 'ar_entry_type', 'adjustment_reason']),
    }),

    /**
     * Cheques taken in and not yet cleared — the PDC pipeline, as of now.
     *
     * A position rather than a period: what matters is what is sitting in the
     * safe or with the bank today, not how many cheques were accepted last
     * month. `CLEARED` is excluded because a cleared cheque is cash, and cash is
     * not a pipeline.
     */
    pdc_outstanding: Object.freeze({
        id: 'pdc_outstanding',
        label: 'Cheques not yet cleared',
        grain: 'payment',
        from: 'FROM customer_payment cp',
        dateColumn: null,
        defaultWhere: () => ["cp.pdc_status IS NOT NULL", "cp.pdc_status <> 'CLEARED'"],
        cols: Object.freeze({
            __alias: 'cp',
            payment_id: 'cp.payment_id',
            customer_id: 'cp.customer_id',
            amount: 'cp.amount',
            cheque_date: 'cp.cheque_date',
            pdc_status: 'cp.pdc_status',
        }),
        joins: Object.freeze({
            customer: 'LEFT JOIN customer cu ON cu.customer_id = cp.customer_id',
        }),
        dimensions: Object.freeze(['customer', 'customer_type', 'pdc_status']),
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
