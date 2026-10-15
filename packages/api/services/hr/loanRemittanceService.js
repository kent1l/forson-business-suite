'use strict';

const {
  cents,
  money,
  fail,
  validText
} = require('./employeeRecoveryService');
const loans = require('./employeeLoanService');
async function available(client, employeeId) {
  return (await client.query(`SELECT w.*,concat_ws(' ',e.first_name,e.last_name) employee_name,l.version loan_version,p.created_at withholding_at,COALESCE(a.recovery_month,date_trunc('month',r.period_end)::date) recovery_month
 FROM loan_withholding_available w JOIN employee e ON e.employee_id=w.employee_id JOIN employee_loan l ON l.loan_id=w.loan_id JOIN employee_loan_payment p USING(payment_id) LEFT JOIN payroll_deduction_allocation a ON a.allocation_id=p.allocation_id JOIN payroll_payslip ps ON ps.payslip_id=p.payslip_id JOIN payroll_run r ON r.run_id=ps.run_id
 WHERE ($1::integer IS NULL OR w.employee_id=$1) ORDER BY w.creditor,w.payment_id`, [employeeId || null])).rows;
}
async function remit(client, input, actor) {
  if (!['SSS', 'PAGIBIG'].includes(input.agency)) fail(400, 'INVALID_AGENCY', 'Choose SSS or PAGIBIG.');
  const amount = money(cents(input.amount, {
    positive: true
  }));
  const period = loans.month(input.recovery_month);
  const evidence = validText(input.evidence, 2000, true);
  const reference = validText(input.official_reference, 200, true);
  if (input.confirmed !== true) fail(422, 'UNVERIFIED_TREASURY', 'Confirm the Treasury payment from official evidence.');
  const allocations = input.allocations;
  if (!Array.isArray(allocations) || !allocations.length || new Set(allocations.map(a => String(a.payment_id))).size !== allocations.length) fail(400, 'INVALID_ALLOCATIONS', 'Choose unique exact withheld installments.');
  if (Boolean(input.treasury_expense_id) === Boolean(input.treasury_ap_payment_id)) fail(400, 'TREASURY_SOURCE_REQUIRED', 'Choose one existing Treasury expense or cleared supplier payment.');
  // All remittance/correction paths lock obligations before a Treasury source.
  await client.query('SELECT loan_id FROM employee_loan WHERE loan_id IN(SELECT loan_id FROM employee_loan_payment WHERE payment_id=ANY($1::bigint[])) ORDER BY loan_id FOR UPDATE', [allocations.map(a => a.payment_id)]);
  let source;
  if (input.treasury_expense_id) {
    source = (await client.query('SELECT * FROM expense WHERE expense_id=$1 AND NOT is_void AND payroll_run_id IS NULL FOR UPDATE', [input.treasury_expense_id])).rows[0];
  } else source = (await client.query("SELECT * FROM ap_payment WHERE payment_id=$1 AND pdc_status='CLEARED' FOR UPDATE", [input.treasury_ap_payment_id])).rows[0];
  if (!source || cents(source.amount) < cents(amount)) fail(422, 'INVALID_TREASURY_PAYMENT', 'Source must be an existing valid paid Treasury document covering this loan remittance. Gross payroll expense cannot be reused.');
  const cashMovement = await client.query(`SELECT movement_id FROM cash_drawer_movement WHERE ${input.treasury_expense_id ? 'expense_id' : 'ap_payment_id'}=$1 AND direction='OUT' AND NOT EXISTS(SELECT 1 FROM cash_drawer_movement rev WHERE rev.reversal_of=cash_drawer_movement.movement_id)`, [input.treasury_expense_id || input.treasury_ap_payment_id]);
  // With a tracked cash source, attribution reuses its movement. No new expense or release is created.
  let total = 0n;
  const rows = await available(client);
  for (const a of allocations) {
    const target = rows.find(w => String(w.payment_id) === String(a.payment_id));
    const value = cents(a.amount, {
      positive: true
    });
    total += value;
    if (!target || target.creditor !== input.agency || value > cents(target.unremitted)) fail(422, 'REMITTANCE_LIMIT', 'Allocation exceeds available withholding or belongs to another agency.');
  }
  if (total !== cents(amount)) fail(422, 'ALLOCATION_TOTAL', 'Exact loan allocations must equal the loan share of the Treasury payment.');
  const {
    rows: [doc]
  } = await client.query('INSERT INTO loan_remittance(agency,recovery_month,amount,treasury_expense_id,treasury_ap_payment_id,official_reference,evidence,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [input.agency, period, amount, input.treasury_expense_id || null, input.treasury_ap_payment_id || null, reference, evidence, actor.employee_id]);
  for (const a of allocations) await client.query('INSERT INTO loan_remittance_allocation(remittance_id,payment_id,amount) VALUES($1,$2,$3)', [doc.remittance_id, a.payment_id, a.amount]);
  const {
    rows: [event]
  } = await client.query("INSERT INTO loan_remittance_event(remittance_id,state,evidence,reason,actor_id) VALUES($1,'PAID',$2,'Existing Treasury disbursement attributed to exact withheld installments',$3) RETURNING *", [doc.remittance_id, evidence, actor.employee_id]);
  return {
    ...doc,
    event_id: event.event_id,
    state: event.state,
    source_movement_id: cashMovement.rows[0]?.movement_id || null,
    allocations
  };
}
async function reconcile(client, id, input, actor) {
  const {
    rows: [doc]
  } = await client.query('SELECT * FROM loan_remittance WHERE remittance_id=$1 FOR UPDATE', [id]);
  if (!doc) fail(404, 'REMITTANCE_NOT_FOUND', 'Remittance not found.');
  const {
    rows: [latest]
  } = await client.query('SELECT * FROM loan_remittance_event WHERE remittance_id=$1 ORDER BY event_id DESC LIMIT 1', [id]);
  if (!Number.isInteger(input.version) || Number(latest.event_id) !== input.version) fail(409, 'STALE_VERSION', 'Remittance changed. Refresh.');
  if (!['CONFIRMED', 'RECONCILED', 'NEEDS_REVIEW'].includes(input.state)) fail(400, 'INVALID_RECONCILIATION', 'Choose confirmed, reconciled or needs review.');
  const statementAmount = money(cents(input.statement_amount));
  const {
    rows: [corrected]
  } = await client.query('SELECT COALESCE(SUM(c.amount),0)::numeric(12,2) amount FROM loan_remittance_correction c JOIN loan_remittance_allocation a USING(remittance_allocation_id) WHERE a.remittance_id=$1', [id]);
  if (input.state === 'RECONCILED' && cents(statementAmount) !== cents(doc.amount) - cents(corrected.amount)) fail(422, 'STATEMENT_DIFFERENCE', 'Record needs review for an agency statement difference; do not rewrite withholding.');
  const {
    rows: [event]
  } = await client.query('INSERT INTO loan_remittance_event(remittance_id,state,statement_amount,evidence,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [id, input.state, statementAmount, validText(input.evidence, 2000, true), validText(input.reason, 2000, true), actor.employee_id]);
  return {
    ...doc,
    ...event
  };
}
async function directAgencyPayment(client, id, input, actor) {
  const loan = await loans.lock(client, id, input.version);
  if (!['SSS', 'PAGIBIG'].includes(loan.creditor) || loan.activation_state === 'DRAFT') fail(422, 'AGENCY_LOAN_REQUIRED', 'Only activated agency obligations can use agency-direct reconciliation.');
  if ((await client.query("SELECT 1 FROM payroll_deduction_allocation WHERE loan_id=$1 AND status='RESERVED' AND approved_amount>0", [id])).rowCount) fail(409, 'PAYROLL_RESERVED', 'Release/recompute unpaid payroll before reconciling a direct agency payment.');
  const amount = money(cents(input.amount, {
    positive: true
  }));
  if (cents(amount) > cents(loan.principal_amount) - cents(loan.amount_paid)) fail(422, 'AGENCY_PAYMENT_LIMIT', 'Agency-direct payment exceeds debt.');
  if (!input.occurred_at || !Number.isFinite(Date.parse(input.occurred_at)) || Date.parse(input.occurred_at) > Date.now() + 60000) fail(400, 'INVALID_OCCURRED_AT', 'Enter actual agency payment time.');
  const {
    rows: [doc]
  } = await client.query('INSERT INTO employee_agency_payment(loan_id,agency,amount,official_reference,evidence,reason,occurred_at,actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [id, loan.creditor, amount, validText(input.official_reference, 200, true), validText(input.evidence, 2000, true), validText(input.reason, 2000, true), input.occurred_at, actor.employee_id]);
  await client.query('INSERT INTO employee_loan_payment(loan_id,amount,actor_id,source_key,reason,occurred_at) VALUES($1,$2,$3,$4,$5,$6)', [id, amount, actor.employee_id, `agency-direct:${doc.agency_payment_id}`, doc.reason, doc.occurred_at]);
  return {
    ...doc,
    company_cash_movement: null,
    agency_schedule_changed: false
  };
}
async function list(client, employeeId) {
  return (await client.query(`SELECT r.*,(SELECT json_agg(to_jsonb(a)||jsonb_build_object('amount',a.amount::text) ORDER BY a.remittance_allocation_id) FROM loan_remittance_allocation a WHERE a.remittance_id=r.remittance_id) allocations,
 (SELECT json_agg(to_jsonb(e)||jsonb_build_object('statement_amount',e.statement_amount::text) ORDER BY e.event_id) FROM loan_remittance_event e WHERE e.remittance_id=r.remittance_id) events,
 (SELECT event_id FROM loan_remittance_event e WHERE e.remittance_id=r.remittance_id ORDER BY event_id DESC LIMIT 1) version,
 (SELECT state FROM loan_remittance_event e WHERE e.remittance_id=r.remittance_id ORDER BY event_id DESC LIMIT 1) state
 FROM loan_remittance r WHERE $1::integer IS NULL OR EXISTS(SELECT 1 FROM loan_remittance_allocation a JOIN employee_loan_payment p USING(payment_id) JOIN employee_loan l USING(loan_id) WHERE a.remittance_id=r.remittance_id AND l.employee_id=$1) ORDER BY r.remittance_id DESC`, [employeeId || null])).rows;
}
module.exports = {
  available,
  remit,
  reconcile,
  directAgencyPayment,
  list
};
