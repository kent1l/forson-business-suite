'use strict';

/**
 * Posts a finalised payroll run into the expense module.
 *
 * Two rows per run — gross pay and the employer statutory share — rather than
 * one per employee. See 20260813_14_hr_payroll_expense_posting.sql for the
 * reasoning; the short version is that `expense.payee` is free text feeding the
 * expense AI lexicon and the payee typeahead, and the payslip is already the
 * per-employee record.
 */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const getSetting = async (executor, key, fallback = null) => {
    const { rows } = await executor.query('SELECT setting_value FROM settings WHERE setting_key = $1', [key]);
    return rows[0]?.setting_value ?? fallback;
};

/**
 * Paid -> Posted. Idempotent: the partial unique index
 * uq_expense_payroll_posting means a double-click cannot duplicate the rows.
 */
const postRunToExpense = async (executor, { runId, postedBy }) => {
    const { rows: runRows } = await executor.query(
        `SELECT run_id, run_no, status, total_gross, total_employer_contrib, total_net, employee_count,
                TO_CHAR(period_start, 'YYYY-MM-DD') AS period_start,
                TO_CHAR(period_end, 'YYYY-MM-DD') AS period_end,
                TO_CHAR(pay_date, 'YYYY-MM-DD') AS pay_date
         FROM payroll_run WHERE run_id = $1 FOR UPDATE`,
        [runId]
    );
    const run = runRows[0];
    if (!run) {
        const err = new Error('Payroll run not found');
        err.code = 'RUN_NOT_FOUND';
        throw err;
    }
    if (run.status !== 'Paid') {
        const err = new Error(`Only a Paid run can be posted to expenses (this one is ${run.status}).`);
        err.code = 'INVALID_TRANSITION';
        throw err;
    }

    const salariesCategoryId = Number(await getSetting(executor, 'PAYROLL_EXPENSE_CATEGORY_SALARIES'));
    const employerCategoryId = Number(await getSetting(executor, 'PAYROLL_EXPENSE_CATEGORY_EMPLOYER'));
    const paymentMethodText = await getSetting(executor, 'PAYROLL_DEFAULT_PAYMENT_METHOD', 'Cash');

    if (!salariesCategoryId || !employerCategoryId) {
        const err = new Error(
            'Payroll expense categories are not configured. Set PAYROLL_EXPENSE_CATEGORY_SALARIES and PAYROLL_EXPENSE_CATEGORY_EMPLOYER.'
        );
        err.code = 'POSTING_NOT_CONFIGURED';
        throw err;
    }

    const label = `Payroll ${run.run_no} (${run.period_start} to ${run.period_end})`;
    const expenseIds = [];

    const postings = [
        {
            categoryId: salariesCategoryId,
            amount: round2(run.total_gross),
            notes: `Gross pay for ${run.employee_count} employee(s). `
                + `Net paid out: ${round2(run.total_net)}. The difference is employee statutory `
                + 'withholdings and loan deductions, which are liabilities remitted separately — '
                + 'do NOT record those remittances as a second expense.',
        },
        {
            categoryId: employerCategoryId,
            amount: round2(run.total_employer_contrib),
            notes: `Employer share of SSS, PhilHealth and Pag-IBIG for ${run.employee_count} employee(s). `
                + 'Remitting this to the agencies is settling a liability, not a new expense.',
        },
    ];

    for (const posting of postings) {
        // A run with no employer contributions (or a zero-gross run) should not
        // create a zero-peso expense row — the amount CHECK would reject it anyway.
        if (posting.amount <= 0) continue;

        const { rows } = await executor.query(
            `INSERT INTO expense
                (expense_date, category_id, amount, payee, payment_method_text,
                 reference_no, notes, payroll_run_id, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             ON CONFLICT (payroll_run_id, category_id) WHERE payroll_run_id IS NOT NULL AND is_void = false
             DO NOTHING
             RETURNING expense_id`,
            [run.pay_date, posting.categoryId, posting.amount, label, paymentMethodText,
                run.run_no, posting.notes, runId, postedBy]
        );
        if (rows[0]) expenseIds.push(rows[0].expense_id);
    }

    const { rows: updated } = await executor.query(
        `UPDATE payroll_run SET status = 'Posted', posted_by = $1, posted_at = now()
         WHERE run_id = $2 RETURNING run_id, run_no, status`,
        [postedBy, runId]
    );

    return { run: updated[0], expenseIds };
};

module.exports = { postRunToExpense };
