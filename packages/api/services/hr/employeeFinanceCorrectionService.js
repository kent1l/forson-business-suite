'use strict';

const {
  cents,
  money,
  fail,
  validText
} = require('./employeeRecoveryService');
const loanService = require('./employeeLoanService');
const settlement = require('./employeeSettlementService');
const fundingService = require('./employeeFundingService');
function proof(input) {
  return {
    reason: validText(input.reason, 2000, true),
    evidence: validText(input.evidence, 2000, true)
  };
}
async function reverseRecovery(client, id, input, actor) {
  const {
    rows: [payment]
  } = await client.query('SELECT * FROM employee_loan_payment WHERE payment_id=$1', [id]);
  if (!payment || !payment.payslip_id || payment.reversal_of) fail(404, 'RECOVERY_NOT_FOUND', 'Original payroll recovery not found.');
  const [p] = await settlement.lockTargets(client, [payment.payslip_id]);
  if (p.version !== input.run_version) fail(409, 'STALE_VERSION', 'Payroll changed. Refresh.');
  await loanService.lock(client, payment.loan_id, input.loan_version);
  const {
    rows: [remitted]
  } = await client.query(`SELECT COALESCE(SUM(a.amount-COALESCE((SELECT SUM(c.amount) FROM loan_remittance_correction c WHERE c.remittance_allocation_id=a.remittance_allocation_id),0)),0)::numeric(12,2) amount FROM loan_remittance_allocation a WHERE a.payment_id=$1`, [id]);
  if (cents(remitted.amount) > 0n) fail(409, 'REMITTED_RECOVERY', 'Correct and reconcile the agency remittance first; payroll cannot undo money already remitted.');
  const {
    reason,
    evidence
  } = proof(input);
  const {
    rows: [reversal]
  } = await client.query('INSERT INTO employee_loan_payment(loan_id,amount,reversal_of,actor_id,reason,source_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [payment.loan_id, payment.amount, id, actor.employee_id, reason, `payroll-recovery-reversal:${id}`]);
  const {
    rows: [doc]
  } = await client.query('INSERT INTO payroll_recovery_correction(payment_id,reversal_payment_id,payslip_id,amount,reason,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [id, reversal.payment_id, payment.payslip_id, payment.amount, reason, evidence, actor.employee_id]);
  await client.query('UPDATE payroll_run SET version=version+1 WHERE run_id=$1', [p.run_id]);
  return {
    ...doc,
    restored_debt: payment.amount,
    additional_wages_payable: payment.amount,
    cash_movement: null
  };
}
async function returnPayout(client, id, input, actor) {
  const {
    rows: [allocation]
  } = await client.query('SELECT a.*,p.employee_id,p.status FROM payroll_payout_allocation a JOIN payroll_payout_current p USING(payout_id) WHERE a.payout_allocation_id=$1', [id]);
  if (!allocation || allocation.status !== 'CONFIRMED') fail(404, 'CONFIRMED_PAYOUT_REQUIRED', 'Confirmed exact payout allocation not found.');
  const [p] = await settlement.lockTargets(client, [allocation.payslip_id]);
  if (p.version !== input.version) fail(409, 'STALE_VERSION', 'Payroll changed. Refresh.');
  const amount = money(cents(input.amount, {
    positive: true
  }));
  const {
    reason,
    evidence
  } = proof(input);
  const {
    rows: [returned]
  } = await client.query('SELECT COALESCE(SUM(amount),0)::numeric(12,2) amount FROM payroll_payout_return WHERE payout_allocation_id=$1', [id]);
  if (cents(amount) + cents(returned.amount) > cents(allocation.amount)) fail(422, 'RETURN_LIMIT', 'Returned amount exceeds actual payout allocation.');
  const f = await fundingService.record(client, {
    funding: input.funding,
    amount,
    direction: 'IN',
    ownerKey: `payout-return:${input.request_id}`,
    actor
  });
  const {
    rows: [doc]
  } = await client.query('INSERT INTO payroll_payout_return(payout_allocation_id,amount,return_funding_id,reason,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [id, amount, f.funding_id, reason, evidence, actor.employee_id]);
  await client.query('UPDATE payroll_run SET version=version+1 WHERE run_id=$1', [p.run_id]);
  return {
    ...doc,
    restored_wages_payable: amount
  };
}
async function returnRemittance(client, id, input, actor) {
  const {
    rows: [a]
  } = await client.query('SELECT * FROM loan_remittance_allocation WHERE remittance_allocation_id=$1 AND remittance_id=$2', [input.remittance_allocation_id, id]);
  if (!a) fail(404, 'REMITTANCE_ALLOCATION_NOT_FOUND', 'Exact remittance allocation not found.');
  const {
    rows: [p]
  } = await client.query('SELECT loan_id FROM employee_loan_payment WHERE payment_id=$1', [a.payment_id]);
  await loanService.lock(client, p.loan_id, input.loan_version);
  await client.query('SELECT 1 FROM loan_remittance WHERE remittance_id=$1 FOR UPDATE', [id]);
  const {
    rows: [latest]
  } = await client.query('SELECT event_id FROM loan_remittance_event WHERE remittance_id=$1 ORDER BY event_id DESC LIMIT 1', [id]);
  if (Number(latest.event_id) !== input.version) fail(409, 'STALE_VERSION', 'Remittance changed. Refresh.');
  const {
    rows: [prior]
  } = await client.query('SELECT COALESCE(SUM(amount),0)::numeric(12,2) amount FROM loan_remittance_correction WHERE remittance_allocation_id=$1', [a.remittance_allocation_id]);
  const amount = money(cents(input.amount, {
    positive: true
  }));
  if (cents(amount) + cents(prior.amount) > cents(a.amount)) fail(422, 'CORRECTION_LIMIT', 'Correction exceeds unreversed remittance allocation.');
  const {
    reason,
    evidence
  } = proof(input);
  const f = await fundingService.record(client, {
    funding: input.funding,
    amount,
    direction: 'IN',
    ownerKey: `remittance-return:${input.request_id}`,
    actor
  });
  const {
    rows: [doc]
  } = await client.query('INSERT INTO loan_remittance_correction(remittance_allocation_id,amount,return_funding_id,reason,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [a.remittance_allocation_id, amount, f.funding_id, reason, evidence, actor.employee_id]);
  await client.query("INSERT INTO loan_remittance_event(remittance_id,state,evidence,reason,actor_id) VALUES($1,'NEEDS_REVIEW',$2,$3,$4)", [id, evidence, reason, actor.employee_id]);
  return {
    ...doc,
    reopened_unremitted_withholding: amount
  };
}
async function refundCollection(client, id, input, actor) {
  const {
    rows: [p]
  } = await client.query('SELECT * FROM employee_loan_payment WHERE collection_id=$1 AND payment_id=$2 AND reversal_of IS NULL', [id, input.payment_id]);
  if (!p) fail(404, 'COLLECTION_PAYMENT_NOT_FOUND', 'Original exact collection allocation not found.');
  await loanService.lock(client, p.loan_id, input.loan_version);
  if (input.amount !== undefined && cents(input.amount) !== cents(p.amount)) fail(422, 'REFUND_AMOUNT', 'Refund the exact original collection allocation amount.');
  const {
    reason,
    evidence
  } = proof(input);
  const f = await fundingService.record(client, {
    funding: input.funding,
    amount: p.amount,
    direction: 'OUT',
    ownerKey: `collection-refund:${input.request_id}`,
    actor
  });
  const {
    rows: [r]
  } = await client.query('INSERT INTO employee_loan_payment(loan_id,amount,reversal_of,actor_id,reason,source_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [p.loan_id, p.amount, p.payment_id, actor.employee_id, reason, `collection-refund:${p.payment_id}`]);
  const {
    rows: [doc]
  } = await client.query('INSERT INTO employee_collection_refund(payment_id,reversal_payment_id,funding_id,reason,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [p.payment_id, r.payment_id, f.funding_id, reason, evidence, actor.employee_id]);
  return {
    ...doc,
    restored_debt: p.amount
  };
}
module.exports = {
  reverseRecovery,
  returnPayout,
  returnRemittance,
  refundCollection
};
