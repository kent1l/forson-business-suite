'use strict';

require('dotenv').config({
  path: require('path').resolve(__dirname, '../../../.env')
});
const database = process.env.EMPLOYEE_FINANCE_TEST_DB;
if (!/^codex_employee_finance_verify_[a-z0-9_]+$/.test(database || '')) throw Error('Select a disposable schema-only EMPLOYEE_FINANCE_TEST_DB.');
const {
  Pool
} = require('pg');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database
});
async function main() {
  assert.equal((await pool.query("SELECT to_regclass('employee_loan_schedule') name")).rows[0].name, null, 'Start from a schema-only PRE-feature database.');
  await pool.query("INSERT INTO permission_level(permission_level_id,level_name) VALUES(10,'Admin') ON CONFLICT DO NOTHING");
  const {
    rows: [e]
  } = await pool.query("INSERT INTO employee(first_name,last_name,permission_level_id,username,password_hash,password_salt) VALUES('Legacy','Fixture',10,'legacy-fixture','unused','unused') RETURNING employee_id");
  await pool.query("INSERT INTO pay_component(component_code,component_name,component_type) VALUES('LEGACY_LOAN','Legacy loan','DEDUCTION')");
  for (const [cutoff, amount] of [[1, '100.01'], [2, '200.02']]) await pool.query("INSERT INTO employee_loan(employee_id,loan_type,component_code,principal_amount,amortization_amount,start_date,deduct_on_cutoff) VALUES($1,'OTHER','LEGACY_LOAN',1000,$2,'2026-01-01',$3)", [e.employee_id, amount, cutoff]);
  const {
    rows: [r]
  } = await pool.query("INSERT INTO payroll_run(run_no,period_start,period_end,pay_date,created_by) VALUES('LEGACY-PAID','2026-01-01','2026-01-15','2026-01-15',$1) RETURNING run_id", [e.employee_id]);
  const {
    rows: [p]
  } = await pool.query("INSERT INTO payroll_payslip(run_id,employee_id,payslip_no,employee_code,employee_name,pay_basis,daily_rate,monthly_basis,gross_pay,net_pay) VALUES($1,$2,'LEGACY-SLIP','LEGACY','Legacy Fixture','monthly',100,200,99.99,99.99) RETURNING payslip_id", [r.run_id, e.employee_id]);
  const originalLoan=(await pool.query('SELECT loan_id FROM employee_loan WHERE deduct_on_cutoff=1')).rows[0];
  const originalPayment=(await pool.query('INSERT INTO employee_loan_payment(loan_id,payslip_id,amount) VALUES($1,$2,100) RETURNING payment_id',[originalLoan.loan_id,p.payslip_id])).rows[0];
  await pool.query('UPDATE payroll_payslip SET gross_pay=199.99,total_deductions=100,loans_total=100 WHERE payslip_id=$1',[p.payslip_id]);
  for (const status of ['Computed', 'Approved', 'Paid', 'Posted']) await pool.query('UPDATE payroll_run SET status=$2 WHERE run_id=$1', [r.run_id, status]);
  const migrationDir = [path.resolve(__dirname, '../../../database/migrations'), '/database/migrations'].find(d => fs.existsSync(d));
  const files = fs.readdirSync(migrationDir).filter(f => /^20261015_0[1-7]_.*\.sql$/.test(f)).sort();
  assert.equal(files.length, 7);
  const c = await pool.connect();
  try {
    for (const f of files) await c.query(fs.readFileSync(path.join(migrationDir, f), 'utf8'));
  } finally {
    c.release();
  }
  const terms = (await pool.query('SELECT schedule,monthly_installment FROM employee_loan_schedule ORDER BY loan_id')).rows;
  assert.deepEqual(terms, [{
    schedule: 'FIRST_CUTOFF',
    monthly_installment: '100.01'
  }, {
    schedule: 'SECOND_CUTOFF',
    monthly_installment: '200.02'
  }]);
  assert.equal((await pool.query('SELECT net_pay FROM payroll_payslip WHERE payslip_id=$1', [p.payslip_id])).rows[0].net_pay, '99.99');
  const assertion = (await pool.query('SELECT * FROM payroll_legacy_settlement WHERE payslip_id=$1', [p.payslip_id])).rows[0];
  assert.equal(assertion.asserted_net, '99.99');
  assert.match(assertion.provenance, /unknown/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM cash_drawer_movement')).rows[0].n, 0);
  assert.equal((await pool.query('SELECT count(*)::int n FROM employee_finance_funding')).rows[0].n, 0);
  await assert.rejects(pool.query("UPDATE payroll_run SET status='Voided' WHERE run_id=$1", [r.run_id]), /cannot move/);
  const corrections=require('../services/hr/employeeFinanceCorrectionService');const settlement=require('../services/hr/employeeSettlementService');const recovery=require('../services/hr/employeeRecoveryService');const {randomUUID}=require('node:crypto');
  const actor={employee_id:e.employee_id,permission_level_id:10};
  const client=await pool.connect();try {
   await client.query('BEGIN');
   await corrections.reverseRecovery(client,originalPayment.payment_id,{run_version:1,loan_version:1,reason:'verified legacy recovery error',evidence:'source-specific approved correction'},actor);
   const version=(await client.query('SELECT version FROM payroll_run WHERE run_id=$1',[r.run_id])).rows[0].version;
   const bank=(await client.query("INSERT INTO bank_account(account_name,bank_name) VALUES('Legacy correction fixture','Test bank') RETURNING bank_account_id")).rows[0];
   const request_id=randomUUID();const body={request_id,employee_id:e.employee_id,amount:'100.00',method:'BANK',evidence:'verified new correction transfer',funding:{method:'BANK',bank_account_id:bank.bank_account_id,external_reference:randomUUID(),confirmed:true,evidence:'new bank evidence',occurred_at:new Date().toISOString()},allocations:[{payslip_id:p.payslip_id,version,amount:'100.00'}]};
   await recovery.request(client,{requestId:request_id,actorId:e.employee_id,operation:'legacy-correction-payout',payload:body},()=>settlement.payout(client,body,actor));
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  const corrected=(await settlement.payable(pool,e.employee_id))[0];assert.equal(corrected.remaining_payable,'0.00');assert.equal(corrected.actual_paid,'100.00');assert.equal(corrected.legacy_asserted_paid,'99.99');assert.equal((await pool.query('SELECT net_pay FROM payroll_payslip WHERE payslip_id=$1',[p.payslip_id])).rows[0].net_pay,'99.99');
  console.log('PASS verified legacy recovery correction: original Posted payslip/assertion retained, debt restored, additional wages paid from new bank evidence only');
  console.log('PASS seven-migration legacy rehearsal: cutoff 1/2 amounts unchanged, frozen Posted payslip preserved, provenance-only settlement assertion, zero invented cash/funding, paid void blocked.');
}
main().then(() => pool.end()).catch(async e => {
  console.error(e);
  await pool.end();
  process.exitCode = 1;
});
