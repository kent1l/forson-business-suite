/**
 * Cheap EXISTS probes for modules that are scaffolded but not yet in use.
 *
 * Operating-P&L metrics are registered from day one so that they light up with
 * no code change once the Expenses and Payroll modules carry data. Until then
 * the frontend must render "not being recorded yet" -- and it must do so
 * *without issuing the query*, because a query over an empty table returns a
 * confident 0 that reads as "we spent nothing".
 *
 * `/meta` runs these, caches the result briefly, and hands the frontend a flag
 * per probe. No probe touches request input.
 */
const READINESS_PROBES = Object.freeze({
    expense_data: Object.freeze({
        id: 'expense_data',
        label: 'Expenses recorded',
        sql: 'SELECT EXISTS(SELECT 1 FROM expense WHERE is_void = FALSE) AS ready',
        emptyMessage: 'Operating expenses are not being recorded yet.',
    }),
    payroll_data: Object.freeze({
        id: 'payroll_data',
        label: 'Payroll recorded',
        sql: 'SELECT EXISTS(SELECT 1 FROM payroll_run) AS ready',
        emptyMessage: 'Payroll is not being recorded yet.',
    }),
    // Not one of the scaffolded modules: discounts are a field on a table that
    // is very much in use, and not one of 11,540 sale lines carries a non-zero
    // one. A discount rate of 0.0% would read as "we never discount" where the
    // truth is "this is not being captured", so the tile says so instead --
    // and lights up on its own the day a cashier records the first one.
    line_discount_data: Object.freeze({
        id: 'line_discount_data',
        label: 'Line discounts recorded',
        sql: 'SELECT EXISTS(SELECT 1 FROM invoice_line WHERE COALESCE(discount_amount, 0) <> 0) AS ready',
        emptyMessage: 'Discounts are not being recorded on sale lines yet.',
    }),
    ar_ledger_data: Object.freeze({
        id: 'ar_ledger_data',
        label: 'A/R ledger populated',
        sql: 'SELECT EXISTS(SELECT 1 FROM ar_ledger) AS ready',
        emptyMessage: 'The A/R ledger has no entries yet.',
    }),
    /**
     * Purchase orders — the module Phase 4 found empty.
     *
     * `purchase_order` holds nothing, and not one of the 336 posted goods
     * receipts carries a `po_id`. Order-to-receipt lead time is therefore not a
     * figure this database can produce at all: it is the gap between two events,
     * and only the second one is recorded. The lead-time metrics are registered
     * anyway, gated on this probe, exactly as the expense and payroll metrics
     * were in Phase 0 -- so they light up on their own the day the first order
     * is raised, with no code change and no forgotten backlog item.
     *
     * The alternative -- inferring lead time from the interval between one
     * receipt and the next -- would produce a number in days that measures how
     * often a supplier is used, presented as how long they take to deliver.
     */
    purchase_order_data: Object.freeze({
        id: 'purchase_order_data',
        label: 'Purchase orders raised',
        sql: 'SELECT EXISTS(SELECT 1 FROM purchase_order) AS ready',
        emptyMessage: 'Purchase orders are not being raised in the system yet, so the time '
            + 'between ordering and receiving cannot be measured.',
    }),
    ap_ledger_data: Object.freeze({
        id: 'ap_ledger_data',
        label: 'A/P ledger populated',
        sql: 'SELECT EXISTS(SELECT 1 FROM ap_ledger) AS ready',
        emptyMessage: 'The supplier ledger has no entries yet.',
    }),
    /**
     * Counted lines, not batches. A batch that was opened and never counted
     * carries no observation, and a "count accuracy" figure computed over zero
     * observations comes back as a confident 0% -- which reads as "the stock
     * records are always wrong" rather than "nobody has counted anything".
     */
    cycle_count_data: Object.freeze({
        id: 'cycle_count_data',
        label: 'Stock counted',
        sql: 'SELECT EXISTS(SELECT 1 FROM cycle_count_line WHERE counted_at IS NOT NULL) AS ready',
        emptyMessage: 'No stock has been counted yet.',
    }),
    /**
     * Not a probe about a module at all: a probe about a FACT ABOUT THIS
     * BUSINESS that no query can infer.
     *
     * The walk-in record is a customer row like any other and carries ~83% of
     * revenue. Everything on the Customers board that divides by a customer, or
     * ranks one against another, is meaningless until counter trade can be told
     * apart from a named account -- and there is no safe way to guess which row
     * it is. So the `named_invoice` source refuses to build without it, its
     * metrics gate on this probe, and the tiles say plainly what is missing
     * instead of quietly reporting that the business depends on one customer.
     *
     * Static SQL, like every other probe: it reads the setting, never a request.
     */
    walkin_customer_identified: Object.freeze({
        id: 'walkin_customer_identified',
        label: 'Walk-in customer record named',
        sql: `SELECT EXISTS(
                SELECT 1 FROM settings
                WHERE setting_key = 'ANALYTICS_WALKIN_CUSTOMER_ID'
                  AND COALESCE(TRIM(setting_value), '') ~ '^[0-9]+$') AS ready`,
        emptyMessage:
            'Analytics cannot tell counter trade from a named account until the walk-in customer '
            + 'record is named under Settings → Analytics.',
    }),
});

const READINESS_TTL_MS = 5 * 60 * 1000;

module.exports = { READINESS_PROBES, READINESS_TTL_MS };
