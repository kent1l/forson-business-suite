import LoadingState from '../ui/LoadingState';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { financeStyles as styles, financeMoney, financeDate, financeLabel } from './financePresentation';
import { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { FinanceCommand, FinanceField, FundingFields, FinanceFigures, FinanceStatus } from './FinancePrimitives';
const cls = styles.input;
function ReconcilePayout({
  payout,
  employeeId,
  banks,
  onDone
}) {
  const [status, setStatus] = useState('UNKNOWN');
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [funding, setFunding] = useState({
    method: payout.method,
    bank_account_id: payout.bank_account_id || '',
    external_reference: payout.instruction_reference || ''
  });
  return <FinanceCommand scope={`${employeeId}:payout:${payout.payout_id}:reconcile`} endpoint={`/payroll/payouts/${payout.payout_id}/reconcile`} body={{
    version: Number(payout.event_id),
    status,
    evidence,
    reason,
    funding
  }} onDone={onDone} label="Record reconciled bank outcome">
 <FinanceField label="Verified outcome"><select className={cls} value={status} onChange={e => setStatus(e.target.value)}>{['UNKNOWN', 'CONFIRMED', 'FAILED', 'CANCELLED'].map(v => <option key={v} value={v}>{financeLabel(v)}</option>)}</select></FinanceField>
 <FinanceField label="Bank evidence"><input required className={cls} value={evidence} onChange={e => setEvidence(e.target.value)} /></FinanceField><FinanceField label="Reconciliation reason"><input required className={cls} value={reason} onChange={e => setReason(e.target.value)} /></FinanceField>
 {status === 'CONFIRMED' && <FundingFields banks={banks} value={funding} onChange={setFunding} />}
 </FinanceCommand>;
}
function Rounding({
  p,
  onDone
}) {
  const [amount, setAmount] = useState('');
  const [policy, setPolicy] = useState('');
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  return <details><summary>Approve employer-funded upward rounding</summary><FinanceCommand scope={`rounding:${p.payslip_id}`} endpoint={`/payroll/payslips/${p.payslip_id}/rounding-adjustments`} body={{
      version: p.version,
      amount,
      policy_version: policy,
      reason,
      evidence
    }} onDone={onDone} label="Approve adjustment">
 <p>Less than ₱1.00; added to wages owed and funded by the actual payout.</p>
 {[['Amount', amount, setAmount], ['Policy version', policy, setPolicy], ['Reason', reason, setReason], ['Approval evidence', evidence, setEvidence]].map(([label, value, set]) => <FinanceField key={label} label={label}><input required className={cls} value={value} onChange={e => set(e.target.value)} /></FinanceField>)}
 </FinanceCommand></details>;
}
export default function EmployeePayables({
  employeeId,
  banks,
  onChanged
}) {
  const {
    hasPermission,
    user
  } = useAuth();
  const [payables, setPayables] = useState(null);
  const [payouts, setPayouts] = useState([]);
  const [error, setError] = useState('');
  const [allocations, setAllocations] = useState({});
  const [amount, setAmount] = useState('');
  const [evidence, setEvidence] = useState('');
  const [status, setStatus] = useState('CONFIRMED');
  const [funding, setFunding] = useState({
    method: 'BANK'
  });
  const load = useCallback(async () => {
    setError('');
    try {
      const [p, o] = await Promise.all([api.get(`/hr/employees/${employeeId}/payables`), api.get(`/hr/employees/${employeeId}/payouts`)]);
      setPayables(p.data);
      setPayouts(o.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Settlement details failed to load.');
    }
  }, [employeeId]);
  useEffect(() => {
    setPayables(null);
    setPayouts([]);
    setAllocations({});
    load();
  }, [load, user?.employee_id]);
  const done = () => {
    setAllocations({});
    setAmount('');
    load();
    onChanged?.();
  };
  const selected = payables?.filter(p => allocations[p.payslip_id] && allocations[p.payslip_id] !== '0.00').map(p => ({
    payslip_id: p.payslip_id,
    version: p.version,
    amount: allocations[p.payslip_id]
  })) || [];
  const canPay = hasPermission('employee_finance:pay');
  return <section className="space-y-3"><h3 className="font-semibold">Salary entitlement and actual settlement</h3>{error && <ErrorState description={error} onRetry={load}/>}{!payables && !error && <LoadingState label="Loading wage balances…" compact/>}{payables?.length === 0 && <EmptyState title="No approved wage entitlements." description="Approved payroll and its settlement history will appear here."/>}
 {payables?.map(p => <article className={`${styles.card} space-y-4`} key={p.payslip_id}><h4>{p.payslip_no} · {financeDate(p.pay_date)}</h4><FinanceFigures items={[["Net entitlement",p.net_pay],["Corrections",p.correction_amount],["Approved rounding",p.rounding_amount],["Actual paid",p.actual_paid],["Remaining payable",p.remaining_payable],["Pending bank outcome",p.pending_amount]]}/><p className={styles.muted}>Noncash recovery: {p.settlement_id ? 'posted' : p.legacy_provenance ? 'imported assertion; details unknown' : 'awaiting execution'}</p>{p.legacy_provenance && <p>Legacy asserted settlement ₱{p.legacy_asserted_paid}. {p.legacy_provenance}</p>}
 <details><summary>Exact recovery sources</summary>{p.recoveries.map(a => <p key={a.allocation_id}>Loan #{a.loan_id} · allocation #{a.allocation_id} · {financeMoney(a.approved_amount)} · {financeLabel(a.status)}</p>)}</details>
 {canPay && !p.settlement_id && !p.legacy_provenance && p.status === 'Approved' && <FinanceCommand scope={`settle:${p.payslip_id}`} endpoint="/payroll/employee-settlements" body={{
        payslip_id: p.payslip_id,
        version: p.version,
        allocation_ids: p.recoveries.filter(a => a.status === 'RESERVED').map(a => a.allocation_id),
        reason: 'Execute approved payslip noncash offsets'
      }} onDone={done} label="Execute approved noncash settlement"><p>Posts the exact approved recoveries once, including when net wages are zero. Cash is recorded separately.</p></FinanceCommand>}
 {hasPermission('employee_finance:approve') && ['Approved', 'Paid'].includes(p.status) && <Rounding p={p} banks={banks} onDone={done} />}
 </article>)}
 {canPay && payables?.some(p => p.settlement_id || p.legacy_provenance) && <details><summary>Record actual payout across current / older payslips</summary><FinanceCommand scope={`${employeeId}:payout-create`} endpoint="/payroll/payouts" body={{
        employee_id: employeeId,
        amount,
        method: funding.method,
        status,
        evidence,
        funding,
        allocations: selected
      }} onDone={done} label="Record actual payment" disabled={!selected.length}>
 <FinanceField label="Actual total amount"><input required inputMode="decimal" className={cls} value={amount} onChange={e => setAmount(e.target.value)} /></FinanceField>
 {payables.filter(p => (p.settlement_id || p.legacy_provenance) && p.remaining_payable !== '0.00').map(p => <FinanceField key={p.payslip_id} label={`${p.payslip_no} — remaining ₱${p.remaining_payable}`}><input inputMode="decimal" className={cls} value={allocations[p.payslip_id] || ''} onChange={e => setAllocations({
            ...allocations,
            [p.payslip_id]: e.target.value
          })} /></FinanceField>)}
 <FinanceField label="Outcome"><select className={cls} value={status} onChange={e => {
            setStatus(e.target.value);
            if (e.target.value !== 'CONFIRMED') setFunding({
              ...funding,
              method: 'BANK'
            });
          }}><option value="CONFIRMED">Confirmed actual payout</option><option value="PENDING">Pending bank instruction</option><option value="UNKNOWN">Unknown bank outcome</option></select></FinanceField>
 <FinanceField label="Payment / instruction evidence"><input required className={cls} value={evidence} onChange={e => setEvidence(e.target.value)} /></FinanceField>
 {status !== 'CONFIRMED' && <><FinanceField label="Bank account for instruction"><select required className={cls} value={funding.bank_account_id || ''} onChange={e => setFunding({
              ...funding,
              bank_account_id: e.target.value
            })}><option value="">Select bank</option>{banks.map(b => <option key={b.bank_account_id} value={b.bank_account_id}>{b.account_name}</option>)}</select></FinanceField><FinanceField label="Bank instruction reference"><input required className={cls} value={funding.external_reference || ''} onChange={e => setFunding({
              ...funding,
              external_reference: e.target.value
            })} /></FinanceField></>}
 {status === 'CONFIRMED' && <FundingFields value={funding} onChange={setFunding} banks={banks} amount={amount} />}
 </FinanceCommand></details>}
 {payouts.map(p => <article key={p.payout_id} className={`${styles.card} space-y-3`}><p>Payout #{p.payout_id} · {financeMoney(p.amount)} · {financeLabel(p.method)} · <FinanceStatus value={p.status}/></p><p>Request {p.request_id}</p>{p.method === 'BANK' && <p>Original bank account #{p.bank_account_id} · Instruction {p.instruction_reference || 'Unknown (legacy)'}</p>}{p.allocations.map(a => <p key={a.payout_allocation_id}>Payslip #{a.payslip_id}: ₱{a.amount}</p>)}<details><summary>Outcome history</summary>{p.events.map(e => <p key={e.event_id}>{financeLabel(e.status)} · {e.evidence} · {e.reason}</p>)}</details>{canPay && ['PENDING', 'UNKNOWN'].includes(p.status) && <details><summary>Resolve bank outcome</summary><ReconcilePayout payout={p} employeeId={employeeId} banks={banks} onDone={done} /></details>}</article>)}
 </section>;
}
