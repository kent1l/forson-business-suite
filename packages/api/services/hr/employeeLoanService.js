'use strict';
const {cents,money,fail,validText}=require('./employeeRecoveryService');
const schedule=require('./loanSchedule');
const fundingService=require('./employeeFundingService');
function month(value) { if(!/^\d{4}-(0[1-9]|1[0-2])-01$/.test(value||'')) fail(400,'INVALID_MONTH','Use the first day of the recovery month (YYYY-MM-01).');return value; }
async function lock(client,id,version) {
 const {rows:[loan]}=await client.query('SELECT * FROM employee_loan WHERE loan_id=$1 FOR UPDATE',[id]);
 if(!loan) fail(404,'LOAN_NOT_FOUND','Loan not found.');
 if(!Number.isInteger(version) || loan.version!==version) fail(409,'STALE_VERSION','Loan changed. Refresh and retry with its current version.');
 return loan;
}
async function activity(client,id,action,reason,actor,version) {
 await client.query('INSERT INTO employee_loan_activity(loan_id,action,reason,actor_id,version) VALUES($1,$2,$3,$4,$5)',[id,action,validText(reason,2000,true),actor,version]);
}
async function create(client,input,actor) {
 const principal=money(cents(input.principal_amount,{positive:true}));
 const collectible=money(cents(input.collectible_opening,{positive:true}));
 const fees=money(cents(input.interest_fees));
 if(cents(principal)+cents(fees)!==cents(collectible)) fail(422,'TERMS_MISMATCH','Original principal plus explicitly agreed interest/fees must equal collectible opening.');
 const creditor=input.creditor;const types={COMPANY:['CASH_ADVANCE','OTHER'],SSS:['SSS_SALARY','SSS_CALAMITY'],PAGIBIG:['HDMF_MPL','HDMF_CALAMITY']};
 if(!types[creditor]?.includes(input.loan_type)) fail(400,'INVALID_CREDITOR_TYPE','Loan type does not belong to the creditor.');
 const monthly=money(cents(input.monthly_installment,{positive:true}));const preview=schedule.preview(monthly,input.schedule);
 const effective=month(input.effective_from);
 if(!/^\d{4}-\d{2}-\d{2}$/.test(input.start_date||'') || input.start_date.slice(0,7)<effective.slice(0,7)) fail(400,'INVALID_START','Start date must be in or after the schedule start month.');
 const code=input.component_code || ({COMPANY:'CASH_ADVANCE',SSS:'SSS_LOAN',PAGIBIG:'HDMF_LOAN'})[creditor];
 const {rows:[component]}=await client.query("SELECT component_type FROM pay_component WHERE component_code=$1 AND is_active",[code]);
 if(component?.component_type!=='DEDUCTION') fail(400,'INVALID_COMPONENT','Choose an active deduction component.');
 const authorization=validText(input.authorization,2000,true);const evidence=validText(input.evidence,2000,true);
 const {rows:[loan]}=await client.query(`INSERT INTO employee_loan(employee_id,loan_type,component_code,reference_no,principal_amount,amortization_amount,start_date,deduct_on_cutoff,status,creditor,activation_state,purpose,deduction_authority,evidence,collectible_opening,interest_fees,original_principal,notes,created_by)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,'On Hold',$9,'DRAFT',$10,$11,$12,$5,$13,$16,$14,$15) RETURNING *`,[input.employee_id,input.loan_type,code,validText(input.reference_no,50),collectible,monthly,input.start_date,input.schedule==='FIRST_CUTOFF'?1:2,creditor,validText(input.purpose,2000,true),authorization,evidence,fees,`Original principal: ${principal}`,actor.employee_id,principal]);
 await client.query(`INSERT INTO employee_loan_schedule(loan_id,schedule,monthly_installment,effective_from,version,deduction_authority,reason,created_by) VALUES($1,$2,$3,$4,1,$5,'Initial agreed terms',$6)`,[loan.loan_id,input.schedule,monthly,effective,authorization,actor.employee_id]);
 await activity(client,loan.loan_id,'DRAFT','Initial agreed terms',actor.employee_id,1);
 return {...loan,original_principal:principal,preview};
}
async function activate(client,id,input,actor) {
 const loan=await lock(client,id,input.version);
 if(loan.activation_state!=='DRAFT') fail(409,'LOAN_STATE','Only a draft can be activated.');
 const reason=validText(input.reason,2000,true);
 let funding=null;
 if(loan.creditor==='COMPANY') funding=await fundingService.record(client,{funding:input.funding,amount:loan.collectible_opening && money(cents(loan.collectible_opening)-cents(loan.interest_fees||'0.00')),direction:'OUT',ownerKey:`loan:${id}`,actor});
 else validText(input.enrollment_evidence,2000,true);
 const {rows:[updated]}=await client.query(`UPDATE employee_loan SET activation_state='ACTIVE',status='Active',activated_by=$2,activated_at=now(),release_funding_id=$3,evidence=evidence || E'\n' || $4,version=version+1 WHERE loan_id=$1 RETURNING *`,[id,actor.employee_id,funding?.funding_id||null,input.enrollment_evidence||reason]);
 await activity(client,id,'ACTIVATE',reason,actor.employee_id,updated.version);return updated;
}
async function changeSchedule(client,id,input,actor) {
 const loan=await lock(client,id,input.version); const effective=month(input.effective_from);
 const reason=validText(input.reason,2000,true); const authorization=validText(input.authorization,2000,true);
 const monthly=money(cents(input.monthly_installment,{positive:true})); const preview=schedule.preview(monthly,input.schedule);
 const {rows:[latest]}=await client.query(`SELECT *,to_char(effective_from,'YYYY-MM-DD') AS month FROM employee_loan_schedule WHERE loan_id=$1 ORDER BY effective_from DESC LIMIT 1`,[id]);
 if(effective<=latest.month) fail(409,'FUTURE_SCHEDULE_REQUIRED','New terms must follow the latest schedule start.');
 const {rows:[frozen]}=await client.query(`SELECT to_char(max(recovery_month),'YYYY-MM-DD') AS recovery_month FROM payroll_deduction_allocation WHERE loan_id=$1 AND status IN ('RESERVED','RECOVERED')`,[id]);
 if(frozen.recovery_month && effective<=frozen.recovery_month) fail(409,'FROZEN_MONTH','Approved payroll exists. Change the next recovery month or release and recompute unpaid payroll.');
 await client.query('UPDATE employee_loan_schedule SET effective_to=$2 WHERE schedule_id=$1',[latest.schedule_id,effective]);
 const {rows:[terms]}=await client.query(`INSERT INTO employee_loan_schedule(loan_id,schedule,monthly_installment,effective_from,version,deduction_authority,reason,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[id,input.schedule,monthly,effective,latest.version+1,authorization,reason,actor.employee_id]);
 await client.query("SET LOCAL app.loan_schedule_sync='on'");
 await client.query('UPDATE employee_loan SET amortization_amount=$2,deduct_on_cutoff=$3,version=version+1,modified_by=$4 WHERE loan_id=$1',[id,monthly,input.schedule==='FIRST_CUTOFF'?1:2,actor.employee_id]);
 await activity(client,id,'SCHEDULE',reason,actor.employee_id,loan.version+1); return {...terms,loan_version:loan.version+1,preview};
}
async function hold(client,id,input,actor,resume=false) {
 const loan=await lock(client,id,input.version);
 if(loan.activation_state==='DRAFT' || loan.status!==(resume?'On Hold':'Active')) fail(409,'LOAN_STATE','Loan is not in the required operational state.');
 const {rows:[updated]}=await client.query('UPDATE employee_loan SET status=$2,version=version+1,modified_by=$3 WHERE loan_id=$1 RETURNING *',[id,resume?'Active':'On Hold',actor.employee_id]);
 await activity(client,id,resume?'RESUME':'HOLD',input.reason,actor.employee_id,updated.version);return updated;
}
async function collect(client,input,actor) {
 const amount=money(cents(input.amount,{positive:true}));const reason=validText(input.reason,2000,true);
 if(!['PRINCIPAL','INSTALLMENT_ARREARS'].includes(input.allocation_policy)) fail(400,'ALLOCATION_POLICY_REQUIRED','Select principal or installment arrears.');
 if(!Array.isArray(input.allocations)||!input.allocations.length) fail(400,'ALLOCATIONS_REQUIRED','Select exact loans.');
 const ids=input.allocations.map(a=>String(a.loan_id));if(new Set(ids).size!==ids.length) fail(400,'DUPLICATE_TARGET','Each loan may appear once.');
 const {rows:loans}=await client.query('SELECT * FROM employee_loan WHERE loan_id=ANY($1::bigint[]) ORDER BY loan_id FOR UPDATE',[ids]);
 let total=0n;
 for(const a of input.allocations) {
  const loan=loans.find(l=>String(l.loan_id)===String(a.loan_id));const value=cents(a.amount,{positive:true});total+=value;
  if(!loan || Number(loan.employee_id)!==Number(input.employee_id) || loan.creditor!=='COMPANY' || loan.activation_state==='DRAFT') fail(422,'CREDITOR_BOUNDARY','Only activated company debt of this employee can use company collections.');
  if(loan.version!==a.version) fail(409,'STALE_VERSION','Loan changed. Refresh.');
  if(value>cents(loan.principal_amount)-cents(loan.amount_paid)) fail(422,'OVER_COLLECTION','Collection exceeds debt. Overpayments are not accepted.');
  if((await client.query("SELECT 1 FROM payroll_deduction_allocation WHERE loan_id=$1 AND status='RESERVED'",[loan.loan_id])).rowCount) fail(409,'PAYROLL_RESERVED','Release and recompute affected unpaid payroll before direct collection.');
 }
 if(total!==cents(amount)) fail(422,'ALLOCATION_TOTAL','Allocations must equal the actual receipt.');
 const funding=await fundingService.record(client,{funding:input.funding,amount,direction:'IN',ownerKey:`collection:${input.request_id}`,actor});
 const {rows:[doc]}=await client.query('INSERT INTO employee_collection(employee_id,amount,funding_id,allocation_policy,reason,actor_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',[input.employee_id,amount,funding.funding_id,input.allocation_policy,reason,actor.employee_id]);
 for(const a of input.allocations) {await client.query('INSERT INTO employee_loan_payment(loan_id,amount,collection_id,actor_id,source_key,reason,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7)',[a.loan_id,a.amount,doc.collection_id,actor.employee_id,`collection:${doc.collection_id}:${a.loan_id}`,reason,funding.occurred_at]);await client.query('UPDATE employee_loan SET version=version+1 WHERE loan_id=$1',[a.loan_id]);}
 return {...doc,allocations:input.allocations};
}
module.exports={create,activate,changeSchedule,hold,collect,lock,month};
