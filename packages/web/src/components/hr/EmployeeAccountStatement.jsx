import { FinanceCorrection } from './EmployeeAgencyLoans';
import { FinanceDialog as Modal, FinancePanel, FinanceField, FinanceNotice } from './FinancePrimitives';
import { financeStyles as styles, financeMoney, financeDate, financeLabel } from './financePresentation';
import LoadingState from '../ui/LoadingState';
import EmptyState from '../ui/EmptyState';
import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
const labels = {
  COMPANY: 'Owed to company',
  EMPLOYEE: 'Owed to employee',
  GOVERNMENT: 'Government loans',
  ADVANCES: 'Business advances'
};
export default function EmployeeAccountStatement({
  employeeId,
  refresh = 0,
  banks = []
}) {
  const {
    user,
    hasPermission
  } = useAuth();
  const requestSequence = useRef(0);
  const sourceSequence = useRef(0);
  useEffect(() => () => { requestSequence.current++; sourceSequence.current++; }, []);
  const [source, setSource] = useState(null);
  const [sourceError, setSourceError] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [domain, setDomain] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setData(null);
    setError('');
    try {
      const r = await api.get(`/hr/employees/${employeeId}/accounts`, {
        params: {
          domain: domain || undefined,
          from: from || undefined,
          to: to || undefined,
          page,
          pageSize: 25
        }
      });
      if (sequence === requestSequence.current) setData(r.data);
    } catch (e) {
      if (sequence === requestSequence.current) setError(e.response?.data?.message || 'Statement unavailable.');
    }
  }, [employeeId, domain, from, to, page]);
  useEffect(() => {
    load();
  }, [load, refresh, user?.employee_id]);
  const openSource = async entry => {
    const sequence = ++sourceSequence.current;
    setSourceError('');
    setSource({
      type: entry.source_type,
      title: `${financeLabel(entry.source_type)} #${entry.source_id}`,
      loading: true
    });
    try {
      const r = await api.get(`/hr/employees/${employeeId}/account-sources/${entry.source_type}/${entry.source_id}`);
      if (sequence === sourceSequence.current) setSource({
        type: entry.source_type,
      title: `${financeLabel(entry.source_type)} #${entry.source_id}`,
        data: r.data
      });
    } catch (e) {
      if (sequence === sourceSequence.current) setSourceError(e.response?.data?.message || 'Source could not load.');
    }
  };
  return <section className="space-y-3"><Modal isOpen={Boolean(source)} onClose={() => { sourceSequence.current++; setSource(null); }} title={source?.title || 'Source document'}>{sourceError ? <p role="alert">{sourceError}</p> : source?.loading ? <p>Loading source…</p> : <dl className="space-y-2">{Object.entries(source?.data || {}).filter(([k, v]) => v !== null && typeof v !== 'object' && !['computation_trace', 'policy_snapshot', 'password_hash', 'request_id', 'payload_hash'].includes(k) && !k.endsWith('_version') && k !== 'version').map(([k, v]) => <div key={k}><dt className="text-sm font-semibold">{financeLabel(k)}</dt><dd className="break-words">{/(amount|paid|payable|outstanding|net_pay)$/.test(k) ? financeMoney(v) : /(_at|_date)$/.test(k) ? financeDate(v, k.endsWith('_at')) : String(v)}</dd></div>)}</dl>}
 {hasPermission('employee_finance:correct') && source?.data && source.type === 'LOAN_PAYMENT' && source.data.payslip_id && !source.data.reversal_of && <FinanceCorrection scope={`recovery-reverse:${source.data.payment_id}`} endpoint={`/payroll/recoveries/${source.data.payment_id}/reversals`} base={{
        loan_version: source.data.loan_version,
        run_version: source.data.run_version
      }} banks={banks} label="Reverse exact payroll recovery and restore wages owed" onDone={() => {
        setSource(null);
        load();
      }} />}
 {hasPermission('employee_finance:correct') && source?.data && source.type === 'LOAN_PAYMENT' && source.data.collection_id && !source.data.reversal_of && <FinanceCorrection scope={`collection-refund:${source.data.payment_id}`} endpoint={`/hr/employee-collections/${source.data.collection_id}/refunds`} base={{
        loan_version: source.data.loan_version,
        payment_id: source.data.payment_id
      }} banks={banks} requiresFunding label="Refund exact company collection allocation" onDone={() => {
        setSource(null);
        load();
      }} />}
 {hasPermission('employee_finance:correct') && source?.data && source.type === 'PAYOUT' && source.data.status === 'CONFIRMED' && source.data.allocations.map(a => <FinanceCorrection key={a.payout_allocation_id} scope={`payout-return:${a.payout_allocation_id}`} endpoint={`/payroll/payout-allocations/${a.payout_allocation_id}/returns`} base={{
        version: a.run_version
      }} banks={banks} requiresFunding direction="IN" label={`Record verified returned wages for payslip #${a.payslip_id}`} onDone={() => {
        setSource(null);
        load();
      }} />)}
 </Modal><div><h3 className="text-sm font-semibold">Balances & activity</h3><p className={`mt-1 ${styles.muted}`}>Balances remain separate by purpose. Statement filters apply to activity below.</p></div>
 {error && <p role="alert">{error}<button onClick={load}>Retry</button></p>}{!data && !error && <LoadingState label="Loading statement…" compact/>}
 {data && <><div className="grid gap-4 sm:grid-cols-2">
 <FinancePanel title="Owed to company" description="Company loan principal and agreed charges"><p className="break-words text-2xl font-semibold tabular-nums">{financeMoney(data.categories.owed_to_company.outstanding)}</p></FinancePanel>
 <FinancePanel title="Owed to employee" description="Approved salary awaiting actual settlement"><p className="break-words text-2xl font-semibold tabular-nums">{financeMoney(data.categories.owed_to_employee.unpaid_salary)}</p><p className={`mt-2 ${styles.muted}`}>Pending bank outcome: {financeMoney(data.categories.owed_to_employee.pending)}</p></FinancePanel>
 <FinancePanel title="Government loans" description="Agency balances and company withholding"><div className="space-y-2 text-sm">{data.categories.government_loans.obligations.map(l => <p key={l.creditor}>{financeLabel(l.creditor)} outstanding <span className="font-semibold tabular-nums">{financeMoney(l.outstanding)}</span></p>)}{data.categories.government_loans.withheld.map(l => <p key={l.creditor}>{financeLabel(l.creditor)} withheld <span className="font-semibold tabular-nums">{financeMoney(l.withheld)}</span></p>)}{!data.categories.government_loans.obligations.length && !data.categories.government_loans.withheld.length && <p className={styles.muted}>No government loan balances.</p>}<p className={styles.muted}>Withholding and remittance are tracked separately.</p></div></FinancePanel>
 <FinancePanel title="Business advances" description="Company funds held for business expenses"><div className="space-y-2">{data.categories.business_advances.records.length === 0 ? <p className={styles.muted}>No advances.</p> : data.categories.business_advances.records.map(a => <p className="text-sm" key={a.advance_id}>Advance #{a.advance_id} · custody {financeMoney(a.outstanding_custody)}</p>)}<p className={styles.muted}>Manage liquidation, returns and reimbursement in Cash Box.</p></div></FinancePanel>
 </div><p className={styles.muted}>As of {financeDate(data.as_of,true)} · Manila time</p>{data.partial && <FinanceNotice tone="warning">Partial result. Some account information could not be included.</FinanceNotice>}


 </>}
 <div className="pt-3"><h3 className="mb-3 text-sm font-semibold">Statement activity</h3><div className="grid gap-3 sm:grid-cols-3"><FinanceField label="Category"><select className={styles.input} value={domain} onChange={e => {setDomain(e.target.value);setPage(1);}}><option value="">All categories</option>{Object.entries(labels).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></FinanceField><FinanceField label="From"><input type="date" className={styles.input} value={from} max={to || undefined} onChange={e => {setFrom(e.target.value);setPage(1);}}/></FinanceField><FinanceField label="To"><input type="date" className={styles.input} value={to} min={from || undefined} onChange={e => {setTo(e.target.value);setPage(1);}}/></FinanceField></div></div>
 {data && <>

 {data.transactions.balances.map(b => <p className={styles.muted} key={b.domain}>{labels[b.domain]} · opening {financeMoney(b.opening)} · closing {financeMoney(b.closing)}</p>)}
 {data.transactions.data.length === 0 ? <EmptyState title={domain || from || to ? 'No entries match these filters.' : 'No account transactions.'} description="Verified account activity will appear here with its source document."/> : <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700"><table className="w-full text-sm"><thead><tr><th>Date</th><th>Category / source</th><th>Details</th><th>Amount</th></tr></thead><tbody>{data.transactions.data.map(e => <tr key={`${e.source_type}:${e.source_id}`}><td className="whitespace-nowrap">{financeDate(e.occurred_at,true)}</td><td>{labels[e.domain]} · <button className="underline" onClick={() => openSource(e)}>{financeLabel(e.source_type)} #{e.source_id}</button></td><td>{e.description}</td><td className="whitespace-nowrap tabular-nums">{financeMoney(e.amount)}</td></tr>)}</tbody></table></div>}
 <div className="flex items-center justify-between gap-3 text-xs"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>{page} / {Math.max(1,data.transactions.totalPages)}</span><button disabled={page >= data.transactions.totalPages} onClick={() => setPage(page + 1)}>Next</button></div>
 </>}
 </section>;
}
