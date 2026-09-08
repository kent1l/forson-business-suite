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
});

const READINESS_TTL_MS = 5 * 60 * 1000;

module.exports = { READINESS_PROBES, READINESS_TTL_MS };
