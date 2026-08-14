'use strict';

/**
 * Read-only aggregations over finalised payslips.
 *
 * Every report reads the payslip SNAPSHOT rather than recomputing, so a
 * remittance report run today and the same report run next year return
 * identical figures even after rates change.
 *
 * Only runs that have actually been committed (Approved, Paid, Posted) are
 * included: a Draft or Computed run is a working document, and a Voided one
 * has been retracted.
 */

const COMMITTED_STATUSES = ['Approved', 'Paid', 'Posted'];

/** Payroll register — every payslip in a run, the sheet payroll is signed off from. */
const payrollRegister = async (executor, { runId }) => {
    const { rows } = await executor.query(
        `SELECT p.payslip_no, p.employee_code, p.employee_name, p.position_title, p.department_name,
                p.daily_rate, p.days_paid, p.days_absent, p.days_on_leave, p.overtime_hours,
                p.basic_pay, p.overtime_pay, p.night_diff_pay,
                p.allowances_taxable, p.allowances_nontaxable, p.gross_pay,
                p.sss_ee, p.sss_mpf_ee, p.philhealth_ee, p.pagibig_ee, p.withholding_tax,
                p.loans_total, p.other_deductions, p.total_deductions, p.net_pay,
                p.sss_er, p.sss_mpf_er, p.sss_ec, p.philhealth_er, p.pagibig_er, p.total_employer_contrib
         FROM payroll_payslip p
         WHERE p.run_id = $1
         ORDER BY p.department_name NULLS LAST, p.employee_name`,
        [runId]
    );

    const totals = rows.reduce((acc, r) => {
        for (const key of Object.keys(acc)) acc[key] = Math.round((acc[key] + Number(r[key] || 0)) * 100) / 100;
        return acc;
    }, {
        basic_pay: 0, overtime_pay: 0, night_diff_pay: 0, gross_pay: 0,
        sss_ee: 0, sss_mpf_ee: 0, philhealth_ee: 0, pagibig_ee: 0, withholding_tax: 0,
        loans_total: 0, other_deductions: 0, total_deductions: 0, net_pay: 0,
        sss_er: 0, sss_mpf_er: 0, sss_ec: 0, philhealth_er: 0, pagibig_er: 0, total_employer_contrib: 0,
    });

    return { rows, totals, employee_count: rows.length };
};

/**
 * Contribution remittance schedule for one agency over a date range.
 *
 * Semi-monthly payroll means two payslips per month per employee, so the rows
 * are summed per employee per month — which is the unit the agencies actually
 * collect and report on.
 */
const contributionSchedule = async (executor, { agency, year, month }) => {
    const columns = {
        SSS: 'p.sss_ee AS ee, p.sss_er AS er, p.sss_ec AS ec, p.sss_mpf_ee AS mpf_ee, p.sss_mpf_er AS mpf_er',
        PHILHEALTH: 'p.philhealth_ee AS ee, p.philhealth_er AS er, 0 AS ec, 0 AS mpf_ee, 0 AS mpf_er',
        PAGIBIG: 'p.pagibig_ee AS ee, p.pagibig_er AS er, 0 AS ec, 0 AS mpf_ee, 0 AS mpf_er',
    }[agency];

    if (!columns) {
        const err = new Error('agency must be SSS, PHILHEALTH or PAGIBIG');
        err.code = 'INVALID_REPORT_PARAMS';
        throw err;
    }

    const { rows } = await executor.query(
        `SELECT p.employee_id, MAX(p.employee_code) AS employee_code, MAX(p.employee_name) AS employee_name,
                g.sss_no, g.tin, g.philhealth_no, g.pagibig_mid_no,
                SUM(x.ee)::numeric(12,2)     AS employee_share,
                SUM(x.er)::numeric(12,2)     AS employer_share,
                SUM(x.ec)::numeric(12,2)     AS ec_share,
                SUM(x.mpf_ee)::numeric(12,2) AS mpf_employee,
                SUM(x.mpf_er)::numeric(12,2) AS mpf_employer,
                (SUM(x.ee) + SUM(x.er) + SUM(x.ec) + SUM(x.mpf_ee) + SUM(x.mpf_er))::numeric(12,2) AS total
         FROM payroll_payslip p
         JOIN payroll_run r ON p.run_id = r.run_id
         LEFT JOIN employee_government_id g ON g.employee_id = p.employee_id
         CROSS JOIN LATERAL (SELECT ${columns}) AS x
         WHERE r.status = ANY($1)
           -- Job-order workers are outside the coverage, so they must never
           -- appear on a contribution schedule — not even as zero rows.
           AND r.run_type <> 'JOB_ORDER'
           AND EXTRACT(YEAR FROM r.period_end) = $2
           AND EXTRACT(MONTH FROM r.period_end) = $3
         GROUP BY p.employee_id, g.sss_no, g.tin, g.philhealth_no, g.pagibig_mid_no
         ORDER BY MAX(p.employee_name)`,
        [COMMITTED_STATUSES, year, month]
    );

    const totals = rows.reduce((acc, r) => ({
        employee_share: Math.round((acc.employee_share + Number(r.employee_share)) * 100) / 100,
        employer_share: Math.round((acc.employer_share + Number(r.employer_share)) * 100) / 100,
        ec_share: Math.round((acc.ec_share + Number(r.ec_share)) * 100) / 100,
        mpf_employee: Math.round((acc.mpf_employee + Number(r.mpf_employee)) * 100) / 100,
        mpf_employer: Math.round((acc.mpf_employer + Number(r.mpf_employer)) * 100) / 100,
        total: Math.round((acc.total + Number(r.total)) * 100) / 100,
    }), { employee_share: 0, employer_share: 0, ec_share: 0, mpf_employee: 0, mpf_employer: 0, total: 0 });

    return { agency, year, month, rows, totals };
};

/** Withholding tax remitted per month — the figures behind BIR 1601-C. */
const withholdingTaxReport = async (executor, { year, month }) => {
    const { rows } = await executor.query(
        `SELECT p.employee_id, MAX(p.employee_code) AS employee_code, MAX(p.employee_name) AS employee_name,
                g.tin,
                SUM(p.gross_pay)::numeric(14,2)        AS gross_pay,
                SUM(p.taxable_income)::numeric(14,2)   AS taxable_income,
                SUM(p.withholding_tax)::numeric(14,2)  AS withholding_tax
         FROM payroll_payslip p
         JOIN payroll_run r ON p.run_id = r.run_id
         LEFT JOIN employee_government_id g ON g.employee_id = p.employee_id
         WHERE r.status = ANY($1)
           -- A job-order fee is not compensation, so it must not inflate the
           -- gross reported on BIR 1601-C.
           AND r.run_type <> 'JOB_ORDER'
           AND EXTRACT(YEAR FROM r.period_end) = $2
           AND ($3::int IS NULL OR EXTRACT(MONTH FROM r.period_end) = $3)
         GROUP BY p.employee_id, g.tin
         ORDER BY MAX(p.employee_name)`,
        [COMMITTED_STATUSES, year, month || null]
    );

    const totals = rows.reduce((acc, r) => ({
        gross_pay: Math.round((acc.gross_pay + Number(r.gross_pay)) * 100) / 100,
        taxable_income: Math.round((acc.taxable_income + Number(r.taxable_income)) * 100) / 100,
        withholding_tax: Math.round((acc.withholding_tax + Number(r.withholding_tax)) * 100) / 100,
    }), { gross_pay: 0, taxable_income: 0, withholding_tax: 0 });

    return { year, month: month || null, rows, totals };
};

/**
 * 13th-month pay computation for a year.
 *
 * Under PD 851 the entitlement is total BASIC salary earned during the calendar
 * year divided by 12 — overtime, allowances and other premiums are excluded,
 * which is why this sums basic_pay rather than gross_pay.
 *
 * Anything already paid through a THIRTEENTH_MONTH run is netted off so the
 * report can be run repeatedly without double-paying.
 */
const thirteenthMonthReport = async (executor, { year }) => {
    const { rows } = await executor.query(
        `WITH basic AS (
            SELECT p.employee_id,
                   MAX(p.employee_code) AS employee_code,
                   MAX(p.employee_name) AS employee_name,
                   MAX(p.department_name) AS department_name,
                   SUM(p.basic_pay) FILTER (WHERE r.run_type = 'REGULAR')::numeric(14,2) AS basic_earned,
                   COUNT(*) FILTER (WHERE r.run_type = 'REGULAR')::int AS cutoffs_paid
            FROM payroll_payslip p
            JOIN payroll_run r ON p.run_id = r.run_id
            WHERE r.status = ANY($1) AND EXTRACT(YEAR FROM r.period_end) = $2
            GROUP BY p.employee_id
        ), already AS (
            SELECT p.employee_id, SUM(p.gross_pay)::numeric(14,2) AS already_paid
            FROM payroll_payslip p
            JOIN payroll_run r ON p.run_id = r.run_id
            -- A final pay settles the leaver's 13th month too, so it counts as
            -- already paid; otherwise this report would keep showing them owed.
            WHERE r.status = ANY($1) AND r.run_type IN ('THIRTEENTH_MONTH', 'FINAL_PAY')
              AND EXTRACT(YEAR FROM r.period_end) = $2
            GROUP BY p.employee_id
        )
        SELECT b.employee_id, b.employee_code, b.employee_name, b.department_name,
               b.basic_earned, b.cutoffs_paid,
               ROUND(b.basic_earned / 12, 2) AS entitlement,
               COALESCE(a.already_paid, 0)::numeric(14,2) AS already_paid,
               GREATEST(ROUND(b.basic_earned / 12, 2) - COALESCE(a.already_paid, 0), 0)::numeric(14,2) AS payable
        FROM basic b
        LEFT JOIN already a ON a.employee_id = b.employee_id
        WHERE b.basic_earned > 0
        ORDER BY b.employee_name`,
        [COMMITTED_STATUSES, year]
    );

    const totals = rows.reduce((acc, r) => ({
        basic_earned: Math.round((acc.basic_earned + Number(r.basic_earned)) * 100) / 100,
        entitlement: Math.round((acc.entitlement + Number(r.entitlement)) * 100) / 100,
        already_paid: Math.round((acc.already_paid + Number(r.already_paid)) * 100) / 100,
        payable: Math.round((acc.payable + Number(r.payable)) * 100) / 100,
    }), { basic_earned: 0, entitlement: 0, already_paid: 0, payable: 0 });

    // The tax-exempt ceiling applies to 13th month plus other benefits combined.
    const { rows: capRows } = await executor.query(
        "SELECT setting_value FROM settings WHERE setting_key = 'PAYROLL_13TH_MONTH_TAX_EXEMPT_CAP'"
    );

    return {
        year,
        rows,
        totals,
        tax_exempt_cap: Number(capRows[0]?.setting_value) || 90000,
        basis_note: 'Entitlement is total basic salary earned in the year divided by 12 (PD 851). '
            + 'Overtime, allowances and other premiums are excluded.',
    };
};

module.exports = {
    payrollRegister,
    contributionSchedule,
    withholdingTaxReport,
    thirteenthMonthReport,
    COMMITTED_STATUSES,
};
