'use strict';
// Explicit opt-in only. Never point fixture-writing tests at a business DB.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env') });
if (!/^codex_employee_finance_verify_[a-z0-9_]+$/.test(process.env.EMPLOYEE_FINANCE_TEST_DB || '')) throw new Error('Select a disposable EMPLOYEE_FINANCE_TEST_DB.');
process.env.DB_NAME = process.env.EMPLOYEE_FINANCE_TEST_DB;
const { Pool } = require('pg');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const recovery = require('../services/hr/employeeRecoveryService');
const loanService = require('../services/hr/employeeLoanService');
const runs = require('../services/hr/payrollRunService');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
async function tx(fn) {
 const c = await pool.connect();
 try { await c.query('BEGIN'); const result=await fn(c); await c.query('COMMIT'); return result; }
 catch(e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}
async function main() {
 const tag=randomUUID().slice(0,8);
 await pool.query("INSERT INTO permission_level(permission_level_id,level_name) VALUES(10,'Admin') ON CONFLICT DO NOTHING");
 const {rows:[employee]}=await pool.query(`INSERT INTO employee(first_name,last_name,permission_level_id,username,password_hash,password_salt) VALUES('Finance','Test',10,$1,'unused','unused') RETURNING employee_id`,[`finance_${tag}`]);
 const actor=employee.employee_id;
 await pool.query("INSERT INTO pay_component(component_code,component_name,component_type) VALUES('TEST_LOAN','Test loan','DEDUCTION') ON CONFLICT DO NOTHING");
 const {rows:[period]}=await pool.query("INSERT INTO pay_period(period_year,period_month,period_seq,period_start,period_end,pay_date) VALUES(2200+$1,1,1,make_date(2200+$1,1,1),make_date(2200+$1,1,15),make_date(2200+$1,1,15)) RETURNING pay_period_id",[actor]);
 const makeRun=async(type='REGULAR')=>(await pool.query(`INSERT INTO payroll_run(run_no,run_type,pay_period_id,period_start,period_end,pay_date,created_by) VALUES($1,$2,$3,'2090-01-01','2090-01-15','2090-01-15',$4) RETURNING *`,[tag+randomUUID().slice(0,8),type,period.pay_period_id,actor])).rows[0];
 const makeSlip=async(run, loanTotal='20.00')=>(await pool.query(`INSERT INTO payroll_payslip(run_id,employee_id,payslip_no,employee_code,employee_name,pay_basis,daily_rate,monthly_basis,gross_pay,loans_total,total_deductions,net_pay) VALUES($1,$2,$3,'FIN','Finance Test','monthly',100,200,100,$4,$4,100-$4::numeric) RETURNING *`,[run.run_id,actor,randomUUID(),loanTotal])).rows[0];
 const loans=[];
 for(let i=0;i<2;i++) loans.push((await pool.query(`INSERT INTO employee_loan(employee_id,loan_type,component_code,principal_amount,amortization_amount,start_date) VALUES($1,'OTHER','TEST_LOAN',100,10,'2089-01-01') RETURNING *`,[actor])).rows[0]);
 for(const loan of loans) {const {rows:[terms]}=await pool.query("INSERT INTO employee_loan_schedule(loan_id,schedule,monthly_installment,effective_from,version,deduction_authority,reason) VALUES($1,'FIRST_CUTOFF',10,'2089-01-01',1,'test authority','test') RETURNING *",[loan.loan_id]);Object.assign(loan,{schedule_id:terms.schedule_id,schedule_version:1,scheduled_share:'10.00'});}
 const run=await makeRun(); const slip=await makeSlip(run);
 await tx(async c=>{await recovery.persist(c,{payslipId:slip.payslip_id,employeeId:actor,periodId:period.pay_period_id,run:{period_end:'2090-01-15'},cutoffSeq:1,deductions:loans.map(l=>({loanId:l.loan_id,amount:'10.00'})),loans});await c.query("UPDATE payroll_run SET status='Computed' WHERE run_id=$1",[run.run_id]); await runs.approveRun(c,{runId:run.run_id,approvedBy:actor});});
 await assert.rejects(tx(c=>loanService.collect(c,{employee_id:actor,amount:'1.00',reason:'reserved test',allocation_policy:'PRINCIPAL',allocations:[{loan_id:loans[0].loan_id,version:1,amount:'1.00'}]}, {employee_id:actor})),/Release and recompute/);
 await tx(c=>runs.markPaid(c,{runId:run.run_id,paidBy:actor}));
 assert.deepEqual((await pool.query('SELECT amount_paid FROM employee_loan WHERE loan_id=ANY($1::bigint[]) ORDER BY loan_id',[loans.map(l=>l.loan_id)])).rows.map(l=>l.amount_paid),['10.00','10.00']);
 await assert.rejects(tx(c=>runs.voidRun(c,{runId:run.run_id,userId:actor,reason:'test'})),/cannot move/);
 await assert.rejects(pool.query('DELETE FROM employee_loan_payment WHERE payslip_id=$1',[slip.payslip_id]),/append-only/);
 const unpaid=await makeRun('SPECIAL'); await makeSlip(unpaid,'0.00');
 await tx(c=>runs.voidRun(c,{runId:unpaid.run_id,userId:actor,reason:'wrong run'}));
 assert.equal((await pool.query('SELECT count(*)::int n FROM payroll_payslip WHERE run_id=$1',[unpaid.run_id])).rows[0].n,1);
 const key=randomUUID();const input={requestId:key,actorId:actor,operation:'test',payload:{a:1}};
 await tx(c=>recovery.request(c,input,async()=>({amount:'1.00'})));
 assert.equal((await tx(c=>recovery.request(c,input,async()=>{throw new Error('must not rerun');}))).replay,true);
 await assert.rejects(tx(c=>recovery.request(c,{...input,payload:{a:2}},async()=>({}))),/different details/);
 const {rows:[bank]}=await pool.query("INSERT INTO bank_account(account_name,bank_name) VALUES('Finance test','Test bank') RETURNING *");
 const actorUser={employee_id:actor,permission_level_id:10};
 const proof=()=>({method:'BANK',bank_account_id:bank.bank_account_id,external_reference:randomUUID(),confirmed:true,evidence:'verified test statement',occurred_at:new Date().toISOString()});
 const draft=await tx(c=>loanService.create(c,{employee_id:actor,creditor:'COMPANY',loan_type:'CASH_ADVANCE',component_code:'TEST_LOAN',principal_amount:'100.00',collectible_opening:'100.00',interest_fees:'0.00',monthly_installment:'10.01',schedule:'SPLIT_HALF',effective_from:'2090-01-01',start_date:'2090-01-10',purpose:'test vale',authorization:'signed deduction consent',evidence:'signed agreement'},actorUser));
 assert.deepEqual(draft.preview,{first_cutoff:'5.01',second_cutoff:'5.00'});
 const activated=await tx(c=>loanService.activate(c,draft.loan_id,{version:1,reason:'release approved',funding:proof()},actorUser));
 assert.equal(activated.status,'Active');
 const held=await tx(c=>loanService.hold(c,draft.loan_id,{version:activated.version,reason:'test hold'},actorUser));
 const resumed=await tx(c=>loanService.hold(c,draft.loan_id,{version:held.version,reason:'test resume'},actorUser,true));
 assert.equal(resumed.amount_paid,'0.00');
 await tx(c=>loanService.changeSchedule(c,draft.loan_id,{version:resumed.version,reason:'new agreed terms',authorization:'signed revised terms',monthly_installment:'12.03',schedule:'FIRST_CUTOFF',effective_from:'2090-02-01'},actorUser));
 await assert.rejects(pool.query("UPDATE employee_loan SET deduct_on_cutoff=2 WHERE loan_id=$1",[draft.loan_id]),/effective-dated/);
 const updated=(await pool.query('SELECT * FROM employee_loan WHERE loan_id=$1',[draft.loan_id])).rows[0];
 const received=await tx(c=>loanService.collect(c,{request_id:randomUUID(),employee_id:actor,amount:'1.01',allocation_policy:'PRINCIPAL',reason:'direct bank repayment',funding:proof(),allocations:[{loan_id:draft.loan_id,version:updated.version,amount:'1.01'}]},actorUser));
 assert.equal(received.amount,'1.01');
 await assert.rejects(pool.query("UPDATE employee_loan SET status='Completed' WHERE loan_id=$1",[draft.loan_id]),/cannot be erased/);
 console.log('PASS operations: split centavos, draft release activation, hold/resume, future schedule, old-writer rejection, direct collection, no balance-erasing Complete');
 console.log('PASS foundation: exact same-component loans, paid void blocked, append-only history, unpaid audit retention, idempotency conflict/replay');
}
main().then(()=>pool.end()).catch(async e=>{console.error(e);await pool.end();process.exitCode=1;});
