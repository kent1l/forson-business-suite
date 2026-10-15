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
    load();
  }, [load, user?.employee_id]);
  const done = () => {
    load();
    onChanged?.();
  };
  const canPay = hasPermission('employee_finance:pay');
  return <section className="space-y-3"><h3 className="font-semibold">Salary payments</h3><p className={styles.muted}>Use Mark Paid on the payroll run to record the exact remaining wages and approved deductions. No amount, payment method or funding details are needed.</p>{error && <ErrorState description={error} onRetry={load}/>}{!payables && !error && <LoadingState label="Loading wage balances…" compact/>}{payables?.length === 0 && <EmptyState title="No approved wage entitlements." description="Approved payroll and its settlement history will appear here."/>}
 {payables?.map(p => <article className={`${styles.card} space-y-4`} key={p.payslip_id}><h4>{p.payslip_no} · {financeDate(p.pay_date)}</h4><FinanceFigures items={[["Net entitlement",p.net_pay],["Corrections",p.correction_amount],["Approved rounding",p.rounding_amount],["Actual paid",p.actual_paid],["Remaining payable",p.remaining_payable]]}/><p className={styles.muted}>Noncash recovery: {p.settlement_id ? 'posted' : p.legacy_provenance ? 'imported assertion; details unknown' : 'awaiting execution'}</p>{p.legacy_provenance && <p>Legacy asserted settlement ₱{p.legacy_asserted_paid}. {p.legacy_provenance}</p>}
 <details><summary>Exact recovery sources</summary>{p.recoveries.map(a => <p key={a.allocation_id}>Loan #{a.loan_id} · allocation #{a.allocation_id} · {financeMoney(a.approved_amount)} · {financeLabel(a.status)}</p>)}</details>

 </article>)}

 {payouts.map(p => <article key={p.payout_id} className={`${styles.card} space-y-3`}><p>Payout #{p.payout_id} · {financeMoney(p.amount)} · <FinanceStatus value={p.status}/></p><p>Request {p.request_id}</p>{p.method === 'BANK' && <p>Original bank account #{p.bank_account_id} · Instruction {p.instruction_reference || 'Unknown (legacy)'}</p>}{p.allocations.map(a => <p key={a.payout_allocation_id}>Payslip #{a.payslip_id}: ₱{a.amount}</p>)}<details><summary>Outcome history</summary>{p.events.map(e => <p key={e.event_id}>{financeLabel(e.status)} · {e.evidence} · {e.reason}</p>)}</details>{canPay && ['PENDING', 'UNKNOWN'].includes(p.status) && <details><summary>Resolve bank outcome</summary><ReconcilePayout payout={p} employeeId={employeeId} banks={banks} onDone={done} /></details>}</article>)}
 </section>;
}
