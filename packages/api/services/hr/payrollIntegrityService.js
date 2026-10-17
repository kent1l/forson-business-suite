'use strict';

const { cents } = require('../cashDrawerService');

const EARNINGS = ['basic_pay', 'overtime_pay', 'holiday_pay', 'night_diff_pay',
    'allowances_taxable', 'allowances_nontaxable', 'other_earnings'];
const DEDUCTIONS = ['sss_ee', 'sss_mpf_ee', 'philhealth_ee', 'pagibig_ee',
    'withholding_tax', 'loans_total', 'other_deductions'];
const EMPLOYER = ['sss_er', 'sss_mpf_er', 'sss_ec', 'philhealth_er', 'pagibig_er'];
const amount = (value) => cents(String(value ?? 0), { signed: true });
const sum = (row, keys) => keys.reduce((total, key) => total + amount(row[key]), 0n);

/** Exact-cent reconciliation. Accepts computed camelCase or stored SQL lines. */
const payslipIssues = (header, lines) => {
    const issues = [];
    try {
        const lineSum = (type) => lines.filter((line) => (line.line_type || line.lineType) === type)
            .reduce((total, line) => total + amount(line.amount), 0n);
        if (sum(header, EARNINGS) !== amount(header.gross_pay)) issues.push('Earnings breakdown does not equal gross pay.');
        if (sum(header, DEDUCTIONS) !== amount(header.total_deductions)) issues.push('Deduction breakdown does not equal total deductions.');
        if (sum(header, EMPLOYER) !== amount(header.total_employer_contrib)) issues.push('Employer contribution breakdown does not equal its total.');
        if (lineSum('EARNING') !== amount(header.gross_pay)) issues.push('Earning lines do not equal gross pay.');
        if (lineSum('DEDUCTION') !== amount(header.total_deductions)) issues.push('Deduction lines do not equal total deductions.');
        if (lineSum('EMPLOYER_CONTRIBUTION') !== amount(header.total_employer_contrib)) issues.push('Employer contribution lines do not equal their total.');
        if (amount(header.gross_pay) - amount(header.total_deductions) !== amount(header.net_pay)) issues.push('Gross less deductions does not equal net pay.');
    } catch {
        issues.push('Payroll contains an invalid amount or more than two decimal places.');
    }
    return issues;
};

const reject = (issues) => {
    if (!issues.length) return;
    const error = new Error(`Payroll reconciliation failed: ${issues.join(' ')}`);
    error.code = 'PAYROLL_RECONCILIATION_FAILED';
    error.status = 422;
    throw error;
};
const assertPayslip = (header, lines) => reject(payslipIssues(header, lines));

const inspectRun = async (executor, runId) => {
    const { rows: [run] } = await executor.query('SELECT * FROM payroll_run WHERE run_id = $1', [runId]);
    if (!run) return { issues: ['Payroll run not found.'], payslips: [], run: null };
    const { rows: payslips } = await executor.query('SELECT * FROM payroll_payslip WHERE run_id = $1 ORDER BY payslip_id', [runId]);
    const { rows: lines } = await executor.query(
        `SELECT l.* FROM payroll_payslip_line l JOIN payroll_payslip p USING(payslip_id)
         WHERE p.run_id = $1 ORDER BY l.sort_order, l.line_id`, [runId]);
    const issues = [];
    for (const slip of payslips) {
        for (const issue of payslipIssues(slip, lines.filter((line) => String(line.payslip_id) === String(slip.payslip_id)))) {
            issues.push(`${slip.payslip_no}: ${issue}`);
        }
    }
    try {
        for (const [total, field] of [['total_gross', 'gross_pay'], ['total_deductions', 'total_deductions'],
            ['total_net', 'net_pay'], ['total_employer_contrib', 'total_employer_contrib']]) {
            if (payslips.reduce((acc, slip) => acc + amount(slip[field]), 0n) !== amount(run[total])) {
                issues.push(`Run ${total} does not equal its payslips.`);
            }
        }
    } catch { issues.push('Run contains an invalid monetary amount.'); }
    if (Number(run.employee_count) !== payslips.length) issues.push('Run employee count does not equal its payslip count.');
    return { run, payslips, issues };
};

const assertRun = async (executor, runId, { requireCurrentComputation = false } = {}) => {
    const result = await inspectRun(executor, runId);
    result.issues.push(...(result.run?.policy_snapshot?.approvalBlockers || []));
    if (!result.payslips.length) result.issues.push('A payable run must contain payslips.');
    for (const slip of result.payslips) {
        if (amount(slip.net_pay) < 0n) result.issues.push(`${slip.payslip_no}: negative net pay requires review.`);
        if (requireCurrentComputation && slip.computation_trace?.earningsModelVersion !== 2) {
            result.issues.push(`${slip.payslip_no}: recompute this unpaid run with the corrected payroll engine before approval.`);
        }
        if (slip.computation_trace?.requiresAnnualisation) {
            result.issues.push(`${slip.payslip_no}: annual tax reconciliation is required before approval.`);
        }
    }
    reject(result.issues);
    return result;
};

module.exports = { payslipIssues, assertPayslip, inspectRun, assertRun };
