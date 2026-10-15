import { useEffect, useState } from 'react';
import api from '../../api';
import { FinanceCommand, FinanceField } from './EmployeeAccountsTab';
const inputClass = 'w-full rounded border bg-transparent p-2';
export default function PayrollRecoveryReview({
  payslip,
  run,
  onDone
}) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    api.get(`/payroll/payslips/${payslip.payslip_id}/recoveries`).then(r => {
      if (live) setRows(r.data.map(a => ({
        ...a,
        amount: a.approved_amount,
        action: 'RECOVER',
        reason: '',
        authorization: ''
      })));
    }).catch(e => {
      if (live) setError(e.response?.data?.message || 'Recovery review failed to load.');
    });
    return () => {
      live = false;
    };
  }, [payslip.payslip_id]);
  const edit = (id, key, value) => setRows(r => r.map(a => a.allocation_id === id ? {
    ...a,
    [key]: value,
    ...(['DEFER', 'SKIP'].includes(value) && key === 'action' ? {
      amount: '0.00'
    } : {})
  } : a));
  if (error) return <p role="alert">{error}</p>;
  if (!rows) return <p>Loading exact recoveries…</p>;
  if (!rows.length) return <p>No loan allocations on this payslip.</p>;
  return <FinanceCommand scope={`payslip:${payslip.payslip_id}:review`} endpoint={`/payroll/payslips/${payslip.payslip_id}/recovery-review`} body={{
    version: run.version,
    allocations: rows.map(a => ({
      allocation_id: a.allocation_id,
      amount: a.amount,
      action: a.action,
      reason: a.reason,
      authorization: a.authorization
    }))
  }} onDone={onDone} label="Save exact recovery review">
 <p>Available net pay before review: ₱{payslip.net_pay}. Approval blocks unresolved negative net pay.</p>
 {rows.map(a => <fieldset key={a.allocation_id} className="rounded border p-3 space-y-2"><legend>Loan #{a.loan_id} · {a.reference_no} · {a.creditor}</legend><p>Scheduled ₱{a.scheduled_amount} · Approved ₱{a.approved_amount} · Outstanding ₱{a.outstanding}</p>
 <FinanceField label="Decision"><select className={inputClass} value={a.action} onChange={e => edit(a.allocation_id, 'action', e.target.value)}>{['RECOVER', 'DEFER', 'SKIP', 'CATCH_UP'].map(v => <option key={v}>{v}</option>)}</select></FinanceField>
 <FinanceField label="Exact approved amount"><input required className={inputClass} inputMode="decimal" value={a.amount} onChange={e => edit(a.allocation_id, 'amount', e.target.value)} /></FinanceField>
 <FinanceField label="Reason"><input required className={inputClass} value={a.reason} onChange={e => edit(a.allocation_id, 'reason', e.target.value)} /></FinanceField>
 <FinanceField label="Explicit authority (catch-up / final / supplemental)"><input className={inputClass} value={a.authorization} onChange={e => edit(a.allocation_id, 'authorization', e.target.value)} /></FinanceField>
 </fieldset>)}
 </FinanceCommand>;
}
