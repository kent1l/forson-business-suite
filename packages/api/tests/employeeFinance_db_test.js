'use strict';

// Explicit opt-in only. Never point fixture-writing tests at a business DB.
require('dotenv').config({
  path: require('path').resolve(__dirname, '../../../.env')
});
if (!/^codex_employee_finance_verify_[a-z0-9_]+$/.test(process.env.EMPLOYEE_FINANCE_TEST_DB || '')) throw new Error('Select a disposable EMPLOYEE_FINANCE_TEST_DB.');
process.env.DB_NAME = process.env.EMPLOYEE_FINANCE_TEST_DB;
const {
  Pool
} = require('pg');
const assert = require('node:assert/strict');
const {
  randomUUID
} = require('node:crypto');
const recovery = require('../services/hr/employeeRecoveryService');
const remittances = require('../services/hr/loanRemittanceService');
const corrections = require('../services/hr/employeeFinanceCorrectionService');
const settlement = require('../services/hr/employeeSettlementService');
const accounts = require('../services/hr/employeeAccountsService');
const loanService = require('../services/hr/employeeLoanService');
const runs = require('../services/hr/payrollRunService');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME
});
async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
// Production computation persists the earning/loan lines together with these
// headers. Lifecycle fixtures must provide the same evidence for reconciliation.
async function persistRecoveryFixture(client, args) {
  const loanLineIds = new Map();
  for (const deduction of args.deductions) {
    const loan = args.loans.find(row => String(row.loan_id) === String(deduction.loanId));
    const { rows: [line] } = await client.query(
      `INSERT INTO payroll_payslip_line(payslip_id,line_type,component_code,description,amount,sort_order)
       VALUES($1,'DEDUCTION',$2,'Fixture loan deduction',$3,40) RETURNING line_id`,
      [args.payslipId, loan.component_code, deduction.amount]);
    loanLineIds.set(String(deduction.loanId), line.line_id);
  }
  return recovery.persist(client, { ...args, loanLineIds });
}
async function main() {
  const tag = randomUUID().slice(0, 8);
  await pool.query("INSERT INTO permission_level(permission_level_id,level_name) VALUES(10,'Admin') ON CONFLICT DO NOTHING");
  const {
    rows: [employee]
  } = await pool.query(`INSERT INTO employee(first_name,last_name,permission_level_id,username,password_hash,password_salt) VALUES('Finance','Test',10,$1,'unused','unused') RETURNING employee_id`, [`finance_${tag}`]);
  const actor = employee.employee_id;
  await pool.query("INSERT INTO pay_component(component_code,component_name,component_type) VALUES('TEST_LOAN','Test loan','DEDUCTION') ON CONFLICT DO NOTHING");
  const {
    rows: [period]
  } = await pool.query("INSERT INTO pay_period(period_year,period_month,period_seq,period_start,period_end,pay_date) VALUES(2200+$1,1,1,make_date(2200+$1,1,1),make_date(2200+$1,1,15),make_date(2200+$1,1,15)) RETURNING pay_period_id", [actor]);
  const makeRun = async (type = 'REGULAR', departmentId = null) => (await pool.query(`INSERT INTO payroll_run(run_no,run_type,pay_period_id,period_start,period_end,pay_date,created_by,department_id) VALUES($1,$2,$3,'2090-01-01','2090-01-15','2090-01-15',$4,$5) RETURNING *`, [tag + randomUUID().slice(0, 8), type, period.pay_period_id, actor, departmentId])).rows[0];
  const makeSlip = async (run, loanTotal = '20.00') => {
    const result = await pool.query(`INSERT INTO payroll_payslip(run_id,employee_id,payslip_no,employee_code,employee_name,pay_basis,daily_rate,monthly_basis,basic_pay,gross_pay,loans_total,total_deductions,net_pay,computation_trace) VALUES($1,$2,$3,'FIN','Finance Test','monthly',100,200,100,100,$4,$4,100-$4::numeric,'{"earningsModelVersion":2}') RETURNING *`, [run.run_id, actor, randomUUID(), loanTotal]);
    await pool.query(`INSERT INTO payroll_payslip_line(payslip_id,line_type,component_code,description,amount,sort_order)
        VALUES($1,'EARNING','BASIC','Fixture basic pay',100,1)`, [result.rows[0].payslip_id]);
    await pool.query('UPDATE payroll_run SET employee_count=1,total_gross=100,total_deductions=$2,total_net=100-$2::numeric WHERE run_id=$1', [run.run_id, loanTotal]);
    return result.rows[0];
  };
  const loans = [];
  for (let i = 0; i < 2; i++) loans.push((await pool.query(`INSERT INTO employee_loan(employee_id,loan_type,component_code,principal_amount,amortization_amount,start_date) VALUES($1,'OTHER','TEST_LOAN',100,10,'2089-01-01') RETURNING *`, [actor])).rows[0]);
  for (const loan of loans) {
    const {
      rows: [terms]
    } = await pool.query("INSERT INTO employee_loan_schedule(loan_id,schedule,monthly_installment,effective_from,version,deduction_authority,reason) VALUES($1,'FIRST_CUTOFF',10,'2089-01-01',1,'test authority','test') RETURNING *", [loan.loan_id]);
    Object.assign(loan, {
      schedule_id: terms.schedule_id,
      schedule_version: 1,
      scheduled_share: '10.00'
    });
  }
  const run = await makeRun();
  const slip = await makeSlip(run);
  await tx(async c => {
    await persistRecoveryFixture(c, {
      payslipId: slip.payslip_id,
      employeeId: actor,
      periodId: period.pay_period_id,
      run: {
        period_end: '2090-01-15'
      },
      cutoffSeq: 1,
      deductions: loans.map(l => ({
        loanId: l.loan_id,
        amount: '10.00'
      })),
      loans
    });
    await c.query("UPDATE payroll_run SET status='Computed' WHERE run_id=$1", [run.run_id]);
    await runs.approveRun(c, {
      runId: run.run_id,
      approvedBy: actor
    });
  });
  await assert.rejects(tx(c => loanService.collect(c, {
    employee_id: actor,
    amount: '1.00',
    reason: 'reserved test',
    allocation_policy: 'PRINCIPAL',
    allocations: [{
      loan_id: loans[0].loan_id,
      version: 1,
      amount: '1.00'
    }]
  }, {
    employee_id: actor
  })), /Release and recompute/);
  const {
    rows: [bank]
  } = await pool.query("INSERT INTO bank_account(account_name,bank_name) VALUES('Finance test','Test bank') RETURNING *");
  const actorUser = {
    employee_id: actor,
    permission_level_id: 10
  };
  const proof = () => ({
    method: 'BANK',
    bank_account_id: bank.bank_account_id,
    external_reference: randomUUID(),
    confirmed: true,
    evidence: 'verified test statement',
    occurred_at: new Date().toISOString()
  });
  const post = (operation, body, fn) => {
    const request_id = randomUUID();
    return tx(c => recovery.request(c, {
      requestId: request_id,
      actorId: actor,
      operation,
      payload: body
    }, () => fn(c, {
      ...body,
      request_id
    })));
  };
  const currentVersion = async id => (await pool.query('SELECT version FROM payroll_run WHERE run_id=$1', [id])).rows[0].version;
  const ids = (await pool.query('SELECT allocation_id FROM payroll_deduction_allocation WHERE payslip_id=$1', [slip.payslip_id])).rows.map(a => a.allocation_id);
  await post('settle', {
    payslip_id: slip.payslip_id,
    version: await currentVersion(run.run_id),
    allocation_ids: ids,
    reason: 'approved wage offsets'
  }, (c, b) => settlement.settle(c, b, actorUser));
  await post('payout', {
    employee_id: actor,
    amount: '79.99',
    method: 'BANK',
    evidence: 'actual 79.99 transfer',
    funding: proof(),
    allocations: [{
      payslip_id: slip.payslip_id,
      version: await currentVersion(run.run_id),
      amount: '79.99'
    }]
  }, (c, b) => settlement.payout(c, b, actorUser));
  assert.equal((await settlement.payable(pool, actor)).find(p => p.payslip_id === slip.payslip_id).remaining_payable, '0.01');
  const pending = await post('payout', {
    employee_id: actor,
    amount: '0.01',
    method: 'BANK',
    status: 'UNKNOWN',
    evidence: 'instruction timed out',
    funding: proof(),
    allocations: [{
      payslip_id: slip.payslip_id,
      version: await currentVersion(run.run_id),
      amount: '0.01'
    }]
  }, (c, b) => settlement.payout(c, b, actorUser));
  await assert.rejects(post('payout', {
    employee_id: actor,
    amount: '0.01',
    method: 'BANK',
    evidence: 'replacement',
    funding: proof(),
    allocations: [{
      payslip_id: slip.payslip_id,
      version: await currentVersion(run.run_id),
      amount: '0.01'
    }]
  }, (c, b) => settlement.payout(c, b, actorUser)), /existing pending\/unknown/);
  const event = (await pool.query('SELECT event_id FROM payroll_payout_current WHERE payout_id=$1', [pending.payout_id])).rows[0];
  await post('resolve', {
    version: Number(event.event_id),
    status: 'FAILED',
    evidence: 'verified bank rejection',
    reason: 'bank rejected'
  }, (c, b) => settlement.resolve(c, pending.payout_id, b, actorUser));
  await tx(c => runs.markPaid(c, {
    runId: run.run_id,
    paidBy: actor
  }));
  const summary = await accounts.summary(pool, actor);
  assert.equal(summary.categories.owed_to_employee.unpaid_salary, '0.00');
  assert.equal(summary.categories.owed_to_company.outstanding, '180.00');
  // Simplified payroll: no separate recovery, amount, method, funding or evidence.
  const exactDepartment = (await pool.query('INSERT INTO department(department_name) VALUES($1) RETURNING department_id', [randomUUID()])).rows[0].department_id;
  const exactRun = await makeRun('REGULAR', exactDepartment);
  const exactSlip = await makeSlip(exactRun, '20.00');
  const exactLoan = (await pool.query("INSERT INTO employee_loan(employee_id,loan_type,component_code,principal_amount,amortization_amount,start_date) VALUES($1,'OTHER','TEST_LOAN',100,20,'2089-01-01') RETURNING *", [actor])).rows[0];
  const exactTerms = (await pool.query("INSERT INTO employee_loan_schedule(loan_id,schedule,monthly_installment,effective_from,version,deduction_authority,reason) VALUES($1,'FIRST_CUTOFF',20,'2089-01-01',1,'test authority','test') RETURNING *", [exactLoan.loan_id])).rows[0];
  Object.assign(exactLoan, {schedule_id: exactTerms.schedule_id, schedule_version: 1, scheduled_share: '20.00'});
  await tx(c => persistRecoveryFixture(c, {payslipId: exactSlip.payslip_id, employeeId: actor, periodId: period.pay_period_id, run: {period_end: '2090-01-15'}, cutoffSeq: 1, deductions: [{loanId: exactLoan.loan_id, amount: '20.00'}], loans: [exactLoan]}));
  await pool.query("UPDATE payroll_run SET status='Computed' WHERE run_id=$1", [exactRun.run_id]);
  await tx(c => runs.approveRun(c, {runId: exactRun.run_id, approvedBy: actor}));
  const fundingBefore = (await pool.query('SELECT COUNT(*)::int n FROM employee_finance_funding')).rows[0].n;
  const doubleClick = await Promise.allSettled([1,2].map(() => tx(c => runs.markPaid(c, {runId: exactRun.run_id, paidBy: actor}))));
  assert.equal(doubleClick.filter(r => r.status === 'fulfilled').length, 1);
  const exactBalance = (await settlement.payable(pool, actor)).find(p => p.payslip_id === exactSlip.payslip_id);
  assert.equal(exactBalance.actual_paid, '80.00');
  assert.equal((await pool.query('SELECT amount_paid FROM employee_loan WHERE loan_id=$1', [exactLoan.loan_id])).rows[0].amount_paid, '20.00');
  assert.equal(exactBalance.remaining_payable, '0.00');
  assert.ok(exactBalance.settlement_id);
  const exactPayouts = (await pool.query('SELECT pc.* FROM payroll_payout_current pc JOIN payroll_payout_allocation a USING(payout_id) WHERE a.payslip_id=$1', [exactSlip.payslip_id])).rows;
  assert.equal(exactPayouts.length, 1);
  assert.equal(exactPayouts[0].method, null);
  assert.equal(exactPayouts[0].funding_id, null);
  assert.equal(exactPayouts[0].status, 'CONFIRMED');
  const exactStatement = await accounts.statement(pool, actor, {domain: 'EMPLOYEE', pageSize: '100'});
  assert.ok(exactStatement.data.some(e => e.source_type === 'PAYOUT' && e.source_id === String(exactPayouts[0].payout_id) && e.amount === '-80.00'));
  assert.equal(exactStatement.balances.find(b => b.domain === 'EMPLOYEE').closing, '0.00');
  assert.equal((await pool.query('SELECT COUNT(*)::int n FROM employee_finance_funding')).rows[0].n, fundingBefore);
  console.log('PASS simplified payroll: one click settles exact wages, no method/funding, duplicate click cannot pay twice');
  console.log('PASS settlement: explicit noncash offsets, partial actual payout, centavo residual, unknown replacement rejection, failed outcome reconciliation, final payout gate, source-linked accounts');
  assert.deepEqual((await pool.query('SELECT amount_paid FROM employee_loan WHERE loan_id=ANY($1::bigint[]) ORDER BY loan_id', [loans.map(l => l.loan_id)])).rows.map(l => l.amount_paid), ['10.00', '10.00']);
  await assert.rejects(tx(c => runs.voidRun(c, {
    runId: run.run_id,
    userId: actor,
    reason: 'test'
  })), /cannot move/);
  await assert.rejects(pool.query('DELETE FROM employee_loan_payment WHERE payslip_id=$1', [slip.payslip_id]), /append-only/);
  const unpaid = await makeRun('SPECIAL');
  await makeSlip(unpaid, '0.00');
  await tx(c => runs.voidRun(c, {
    runId: unpaid.run_id,
    userId: actor,
    reason: 'wrong run'
  }));
  assert.equal((await pool.query('SELECT count(*)::int n FROM payroll_payslip WHERE run_id=$1', [unpaid.run_id])).rows[0].n, 1);
  const key = randomUUID();
  const input = {
    requestId: key,
    actorId: actor,
    operation: 'test',
    payload: {
      a: 1
    }
  };
  await tx(c => recovery.request(c, input, async () => ({
    amount: '1.00'
  })));
  assert.equal((await tx(c => recovery.request(c, input, async () => {
    throw new Error('must not rerun');
  }))).replay, true);
  await assert.rejects(tx(c => recovery.request(c, {
    ...input,
    payload: {
      a: 2
    }
  }, async () => ({}))), /different details/);
  const draft = await tx(c => loanService.create(c, {
    employee_id: actor,
    creditor: 'COMPANY',
    loan_type: 'CASH_ADVANCE',
    component_code: 'TEST_LOAN',
    principal_amount: '100.00',
    collectible_opening: '100.00',
    interest_fees: '0.00',
    monthly_installment: '10.01',
    schedule: 'SPLIT_HALF',
    effective_from: '2090-01-01',
    start_date: '2090-01-10',
    purpose: 'test vale',
    authorization: 'signed deduction consent',
    evidence: 'signed agreement'
  }, actorUser));
  assert.deepEqual(draft.preview, {
    first_cutoff: '5.01',
    second_cutoff: '5.00'
  });
  const activated = await tx(c => loanService.activate(c, draft.loan_id, {
    version: 1,
    reason: 'release approved',
    funding: proof()
  }, actorUser));
  assert.equal(activated.status, 'Active');
  const held = await tx(c => loanService.hold(c, draft.loan_id, {
    version: activated.version,
    reason: 'test hold'
  }, actorUser));
  const resumed = await tx(c => loanService.hold(c, draft.loan_id, {
    version: held.version,
    reason: 'test resume'
  }, actorUser, true));
  assert.equal(resumed.amount_paid, '0.00');
  await tx(c => loanService.changeSchedule(c, draft.loan_id, {
    version: resumed.version,
    reason: 'new agreed terms',
    authorization: 'signed revised terms',
    monthly_installment: '12.03',
    schedule: 'FIRST_CUTOFF',
    effective_from: '2090-02-01'
  }, actorUser));
  await assert.rejects(pool.query("UPDATE employee_loan SET deduct_on_cutoff=2 WHERE loan_id=$1", [draft.loan_id]), /effective-dated/);
  const updated = (await pool.query('SELECT * FROM employee_loan WHERE loan_id=$1', [draft.loan_id])).rows[0];
  const received = await tx(c => loanService.collect(c, {
    request_id: randomUUID(),
    employee_id: actor,
    amount: '1.01',
    allocation_policy: 'PRINCIPAL',
    reason: 'direct bank repayment',
    funding: proof(),
    allocations: [{
      loan_id: draft.loan_id,
      version: updated.version,
      amount: '1.01'
    }]
  }, actorUser));
  assert.equal(received.amount, '1.01');
  await assert.rejects(pool.query("UPDATE employee_loan SET status='Completed' WHERE loan_id=$1", [draft.loan_id]), /cannot be erased/);
  const zeroLoan = await tx(c => loanService.create(c, {
    employee_id: actor,
    creditor: 'COMPANY',
    loan_type: 'OTHER',
    component_code: 'TEST_LOAN',
    principal_amount: '100.00',
    collectible_opening: '100.00',
    interest_fees: '0.00',
    monthly_installment: '100.00',
    schedule: 'FIRST_CUTOFF',
    effective_from: '2090-01-01',
    start_date: '2090-01-01',
    purpose: 'zero-net test',
    authorization: 'signed consent',
    evidence: 'test evidence'
  }, actorUser));
  await tx(c => loanService.activate(c, zeroLoan.loan_id, {
    version: 1,
    reason: 'verified release',
    funding: proof()
  }, actorUser));
  const zeroRun = await makeRun('JOB_ORDER');
  const zeroSlip = await makeSlip(zeroRun, '100.00');
  const z = (await pool.query('SELECT l.*,s.schedule_id,s.version schedule_version FROM employee_loan l JOIN employee_loan_schedule s USING(loan_id) WHERE l.loan_id=$1', [zeroLoan.loan_id])).rows[0];
  z.scheduled_share = '100.00';
  await tx(async c => {
    await persistRecoveryFixture(c, {
      payslipId: zeroSlip.payslip_id,
      employeeId: actor,
      periodId: period.pay_period_id,
      run: {
        period_end: '2090-01-15'
      },
      cutoffSeq: 1,
      deductions: [{
        loanId: z.loan_id,
        amount: '100.00'
      }],
      loans: [z]
    });
    await c.query("UPDATE payroll_run SET status='Computed' WHERE run_id=$1", [zeroRun.run_id]);
    await runs.approveRun(c, {
      runId: zeroRun.run_id,
      approvedBy: actor
    });
  });
  const beforeFunding = (await pool.query('SELECT count(*)::int n FROM employee_finance_funding')).rows[0].n;
  await tx(c => runs.markPaid(c, {
    runId: zeroRun.run_id,
    paidBy: actor
  }));
  assert.equal((await pool.query('SELECT count(*)::int n FROM employee_finance_funding')).rows[0].n, beforeFunding);
  assert.equal((await pool.query('SELECT amount_paid FROM employee_loan WHERE loan_id=$1', [z.loan_id])).rows[0].amount_paid, '100.00');
  assert.equal((await pool.query('SELECT count(*)::int n FROM payroll_payout_allocation WHERE payslip_id=$1', [zeroSlip.payslip_id])).rows[0].n, 0);
  await post('rounding', {
    version: await currentVersion(zeroRun.run_id),
    amount: '0.50',
    policy_version: 'test-approved-rounding-v1',
    reason: 'employer covers rounding',
    evidence: 'approved policy'
  }, (c, b) => settlement.rounding(c, zeroSlip.payslip_id, b, actorUser));
  assert.equal((await settlement.payable(pool, actor)).find(p => p.payslip_id === zeroSlip.payslip_id).remaining_payable, '0.50');
  const agency = await tx(c => loanService.create(c, {
    employee_id: actor,
    creditor: 'SSS',
    loan_type: 'SSS_SALARY',
    component_code: 'TEST_LOAN',
    principal_amount: '100.00',
    collectible_opening: '100.00',
    interest_fees: '0.00',
    monthly_installment: '10.00',
    schedule: 'FIRST_CUTOFF',
    effective_from: '2090-01-01',
    start_date: '2090-01-01',
    purpose: 'agency test',
    authorization: 'signed agency consent',
    evidence: 'agency enrollment'
  }, actorUser));
  await tx(c => loanService.activate(c, agency.loan_id, {
    version: 1,
    reason: 'verified enrollment',
    enrollment_evidence: 'agency evidence'
  }, actorUser));
  const agencyRun = await makeRun('SPECIAL');
  const agencySlip = await makeSlip(agencyRun, '10.00');
  const agencyLoan = (await pool.query('SELECT l.*,s.schedule_id,s.version schedule_version FROM employee_loan l JOIN employee_loan_schedule s USING(loan_id) WHERE l.loan_id=$1', [agency.loan_id])).rows[0];
  agencyLoan.scheduled_share = '10.00';
  await tx(async c => {
    await persistRecoveryFixture(c, {
      payslipId: agencySlip.payslip_id,
      employeeId: actor,
      periodId: period.pay_period_id,
      run: {
        period_end: '2090-01-15'
      },
      cutoffSeq: 1,
      deductions: [{
        loanId: agency.loan_id,
        amount: '10.00'
      }],
      loans: [agencyLoan]
    });
    await c.query("UPDATE payroll_deduction_allocation SET supplemental_authorization='explicit authorized supplemental recovery' WHERE payslip_id=$1", [agencySlip.payslip_id]);
    await c.query("UPDATE payroll_run SET status='Computed' WHERE run_id=$1", [agencyRun.run_id]);
    await runs.approveRun(c, {
      runId: agencyRun.run_id,
      approvedBy: actor
    });
  });
  const agencyIds = (await pool.query('SELECT allocation_id FROM payroll_deduction_allocation WHERE payslip_id=$1', [agencySlip.payslip_id])).rows.map(a => a.allocation_id);
  await post('settle', {
    payslip_id: agencySlip.payslip_id,
    version: await currentVersion(agencyRun.run_id),
    allocation_ids: agencyIds,
    reason: 'approved agency offset'
  }, (c, b) => settlement.settle(c, b, actorUser));
  let withheld = (await remittances.available(pool, actor)).find(w => w.loan_id === agency.loan_id);
  assert.equal(withheld.unremitted, '10.00');
  const {
    rows: [category]
  } = await pool.query('INSERT INTO expense_category(category_name) VALUES($1) RETURNING category_id', [`Agency fixture ${tag}`]);
  const treasury = async amount => (await pool.query("INSERT INTO expense(expense_date,category_id,amount,payee,payment_method_text,reference_no,created_by) VALUES(current_date,$1,$2,'SSS','Bank',$3,$4) RETURNING *", [category.category_id, amount, randomUUID(), actor])).rows[0];
  const source = await treasury('6.00');
  const source2 = await treasury('4.00');
  const remBody = {
    agency: 'SSS',
    amount: '6.00',
    recovery_month: '2090-01-01',
    treasury_expense_id: source.expense_id,
    official_reference: randomUUID(),
    evidence: 'verified Treasury bank release',
    confirmed: true,
    allocations: [{
      payment_id: withheld.payment_id,
      amount: '6.00'
    }]
  };
  const rem = await post('remit', remBody, (c, b) => remittances.remit(c, b, actorUser));
  assert.equal((await remittances.available(pool, actor)).find(w => w.loan_id === agency.loan_id).unremitted, '4.00');
  await assert.rejects(post('remit', {
    ...remBody,
    official_reference: randomUUID()
  }, (c, b) => remittances.remit(c, b, actorUser)), /exceeds available/);
  await assert.rejects(tx(c => remittances.reconcile(c, rem.remittance_id, {
    version: Number(rem.event_id),
    state: 'RECONCILED',
    statement_amount: '5.99',
    evidence: 'agency mismatch',
    reason: 'difference'
  }, actorUser)), /statement difference/);
  const reconciled = await tx(c => remittances.reconcile(c, rem.remittance_id, {
    version: Number(rem.event_id),
    state: 'RECONCILED',
    statement_amount: '6.00',
    evidence: 'agency matched',
    reason: 'matches'
  }, actorUser));
  const rem2 = await post('remit', {
    ...remBody,
    amount: '4.00',
    treasury_expense_id: source2.expense_id,
    official_reference: randomUUID(),
    allocations: [{
      payment_id: withheld.payment_id,
      amount: '4.00'
    }]
  }, (c, b) => remittances.remit(c, b, actorUser));
  await assert.rejects(pool.query('UPDATE expense SET is_void=true WHERE expense_id=$1', [source.expense_id]), /Correct remittance/);
  const loanVersion = async id => (await pool.query('SELECT version FROM employee_loan WHERE loan_id=$1', [id])).rows[0].version;
  await assert.rejects(tx(async c => corrections.reverseRecovery(c, withheld.payment_id, {
    run_version: await currentVersion(agencyRun.run_id),
    loan_version: await loanVersion(agency.loan_id),
    reason: 'correction',
    evidence: 'source evidence'
  }, actorUser)), /remittance first/);
  const fundingBeforeDirect = (await pool.query('SELECT count(*)::int n FROM employee_finance_funding')).rows[0].n;
  await tx(async c => remittances.directAgencyPayment(c, agency.loan_id, {
    version: await loanVersion(agency.loan_id),
    amount: '1.00',
    official_reference: randomUUID(),
    evidence: 'agency direct employee payment verified',
    reason: 'employee receipt matched',
    occurred_at: new Date().toISOString()
  }, actorUser));
  assert.equal((await pool.query('SELECT count(*)::int n FROM employee_finance_funding')).rows[0].n, fundingBeforeDirect);
  for (const [doc, version] of [[rem, Number(reconciled.event_id)], [rem2, Number(rem2.event_id)]]) {
    const allocation = (await pool.query('SELECT * FROM loan_remittance_allocation WHERE remittance_id=$1', [doc.remittance_id])).rows[0];
    await post('remittance-return', {
      version,
      loan_version: await loanVersion(agency.loan_id),
      remittance_allocation_id: allocation.remittance_allocation_id,
      amount: allocation.amount,
      funding: proof(),
      reason: 'agency returned erroneous remittance',
      evidence: 'verified agency bank refund'
    }, (c, b) => corrections.returnRemittance(c, doc.remittance_id, b, actorUser));
  }
  await post('recovery-reversal', {
    run_version: await currentVersion(agencyRun.run_id),
    loan_version: await loanVersion(agency.loan_id),
    reason: 'erroneous payroll recovery',
    evidence: 'approved source correction'
  }, (c, b) => corrections.reverseRecovery(c, withheld.payment_id, b, actorUser));
  assert.equal((await settlement.payable(pool, actor)).find(p => p.payslip_id === agencySlip.payslip_id).remaining_payable, '100.00');
  const paidAllocation = (await pool.query('SELECT a.* FROM payroll_payout_allocation a JOIN payroll_payout p USING(payout_id) WHERE p.employee_id=$1 AND a.amount=79.99', [actor])).rows[0];
  await post('payout-return', {
    version: await currentVersion(run.run_id),
    amount: '0.01',
    funding: proof(),
    reason: 'verified employee returned centavo',
    evidence: 'bank returned wages'
  }, (c, b) => corrections.returnPayout(c, paidAllocation.payout_allocation_id, b, actorUser));
  await post('payout', {
    employee_id: actor,
    amount: '0.51',
    method: 'BANK',
    evidence: 'old and current residuals',
    funding: proof(),
    allocations: [{
      payslip_id: slip.payslip_id,
      version: await currentVersion(run.run_id),
      amount: '0.01'
    }, {
      payslip_id: zeroSlip.payslip_id,
      version: await currentVersion(zeroRun.run_id),
      amount: '0.50'
    }]
  }, (c, b) => settlement.payout(c, b, actorUser));
  const collectionPayment = (await pool.query('SELECT * FROM employee_loan_payment WHERE collection_id=$1', [received.collection_id])).rows[0];
  await post('collection-refund', {
    payment_id: collectionPayment.payment_id,
    loan_version: await loanVersion(draft.loan_id),
    funding: proof(),
    reason: 'verified receipt refunded',
    evidence: 'bank refund'
  }, (c, b) => corrections.refundCollection(c, received.collection_id, b, actorUser));
  const dept = async () => (await pool.query('INSERT INTO department(department_name) VALUES($1) RETURNING department_id', [randomUUID()])).rows[0].department_id;
  const raceRuns = [await makeRun('REGULAR', await dept()), await makeRun('REGULAR', await dept())];
  const concurrentLoan = (await pool.query(`SELECT l.*,s.schedule_id,s.version schedule_version FROM employee_loan l JOIN employee_loan_schedule s USING(loan_id) WHERE l.loan_id=$1 AND s.effective_from='2090-01-01'`, [draft.loan_id])).rows[0];
  concurrentLoan.scheduled_share = '5.01';
  for (const rr of raceRuns) {
    const pp = await makeSlip(rr, '5.01');
    await tx(async c => {
      await persistRecoveryFixture(c, {
        payslipId: pp.payslip_id,
        employeeId: actor,
        periodId: period.pay_period_id,
        run: {
          period_end: '2090-01-15'
        },
        cutoffSeq: 1,
        deductions: [{
          loanId: draft.loan_id,
          amount: '5.01'
        }],
        loans: [concurrentLoan]
      });
      await c.query("UPDATE payroll_run SET status='Computed' WHERE run_id=$1", [rr.run_id]);
    });
  }
  const race = await Promise.allSettled(raceRuns.map(rr => tx(c => runs.approveRun(c, {
    runId: rr.run_id,
    approvedBy: actor
  }))));
  assert.equal(race.filter(r => r.status === 'fulfilled').length, 1, 'Only one competing payroll may reserve a cutoff slot');
  const raceRun = await makeRun('REGULAR', await dept());
  const raceSlip = await makeSlip(raceRun, '0.00');
  await tx(async c => {
    await c.query("UPDATE payroll_run SET status='Computed' WHERE run_id=$1", [raceRun.run_id]);
    await runs.approveRun(c, {
      runId: raceRun.run_id,
      approvedBy: actor
    });
  });
  const raceVersion = await currentVersion(raceRun.run_id);
  const cancelRace = await Promise.allSettled([tx(c => runs.voidRun(c, {
    runId: raceRun.run_id,
    userId: actor,
    reason: 'wrong run'
  })), tx(c => settlement.settle(c, {
    payslip_id: raceSlip.payslip_id,
    version: raceVersion,
    allocation_ids: [],
    reason: 'execute wages'
  }, actorUser))]);
  assert.equal(cancelRace.filter(r => r.status === 'fulfilled').length, 1, 'Ordinary void and settlement cannot both succeed');
  console.log('PASS races: simultaneous slot reservation; void versus employee settlement has one valid outcome');
  const express = require('express');
  const http = require('supertest');
  const jwt = require('jsonwebtoken');
  const {
    manilaDateString
  } = require('../helpers/manilaDate');
  const app = express();
  app.use(express.json());
  app.use('/api', require('../routes/employeeFinanceRoutes').router);
  app.use('/api/payroll', require('../routes/payrollRoutes'));
  const token = id => jwt.sign({
    employee_id: id,
    login_date: manilaDateString()
  }, process.env.JWT_SECRET);
  const adminHeader = {
    Authorization: `Bearer ${token(actor)}`
  };
  for (const [role, permission] of [[901, 'employee_finance:view'], [902, 'hr:view_sensitive'], [903, 'payroll:post']]) {
    await pool.query('INSERT INTO permission_level(permission_level_id,level_name) VALUES($1,$2) ON CONFLICT DO NOTHING', [role, `Finance fixture ${role}`]);
    await pool.query("INSERT INTO permission(permission_key,description,category) VALUES($1::text,$1::text,'Test') ON CONFLICT DO NOTHING", [permission]);
    await pool.query('INSERT INTO role_permission(permission_level_id,permission_id) SELECT $1,permission_id FROM permission WHERE permission_key=$2 ON CONFLICT DO NOTHING', [role, permission]);
    const {
      rows: [u]
    } = await pool.query("INSERT INTO employee(first_name,last_name,permission_level_id,username,password_hash,password_salt) VALUES('Role','Fixture',$1,$2,'unused','unused') RETURNING employee_id", [role, randomUUID()]);
    const auth = {
      Authorization: `Bearer ${token(u.employee_id)}`
    };
    const read = await http(app).get(`/api/hr/employees/${actor}/accounts`).set(auth);
    assert.equal(read.status, role === 901 ? 200 : 403, JSON.stringify(read.body));
    const pay = await http(app).post('/api/payroll/payouts').set(auth).send({});
    assert.equal(pay.status, 403);
    const cross = await http(app).get(`/api/hr/employees/${u.employee_id}/account-sources/PAYSLIP/${slip.payslip_id}`).set(adminHeader);
    assert.equal(cross.status, 404);
    await pool.query('UPDATE employee SET is_active=false WHERE employee_id=$1', [u.employee_id]);
    assert.equal((await http(app).get(`/api/hr/employees/${actor}/accounts`).set(auth)).status, 401);
    assert.equal((await http(app).get(`/api/hr/employees/${u.employee_id}/accounts`).set(adminHeader)).status, 200);
  }
  for (const url of ['/api/hr/loan-remittances','/api/hr/employee-finance/treasury-sources',`/api/hr/employees/${actor}/account-sources/PAYOUT/${paidAllocation.payout_id}`,`/api/hr/employees/${actor}/account-statement?domain=EMPLOYEE&from=2020-01-01&to=2099-12-31`]) {
    const response=await http(app).get(url).set(adminHeader);assert.equal(response.status,200,`${url}: ${JSON.stringify(response.body)}`);
  }
  const httpBody = {
    request_id: randomUUID(),
    creditor: 'SSS',
    loan_type: 'SSS_SALARY',
    component_code: 'TEST_LOAN',
    principal_amount: '5.00',
    collectible_opening: '5.00',
    interest_fees: '0.00',
    monthly_installment: '1.01',
    schedule: 'SPLIT_HALF',
    effective_from: '2091-01-01',
    start_date: '2091-01-01',
    purpose: 'HTTP draft',
    authorization: 'signed',
    evidence: 'agreement'
  };
  const postUrl = `/api/hr/employees/${actor}/loans`;
  assert.equal((await http(app).post(postUrl).set(adminHeader).send(httpBody)).status, 201);
  assert.equal((await http(app).post(postUrl).set(adminHeader).send(httpBody)).status, 200);
  assert.equal((await http(app).post(postUrl).set(adminHeader).send({
    ...httpBody,
    purpose: 'changed'
  })).status, 409);
  const times = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    await accounts.summary(pool, actor);
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  console.log(`Disposable summary p95 (${times.length} samples, small fixture): ${times[18].toFixed(1)} ms`);
  console.log('PASS authenticated HTTP: finance read, HR-only denial, payroll-post-only payout denial, employee source isolation, revoked login, former-employee records, request creation/replay/conflict');
  // Full orchestrator path (not a mocked query sequence): an exempt fixture keeps statutory rate policy outside this test.
  for (const agencyName of ['SSS', 'PHILHEALTH', 'PAGIBIG', 'BIR_WTAX']) await pool.query("INSERT INTO statutory_table_version(agency,version_label,effective_from,source_reference) VALUES($1,'Disposable exempt fixture','2080-01-01','test only') ON CONFLICT DO NOTHING", [agencyName]);
  await pool.query("INSERT INTO pay_component(component_code,component_name,component_type) VALUES('BASIC','Basic pay','EARNING'),('THIRTEENTH_MONTH','13th month','EARNING') ON CONFLICT DO NOTHING");
  const computeDept = await dept();
  await pool.query("UPDATE employee SET department_id=$2,is_payroll_eligible=true,employee_code=$3,date_hired='2089-01-01',worker_class='EMPLOYEE' WHERE employee_id=$1", [actor, computeDept, `FIN-${tag}`]);
  await pool.query("INSERT INTO employee_compensation(employee_id,effective_date,pay_basis,base_rate,salary_model,statutory_coverage) VALUES($1,'2089-01-01','monthly',1000,'GUARANTEED','EXEMPT')", [actor]);
  const computeLoan = await tx(c => loanService.create(c, {
    employee_id: actor,
    creditor: 'COMPANY',
    loan_type: 'OTHER',
    component_code: 'TEST_LOAN',
    principal_amount: '100.00',
    collectible_opening: '100.00',
    interest_fees: '0.00',
    monthly_installment: '9.01',
    schedule: 'SPLIT_HALF',
    effective_from: '2090-01-01',
    start_date: '2090-01-01',
    purpose: 'compute fixture',
    authorization: 'signed test',
    evidence: 'test only'
  }, actorUser));
  await tx(c => loanService.activate(c, computeLoan.loan_id, {
    version: 1,
    reason: 'release verified',
    funding: proof()
  }, actorUser));
  const midmonth = await tx(c => loanService.create(c, {
    employee_id: actor,
    creditor: 'COMPANY',
    loan_type: 'OTHER',
    component_code: 'TEST_LOAN',
    principal_amount: '100.00',
    collectible_opening: '100.00',
    interest_fees: '0.00',
    monthly_installment: '1.01',
    schedule: 'SPLIT_HALF',
    effective_from: '2090-01-01',
    start_date: '2090-01-16',
    purpose: 'midmonth fixture',
    authorization: 'signed test',
    evidence: 'test only'
  }, actorUser));
  await tx(c => loanService.activate(c, midmonth.loan_id, {
    version: 1,
    reason: 'release verified',
    funding: proof()
  }, actorUser));
  const catchup = await tx(c => loanService.create(c, {
    employee_id: actor,
    creditor: 'COMPANY',
    loan_type: 'OTHER',
    component_code: 'TEST_LOAN',
    principal_amount: '100.00',
    collectible_opening: '100.00',
    interest_fees: '0.00',
    monthly_installment: '2.00',
    schedule: 'FIRST_CUTOFF',
    effective_from: '2090-01-01',
    start_date: '2090-01-16',
    purpose: 'explicit catch-up fixture',
    authorization: 'signed test',
    evidence: 'test only'
  }, actorUser));
  await tx(c => loanService.activate(c, catchup.loan_id, {
    version: 1,
    reason: 'release verified',
    funding: proof()
  }, actorUser));
  const computedRun = await makeRun('REGULAR', computeDept);
  await tx(c => runs.computeRun(c, {
    runId: computedRun.run_id,
    computedBy: actor
  }));
  await tx(c => runs.computeRun(c, {
    runId: computedRun.run_id,
    computedBy: actor
  }));
  const {
    rows: [exact]
  } = await pool.query('SELECT a.*,pl.amount line_amount FROM payroll_deduction_allocation a JOIN payroll_payslip p USING(payslip_id) JOIN payroll_payslip_line pl ON pl.line_id=a.line_id WHERE p.run_id=$1 AND a.loan_id=$2', [computedRun.run_id, computeLoan.loan_id]);
  assert.equal(exact.approved_amount, '4.51');
  assert.equal(exact.line_amount, '4.51');
  await tx(c => runs.approveRun(c, {
    runId: computedRun.run_id,
    approvedBy: actor
  }));
  await assert.rejects(pool.query('UPDATE payroll_payslip_line SET amount=1 WHERE line_id=$1', [exact.line_id]), /immutable/);
  await assert.rejects(pool.query('DELETE FROM payroll_run WHERE run_id=$1', [computedRun.run_id]), /append-only/);
  const {
    rows: [secondPeriod]
  } = await pool.query("INSERT INTO pay_period(period_year,period_month,period_seq,period_start,period_end,pay_date) VALUES(2090,1,2,'2090-01-16','2090-01-31','2090-01-31') ON CONFLICT(period_type,period_start,period_end) DO UPDATE SET pay_date=EXCLUDED.pay_date RETURNING pay_period_id");
  const secondRun = await tx(c => runs.createRun(c, {
    payPeriodId: secondPeriod.pay_period_id,
    departmentId: computeDept,
    createdBy: actor
  }));
  await tx(c => runs.computeRun(c, {
    runId: secondRun.run_id,
    computedBy: actor
  }));
  const secondAllocations = (await pool.query('SELECT a.* FROM payroll_deduction_allocation a JOIN payroll_payslip p USING(payslip_id) WHERE p.run_id=$1', [secondRun.run_id])).rows;
  const secondMain = secondAllocations.find(a => a.loan_id === computeLoan.loan_id);
  const secondMid = secondAllocations.find(a => a.loan_id === midmonth.loan_id);
  const secondCatch = secondAllocations.find(a => a.loan_id === catchup.loan_id);
  assert.equal(secondMain.approved_amount, '4.50');
  assert.equal(secondMid.approved_amount, '0.50');
  assert.equal(secondCatch.approved_amount, '0.00');
  await tx(async c => recovery.review(c, secondMain.payslip_id, {
    version: await currentVersion(secondRun.run_id),
    allocations: [{
      allocation_id: secondCatch.allocation_id,
      action: 'CATCH_UP',
      amount: '2.00',
      reason: 'explicit remaining-month collection',
      authorization: 'approved catch-up consent'
    }, {
      allocation_id: secondMid.allocation_id,
      action: 'DEFER',
      amount: '0.00',
      reason: 'defer this share'
    }]
  }, actor));
  await tx(async c => {
    await c.query('UPDATE payroll_payslip SET gross_pay=0,net_pay=-total_deductions WHERE run_id=$1', [secondRun.run_id]);
  });
  await assert.rejects(tx(c => runs.approveRun(c, {
    runId: secondRun.run_id,
    approvedBy: actor
  })), /negative net pay/);
  await pool.query('UPDATE payroll_payslip SET gross_pay=500,net_pay=500-total_deductions WHERE run_id=$1', [secondRun.run_id]);
  await tx(c => runs.approveRun(c, {
    runId: secondRun.run_id,
    approvedBy: actor
  }));
  console.log('PASS cutoff integration: second share exact remainder, midmonth remaining share only, no hidden first-cutoff catch-up, authorized catch-up/defer, negative-net approval blocked');
  await pool.query("UPDATE employee SET date_separated='2090-01-05',employment_status='Resigned' WHERE employee_id=$1", [actor]);
  const finalRun = await makeRun('FINAL_PAY', computeDept);
  await tx(c => runs.computeRun(c, {
    runId: finalRun.run_id,
    computedBy: actor
  }));
  assert.equal((await pool.query('SELECT loans_total FROM payroll_payslip WHERE run_id=$1', [finalRun.run_id])).rows[0].loans_total, '0.00', 'Final-pay debt must await explicit exact recovery review');
  console.log('PASS full orchestrator: real bulk calculation SQL, recompute, exact line identity, slot-aware share, approval immutability and final-pay explicit review');
  process.env.ENABLE_CASH_DRAWER = 'true';
  const {
    rows: [drawer]
  } = await pool.query("INSERT INTO cash_drawer(code,name) VALUES($1,'Employee finance test') RETURNING drawer_id", [randomUUID()]);
  const {
    rows: [session]
  } = await pool.query("INSERT INTO cash_drawer_session(session_code,drawer_id,business_date,custodian_id,opening_amount,opened_by) VALUES($1,$2,current_date,$3,1000,$3) RETURNING *", [randomUUID(), drawer.drawer_id, actor]);
  const cashProof = async () => ({
    method: 'CASH',
    session_id: session.session_id,
    version: Number((await pool.query('SELECT version FROM cash_drawer_session WHERE session_id=$1', [session.session_id])).rows[0].version),
    external_reference: randomUUID(),
    evidence: 'actual cash received',
    occurred_at: new Date().toISOString()
  });
  const collectBody = async () => ({
    request_id: randomUUID(),
    employee_id: actor,
    amount: '1.00',
    reason: 'actual company repayment',
    allocation_policy: 'PRINCIPAL',
    funding: await cashProof(),
    allocations: [{
      loan_id: loans[0].loan_id,
      version: await loanVersion(loans[0].loan_id),
      amount: '1.00'
    }]
  });
  await tx(async c => loanService.collect(c, await collectBody(), actorUser));
  assert.equal((await pool.query('SELECT count(*)::int n FROM cash_drawer_movement WHERE session_id=$1', [session.session_id])).rows[0].n, 1);
  await pool.query("UPDATE cash_drawer_session SET count_window_expires_at=now()+interval '1 minute' WHERE session_id=$1", [session.session_id]);
  await assert.rejects(tx(async c => loanService.collect(c, await collectBody(), actorUser)), /paused for a count/);
  await pool.query("UPDATE cash_drawer_session SET count_window_expires_at=NULL,status='CLOSING' WHERE session_id=$1", [session.session_id]);
  await assert.rejects(tx(async c => loanService.collect(c, await collectBody(), actorUser)), /Session is CLOSING/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM cash_drawer_movement WHERE session_id=$1', [session.session_id])).rows[0].n, 1);
  const nowMonth = new Date().toISOString().slice(0, 7) + '-01';
  const arrearsLoan = await tx(c => loanService.create(c, {
    employee_id: actor,
    creditor: 'COMPANY',
    loan_type: 'OTHER',
    component_code: 'TEST_LOAN',
    principal_amount: '100.00',
    collectible_opening: '100.00',
    interest_fees: '0.00',
    monthly_installment: '2.01',
    schedule: 'SPLIT_HALF',
    effective_from: nowMonth,
    start_date: nowMonth,
    purpose: 'direct arrears fixture',
    authorization: 'signed test',
    evidence: 'test only'
  }, actorUser));
  await tx(c => loanService.activate(c, arrearsLoan.loan_id, {
    version: 1,
    reason: 'release verified',
    funding: proof()
  }, actorUser));
  const arrearsBody = async () => ({
    request_id: randomUUID(),
    employee_id: actor,
    amount: '1.01',
    reason: 'specific installment arrears repaid',
    allocation_policy: 'INSTALLMENT_ARREARS',
    funding: proof(),
    allocations: [{
      loan_id: arrearsLoan.loan_id,
      version: await loanVersion(arrearsLoan.loan_id),
      amount: '1.01',
      recovery_month: nowMonth,
      cutoff_seq: 1
    }]
  });
  const arrears = await tx(async c => loanService.collect(c, await arrearsBody(), actorUser));
  assert.equal((await pool.query('SELECT amount FROM employee_installment_consumed WHERE loan_id=$1', [arrearsLoan.loan_id])).rows[0].amount, '1.01');
  await assert.rejects(tx(async c => loanService.collect(c, await arrearsBody(), actorUser)), /exceeds the unpaid cutoff share/);
  const ap = (await pool.query('SELECT payment_id FROM employee_loan_payment WHERE collection_id=$1', [arrears.collection_id])).rows[0];
  await post('collection-refund', {
    payment_id: ap.payment_id,
    loan_version: await loanVersion(arrearsLoan.loan_id),
    funding: proof(),
    reason: 'verified collection refund',
    evidence: 'bank return'
  }, (c, b) => corrections.refundCollection(c, arrears.collection_id, b, actorUser));
  assert.equal((await pool.query('SELECT count(*)::int n FROM employee_installment_consumed WHERE loan_id=$1', [arrearsLoan.loan_id])).rows[0].n, 0);
  await pool.query("UPDATE cash_drawer_session SET status='OPEN' WHERE session_id=$1", [session.session_id]);
  const {
    rows: [reviewer]
  } = await pool.query("INSERT INTO employee(first_name,last_name,permission_level_id,username,password_hash,password_salt) VALUES('Cash','Reviewer',10,$1,'unused','unused') RETURNING employee_id", [randomUUID()]);
  const approvedCash = async amount => {
    const f = await cashProof();
    const {
      rows: [approval]
    } = await pool.query("INSERT INTO cash_approval(session_id,action,bound_version,bound_amount,reason,requester_id,reviewer_id,decision) VALUES($1,'MANUAL_RELEASE',$2,$3,'independent release test',$4,$5,'APPROVED') RETURNING approval_id", [session.session_id, f.version, amount, actor, reviewer.employee_id]);
    return {
      ...f,
      approval_id: approval.approval_id
    };
  };
  const cashLoan = await tx(c => loanService.create(c, {
    employee_id: actor,
    creditor: 'COMPANY',
    loan_type: 'OTHER',
    component_code: 'TEST_LOAN',
    principal_amount: '1.00',
    collectible_opening: '1.00',
    interest_fees: '0.00',
    monthly_installment: '1.00',
    schedule: 'FIRST_CUTOFF',
    effective_from: nowMonth,
    start_date: nowMonth,
    purpose: 'cash release test',
    authorization: 'signed',
    evidence: 'release evidence'
  }, actorUser));
  await assert.rejects(tx(async c => loanService.activate(c, cashLoan.loan_id, {
    version: 1,
    reason: 'release',
    funding: await cashProof()
  }, actorUser)), /independent amount-bound/);
  await tx(async c => loanService.activate(c, cashLoan.loan_id, {
    version: 1,
    reason: 'actual approved cash release',
    funding: await approvedCash('1.00')
  }, actorUser));
  await post('payout', {
    employee_id: actor,
    amount: '0.01',
    method: 'CASH',
    evidence: 'actual employee cash receipt',
    funding: await approvedCash('0.01'),
    allocations: [{
      payslip_id: agencySlip.payslip_id,
      version: await currentVersion(agencyRun.run_id),
      amount: '0.01'
    }]
  }, (c, b) => settlement.payout(c, b, actorUser));
  const {
    rows: [cashState]
  } = await pool.query('SELECT count(*)::int n,min(balance_after) balance FROM cash_drawer_movement WHERE session_id=$1', [session.session_id]);
  assert.equal(cashState.n, 3);
  assert.equal(cashState.balance, '999.99');
  const duplicateProof = (await pool.query('SELECT * FROM employee_finance_funding WHERE funding_id=$1', [activated.release_funding_id])).rows[0];
  await assert.rejects(post('payout-return', {
    version: await currentVersion(run.run_id),
    amount: '0.01',
    funding: {
      ...duplicateProof,
      confirmed: true,
      occurred_at: new Date(duplicateProof.occurred_at).toISOString()
    },
    reason: 'duplicate source test',
    evidence: 'duplicate'
  }, (c, b) => corrections.returnPayout(c, paidAllocation.payout_allocation_id, b, actorUser)), /duplicate key/);
  await pool.query("INSERT INTO settings(setting_key,setting_value) VALUES('PAYROLL_EXPENSE_CATEGORY_JOB_ORDER',$1) ON CONFLICT(setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value", [String(category.category_id)]);
  const movementCount = (await pool.query('SELECT count(*)::int n FROM cash_drawer_movement')).rows[0].n;
  await tx(c => require('../services/hr/payrollPostingService').postRunToExpense(c, {
    runId: zeroRun.run_id,
    postedBy: actor
  }));
  assert.equal((await pool.query('SELECT amount,payment_method_text FROM expense WHERE payroll_run_id=$1', [zeroRun.run_id])).rows[0].amount, '100.50');
  assert.equal((await pool.query('SELECT count(*)::int n FROM cash_drawer_movement')).rows[0].n, movementCount);
  const unexpectedRun=await makeRun('REGULAR',await dept());
  await pool.query("INSERT INTO expense(expense_date,category_id,amount,payee,payment_method_text,created_by,payroll_run_id) VALUES(current_date,$1,1,'Unexpected payroll fixture','Bank',$2,$3)",[category.category_id,actor,unexpectedRun.run_id]);
  await assert.rejects(tx(c=>runs.voidRun(c,{runId:unexpectedRun.run_id,userId:actor,reason:'wrong run'})),/Expense recognition/);
  await assert.rejects(pool.query("UPDATE payroll_run SET status='Voided' WHERE run_id=$1",[unexpectedRun.run_id]),/Expense recognition/);
  console.log('PASS stale-status integrity: unexpected recognized expense blocks ordinary unpaid cancellation');
  assert.ok((await pool.query('SELECT payment_method_text FROM expense WHERE payroll_run_id=$1', [zeroRun.run_id])).rows.every(e => e.payment_method_text === null));
  console.log('PASS expense recognition: gross entitlement plus explicit employer rounding, no duplicated funding movement');
  console.log('PASS cash funding: independent bound approval required, company release and actual salary payout each create one outflow; duplicate bank source rejected');
  console.log('PASS direct installments: exact arrears month/cutoff consumes the shared budget, excess rejected atomically, verified refund reopens the slot');
  console.log('PASS drawer: actual collection posts one receipt; count-pause and closing-session rejections roll back');
  console.log('PASS agency: partial/excess remittance, statement difference, reconciliation, protected Treasury source, agency-direct evidence without cash, returned remittance then exact recovery correction');
  console.log('PASS corrections: source-specific payout return, old/current residual payout once, collection refund restores debt');
  console.log('PASS zero-net recovery without funding, explicit employer-funded rounding remains payable');
  console.log('PASS operations: split centavos, draft release activation, hold/resume, future schedule, old-writer rejection, direct collection, no balance-erasing Complete');
  console.log('PASS foundation: exact same-component loans, paid void blocked, append-only history, unpaid audit retention, idempotency conflict/replay');
}
main().then(async () => {
  await pool.end();
  process.exit(0);
}).catch(async e => {
  console.error(e);
  await pool.end();
  process.exitCode = 1;
});
