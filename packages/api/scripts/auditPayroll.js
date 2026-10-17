'use strict';

// Read-only audit: never recomputes, approves, pays or rewrites saved payroll.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env'), quiet: true });
const db = require('../db');
const { inspectRun } = require('../services/hr/payrollIntegrityService');
const { computeWithholdingTax, round2 } = require('../services/hr/statutoryService');

async function audit(executor, runId) {
    const inspected = await inspectRun(executor, runId);
    const { run, payslips, issues } = inspected;
    const findings = [];
    for (const slip of payslips) {
        const trace = slip.computation_trace || {};
        if (['Computed', 'Approved'].includes(run.status) && trace.earningsModelVersion !== 2) {
            findings.push({ payslip_id: slip.payslip_id, code: 'LEGACY_UNPAID_COMPUTATION',
                action: run.status === 'Computed' ? 'Recompute before approval.' : 'Review and replace the unpaid approved run before payout.' });
        }
        if (['SPECIAL', 'THIRTEENTH_MONTH'].includes(run.run_type) && !['SPECIAL', 'THIRTEENTH_MONTH'].includes(trace.basicPayModel)) {
            findings.push({ payslip_id: slip.payslip_id, code: 'RUN_TYPE_COMPUTED_AS_REGULAR' });
        }
        if (trace.requiresAnnualisation) findings.push({ payslip_id: slip.payslip_id, code: 'ANNUAL_TAX_REVIEW_REQUIRED' });
        if (Number(slip.net_pay) < 0) findings.push({ payslip_id: slip.payslip_id, code: 'NEGATIVE_NET_PAY' });
        if (!['REGULAR', 'JOB_ORDER'].includes(run.run_type) || slip.statutory_coverage === 'EXEMPT') continue;
        const { rows: brackets } = await executor.query(
            `SELECT * FROM bir_withholding_bracket WHERE version_id = $1 AND payroll_frequency = 'SEMI_MONTHLY'
             ORDER BY lower_bound, bracket_seq`, [run.bir_version_id]);
        const expected = computeWithholdingTax({ birByFrequency: { SEMI_MONTHLY: brackets } }, slip.taxable_income).tax;
        const overridden = trace.statutoryOverridesApplied?.WTAX != null
            || trace.runAdjustmentsApplied?.some((a) => a.component === 'WTAX' && a.type === 'OVERRIDE');
        if (!overridden && round2(Number(slip.withholding_tax)) !== expected) {
            findings.push({ payslip_id: slip.payslip_id, code: 'WITHHOLDING_DIFFERS_FROM_SAVED_TABLE',
                saved: Number(slip.withholding_tax), expected, difference: round2(expected - Number(slip.withholding_tax)) });
        }
    }
    return { run_id: run.run_id, status: run.status, run_type: run.run_type,
        payslip_count: payslips.length, reconciliation_issues: issues, findings };
}

async function main() {
    const selected = process.argv[2];
    if (selected && !/^\d+$/.test(selected)) throw new Error('Usage: node scripts/auditPayroll.js [run_id]');
    const client = await db.getClient();
    try {
        await client.query('BEGIN READ ONLY');
        const { rows } = await client.query(
            `SELECT run_id FROM payroll_run WHERE status <> 'Draft' ${selected ? 'AND run_id = $1' : ''} ORDER BY run_id`,
            selected ? [selected] : []);
        const runs = [];
        for (const row of rows) runs.push(await audit(client, row.run_id));
        await client.query('ROLLBACK');
        console.log(JSON.stringify({ scope: 'Saved snapshot arithmetic and withholding against the saved BIR version; not a certification of attendance, classification or statutory assessment bases.',
            runs }, null, 2));
        return runs.some((run) => run.reconciliation_issues.length || run.findings.some((finding) => finding.code === 'WITHHOLDING_DIFFERS_FROM_SAVED_TABLE')) ? 2 : 0;
    } finally { client.release(); }
}

if (require.main === module) main().then((code) => process.exit(code)).catch((error) => {
    console.error(error.message); process.exit(1);
});
module.exports = { audit };
