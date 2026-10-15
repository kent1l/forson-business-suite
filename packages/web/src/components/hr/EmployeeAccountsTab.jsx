import { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';

const fieldClass='w-full rounded border border-gray-300 bg-transparent p-2 dark:border-slate-600';
const peso=value=>`₱${String(value??'0.00')}`;
export function FinanceField({label,children}) {return <label className="block text-sm space-y-1"><span>{label}</span>{children}</label>;}
export function FundingFields({value,onChange,banks=[]}) {
 const set=(key,v)=>onChange({...value,[key]:v});
 return <fieldset className="space-y-2 border rounded p-3"><legend>Actual funding evidence</legend>
  <FinanceField label="Method"><select className={fieldClass} value={value.method} onChange={e=>set('method',e.target.value)}><option value="BANK">Bank</option><option value="CASH">Cash drawer</option></select></FinanceField>
  {value.method==='BANK'?<><FinanceField label="Company bank account"><select required className={fieldClass} value={value.bank_account_id||''} onChange={e=>set('bank_account_id',e.target.value)}><option value="">Select account</option>{banks.map(b=><option key={b.bank_account_id} value={b.bank_account_id}>{b.account_name} — {b.bank_name}</option>)}</select></FinanceField><label className="flex gap-2"><input type="checkbox" checked={value.confirmed||false} onChange={e=>set('confirmed',e.target.checked)}/>Confirmed from bank evidence</label></>:<><FinanceField label="Open drawer session ID"><input required className={fieldClass} value={value.session_id||''} onChange={e=>set('session_id',e.target.value)}/></FinanceField><FinanceField label="Drawer version"><input required type="number" className={fieldClass} value={value.version??''} onChange={e=>set('version',Number(e.target.value))}/></FinanceField><FinanceField label="Independent release approval ID (outflows)"><input className={fieldClass} value={value.approval_id||''} onChange={e=>set('approval_id',e.target.value)}/></FinanceField></>}
  <FinanceField label="Bank / receipt reference"><input required className={fieldClass} value={value.external_reference||''} onChange={e=>set('external_reference',e.target.value)}/></FinanceField>
  <FinanceField label="Evidence reference"><input required className={fieldClass} value={value.evidence||''} onChange={e=>set('evidence',e.target.value)}/></FinanceField>
  <FinanceField label="Actual occurrence time"><input required type="datetime-local" className={fieldClass} value={value.local_time||''} onChange={e=>onChange({...value,local_time:e.target.value,occurred_at:e.target.value?new Date(e.target.value).toISOString():null})}/></FinanceField>
  {value.method==='CASH'&&<FinanceField label="Late posting reason (if before session opened)"><input className={fieldClass} value={value.late_reason||''} onChange={e=>set('late_reason',e.target.value)}/></FinanceField>}
 </fieldset>;
}
export function FinanceCommand({scope,endpoint,body,onDone,children,label='Save',disabled=false}) {
 const {user}=useAuth();const key=`employee-finance:${user?.employee_id}:${scope}`;
 const [pending,setPending]=useState(()=>{try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}});
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useEffect(()=>{try{setPending(JSON.parse(sessionStorage.getItem(key)||'null'));}catch{setPending(null);}setError('');},[key]);
 const send=async event=>{event?.preventDefault();if(busy)return;setBusy(true);setError('');
  const request=pending||{endpoint,body:{...body,request_id:crypto.randomUUID()}};
  sessionStorage.setItem(key,JSON.stringify(request));setPending(request);
  try{await api.post(request.endpoint,request.body);sessionStorage.removeItem(key);setPending(null);onDone?.();}
  catch(e){if(e.response){sessionStorage.removeItem(key);setPending(null);}setError(e.response?.data?.message||'Outcome unknown. Retry the same request to reconcile; do not create a replacement.');}finally{setBusy(false);}
 };
 return <form onSubmit={send} className="space-y-3"><fieldset disabled={busy||Boolean(pending)} className="space-y-3">{children}</fieldset>{error&&<p role="alert" className="text-red-600">{error}</p>}{pending&&<p role="status">A request is awaiting reconciliation. Retry preserves the original details.</p>}<button type="submit" disabled={busy||disabled} className="rounded bg-primary-600 px-4 py-2 text-white disabled:opacity-50">{busy?'Saving…':pending?'Reconcile same request':label}</button></form>;
}
const initialTerms={creditor:'COMPANY',loan_type:'CASH_ADVANCE',principal_amount:'',collectible_opening:'',interest_fees:'0.00',monthly_installment:'',schedule:'SECOND_CUTOFF',effective_from:'',start_date:'',purpose:'',authorization:'',evidence:'',reference_no:''};
function TermsFields({value,onChange,initial=false}) {
 const set=(key,v)=>onChange({...value,[key]:v});
 let preview=null; if(/^\d+(\.\d{1,2})?$/.test(value.monthly_installment)) {const [whole,f='']=value.monthly_installment.split('.');const n=BigInt(whole)*100n+BigInt(f.padEnd(2,'0'));const fmt=x=>`${x/100n}.${String(x%100n).padStart(2,'0')}`;const first=value.schedule==='FIRST_CUTOFF'?n:value.schedule==='SECOND_CUTOFF'?0n:(n+1n)/2n;preview=`First cutoff ${peso(fmt(first))}; second cutoff ${peso(fmt(n-first))}`;}
 return <>
 {initial&&<><FinanceField label="Creditor"><select className={fieldClass} value={value.creditor} onChange={e=>onChange({...value,creditor:e.target.value,loan_type:{COMPANY:'CASH_ADVANCE',SSS:'SSS_SALARY',PAGIBIG:'HDMF_MPL'}[e.target.value]})}>{['COMPANY','SSS','PAGIBIG'].map(v=><option key={v}>{v}</option>)}</select></FinanceField><FinanceField label="Loan type"><select className={fieldClass} value={value.loan_type} onChange={e=>set('loan_type',e.target.value)}>{({COMPANY:['CASH_ADVANCE','OTHER'],SSS:['SSS_SALARY','SSS_CALAMITY'],PAGIBIG:['HDMF_MPL','HDMF_CALAMITY']})[value.creditor].map(v=><option key={v}>{v}</option>)}</select></FinanceField>
 {['principal_amount','interest_fees','collectible_opening'].map(k=><FinanceField key={k} label={{principal_amount:'Original principal',interest_fees:'Explicit agreed interest / fees',collectible_opening:'Total collectible opening'}[k]}><input required inputMode="decimal" className={fieldClass} value={value[k]} onChange={e=>set(k,e.target.value)}/></FinanceField>)}
 <FinanceField label="Recovery eligibility start date"><input required type="date" className={fieldClass} value={value.start_date} onChange={e=>set('start_date',e.target.value)}/></FinanceField>
 {['reference_no','purpose','evidence'].map(k=><FinanceField key={k} label={{reference_no:'Loan reference',purpose:'Purpose',evidence:'Agreement / enrollment evidence'}[k]}><input required className={fieldClass} value={value[k]} onChange={e=>set(k,e.target.value)}/></FinanceField>)}</>}
 <FinanceField label="Monthly installment amount"><input required inputMode="decimal" className={fieldClass} value={value.monthly_installment} onChange={e=>set('monthly_installment',e.target.value)}/></FinanceField>
 <FinanceField label="Deduct on"><select className={fieldClass} value={value.schedule} onChange={e=>set('schedule',e.target.value)}><option value="FIRST_CUTOFF">1st cutoff</option><option value="SECOND_CUTOFF">2nd cutoff</option><option value="SPLIT_HALF">Split monthly amount across both cutoffs</option></select></FinanceField>
 {preview&&<p className="text-sm tabular-nums" role="status">{preview}. No automatic catch-up on mid-month start.</p>}
 <FinanceField label="Effective recovery month"><input required type="month" className={fieldClass} value={value.effective_from?.slice(0,7)||''} onChange={e=>set('effective_from',`${e.target.value}-01`)}/></FinanceField>
 <FinanceField label="Deduction authorization"><input required className={fieldClass} value={value.authorization} onChange={e=>set('authorization',e.target.value)}/></FinanceField>
 </>;
}
function LoanAction({loan,employeeId,banks,onDone}) {
 const {hasPermission}=useAuth();const [action,setAction]=useState('');const [reason,setReason]=useState('');const [enrollment,setEnrollment]=useState('');const [funding,setFunding]=useState({method:'BANK'});const [terms,setTerms]=useState({...initialTerms});const [amount,setAmount]=useState('');const [policy,setPolicy]=useState('PRINCIPAL');
 let endpoint=`/hr/loans/${loan.loan_id}/${action}`;let body={version:loan.version,reason};
 if(action==='activate')body={...body,enrollment_evidence:enrollment,funding};
 if(action==='schedule-changes')body={...body,...terms};
 if(action==='collect'){endpoint='/hr/employee-collections';body={employee_id:employeeId,amount,reason,allocation_policy:policy,funding,allocations:[{loan_id:loan.loan_id,version:loan.version,amount}]};}
 return <div className="space-y-3"><div className="flex flex-wrap gap-3">
 {hasPermission('employee_finance:approve')&&loan.activation_state==='DRAFT'&&<button onClick={()=>setAction('activate')}>Approve & activate</button>}
 {hasPermission('employee_finance:manage')&&<><button onClick={()=>setAction('schedule-changes')}>Future schedule</button>{loan.activation_state!=='DRAFT'&&['Active','On Hold'].includes(loan.status)&&<button onClick={()=>setAction(loan.status==='Active'?'hold':'resume')}>{loan.status==='Active'?'Hold':'Resume'}</button>}</>}
 {hasPermission('employee_finance:collect')&&loan.creditor==='COMPANY'&&loan.activation_state!=='DRAFT'&&<button onClick={()=>setAction('collect')}>Direct repayment</button>}
 </div>{action&&<FinanceCommand scope={`${employeeId}:${loan.loan_id}:${action}`} endpoint={endpoint} body={body} onDone={()=>{setAction('');onDone();}} label={action==='activate'?'Approve and activate':'Confirm'}>
 <p>{action} — loan {loan.loan_id}</p>
 {action==='schedule-changes'&&<TermsFields value={terms} onChange={setTerms}/>}
 {action==='activate'&&loan.creditor!=='COMPANY'&&<FinanceField label="Verified agency enrollment evidence"><input required className={fieldClass} value={enrollment} onChange={e=>setEnrollment(e.target.value)}/></FinanceField>}
 {action==='collect'&&<><FinanceField label="Actual receipt amount"><input required className={fieldClass} value={amount} onChange={e=>setAmount(e.target.value)}/></FinanceField><FinanceField label="Allocation policy"><select className={fieldClass} value={policy} onChange={e=>setPolicy(e.target.value)}><option value="PRINCIPAL">Reduce principal outstanding</option><option value="INSTALLMENT_ARREARS">Apply to installment arrears</option></select></FinanceField></>}
 {(action==='collect'||(action==='activate'&&loan.creditor==='COMPANY'))&&<FundingFields value={funding} onChange={setFunding} banks={banks}/>}
 <FinanceField label="Reason"><input required className={fieldClass} value={reason} onChange={e=>setReason(e.target.value)}/></FinanceField>
 </FinanceCommand>}</div>;
}
export default function EmployeeAccountsTab({employeeId}) {
 const {user,hasPermission}=useAuth();const [loans,setLoans]=useState(null);const [banks,setBanks]=useState([]);const [error,setError]=useState('');const [create,setCreate]=useState(false);const [terms,setTerms]=useState(initialTerms);
 const load=useCallback(async()=>{setError('');try{const [l,b]=await Promise.all([api.get(`/hr/employees/${employeeId}/loans`),api.get('/hr/employee-finance/bank-accounts')]);setLoans(l.data);setBanks(b.data);}catch(e){setError(e.response?.data?.message||'Employee accounts could not load.');}},[employeeId]);
 useEffect(()=>{setLoans(null);setCreate(false);setTerms(initialTerms);load();},[load,user?.employee_id]);
 if(!hasPermission('employee_finance:view'))return <p role="alert">Financial access required.</p>;
 return <div className="space-y-4 p-4"><h2 className="font-semibold">Employee Accounts</h2>{error&&<div role="alert">{error}<button onClick={load}>Retry</button></div>}{!loans&&!error&&<p role="status">Loading accounts…</p>}
 {hasPermission('employee_finance:manage')&&<button onClick={()=>setCreate(!create)}>Create loan / vale draft</button>}
 {create&&<FinanceCommand scope={`${employeeId}:loan-create`} endpoint={`/hr/employees/${employeeId}/loans`} body={terms} onDone={()=>{setCreate(false);setTerms(initialTerms);load();}} label="Create draft"><TermsFields value={terms} onChange={setTerms} initial/></FinanceCommand>}
 {loans?.length===0&&<p>No employee loans.</p>}
 {loans?.map(loan=><article key={loan.loan_id} className="space-y-3 rounded border p-3"><h3 className="font-semibold">{loan.creditor} · {loan.loan_type} · #{loan.loan_id} {loan.reference_no}</h3><p>{loan.activation_state} / {loan.status} · Outstanding <span className="tabular-nums whitespace-nowrap">{peso(loan.outstanding)}</span></p><p className="text-sm">Collectible opening {peso(loan.collectible_opening)} · Paid {peso(loan.amount_paid)} · Original principal {loan.original_principal?peso(loan.original_principal):'Unknown (legacy)'}</p>{loan.migration_review&&<p className="text-amber-700">Review: {loan.migration_review}</p>}
 <details><summary>Schedule and audit history</summary>{loan.schedules.map(s=><p key={s.schedule_id}>{s.effective_from?.slice(0,10)} to {s.effective_to?.slice(0,10)||'ongoing'}: {s.schedule} · {peso(s.monthly_installment)} monthly · v{s.version} · {s.reason}</p>)}{loan.activity.map(a=><p key={a.activity_id}>{a.action}: {a.reason} · {a.created_at}</p>)}</details>
 <LoanAction loan={loan} employeeId={employeeId} banks={banks} onDone={load}/></article>)}
 </div>;
}
