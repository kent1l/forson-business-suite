'use strict';

/**
 * Payroll run orchestration and state machine.
 *
 * Compute deliberately bulk-loads everything up front — employees, effective
 * compensation, DTR summaries and loans are four queries regardless of headcount.
 * A naive per-employee loop turns a 40-person run into hundreds of round trips.
 *
 * The state machine is mirrored by a database trigger
 * (payroll_run_transition_guard), so the rules here are the friendly error
 * message and the trigger is the actual guarantee.
 */

const statutory = require('./statutoryService');
const dtrService = require('./dtrService');
const { computePayslip, round2 } = require('./payrollCalculationService');
const { getNextDocumentNumber } = require('../../helpers/documentNumberGenerator');

// Statuses meaning the employment has ended. Kept distinct from `is_active`,
// which is a system-access flag that nothing keeps in step with HR status — so
// a Resigned employee can, and in practice does, still read as active.
const SEPARATED_STATUSES = new Set(['Resigned', 'Terminated', 'Retired']);

const ALLOWED_TRANSITIONS = {
    Draft: ['Computed', 'Voided'],
    Computed: ['Draft', 'Approved', 'Voided'],
    Approved: ['Paid', 'Voided'],
    Paid: ['Posted', 'Voided'],
    Posted: ['Voided'],
    Voided: [],
};

const assertTransition = (from, to) => {
    if (!(ALLOWED_TRANSITIONS[from] || []).includes(to)) {
        const err = new Error(`A payroll run cannot move from ${from} to ${to}.`);
        err.code = 'INVALID_TRANSITION';
        throw err;
    }
};

const PAYROLL_SETTING_KEYS = [
    'PAYROLL_STATUTORY_SCHEDULE', 'PAYROLL_WORKING_DAYS_PER_YEAR',
    'PAYROLL_OT_RATE_ORDINARY', 'PAYROLL_OT_RATE_REST_DAY', 'PAYROLL_REST_DAY_RATE',
    'PAYROLL_REGULAR_HOLIDAY_RATE', 'PAYROLL_REGULAR_HOLIDAY_UNWORKED',
    'PAYROLL_SPECIAL_HOLIDAY_RATE', 'PAYROLL_NIGHT_DIFF_RATE', 'PAYROLL_ROUNDING_MODE',
    'PAYROLL_MONTHLY_DIVISOR_MODE',
];

/** Reads the PAYROLL_* settings into the policy object snapshotted on the run. */
const loadPolicy = async (executor) => {
    const { rows } = await executor.query(
        'SELECT setting_key, setting_value FROM settings WHERE setting_key = ANY($1::text[])',
        [PAYROLL_SETTING_KEYS]
    );
    const raw = Object.fromEntries(rows.map((r) => [r.setting_key, r.setting_value]));
    return {
        statutorySchedule: raw.PAYROLL_STATUTORY_SCHEDULE || 'SPLIT_HALF',
        workingDaysPerYear: Number(raw.PAYROLL_WORKING_DAYS_PER_YEAR) || 313,
        otRateOrdinary: Number(raw.PAYROLL_OT_RATE_ORDINARY) || 1.25,
        otRateRestDay: Number(raw.PAYROLL_OT_RATE_REST_DAY) || 1.69,
        restDayRate: Number(raw.PAYROLL_REST_DAY_RATE) || 1.30,
        regularHolidayRate: Number(raw.PAYROLL_REGULAR_HOLIDAY_RATE) || 2.00,
        regularHolidayUnworked: Number(raw.PAYROLL_REGULAR_HOLIDAY_UNWORKED) || 1.00,
        specialHolidayRate: Number(raw.PAYROLL_SPECIAL_HOLIDAY_RATE) || 1.30,
        nightDiffRate: Number(raw.PAYROLL_NIGHT_DIFF_RATE) || 0.10,
        monthlyDivisorMode: raw.PAYROLL_MONTHLY_DIVISOR_MODE || 'PERIOD_WORKING_DAYS',
        standardHoursPerDay: 8,
        roundingMode: raw.PAYROLL_ROUNDING_MODE || 'HALF_UP',
    };
};

const createRun = async (executor, { payPeriodId, runType = 'REGULAR', departmentId = null, createdBy, notes }) => {
    const { rows: periodRows } = await executor.query(
        `SELECT pay_period_id, period_seq,
                TO_CHAR(period_start, 'YYYY-MM-DD') AS period_start,
                TO_CHAR(period_end, 'YYYY-MM-DD') AS period_end,
                TO_CHAR(pay_date, 'YYYY-MM-DD') AS pay_date
         FROM pay_period WHERE pay_period_id = $1`,
        [payPeriodId]
    );
    const period = periodRows[0];
    if (!period) {
        const err = new Error('Pay period not found');
        err.code = 'PERIOD_NOT_FOUND';
        throw err;
    }

    const runNo = await getNextDocumentNumber(executor, 'PAY');
    const { rows } = await executor.query(
        `INSERT INTO payroll_run
            (run_no, run_type, pay_period_id, period_start, period_end, pay_date, department_id, notes, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING run_id, run_no, status,
                   TO_CHAR(period_start, 'YYYY-MM-DD') AS period_start,
                   TO_CHAR(period_end, 'YYYY-MM-DD') AS period_end`,
        [runNo, runType, payPeriodId, period.period_start, period.period_end,
            period.pay_date, departmentId, notes || null, createdBy]
    );
    return rows[0];
};

/**
 * Computes (or recomputes) every payslip in a run.
 *
 * Recompute is modelled as delete-then-regenerate, which the payslip
 * immutability trigger permits only while the run is Draft or Computed.
 */
const computeRun = async (executor, { runId, computedBy }) => {
    const { rows: runRows } = await executor.query(
        `SELECT run_id, run_no, run_type, status, department_id, pay_period_id,
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
    if (!['Draft', 'Computed'].includes(run.status)) {
        const err = new Error(`A ${run.status} run cannot be recomputed. Void it and start a new one.`);
        err.code = 'INVALID_TRANSITION';
        throw err;
    }

    const { rows: seqRows } = await executor.query(
        'SELECT period_seq FROM pay_period WHERE pay_period_id = $1', [run.pay_period_id]
    );
    const cutoffSeq = seqRows[0]?.period_seq || 1;

    // Statutory schedules are resolved against the PERIOD END, not today, so
    // recomputing an old run still picks the schedule that applied back then.
    const versions = await statutory.resolveVersions(executor, run.period_end);
    const tables = await statutory.loadTables(executor, versions);
    const policy = await loadPolicy(executor);

    // Clear any previous computation. Allowed here because the run is Draft or
    // Computed; the immutability trigger blocks it in every later state.
    await executor.query('DELETE FROM payroll_payslip WHERE run_id = $1', [runId]);

    // --- Bulk loads (four queries, regardless of headcount) --------------
    // A JOB_ORDER run pays contract-of-service workers; every other run type pays
    // employees. This one predicate is what keeps the two populations — and
    // therefore the statutory and BIR reports — apart.
    const workerClass = run.run_type === 'JOB_ORDER' ? 'JOB_ORDER' : 'EMPLOYEE';
    const empParams = [workerClass, run.period_start, run.period_end];
    // Separation is a DATE question, not a flag question. Someone who resigns
    // mid-cutoff is still owed the days they worked, so they must stay in the
    // run and be prorated — only a separation BEFORE the period starts removes
    // them. `is_active` is deliberately not trusted on its own: nothing keeps it
    // in step with employment_status, so a Resigned employee whose flag was
    // never flipped would otherwise be paid in full.
    let empWhere = `WHERE e.is_active = TRUE AND e.is_payroll_eligible = TRUE
                      AND e.worker_class = $1
                      AND (e.date_separated IS NULL OR e.date_separated >= $2::date)
                      AND (e.date_hired IS NULL OR e.date_hired <= $3::date)`;
    if (run.department_id) { empWhere += ' AND e.department_id = $4'; empParams.push(run.department_id); }

    const { rows: employees } = await executor.query(
        `SELECT e.employee_id, e.employee_code, e.position_title, e.worker_class,
                e.employment_status,
                TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
                TO_CHAR(e.date_hired, 'YYYY-MM-DD')    AS date_hired,
                TO_CHAR(e.date_separated, 'YYYY-MM-DD') AS date_separated,
                d.department_name
         FROM employee e
         LEFT JOIN department d ON e.department_id = d.department_id
         ${empWhere}
         ORDER BY e.last_name, e.first_name`,
        empParams
    );

    if (employees.length === 0) {
        // "Nobody matched" is useless on its own — three separate gates can
        // exclude someone, and the one that actually fired is invisible from the
        // UI. Re-query without the gates to say WHICH one, and name the people,
        // so the fix is a single click rather than a hunt.
        const { rows: [diag] } = await executor.query(
            `SELECT
                COUNT(*) FILTER (WHERE e.worker_class = $1)                          AS right_class,
                COUNT(*) FILTER (WHERE e.worker_class = $1 AND NOT e.is_active)      AS inactive,
                COUNT(*) FILTER (WHERE e.worker_class = $1 AND e.is_active
                                   AND NOT e.is_payroll_eligible)                    AS not_eligible,
                COALESCE(STRING_AGG(
                    TRIM(CONCAT_WS(' ', e.first_name, e.last_name)), ', '
                ) FILTER (WHERE e.worker_class = $1 AND e.is_active
                            AND NOT e.is_payroll_eligible), '')                      AS not_eligible_names
             FROM employee e`,
            [workerClass]
        );

        const label = workerClass === 'JOB_ORDER' ? 'job-order worker' : 'employee';
        let message;
        if (Number(diag.right_class) === 0) {
            message = `No ${label}s exist yet. Set a person's worker class to `
                + `${workerClass === 'JOB_ORDER' ? 'Job Order' : 'Employee'} to include them in this run.`;
        } else if (Number(diag.not_eligible) > 0) {
            message = `${diag.not_eligible} ${label}(s) were excluded because "Payroll eligible" is off: `
                + `${diag.not_eligible_names}. Turn it on in the employee record to pay them.`;
        } else if (Number(diag.inactive) > 0) {
            message = `Every ${label} is marked inactive, so none could be paid.`;
        } else if (run.department_id) {
            message = `No ${label}s are assigned to the selected department.`;
        } else {
            message = `No ${label}s matched this run.`;
        }

        const err = new Error(message);
        err.code = 'NO_EMPLOYEES';
        throw err;
    }
    const employeeIds = employees.map((e) => e.employee_id);

    // Effective compensation: for each employee, the latest row on or before the
    // period end. DISTINCT ON is the cheapest way to express "latest per group".
    const { rows: compRows } = await executor.query(
        `SELECT DISTINCT ON (employee_id)
                employee_id, compensation_id, pay_basis, salary_model, base_rate, days_per_year,
                declared_monthly_basic, sss_msc_override, is_overtime_exempt, is_tardiness_exempt,
                statutory_coverage
         FROM employee_compensation
         WHERE employee_id = ANY($1::int[]) AND effective_date <= $2
         ORDER BY employee_id, effective_date DESC`,
        [employeeIds, run.period_end]
    );
    const compensationByEmployee = new Map(compRows.map((r) => [r.employee_id, r]));

    const dtrByEmployee = await dtrService.summarizePeriodBulk(executor, {
        employeeIds, periodStart: run.period_start, periodEnd: run.period_end,
    });

    // Scheduled working days per employee: the divisor a monthly salary deducts
    // unpaid days against, and the basis for prorating a mid-cutoff hire.
    const periodDaysByEmployee = await dtrService.scheduledDaysBulk(executor, {
        employees, periodStart: run.period_start, periodEnd: run.period_end,
    });

    const { rows: loanRows } = await executor.query(
        `SELECT loan_id, employee_id, loan_type, component_code, reference_no,
                principal_amount, amortization_amount, amount_paid, deduct_on_cutoff
         FROM employee_loan
         WHERE employee_id = ANY($1::int[]) AND status = 'Active' AND start_date <= $2`,
        [employeeIds, run.period_end]
    );
    const loansByEmployee = new Map();
    for (const loan of loanRows) {
        if (!loansByEmployee.has(loan.employee_id)) loansByEmployee.set(loan.employee_id, []);
        loansByEmployee.get(loan.employee_id).push(loan);
    }

    // Recurring allowances and deductions in force at period end. Taxability
    // comes from the catalog, never from the assignment, so a reclassification
    // is one row rather than one per employee.
    const { rows: componentRows } = await executor.query(
        `SELECT epc.employee_id, epc.component_code, epc.amount, epc.rate_percent, epc.frequency,
                pc.component_name, pc.component_type, pc.is_taxable
         FROM employee_pay_component epc
         JOIN pay_component pc ON pc.component_code = epc.component_code
         WHERE epc.employee_id = ANY($1::int[])
           AND epc.is_active AND pc.is_active
           AND epc.effective_from <= $2
           AND (epc.effective_to IS NULL OR epc.effective_to >= $2)`,
        [employeeIds, run.period_end]
    );
    const componentsByEmployee = new Map();
    for (const row of componentRows) {
        if (!componentsByEmployee.has(row.employee_id)) componentsByEmployee.set(row.employee_id, []);
        componentsByEmployee.get(row.employee_id).push(row);
    }

    const { rows: overrideRows } = await executor.query(
        `SELECT employee_id, component_code, override_amount
         FROM employee_statutory_override
         WHERE employee_id = ANY($1::int[]) AND is_active
           AND effective_from <= $2
           AND (effective_to IS NULL OR effective_to >= $2)`,
        [employeeIds, run.period_end]
    );
    const overridesByEmployee = new Map();
    for (const row of overrideRows) {
        if (!overridesByEmployee.has(row.employee_id)) overridesByEmployee.set(row.employee_id, {});
        overridesByEmployee.get(row.employee_id)[row.component_code] = Number(row.override_amount);
    }

    // Run-scoped adjustments live outside the payslip precisely so a recompute
    // preserves them.
    const { rows: adjustmentRows } = await executor.query(
        `SELECT a.employee_id, a.component_code, a.adjustment_type, a.amount, a.reason,
                pc.component_name, pc.component_type, pc.is_taxable
         FROM payroll_run_adjustment a
         JOIN pay_component pc ON pc.component_code = a.component_code
         WHERE a.run_id = $1`,
        [runId]
    );
    const adjustmentsByEmployee = new Map();
    for (const row of adjustmentRows) {
        if (!adjustmentsByEmployee.has(row.employee_id)) adjustmentsByEmployee.set(row.employee_id, []);
        adjustmentsByEmployee.get(row.employee_id).push(row);
    }

    // --- Per-employee computation ----------------------------------------
    const warnings = [];
    // Collected rather than pushed per employee, so one missed DTR generation
    // reads as a single actionable warning instead of a wall of identical ones.
    const monthlyWithoutDtr = [];
    // Named in a closing warning so a final pay is never missed: someone leaving
    // mid-cutoff is paid a partial period here, and usually needs a FINAL_PAY
    // run afterwards for their last entitlements.
    const separatedThisPeriod = [];
    const totals = { gross: 0, deductions: 0, net: 0, employer: 0 };
    let payslipCount = 0;

    for (const employee of employees) {
        const compensation = compensationByEmployee.get(employee.employee_id);
        const dtrSummary = dtrByEmployee.get(employee.employee_id);

        // A separated status with no separation date is unresolvable: we cannot
        // tell which days of this cutoff were still employment. Paying in full
        // is the one option that is certainly wrong, so refuse and say what is
        // missing — this is also what surfaces records whose employment_status
        // and is_active flag disagree.
        if (SEPARATED_STATUSES.has(employee.employment_status) && !employee.date_separated) {
            warnings.push(
                `${employee.employee_name}: skipped — marked ${employee.employment_status} but has no `
                + 'separation date, so the last payable day is unknown. Set Date Separated on their record.'
            );
            continue;
        }
        if (employee.date_separated && employee.date_separated <= run.period_end) {
            separatedThisPeriod.push(`${employee.employee_name} (${employee.date_separated})`);
        }

        // Paying someone with no recorded rate would be inventing money.
        if (!compensation) {
            warnings.push(`${employee.employee_name}: skipped — no compensation on record as of ${run.period_end}.`);
            continue;
        }
        // A daily earner with no time recorded has earned nothing we can prove,
        // so skipping is right. A monthly earner is owed a contractual salary
        // whether or not anyone generated their DTR — attendance is an exception
        // record for them, not the basis of payment. They are paid in full and
        // named in a warning, so a missed DTR generation still cannot pass
        // unnoticed.
        if (!dtrSummary && compensation.pay_basis === 'daily') {
            warnings.push(`${employee.employee_name}: skipped — no daily time records for this period.`);
            continue;
        }
        if (!dtrSummary) monthlyWithoutDtr.push(employee.employee_name);

        let computed;
        try {
            computed = computePayslip({
                employee, compensation, dtrSummary,
                periodDays: periodDaysByEmployee.get(employee.employee_id),
                loans: loansByEmployee.get(employee.employee_id) || [],
                payComponents: componentsByEmployee.get(employee.employee_id) || [],
                statutoryOverrides: overridesByEmployee.get(employee.employee_id) || {},
                adjustments: adjustmentsByEmployee.get(employee.employee_id) || [],
                policy, statutoryTables: tables, cutoffSeq,
            });
        } catch (err) {
            if (['NO_COMPENSATION', 'UNSUPPORTED_PAY_BASIS'].includes(err.code)) {
                warnings.push(`${employee.employee_name}: skipped — ${err.message}`);
                continue;
            }
            throw err;
        }

        payslipCount += 1;
        const h = computed.header;
        const payslipNo = `${run.run_no}-${String(payslipCount).padStart(3, '0')}`;

        const { rows: payslipRows } = await executor.query(
            `INSERT INTO payroll_payslip (
                run_id, employee_id, payslip_no, employee_code, employee_name,
                position_title, department_name, pay_basis, salary_model, is_overtime_exempt,
                worker_class, statutory_coverage,
                daily_rate, monthly_basis, compensation_id,
                days_worked, days_paid, days_absent, days_on_leave, overtime_hours,
                basic_pay, overtime_pay, holiday_pay, night_diff_pay,
                allowances_taxable, allowances_nontaxable, other_earnings, gross_pay,
                sss_ee, sss_mpf_ee, philhealth_ee, pagibig_ee, withholding_tax,
                loans_total, other_deductions, total_deductions, taxable_income, net_pay,
                sss_er, sss_mpf_er, sss_ec, philhealth_er, pagibig_er, total_employer_contrib,
                computation_trace
             ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,
                $41,$42,$43,$44,$45
             ) RETURNING payslip_id`,
            [runId, h.employee_id, payslipNo, h.employee_code, h.employee_name,
                h.position_title, h.department_name, h.pay_basis, h.salary_model, h.is_overtime_exempt,
                h.worker_class, h.statutory_coverage,
                h.daily_rate, h.monthly_basis, h.compensation_id,
                h.days_worked, h.days_paid, h.days_absent, h.days_on_leave, h.overtime_hours,
                h.basic_pay, h.overtime_pay, h.holiday_pay, h.night_diff_pay,
                h.allowances_taxable, h.allowances_nontaxable, h.other_earnings, h.gross_pay,
                h.sss_ee, h.sss_mpf_ee, h.philhealth_ee, h.pagibig_ee, h.withholding_tax,
                h.loans_total, h.other_deductions, h.total_deductions, h.taxable_income, h.net_pay,
                h.sss_er, h.sss_mpf_er, h.sss_ec, h.philhealth_er, h.pagibig_er, h.total_employer_contrib,
                JSON.stringify(computed.trace)]
        );
        const payslipId = payslipRows[0].payslip_id;

        for (const line of computed.lines) {
            await executor.query(
                `INSERT INTO payroll_payslip_line
                    (payslip_id, line_type, component_code, description, quantity, rate, amount, is_taxable, sort_order)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [payslipId, line.lineType, line.componentCode, line.description,
                    line.quantity ?? null, line.rate ?? null, line.amount, line.isTaxable, line.sortOrder]
            );
        }

        // Loan instalments are recorded now but only become real when the run is
        // marked Paid — see markPaid.
        computed.loanDeductions.forEach((d) => { d.payslipId = payslipId; });

        totals.gross = round2(totals.gross + h.gross_pay);
        totals.deductions = round2(totals.deductions + h.total_deductions);
        totals.net = round2(totals.net + h.net_pay);
        totals.employer = round2(totals.employer + h.total_employer_contrib);
    }

    if (separatedThisPeriod.length > 0) {
        warnings.push(
            `${separatedThisPeriod.length} employee(s) separated during or before this period and were `
            + `paid only up to their last day: ${separatedThisPeriod.join(', ')}. `
            + 'Check whether a final pay run is also due.'
        );
    }

    if (monthlyWithoutDtr.length > 0) {
        warnings.push(
            `${monthlyWithoutDtr.length} monthly-paid employee(s) had no daily time records for this period `
            + `and were paid their full salary. Verify DTR generation ran: ${monthlyWithoutDtr.join(', ')}.`
        );
    }

    if (payslipCount === 0) {
        const err = new Error(
            `No payslips could be computed. ${warnings.join(' ')}`
        );
        err.code = 'NOTHING_TO_COMPUTE';
        throw err;
    }

    const { rows: updated } = await executor.query(
        `UPDATE payroll_run
         SET status = 'Computed', computed_by = $1, computed_at = now(),
             sss_version_id = $2, philhealth_version_id = $3, pagibig_version_id = $4, bir_version_id = $5,
             policy_snapshot = $6,
             employee_count = $7, total_gross = $8, total_deductions = $9,
             total_net = $10, total_employer_contrib = $11
         WHERE run_id = $12
         RETURNING run_id, run_no, status, employee_count, total_gross, total_deductions, total_net, total_employer_contrib`,
        [computedBy, versions.sssVersionId, versions.philhealthVersionId,
            versions.pagibigVersionId, versions.birVersionId,
            JSON.stringify({ ...policy, statutoryVersionLabels: versions.labels }),
            payslipCount, totals.gross, totals.deductions, totals.net, totals.employer, runId]
    );

    return { run: updated[0], payslipCount, warnings };
};

/** Computed -> Draft, discarding the computed payslips. */
const revertToDraft = async (executor, { runId, userId }) => {
    const { rows } = await executor.query('SELECT status FROM payroll_run WHERE run_id = $1 FOR UPDATE', [runId]);
    if (!rows[0]) { const e = new Error('Payroll run not found'); e.code = 'RUN_NOT_FOUND'; throw e; }
    assertTransition(rows[0].status, 'Draft');

    await executor.query('DELETE FROM payroll_payslip WHERE run_id = $1', [runId]);
    const { rows: updated } = await executor.query(
        `UPDATE payroll_run
         SET status = 'Draft', computed_by = NULL, computed_at = NULL,
             employee_count = 0, total_gross = 0, total_deductions = 0,
             total_net = 0, total_employer_contrib = 0
         WHERE run_id = $1 RETURNING run_id, run_no, status`,
        [runId]
    );
    return updated[0];
};

/**
 * Computed -> Approved. Freezes the payslips (via the immutability trigger) and
 * locks the DTR days the run consumed so they cannot drift from the payslip.
 */
const approveRun = async (executor, { runId, approvedBy }) => {
    const { rows } = await executor.query(
        `SELECT status, created_by, TO_CHAR(period_start,'YYYY-MM-DD') AS period_start,
                TO_CHAR(period_end,'YYYY-MM-DD') AS period_end
         FROM payroll_run WHERE run_id = $1 FOR UPDATE`,
        [runId]
    );
    const run = rows[0];
    if (!run) { const e = new Error('Payroll run not found'); e.code = 'RUN_NOT_FOUND'; throw e; }
    assertTransition(run.status, 'Approved');

    await executor.query(
        `UPDATE daily_time_record d
         SET locked_by_run_id = $1
         FROM payroll_payslip p
         WHERE p.run_id = $1 AND d.employee_id = p.employee_id
           AND d.work_date BETWEEN $2 AND $3 AND d.locked_by_run_id IS NULL`,
        [runId, run.period_start, run.period_end]
    );

    const { rows: updated } = await executor.query(
        `UPDATE payroll_run SET status = 'Approved', approved_by = $1, approved_at = now()
         WHERE run_id = $2 RETURNING run_id, run_no, status`,
        [approvedBy, runId]
    );
    return updated[0];
};

/** Approved -> Paid. This is where loan instalments actually land. */
const markPaid = async (executor, { runId, paidBy }) => {
    const { rows } = await executor.query('SELECT status FROM payroll_run WHERE run_id = $1 FOR UPDATE', [runId]);
    if (!rows[0]) { const e = new Error('Payroll run not found'); e.code = 'RUN_NOT_FOUND'; throw e; }
    assertTransition(rows[0].status, 'Paid');

    // Reconstructed from the payslip lines rather than carried in memory, so
    // marking paid is correct even in a separate request from compute.
    await executor.query(
        `INSERT INTO employee_loan_payment (loan_id, payslip_id, amount)
         SELECT l.loan_id, p.payslip_id, pl.amount
         FROM payroll_payslip p
         JOIN payroll_payslip_line pl ON pl.payslip_id = p.payslip_id
         JOIN employee_loan l ON l.employee_id = p.employee_id
                             AND l.component_code = pl.component_code
                             AND l.status = 'Active'
         WHERE p.run_id = $1 AND pl.line_type = 'DEDUCTION'
           AND pl.component_code IN ('SSS_LOAN', 'HDMF_LOAN', 'CASH_ADVANCE')
         ON CONFLICT (loan_id, payslip_id) DO NOTHING`,
        [runId]
    );

    const { rows: updated } = await executor.query(
        `UPDATE payroll_run SET status = 'Paid', paid_by = $1, paid_at = now()
         WHERE run_id = $2 RETURNING run_id, run_no, status`,
        [paidBy, runId]
    );
    return updated[0];
};

/**
 * Voids a run and unwinds everything it caused: the expense postings, the loan
 * instalments, and the DTR locks.
 */
const voidRun = async (executor, { runId, userId, reason }) => {
    const { rows } = await executor.query('SELECT status FROM payroll_run WHERE run_id = $1 FOR UPDATE', [runId]);
    if (!rows[0]) { const e = new Error('Payroll run not found'); e.code = 'RUN_NOT_FOUND'; throw e; }
    assertTransition(rows[0].status, 'Voided');
    if (!reason || !String(reason).trim()) {
        const e = new Error('A reason is required to void a payroll run.');
        e.code = 'VOID_REASON_REQUIRED';
        throw e;
    }

    await executor.query(
        `UPDATE expense SET is_void = true, voided_by = $1, voided_at = now(),
                            void_reason = $2
         WHERE payroll_run_id = $3 AND is_void = false`,
        [userId, `Payroll run voided: ${reason}`, runId]
    );

    // Deleting the payments lets the loan-balance trigger restore the
    // outstanding amounts automatically.
    await executor.query(
        `DELETE FROM employee_loan_payment
         WHERE payslip_id IN (SELECT payslip_id FROM payroll_payslip WHERE run_id = $1)`,
        [runId]
    );

    // The DTR lock guard blocks ordinary edits, so releasing the lock needs the
    // documented escape hatch. SET LOCAL scopes it to this transaction only.
    await executor.query("SET LOCAL app.payroll_unlock = 'on'");
    await executor.query(
        'UPDATE daily_time_record SET locked_by_run_id = NULL WHERE locked_by_run_id = $1', [runId]
    );

    const { rows: updated } = await executor.query(
        `UPDATE payroll_run SET status = 'Voided', voided_by = $1, voided_at = now(), void_reason = $2
         WHERE run_id = $3 RETURNING run_id, run_no, status`,
        [userId, reason, runId]
    );
    return updated[0];
};

module.exports = {
    createRun,
    computeRun,
    revertToDraft,
    approveRun,
    markPaid,
    voidRun,
    loadPolicy,
    assertTransition,
    ALLOWED_TRANSITIONS,
};
