'use strict';

const recovery = require('./employeeRecoveryService');
const fundingService = require('./employeeFundingService');
const {
  cents,
  money,
  fail,
  validText
} = recovery;
async function lockTargets(client, ids) {
  if (!Array.isArray(ids) || !ids.length || new Set(ids.map(String)).size !== ids.length) fail(400, 'INVALID_TARGETS', 'Select unique payslip targets.');
  const {
    rows: runs
  } = await client.query('SELECT DISTINCT run_id FROM payroll_payslip WHERE payslip_id=ANY($1::bigint[]) ORDER BY run_id', [ids]);
  for (const r of runs) await recovery.lockRun(client, r.run_id);
  const {
    rows
  } = await client.query(`SELECT p.*,r.status,r.version FROM payroll_payslip p JOIN payroll_run r USING(run_id) WHERE p.payslip_id=ANY($1::bigint[]) ORDER BY p.run_id,p.payslip_id FOR UPDATE OF p`, [ids]);
  if (rows.length !== ids.length) fail(404, 'PAYSLIP_NOT_FOUND', 'Payslip target not found.');
  return rows;
}
async function settle(client, input, actor) {
  const targets = await lockTargets(client, [input.payslip_id]);
  const p = targets[0];
  if (!Number.isInteger(input.version) || input.version !== p.version) fail(409, 'STALE_VERSION', 'Payroll changed. Refresh.');
  if (p.status !== 'Approved') fail(409, 'SETTLEMENT_STATE', 'Only an approved unpaid payslip can begin recovery settlement.');
  if ((await client.query('SELECT 1 FROM employee_settlement WHERE payslip_id=$1', [p.payslip_id])).rowCount) fail(409, 'ALREADY_SETTLED', 'This payslip recovery was already executed.');
  if (cents(p.net_pay, {
    signed: true
  }) < 0n) fail(422, 'INSUFFICIENT_PAY', 'Resolve negative net pay before settlement.');
  const {
    rows: allocations
  } = await client.query("SELECT allocation_id FROM payroll_deduction_allocation WHERE payslip_id=$1 AND status='RESERVED' ORDER BY allocation_id", [p.payslip_id]);
  const actual = allocations.map(a => String(a.allocation_id)).sort();
  const requested = (input.allocation_ids || []).map(String).sort();
  if (JSON.stringify(actual) !== JSON.stringify(requested)) fail(409, 'RECOVERY_SET_CHANGED', 'Refresh and submit the exact approved allocation identities.');
  await recovery.postRecoveries(client, p.run_id, actor.employee_id, p.payslip_id);
  const {
    rows: [result]
  } = await client.query('INSERT INTO employee_settlement(payslip_id,employee_id,actor_id,reason) VALUES($1,$2,$3,$4) RETURNING *', [p.payslip_id, p.employee_id, actor.employee_id, validText(input.reason, 2000, true)]);
  await client.query('UPDATE payroll_run SET version=version+1 WHERE run_id=$1', [p.run_id]);
  return {
    ...result,
    remaining_payout: p.net_pay,
    version: p.version + 1,
    allocation_ids: actual
  };
}
async function payable(client, employeeId) {
  const {
    rows
  } = await client.query(`SELECT v.*,COALESCE((SELECT json_agg(json_build_object('allocation_id',a.allocation_id,'loan_id',a.loan_id,'approved_amount',a.approved_amount::text,'status',a.status)) FROM payroll_deduction_allocation a WHERE a.payslip_id=v.payslip_id),'[]') recoveries,p.payslip_no,r.run_no,to_char(r.pay_date,'YYYY-MM-DD') pay_date,r.status,r.version,
 (v.net_pay+v.correction_amount+v.rounding_amount-v.legacy_asserted_paid-v.actual_paid)::numeric(12,2) remaining_payable
 FROM payroll_employee_payable v JOIN payroll_payslip p USING(payslip_id) JOIN payroll_run r ON r.run_id=v.run_id WHERE v.employee_id=$1 ORDER BY r.pay_date,p.payslip_id`, [employeeId]);
  return rows;
}
async function payout(client, input, actor) {
  const amount = money(cents(input.amount, {
    positive: true
  }));
  const allocations = input.allocations;
  if (!Array.isArray(allocations) || !allocations.length) fail(400, 'ALLOCATIONS_REQUIRED', 'Select exact payslip allocations.');
  const targets = await lockTargets(client, allocations.map(a => a.payslip_id));
  const employeeId = Number(input.employee_id);
  if (targets.some(p => p.employee_id !== employeeId)) fail(422, 'EMPLOYEE_MISMATCH', 'Every payout allocation must belong to this employee.');
  // Serializes residual payouts across different runs of the same employee.
  await client.query('SELECT pg_advisory_xact_lock(71015,$1::integer)', [employeeId]);
  if ((await client.query("SELECT 1 FROM payroll_payout_current WHERE employee_id=$1 AND status IN ('PENDING','UNKNOWN')", [employeeId])).rowCount) fail(409, 'PAYMENT_UNRESOLVED', 'Reconcile the existing pending/unknown payment before creating a replacement.');
  let total = 0n;
  const balances = await payable(client, employeeId);
  for (const a of allocations) {
    const p = targets.find(t => String(t.payslip_id) === String(a.payslip_id));
    const b = balances.find(t => String(t.payslip_id) === String(a.payslip_id));
    if (!Number.isInteger(a.version) || p.version !== a.version) fail(409, 'STALE_VERSION', 'Payroll changed. Refresh the selected entitlements.');
    if (!b?.settlement_id && !b?.legacy_provenance || !['Approved', 'Paid', 'Posted'].includes(p.status)) fail(409, 'SETTLEMENT_REQUIRED', 'Execute the exact noncash recovery settlement before paying wages.');
    const value = cents(a.amount, {
      positive: true
    });
    total += value;
    if (value > cents(b.remaining_payable) - cents(b.pending_amount)) fail(422, 'OVERPAYMENT', 'Allocation exceeds unpaid wages. Record an approved rounding adjustment first when appropriate.');
  }
  if (total !== cents(amount)) fail(422, 'ALLOCATION_TOTAL', 'Allocation amounts must equal actual payout.');
  const status = input.status || 'CONFIRMED';
  if (!['CONFIRMED', 'PENDING', 'UNKNOWN'].includes(status) || !['BANK', 'CASH'].includes(input.method)) fail(400, 'INVALID_PAYOUT', 'Select a valid payout method and outcome.');
  if (input.method === 'CASH' && status !== 'CONFIRMED') fail(400, 'INVALID_CASH_OUTCOME', 'Cash payout must have actual release evidence.');
  const evidence = validText(input.evidence, 2000, true);
  const bankId = input.method === 'BANK' ? input.funding?.bank_account_id : null;
  const instruction = input.method === 'BANK' ? validText(input.funding?.external_reference, 200, true) : null;
  if (input.method === 'BANK' && !(await client.query("SELECT 1 FROM bank_account WHERE bank_account_id=$1 AND is_active AND currency='PHP'", [bankId])).rowCount) fail(422, 'BANK_ACCOUNT_REQUIRED', 'Select the bank account for this payment instruction.');
  const {
    rows: [doc]
  } = await client.query(`INSERT INTO payroll_payout(employee_id,amount,request_id,method,evidence,actor_id,bank_account_id,instruction_reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [employeeId, amount, input.request_id, input.method, evidence, actor.employee_id, bankId, instruction]);
  await client.query(`INSERT INTO payroll_payout_event(payout_id,status,evidence,reason,actor_id) VALUES($1,$2,$3,$4,$5)`, [doc.payout_id, status === 'CONFIRMED' ? 'PENDING' : status, evidence, 'Payment instruction recorded', actor.employee_id]);
  for (const a of allocations) await client.query('INSERT INTO payroll_payout_allocation(payout_id,payslip_id,amount) VALUES($1,$2,$3)', [doc.payout_id, a.payslip_id, a.amount]);
  if (status === 'CONFIRMED') {
    if (input.funding?.method !== input.method) fail(422, 'FUNDING_METHOD', 'Funding must match payout method.');
    const f = await fundingService.record(client, {
      funding: input.funding,
      amount,
      direction: 'OUT',
      ownerKey: `payout:${doc.payout_id}`,
      actor
    });
    await client.query(`INSERT INTO payroll_payout_event(payout_id,status,funding_id,evidence,reason,actor_id) VALUES($1,'CONFIRMED',$2,$3,'Actual disbursement verified',$4)`, [doc.payout_id, f.funding_id, evidence, actor.employee_id]);
  }
  await client.query('UPDATE payroll_run SET version=version+1 WHERE run_id=ANY($1::bigint[])', [[...new Set(targets.map(p => p.run_id))]]);
  return {
    ...doc,
    status,
    allocations
  };
}
async function resolve(client, id, input, actor) {
  const {
    rows: allocations
  } = await client.query('SELECT payslip_id FROM payroll_payout_allocation WHERE payout_id=$1', [id]);
  if (!allocations.length) fail(404, 'PAYOUT_NOT_FOUND', 'Payment not found.');
  const targets = await lockTargets(client, allocations.map(a => a.payslip_id));
  const {
    rows: [doc]
  } = await client.query('SELECT * FROM payroll_payout_current WHERE payout_id=$1', [id]);
  // Run locks serialize all resolvers of this payout; no lock of a view is needed.
  if (!doc || !['PENDING', 'UNKNOWN'].includes(doc.status)) fail(409, 'FINAL_OUTCOME', 'Payment already has a final outcome.');
  if (Number(input.version) !== Number(doc.event_id)) fail(409, 'STALE_VERSION', 'Payment outcome changed. Refresh.');
  if (!['CONFIRMED', 'FAILED', 'CANCELLED', 'UNKNOWN'].includes(input.status)) fail(400, 'INVALID_OUTCOME', 'Select a reconciled payment outcome.');
  let funding = null;
  if (input.status === 'CONFIRMED') {
    if (doc.bank_account_id && Number(input.funding?.bank_account_id) !== Number(doc.bank_account_id)) fail(422, 'BANK_IDENTITY', 'Reconcile against the bank account of the original instruction.');
    if (input.funding?.method !== doc.method) fail(422, 'FUNDING_METHOD', 'Funding method mismatch.');
    funding = await fundingService.record(client, {
      funding: input.funding,
      amount: doc.amount,
      direction: 'OUT',
      ownerKey: `payout:${id}`,
      actor
    });
  }
  const {
    rows: [event]
  } = await client.query('INSERT INTO payroll_payout_event(payout_id,status,funding_id,evidence,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [id, input.status, funding?.funding_id || null, validText(input.evidence, 2000, true), validText(input.reason, 2000, true), actor.employee_id]);
  await client.query('UPDATE payroll_run SET version=version+1 WHERE run_id=ANY($1::bigint[])', [[...new Set(targets.map(p => p.run_id))]]);
  return {
    payout_id: id,
    ...event
  };
}
async function runSummary(client, runId) {
  const {
    rows: [result]
  } = await client.query(`SELECT COUNT(*)::int employees,COUNT(*) FILTER(WHERE settlement_id IS NOT NULL)::int recoveries_posted,
 COALESCE(SUM(actual_paid),0)::numeric(14,2) actual_paid,COALESCE(SUM(legacy_asserted_paid),0)::numeric(14,2) legacy_asserted_paid,
 COALESCE(SUM(net_pay+correction_amount+rounding_amount-actual_paid-legacy_asserted_paid),0)::numeric(14,2) remaining_payable,
 COALESCE(SUM(pending_amount),0)::numeric(14,2) pending_amount FROM payroll_employee_payable WHERE run_id=$1`, [runId]);
  const settled = result.employees > 0 && result.recoveries_posted === result.employees && cents(result.remaining_payable, {
    signed: true
  }) === 0n;
  return {
    ...result,
    state: cents(result.legacy_asserted_paid, {
      signed: true
    }) > 0n || cents(result.remaining_payable, {
      signed: true
    }) < 0n || cents(result.pending_amount) > 0n ? 'NEEDS_REVIEW' : settled ? 'SETTLED' : cents(result.actual_paid) > 0n ? 'PARTIAL' : result.recoveries_posted > 0 ? 'IN_PROGRESS' : 'NOT_STARTED'
  };
}
async function assertRunSettled(client, runId) {
  const {
    rows: [state]
  } = await client.query(`SELECT COUNT(*)::int count,COUNT(*) FILTER(WHERE (settlement_id IS NULL AND legacy_provenance IS NULL) OR net_pay+correction_amount+rounding_amount-actual_paid-legacy_asserted_paid<>0 OR pending_amount<>0)::int incomplete FROM payroll_employee_payable WHERE run_id=$1`, [runId]);
  if (!state.count || state.incomplete) fail(409, 'EMPLOYEE_SETTLEMENT_INCOMPLETE', 'Complete recovery settlement and actual payouts for every employee before marking Paid.');
}
async function rounding(client, payslipId, input, actor) {
  const [p] = await lockTargets(client, [payslipId]);
  if (p.version !== input.version) fail(409, 'STALE_VERSION', 'Payroll changed. Refresh.');
  if (!['Approved', 'Paid'].includes(p.status)) fail(409, 'PAYROLL_STATE', 'Approve rounding before expense posting; Posted payroll requires a separately prepared expense adjustment.');
  const amount = money(cents(input.amount, {
    positive: true
  }));
  if (cents(amount) >= 100n) fail(422, 'ROUNDING_LIMIT', 'Upward rounding must be less than one peso.');
  const {
    rows: [doc]
  } = await client.query('INSERT INTO payroll_rounding_adjustment(payslip_id,amount,policy_version,reason,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [payslipId, amount, validText(input.policy_version, 200, true), validText(input.reason, 2000, true), validText(input.evidence, 2000, true), actor.employee_id]);
  await client.query('UPDATE payroll_run SET version=version+1 WHERE run_id=$1', [p.run_id]);
  return doc;
}
module.exports = {
  runSummary,
  settle,
  payout,
  resolve,
  payable,
  rounding,
  assertRunSettled,
  lockTargets
};
