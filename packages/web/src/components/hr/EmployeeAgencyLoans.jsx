import LoadingState from '../ui/LoadingState';
import ErrorState from '../ui/ErrorState';
import EmptyState from '../ui/EmptyState';
import { financeStyles as styles, financeMoney, financeLabel } from './financePresentation';
import { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { FinanceCommand, FinanceField, FundingFields, FinanceFigures, FinanceNotice, FinanceStatus } from './FinancePrimitives';
const cls = styles.input;
export function FinanceCorrection({
  scope,
  endpoint,
  base,
  banks,
  requiresFunding,
  direction = 'OUT',
  label,
  onDone
}) {
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  const [amount, setAmount] = useState('');
  const [funding, setFunding] = useState({
    method: 'BANK'
  });
  return <details><summary>{label}</summary><FinanceCommand scope={scope} endpoint={endpoint} body={{
      ...base,
      reason,
      evidence,
      ...(requiresFunding ? {
        amount,
        funding
      } : {})
    }} onDone={onDone} label={label}>
 <p>Preserves the original source. Requires independent correction authority and exact evidence.</p>
 {requiresFunding && <><FinanceField label="Actual correction amount"><input required className={cls} inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} /></FinanceField><FundingFields value={funding} onChange={setFunding} banks={banks} direction={direction} amount={amount} /></>}
 <FinanceField label="Correction reason"><input required className={cls} value={reason} onChange={e => setReason(e.target.value)} /></FinanceField><FinanceField label="Correction evidence"><input required className={cls} value={evidence} onChange={e => setEvidence(e.target.value)} /></FinanceField>
 </FinanceCommand></details>;
}
function Reconcile({
  doc,
  employeeId,
  onDone
}) {
  const [state, setState] = useState('CONFIRMED');
  const [amount, setAmount] = useState(doc.amount);
  const [reason, setReason] = useState('');
  const [evidence, setEvidence] = useState('');
  return <FinanceCommand scope={`${employeeId}:remittance:${doc.remittance_id}:reconcile`} endpoint={`/hr/loan-remittances/${doc.remittance_id}/reconcile`} body={{
    version: Number(doc.version),
    state,
    statement_amount: amount,
    reason,
    evidence
  }} onDone={onDone} label="Record agency reconciliation">
 <FinanceField label="Agency state"><select className={cls} value={state} onChange={e => setState(e.target.value)}>{['CONFIRMED', 'RECONCILED', 'NEEDS_REVIEW'].map(v => <option key={v} value={v}>{financeLabel(v)}</option>)}</select></FinanceField>
 {[['Agency statement amount', amount, setAmount], ['Official confirmation evidence', evidence, setEvidence], ['Reason / statement difference', reason, setReason]].map(([label, value, set]) => <FinanceField label={label} key={label}><input required className={cls} value={value} onChange={e => set(e.target.value)} /></FinanceField>)}
 </FinanceCommand>;
}
export default function EmployeeAgencyLoans({
  employeeId,
  banks,
  onChanged
}) {
  const {
    hasPermission
  } = useAuth();
  const [data, setData] = useState(null);
  const [treasury, setTreasury] = useState([]);
  const [sourceError, setSourceError] = useState('');
  const [sourceSearch, setSourceSearch] = useState('');
  const [error, setError] = useState('');
  const [agency, setAgency] = useState('SSS');
  const [amount, setAmount] = useState('');
  const [period, setPeriod] = useState('');
  const [sourceType, setSourceType] = useState('treasury_expense_id');
  const [sourceId, setSourceId] = useState('');
  const [reference, setReference] = useState('');
  const [evidence, setEvidence] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [allocations, setAllocations] = useState({});
  const load = useCallback(async () => {
    setError('');
    try {
      setData((await api.get(employeeId ? `/hr/employees/${employeeId}/loan-withholdings` : '/hr/loan-remittances')).data);
    } catch (e) {
      setError(e.response?.data?.message || 'Agency withholding and remittances unavailable.');
    }
  }, [employeeId]);
  useEffect(() => {
    setData(null);
    load();
  }, [load]);
  useEffect(() => {
    let live = true;
    setSourceError('');
    const timer = setTimeout(() => api.get('/hr/employee-finance/treasury-sources', {
      params: {
        search: sourceSearch
      }
    }).then(r => {
      if (live) setTreasury(r.data);
    }).catch(() => {
      if (live) { setTreasury([]); setSourceError('Treasury sources could not load. Change the search to retry.'); }
    }), 250);
    return () => {
      live = false; clearTimeout(timer);
    };
  }, [sourceSearch]);
  const done = () => {
    load();
    onChanged?.();
  };
  if (error) return <ErrorState description={error} onRetry={load}/>;
  if (!data) return <LoadingState label="Loading agency installments…" compact/>;
  return <section className="space-y-3"><h3 className="font-semibold">Government loan withholding and remittance</h3>{!data.withholdings.length && <EmptyState title="No payroll agency-loan withholdings." description="Withheld SSS and Pag-IBIG loan repayments will appear here."/>}
 {data.withholdings.map(w => <article key={w.payment_id} className={`${styles.card} space-y-3`}><h4 className="text-sm font-semibold">{w.employee_name} · {financeLabel(w.creditor)} loan #{w.loan_id}</h4><FinanceFigures items={[["Withheld",w.amount],["Remitted",w.remitted],["Returned",w.remittance_returned],["Awaiting remittance",w.unremitted]]}/><p className={styles.muted}>Payroll recovery #{w.payment_id}</p></article>)}
 {hasPermission('employee_finance:remit') && data.withholdings.length > 0 && <details><summary>Attribute an existing Treasury payment</summary><FinanceCommand scope={`${employeeId}:remit`} endpoint="/hr/loan-remittances" body={{
        agency,
        amount,
        recovery_month: period,
        [sourceType]: sourceId,
        official_reference: reference,
        evidence,
        confirmed,
        allocations: data.withholdings.filter(w => w.creditor === agency && allocations[w.payment_id]).map(w => ({
          payment_id: w.payment_id,
          amount: allocations[w.payment_id]
        }))
      }} onDone={done} label="Record remittance attribution">
 <p>Use the existing paid Treasury document. This creates no new expense or cash release. Enter only its loan-withholding share; contribution reporting remains separate.</p>
 <FinanceField label="Agency"><select className={cls} value={agency} onChange={e => {
            setAgency(e.target.value);
            setAllocations({});
          }}><option>SSS</option><option>PAGIBIG</option></select></FinanceField>
 <FinanceField label="Agency recovery period"><input required type="month" className={cls} value={period.slice(0, 7)} onChange={e => setPeriod(`${e.target.value}-01`)} /></FinanceField>
 <FinanceField label="Find existing paid Treasury source"><input className={cls} value={sourceSearch} onChange={e => { setSourceSearch(e.target.value); setSourceId(''); }} placeholder="Reference, payee or ID" /></FinanceField>
 <FinanceField label="Existing Treasury document"><select required className={cls} value={sourceId ? `${sourceType}:${sourceId}` : ''} onChange={e => {
            const [type, id] = e.target.value.split(':');
            setSourceType(type);
            setSourceId(id);
          }}><option value="">Select an existing paid document</option>{treasury.map(t => <option key={`${t.source_type}:${t.source_id}`} value={`${t.source_type === 'EXPENSE' ? 'treasury_expense_id' : 'treasury_ap_payment_id'}:${t.source_id}`}>{t.source_type} #{t.source_id} · {t.reference} · {t.payee} · ₱{t.amount}</option>)}</select></FinanceField>
 {sourceError && <FinanceNotice tone="danger">{sourceError}</FinanceNotice>}
 {[['Loan share actually remitted', amount, setAmount], ['Official remittance reference', reference, setReference], ['Verified Treasury / agency evidence', evidence, setEvidence]].map(([label, value, set]) => <FinanceField key={label} label={label}><input required className={cls} value={value} onChange={e => set(e.target.value)} /></FinanceField>)}
 {data.withholdings.filter(w => w.creditor === agency && w.unremitted !== '0.00').map(w => <FinanceField key={w.payment_id} label={`${w.employee_name} · Recovery #${w.payment_id}, loan #${w.loan_id}, available ₱${w.unremitted}`}><input inputMode="decimal" className={cls} value={allocations[w.payment_id] || ''} onChange={e => setAllocations({
            ...allocations,
            [w.payment_id]: e.target.value
          })} /></FinanceField>)}
 <label className="flex gap-2"><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Treasury payment confirmed from source evidence</label>
 </FinanceCommand></details>}
 {data.remittances.map(doc => <article key={doc.remittance_id} className={`${styles.card} space-y-4`}><h4>Remittance #{doc.remittance_id} · {doc.agency} · {financeMoney(doc.amount)} · <FinanceStatus value={doc.state}/></h4><p>Official reference: {doc.official_reference} · Treasury {doc.treasury_expense_id ? `expense #${doc.treasury_expense_id}` : `supplier payment #${doc.treasury_ap_payment_id}`}</p>{doc.allocations.map(a => <div key={a.remittance_allocation_id}><p>Recovery #{a.payment_id}: {financeMoney(a.amount)}</p>{hasPermission('employee_finance:correct') && <FinanceCorrection scope={`remittance-return:${a.remittance_allocation_id}`} endpoint={`/hr/loan-remittances/${doc.remittance_id}/corrections`} base={{
          version: Number(doc.version),
          remittance_allocation_id: a.remittance_allocation_id,
          loan_version: data.withholdings.find(w => w.payment_id === a.payment_id)?.loan_version
        }} banks={banks} requiresFunding direction="IN" label="Record verified agency refund" onDone={done} />}</div>)}
 <details><summary>Agency evidence history</summary>{doc.events.map(e => <p key={e.event_id}>{financeLabel(e.state)} · {e.evidence} · {e.reason} · Statement {financeMoney(e.statement_amount)}</p>)}</details>
 {hasPermission('employee_finance:remit') && <details><summary>Reconcile agency confirmation</summary><Reconcile doc={doc} employeeId={employeeId} onDone={done} /></details>}
 </article>)}
 </section>;
}
