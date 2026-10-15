import { FinanceCommand, FinanceField, FundingFields, FinancePanel, FinanceDialog, FinanceNotice, FinanceStatus, FinanceFigures } from './FinancePrimitives';
import {financeStyles as styles, financeMoney, financeDate, financeLabel} from './financePresentation';
import SegmentedTabs from '../ui/SegmentedTabs';
import EmptyState from '../ui/EmptyState';
import LoadingState from '../ui/LoadingState';
import ErrorState from '../ui/ErrorState';
import EmployeeAgencyLoans from './EmployeeAgencyLoans';
import EmployeePayables from './EmployeePayables';
import EmployeeAccountStatement from './EmployeeAccountStatement';
import { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
const fieldClass = styles.input;
const peso = financeMoney;
const initialTerms = {
  creditor: 'COMPANY',
  loan_type: 'CASH_ADVANCE',
  principal_amount: '',
  collectible_opening: '',
  interest_fees: '0.00',
  monthly_installment: '',
  months_to_pay: '',
  schedule: 'SECOND_CUTOFF',
  effective_from: '',
  start_date: '',
  purpose: 'Vale / cash advance',
  authorization: 'Signed payroll deduction authority',
  evidence: 'Signed vale slip / agreement',
  reference_no: ''
};
function TermsFields({
  value,
  onChange,
  initial = false
}) {
  const set = (key, v) => onChange({
    ...value,
    [key]: v
  });
  let preview = null;
  if (/^\d+(\.\d{1,2})?$/.test(value.monthly_installment)) {
    const [whole, f = ''] = value.monthly_installment.split('.');
    const n = BigInt(whole) * 100n + BigInt(f.padEnd(2, '0'));
    const fmt = x => `${x / 100n}.${String(x % 100n).padStart(2, '0')}`;
    const first = value.schedule === 'FIRST_CUTOFF' ? n : value.schedule === 'SECOND_CUTOFF' ? 0n : (n + 1n) / 2n;
    const cutoffText = `First cutoff ${peso(fmt(first))}; second cutoff ${peso(fmt(n - first))}`;
    const totalText = value.collectible_opening ? ` · Total: ${peso(value.collectible_opening)}` : '';
    const monthsText = value.months_to_pay ? ` (${value.months_to_pay} mo.)` : '';
    preview = `${cutoffText}${totalText}${monthsText}`;
  }

  const handleMonthlyChange = (monthlyStr) => {
    const next = { ...value, monthly_installment: monthlyStr };
    const m = parseFloat(monthlyStr);
    const months = parseFloat(value.months_to_pay);
    if (!isNaN(m) && m > 0 && !isNaN(months) && months > 0) {
      const total = (m * months).toFixed(2);
      next.collectible_opening = total;
      next.principal_amount = total;
      next.interest_fees = '0.00';
    }
    onChange(next);
  };

  const handleMonthsChange = (monthsStr) => {
    const next = { ...value, months_to_pay: monthsStr };
    const m = parseFloat(value.monthly_installment);
    const months = parseFloat(monthsStr);
    if (!isNaN(m) && m > 0 && !isNaN(months) && months > 0) {
      const total = (m * months).toFixed(2);
      next.collectible_opening = total;
      next.principal_amount = total;
      next.interest_fees = '0.00';
    }
    onChange(next);
  };

  const handleTotalChange = (totalStr) => {
    const next = { ...value, collectible_opening: totalStr };
    const tot = parseFloat(totalStr);
    const fees = parseFloat(value.interest_fees) || 0;
    if (!isNaN(tot)) {
      next.principal_amount = (tot - fees).toFixed(2);
      const m = parseFloat(value.monthly_installment);
      if (!isNaN(m) && m > 0) {
        next.months_to_pay = String(Math.ceil(tot / m));
      }
    }
    onChange(next);
  };

  const handleEffectiveFromChange = (monthStr) => {
    const eff = `${monthStr}-01`;
    const next = { ...value, effective_from: eff };
    if (!value.start_date || value.start_date < eff) {
      next.start_date = eff;
    }
    onChange(next);
  };

  const handleCreditorChange = (creditor) => {
    const loan_type = {
      COMPANY: 'CASH_ADVANCE',
      SSS: 'SSS_SALARY',
      PAGIBIG: 'HDMF_MPL'
    }[creditor];
    const defaultPurpose = `${financeLabel(creditor)} ${financeLabel(loan_type)}`;
    const defaultEvidence = creditor === 'COMPANY' ? 'Signed vale slip / agreement' : `${financeLabel(creditor)} loan voucher / billing notice`;
    onChange({
      ...value,
      creditor,
      loan_type,
      purpose: defaultPurpose,
      evidence: defaultEvidence
    });
  };

  return <div className="grid gap-4 sm:grid-cols-2">
    {initial && <>
      <FinanceField label="Creditor">
        <select className={fieldClass} value={value.creditor} onChange={e => handleCreditorChange(e.target.value)}>
          {['COMPANY', 'SSS', 'PAGIBIG'].map(v => <option key={v} value={v}>{financeLabel(v)}</option>)}
        </select>
      </FinanceField>
      <FinanceField label="Loan type">
        <select className={fieldClass} value={value.loan_type} onChange={e => onChange({ ...value, loan_type: e.target.value, purpose: `${financeLabel(value.creditor)} ${financeLabel(e.target.value)}` })}>
          {{
            COMPANY: ['CASH_ADVANCE', 'OTHER'],
            SSS: ['SSS_SALARY', 'SSS_CALAMITY'],
            PAGIBIG: ['HDMF_MPL', 'HDMF_CALAMITY']
          }[value.creditor].map(v => <option key={v} value={v}>{financeLabel(v)}</option>)}
        </select>
      </FinanceField>
      <FinanceField label="Loan reference">
        <input required className={fieldClass} placeholder="e.g. VALE-2026-001 or SSS Loan #" value={value.reference_no} onChange={e => set('reference_no', e.target.value)} />
      </FinanceField>
      <FinanceField label="Number of months to pay">
        <input inputMode="numeric" className={fieldClass} placeholder="e.g. 12 or 24" value={value.months_to_pay || ''} onChange={e => handleMonthsChange(e.target.value)} />
      </FinanceField>
    </>}
    <FinanceField label="Monthly installment amount">
      <input required inputMode="decimal" className={fieldClass} placeholder="e.g. 1000.00" value={value.monthly_installment} onChange={e => handleMonthlyChange(e.target.value)} />
    </FinanceField>
    <FinanceField label="Deduct on">
      <select className={fieldClass} value={value.schedule} onChange={e => set('schedule', e.target.value)}>
        <option value="FIRST_CUTOFF">1st cutoff</option>
        <option value="SECOND_CUTOFF">2nd cutoff</option>
        <option value="SPLIT_HALF">Split monthly amount across both cutoffs</option>
      </select>
    </FinanceField>
    {preview && <div className="sm:col-span-2"><FinanceNotice>{preview}. No automatic catch-up on mid-month start.</FinanceNotice></div>}
    <FinanceField label="Effective recovery month">
      <input required type="month" className={fieldClass} value={value.effective_from?.slice(0, 7) || ''} onChange={e => handleEffectiveFromChange(e.target.value)} />
    </FinanceField>
    <FinanceField label="Deduction authorization">
      <input required className={fieldClass} value={value.authorization} onChange={e => set('authorization', e.target.value)} />
    </FinanceField>

    {initial && <details className="sm:col-span-2 rounded-lg border border-gray-200 dark:border-slate-700 p-3 bg-gray-50/50 dark:bg-slate-800/50">
      <summary className="cursor-pointer text-xs font-semibold text-gray-700 dark:text-slate-300">
        Detailed breakdown & evidence (auto-computed, click to customize)
      </summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <FinanceField label="Total collectible opening">
          <input required inputMode="decimal" className={fieldClass} value={value.collectible_opening} onChange={e => handleTotalChange(e.target.value)} />
        </FinanceField>
        <FinanceField label="Original principal">
          <input required inputMode="decimal" className={fieldClass} value={value.principal_amount} onChange={e => set('principal_amount', e.target.value)} />
        </FinanceField>
        <FinanceField label="Explicit agreed interest / fees">
          <input required inputMode="decimal" className={fieldClass} value={value.interest_fees} onChange={e => set('interest_fees', e.target.value)} />
        </FinanceField>
        <FinanceField label="Recovery eligibility start date">
          <input required type="date" className={fieldClass} value={value.start_date} onChange={e => set('start_date', e.target.value)} />
        </FinanceField>
        <FinanceField label="Purpose">
          <input required className={fieldClass} value={value.purpose} onChange={e => set('purpose', e.target.value)} />
        </FinanceField>
        <FinanceField label="Agreement / enrollment evidence">
          <input required className={fieldClass} value={value.evidence} onChange={e => set('evidence', e.target.value)} />
        </FinanceField>
      </div>
    </details>}
  </div>;
}
function LoanAction({
  loan,
  employeeId,
  banks,
  onDone
}) {
  const {
    hasPermission
  } = useAuth();
  const [action, setAction] = useState('');
  const [reason, setReason] = useState('');
  const [enrollment, setEnrollment] = useState('');
  const [funding, setFunding] = useState({
    method: 'BANK'
  });
  const [terms, setTerms] = useState({
    ...initialTerms
  });
  const [amount, setAmount] = useState('');
  const [policy, setPolicy] = useState('PRINCIPAL');
  const [arrearsMonth, setArrearsMonth] = useState('');
  const [arrearsCutoff, setArrearsCutoff] = useState(1);
  let endpoint = `/hr/loans/${loan.loan_id}/${action}`;
  let body = {
    version: loan.version,
    reason
  };
  if (action === 'activate') body = {
    ...body,
    enrollment_evidence: enrollment,
    release_evidence: enrollment
  };
  if (action === 'schedule-changes') body = {
    ...body,
    ...terms
  };
  if (action === 'agency-payments') {
    body = {
      ...body,
      amount,
      official_reference: enrollment,
      evidence: funding.evidence,
      occurred_at: funding.occurred_at
    };
  }
  if (action === 'collect') {
    endpoint = '/hr/employee-collections';
    body = {
      employee_id: employeeId,
      amount,
      reason,
      allocation_policy: policy,
      funding,
      allocations: [{
        loan_id: loan.loan_id,
        version: loan.version,
        amount,
        ...(policy === 'INSTALLMENT_ARREARS' ? {
          recovery_month: arrearsMonth,
          cutoff_seq: arrearsCutoff
        } : {})
      }]
    };
  }
  return <div className="space-y-3"><div className="flex flex-wrap gap-3">
 {hasPermission('employee_finance:approve') && loan.activation_state === 'DRAFT' && <button onClick={() => setAction('activate')}>Approve & activate</button>}
 {hasPermission('employee_finance:manage') && <><button onClick={() => setAction('schedule-changes')}>Future schedule</button>{loan.activation_state !== 'DRAFT' && ['Active', 'On Hold'].includes(loan.status) && <button onClick={() => setAction(loan.status === 'Active' ? 'hold' : 'resume')}>{loan.status === 'Active' ? 'Hold' : 'Resume'}</button>}</>}
 {hasPermission('employee_finance:collect') && loan.creditor === 'COMPANY' && loan.activation_state !== 'DRAFT' && <button onClick={() => setAction('collect')}>Direct repayment</button>}
 {hasPermission('employee_finance:remit') && loan.creditor !== 'COMPANY' && loan.activation_state !== 'DRAFT' && <button onClick={() => setAction('agency-payments')}>Reconcile employee payment to agency</button>}
 </div><FinanceDialog isOpen={Boolean(action)} onClose={() => setAction('')} title={action === 'activate' ? 'Approve and activate loan' : action === 'collect' ? 'Record direct repayment' : action === 'agency-payments' ? 'Reconcile agency payment' : action === 'schedule-changes' ? 'Change future schedule' : `${financeLabel(action)} loan`}><FinanceCommand scope={`${employeeId}:${loan.loan_id}:${action}`} endpoint={endpoint} body={body} onDone={() => {
      setAction('');
      onDone();
    }} label={action === 'activate' ? 'Approve and activate' : 'Confirm'}>
 <p className={styles.muted}>{financeLabel(loan.loan_type)} · {loan.reference_no || `Loan #${loan.loan_id}`}</p>
 {action === 'schedule-changes' && <TermsFields value={terms} onChange={setTerms} />}
 {action === 'activate' && <FinanceField label={loan.creditor === 'COMPANY' ? "Release evidence / reference" : "Verified agency enrollment evidence"}><input required className={fieldClass} placeholder={loan.creditor === 'COMPANY' ? "e.g. Signed vale voucher # or manual receipt" : "e.g. Agency loan reference / billing notice"} value={enrollment} onChange={e => setEnrollment(e.target.value)} /></FinanceField>}
 {action === 'agency-payments' && <><p>Agency-direct evidence only. No company cash receipt or schedule rewrite.</p><FinanceField label="Agency payment amount"><input required className={fieldClass} value={amount} onChange={e => setAmount(e.target.value)} /></FinanceField><FinanceField label="Official agency receipt reference"><input required className={fieldClass} value={enrollment} onChange={e => setEnrollment(e.target.value)} /></FinanceField><FinanceField label="Agency evidence"><input required className={fieldClass} value={funding.evidence || ''} onChange={e => setFunding({
            ...funding,
            evidence: e.target.value
          })} /></FinanceField><FinanceField label="Actual agency payment time (Manila)"><input required type="datetime-local" className={fieldClass} onChange={e => setFunding({
            ...funding,
            occurred_at: e.target.value ? new Date(`${e.target.value}+08:00`).toISOString() : null
          })} /></FinanceField></>}
 {action === 'collect' && <><FinanceField label="Actual receipt amount"><input required className={fieldClass} value={amount} onChange={e => setAmount(e.target.value)} /></FinanceField><FinanceField label="Allocation policy"><select className={fieldClass} value={policy} onChange={e => setPolicy(e.target.value)}><option value="PRINCIPAL">Reduce principal outstanding</option><option value="INSTALLMENT_ARREARS">Apply to installment arrears</option></select></FinanceField>{policy === 'INSTALLMENT_ARREARS' && <><FinanceField label="Exact arrears recovery month"><input required type="month" className={fieldClass} value={arrearsMonth.slice(0, 7)} onChange={e => setArrearsMonth(`${e.target.value}-01`)} /></FinanceField><FinanceField label="Exact arrears cutoff"><select className={fieldClass} value={arrearsCutoff} onChange={e => setArrearsCutoff(Number(e.target.value))}><option value={1}>1st cutoff</option><option value={2}>2nd cutoff</option></select></FinanceField></>}</>}
 {action === 'collect' && <FundingFields value={funding} onChange={setFunding} banks={banks} direction="IN" amount={amount} />}
 <FinanceField label="Reason"><input required className={fieldClass} value={reason} onChange={e => setReason(e.target.value)} /></FinanceField>
 </FinanceCommand></FinanceDialog></div>;
}
function EmployeeAccountsContent({
  employeeId,
  employeeName
}) {
  const {
    user,
    hasPermission
  } = useAuth();
  const [loans, setLoans] = useState(null);
  const [banks, setBanks] = useState([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [create, setCreate] = useState(false);
  const [tab, setTab] = useState('overview');
  const [terms, setTerms] = useState(initialTerms);
  const load = useCallback(async () => {
    setRefresh(n => n + 1);
    setError('');
    try {
      const [l, b] = await Promise.all([api.get(`/hr/employees/${employeeId}/loans`), api.get('/hr/employee-finance/bank-accounts')]);
      setLoans(l.data);
      setBanks(b.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Employee accounts could not load.');
    }
  }, [employeeId]);
  useEffect(() => {
    setLoans(null);
    setCreate(false);
    setTerms(initialTerms);
    load();
  }, [load, user?.employee_id]);
  if (!hasPermission('employee_finance:view')) return <p role="alert">Financial access required.</p>;
  return <div className="space-y-5">
 <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{employeeName ? `${employeeName} · Accounts` : 'Employee Accounts'}</h2><p className={styles.muted}>Review balances, manage recovery schedules and record verified settlement.</p></div>{hasPermission('employee_finance:manage') && <button className={styles.primary} onClick={() => setCreate(true)}>Create loan / vale draft</button>}</div>
 <SegmentedTabs variant="pills" active={tab} onChange={setTab} tabs={[{key:'overview',label:'Overview & statement'},{key:'loans',label:'Loans & vale'},{key:'salary',label:'Salary & payouts'},{key:'agency',label:'Government loans'}]} />
 {error && <ErrorState description={error} onRetry={load} />}
 {tab === 'overview' && <EmployeeAccountStatement key={`${user?.employee_id}:${employeeId}`} employeeId={employeeId} refresh={refresh} banks={banks} />}
 {tab === 'agency' && <EmployeeAgencyLoans key={`agency:${user?.employee_id}:${employeeId}`} employeeId={employeeId} banks={banks} onChanged={load} />}
 {tab === 'salary' && <EmployeePayables key={`pay:${user?.employee_id}:${employeeId}`} employeeId={employeeId} banks={banks} onChanged={load} />}
 <FinanceDialog isOpen={create} onClose={() => setCreate(false)} title="Create loan / vale draft"><FinanceNotice>Save the agreement and recovery schedule as a draft. Activation requires independent approval.</FinanceNotice><div className="mt-4"><FinanceCommand scope={`${employeeId}:loan-create`} endpoint={`/hr/employees/${employeeId}/loans`} body={terms} onDone={() => { setCreate(false); setTerms(initialTerms); setTab('loans'); load(); }} label="Create draft"><TermsFields value={terms} onChange={setTerms} initial /></FinanceCommand></div></FinanceDialog>
 {tab === 'loans' && <div className="space-y-4">{!loans && !error && <LoadingState label="Loading loans…" compact />}{loans?.length === 0 && <EmptyState title="No employee loans." description="Company vale and enrolled government loans will appear here." />}
 {loans?.map(loan => <FinancePanel key={loan.loan_id} title={`${financeLabel(loan.loan_type)} · ${loan.reference_no || `Loan #${loan.loan_id}`}`} description={`${financeLabel(loan.creditor)} · Original principal ${loan.original_principal ? peso(loan.original_principal) : 'unknown (imported)'}`} actions={<div className="flex gap-2"><FinanceStatus value={loan.activation_state}/><FinanceStatus value={loan.status}/></div>}>
 <div className="space-y-4"><FinanceFigures items={[["Outstanding",loan.outstanding],["Collectible opening",loan.collectible_opening],["Paid",loan.amount_paid]]}/>{loan.migration_review && <FinanceNotice tone="warning">Imported loan requires review: {loan.migration_review}</FinanceNotice>}
 <details><summary>Schedule and audit history</summary><div className="space-y-3">{loan.schedules.map(s => <div key={s.schedule_id}><p className="text-sm font-medium">{financeLabel(s.schedule)} · {peso(s.monthly_installment)} / month</p><p className={styles.muted}>{financeDate(s.effective_from)} – {s.effective_to ? financeDate(s.effective_to) : 'ongoing'} · {s.reason}</p></div>)}{loan.activity.map(a => <p className={styles.muted} key={a.activity_id}>{financeLabel(a.action)} · {a.reason} · {financeDate(a.created_at,true)}</p>)}</div></details>
 <LoanAction loan={loan} employeeId={employeeId} banks={banks} onDone={load} /></div></FinancePanel>)}
 </div>}
 </div>;
}
export default function EmployeeAccountsTab({
  employeeId,
  employeeName
}) {
  const {
    user
  } = useAuth();
  return <div className="employee-finance min-w-0" data-account-employee={employeeId} data-account-actor={user?.employee_id}><EmployeeAccountsContent key={`${user?.employee_id}:${employeeId}`} employeeId={employeeId} employeeName={employeeName} /></div>;
}
