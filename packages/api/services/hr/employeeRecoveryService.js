'use strict';
const crypto = require('node:crypto');
const { cents, money, fail, validText } = require('../cashDrawerService');
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;
async function request(client, { requestId, actorId, operation, payload }, action) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId || '')) fail(400, 'REQUEST_REQUIRED', 'A UUID request_id is required.');
    const hash = crypto.createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex');
    await client.query('INSERT INTO employee_finance_request(request_id,actor_id,operation,payload_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING', [requestId, actorId, operation, hash]);
    const { rows: [row] } = await client.query('SELECT * FROM employee_finance_request WHERE request_id=$1 FOR UPDATE', [requestId]);
    if (row.actor_id !== actorId || row.operation !== operation || row.payload_hash !== hash) fail(409, 'REQUEST_CONFLICT', 'Request identity was already used with different details.');
    if (row.result) return { ...row.result, replay: true };
    const result = await action();
    await client.query('UPDATE employee_finance_request SET result=$2 WHERE request_id=$1', [requestId, JSON.stringify(result)]);
    return { ...result, replay: false };
}
async function lockRun(client, runId, version) {
    const { rows: [run] } = await client.query('SELECT * FROM payroll_run WHERE run_id=$1 FOR UPDATE', [runId]);
    if (!run) fail(404, 'RUN_NOT_FOUND', 'Payroll run not found.');
    if (version !== undefined && Number(version) !== run.version) fail(409, 'STALE_VERSION', 'Payroll changed. Refresh before trying again.');
    return run;
}
async function lockLoans(client, runId) {
    await client.query(`SELECT l.loan_id FROM employee_loan l WHERE l.loan_id IN (
        SELECT a.loan_id FROM payroll_deduction_allocation a JOIN payroll_payslip p USING(payslip_id) WHERE p.run_id=$1)
        ORDER BY l.loan_id FOR UPDATE OF l`, [runId]);
}
async function voidEligibility(client, run) {
    if (!['Draft', 'Computed', 'Approved'].includes(run.status)) return { eligible: false, reason: `${run.status} payroll cannot be ordinarily voided. Paid corrections require source-specific evidence.` };
    const { rowCount } = await client.query(`SELECT 1 FROM employee_loan_payment ep JOIN payroll_payslip p USING(payslip_id) WHERE p.run_id=$1 LIMIT 1`, [run.run_id]);
    if (rowCount) return { eligible: false, reason: 'Posted recoveries block cancellation. Investigate linked financial history.' };
    return { eligible: true, reason: null };
}
async function clearProposals(client, runId) {
    await client.query(`DELETE FROM payroll_deduction_allocation a USING payroll_payslip p WHERE a.payslip_id=p.payslip_id AND p.run_id=$1 AND a.status='PROPOSED'`, [runId]);
}
async function persist(client, { payslipId, employeeId, periodId, run, cutoffSeq, deductions }) {
    for (const d of [...deductions].sort((a,b) => Number(a.loanId)-Number(b.loanId))) {
        await client.query(`INSERT INTO payroll_deduction_allocation(loan_id,employee_id,payslip_id,pay_period_id,recovery_month,cutoff_seq,scheduled_amount,approved_amount)
            VALUES($1,$2,$3,$4,date_trunc('month',$5::date)::date,$6,$7,$7)`,
        [d.loanId, employeeId, payslipId, periodId, run.period_end, cutoffSeq, d.amount]);
    }
}
async function reserve(client, runId) {
    await lockLoans(client, runId);
    const { rows: [shortfall] } = await client.query('SELECT payslip_id FROM payroll_payslip WHERE run_id=$1 AND net_pay<0 LIMIT 1', [runId]);
    if (shortfall) fail(422, 'INSUFFICIENT_PAY', 'Resolve negative net pay with exact recovery review before approval.');
    const { rows } = await client.query(`SELECT a.*, l.amortization_amount FROM payroll_deduction_allocation a JOIN payroll_payslip p USING(payslip_id) JOIN employee_loan l USING(loan_id) WHERE p.run_id=$1 ORDER BY a.loan_id,a.allocation_id`, [runId]);
    for (const a of rows) {
        const { rows: [used] } = await client.query(`SELECT COALESCE(SUM(approved_amount),0)::numeric(12,2) amount FROM payroll_deduction_allocation WHERE loan_id=$1 AND recovery_month=$2 AND cutoff_seq=$3 AND status IN ('RESERVED','RECOVERED') AND allocation_id<>$4`, [a.loan_id,a.recovery_month,a.cutoff_seq,a.allocation_id]);
        if (cents(used.amount)+cents(a.approved_amount)>cents(a.scheduled_amount)) fail(409,'INSTALLMENT_RESERVED','Another payroll owns this installment slot. Release/recompute unpaid payroll first.');
        await client.query("UPDATE payroll_deduction_allocation SET status='RESERVED' WHERE allocation_id=$1", [a.allocation_id]);
    }
}
async function postRecoveries(client, runId, actorId) {
    await lockLoans(client, runId);
    const { rows } = await client.query(`SELECT a.* FROM payroll_deduction_allocation a JOIN payroll_payslip p USING(payslip_id) WHERE p.run_id=$1 AND a.status='RESERVED' ORDER BY a.loan_id,a.allocation_id`, [runId]);
    for (const a of rows) {
        if (cents(a.approved_amount)>0n) await client.query(`INSERT INTO employee_loan_payment(loan_id,payslip_id,amount,allocation_id,actor_id,source_key) VALUES($1,$2,$3,$4,$5,$6)`, [a.loan_id,a.payslip_id,a.approved_amount,a.allocation_id,actorId,`allocation:${a.allocation_id}`]);
        await client.query("UPDATE payroll_deduction_allocation SET status='RECOVERED' WHERE allocation_id=$1", [a.allocation_id]);
    }
    // Old computed payroll has no trustworthy identity; never infer it by component.
    const { rows: [gap] } = await client.query(`SELECT p.payslip_id FROM payroll_payslip p WHERE p.run_id=$1 AND p.loans_total<>(SELECT COALESCE(SUM(a.approved_amount),0) FROM payroll_deduction_allocation a WHERE a.payslip_id=p.payslip_id AND a.status='RECOVERED') LIMIT 1`, [runId]);
    if (gap) fail(409, 'ALLOCATION_REVIEW_REQUIRED', 'Legacy payroll loan identities require release/recompute and approval.');
}
module.exports = { request, lockRun, lockLoans, voidEligibility, clearProposals, persist, reserve, postRecoveries, cents, money, fail, validText };
