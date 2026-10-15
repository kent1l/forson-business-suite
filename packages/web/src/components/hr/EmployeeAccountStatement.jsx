import { FinanceCorrection } from './EmployeeAgencyLoans';
import Modal from '../ui/Modal';
import { useCallback, useEffect, useState } from 'react';
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
  const [source, setSource] = useState(null);
  const [sourceError, setSourceError] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [domain, setDomain] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const load = useCallback(async () => {
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
      setData(r.data);
    } catch (e) {
      setError(e.response?.data?.message || 'Statement unavailable.');
    }
  }, [employeeId, domain, from, to, page]);
  useEffect(() => {
    load();
  }, [load, refresh, user?.employee_id]);
  const openSource = async entry => {
    setSourceError('');
    setSource({
      title: `${entry.source_type} #${entry.source_id}`,
      loading: true
    });
    try {
      const r = await api.get(`/hr/employees/${employeeId}/account-sources/${entry.source_type}/${entry.source_id}`);
      setSource({
        title: `${entry.source_type} #${entry.source_id}`,
        data: r.data
      });
    } catch (e) {
      setSourceError(e.response?.data?.message || 'Source could not load.');
    }
  };
  return <section className="space-y-3"><Modal isOpen={Boolean(source)} onClose={() => setSource(null)} title={source?.title || 'Source document'}>{sourceError ? <p role="alert">{sourceError}</p> : source?.loading ? <p>Loading source…</p> : <dl className="space-y-2">{Object.entries(source?.data || {}).filter(([k, v]) => v !== null && typeof v !== 'object' && !['computation_trace', 'policy_snapshot', 'password_hash'].includes(k)).map(([k, v]) => <div key={k}><dt className="text-sm font-semibold">{k.replaceAll('_', ' ')}</dt><dd className="break-words">{String(v)}</dd></div>)}</dl>}
 {hasPermission('employee_finance:correct') && source?.data && source.title.startsWith('LOAN_PAYMENT') && source.data.payslip_id && !source.data.reversal_of && <FinanceCorrection scope={`recovery-reverse:${source.data.payment_id}`} endpoint={`/payroll/recoveries/${source.data.payment_id}/reversals`} base={{
        loan_version: source.data.loan_version,
        run_version: source.data.run_version
      }} banks={banks} label="Reverse exact payroll recovery and restore wages owed" onDone={() => {
        setSource(null);
        load();
      }} />}
 {hasPermission('employee_finance:correct') && source?.data && source.title.startsWith('LOAN_PAYMENT') && source.data.collection_id && !source.data.reversal_of && <FinanceCorrection scope={`collection-refund:${source.data.payment_id}`} endpoint={`/hr/employee-collections/${source.data.collection_id}/refunds`} base={{
        loan_version: source.data.loan_version,
        payment_id: source.data.payment_id
      }} banks={banks} requiresFunding label="Refund exact company collection allocation" onDone={() => {
        setSource(null);
        load();
      }} />}
 {hasPermission('employee_finance:correct') && source?.data && source.title.startsWith('PAYOUT #') && source.data.status === 'CONFIRMED' && source.data.allocations.map(a => <FinanceCorrection key={a.payout_allocation_id} scope={`payout-return:${a.payout_allocation_id}`} endpoint={`/payroll/payout-allocations/${a.payout_allocation_id}/returns`} base={{
        version: a.run_version
      }} banks={banks} requiresFunding label={`Record verified returned wages for payslip #${a.payslip_id}`} onDone={() => {
        setSource(null);
        load();
      }} />)}
 </Modal><h3 className="font-semibold">Statement</h3><div className="grid gap-2 sm:grid-cols-3"><label>Category<select className="w-full bg-transparent border rounded p-2" value={domain} onChange={e => {
          setDomain(e.target.value);
          setPage(1);
        }}><option value="">All categories (separate balances)</option>{Object.entries(labels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>From<input type="date" className="w-full bg-transparent border rounded p-2" value={from} onChange={e => {
          setFrom(e.target.value);
          setPage(1);
        }} /></label><label>To<input type="date" className="w-full bg-transparent border rounded p-2" value={to} onChange={e => {
          setTo(e.target.value);
          setPage(1);
        }} /></label></div>
 {error && <p role="alert">{error}<button onClick={load}>Retry</button></p>}{!data && !error && <p role="status">Loading statement…</p>}
 {data && <><div className="grid gap-2 sm:grid-cols-2">
 <article className="border rounded p-3"><h4>Owed to company</h4><p className="tabular-nums">₱{data.categories.owed_to_company.outstanding}</p></article>
 <article className="border rounded p-3"><h4>Owed to employee</h4><p className="tabular-nums">Unpaid salary ₱{data.categories.owed_to_employee.unpaid_salary} · Pending ₱{data.categories.owed_to_employee.pending}</p></article>
 <article className="border rounded p-3"><h4>Government loans</h4>{data.categories.government_loans.obligations.map(l => <p key={l.creditor}>{l.creditor} outstanding ₱{l.outstanding}</p>)}{data.categories.government_loans.withheld.map(l => <p key={l.creditor}>{l.creditor} withheld ₱{l.withheld}</p>)}<p>Withholding and remittance are distinct.</p></article>
 <article className="border rounded p-3"><h4>Business advances</h4>{data.categories.business_advances.records.length === 0 ? <p>No advances.</p> : data.categories.business_advances.records.map(a => <p key={a.advance_id}>Advance #{a.advance_id} · custody ₱{a.outstanding_custody}</p>)}<p>Use Cash Box for advance liquidation, returns and reimbursement.</p></article>
 </div><p className="text-xs">As of {data.as_of}{data.partial ? ' · Partial result' : ''}</p>
 {data.transactions.balances.map(b => <p key={b.domain}>{labels[b.domain]} — opening ₱{b.opening} · closing ₱{b.closing}</p>)}
 {data.transactions.data.length === 0 ? <p>{domain || from || to ? 'No entries match these filters.' : 'No account transactions.'}</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr><th>Date</th><th>Category / source</th><th>Details</th><th>Amount</th></tr></thead><tbody>{data.transactions.data.map(e => <tr key={`${e.source_type}:${e.source_id}`}><td>{e.occurred_at}</td><td>{labels[e.domain]} · <button className="underline" onClick={() => openSource(e)}>{e.source_type} #{e.source_id}</button></td><td>{e.description}</td><td className="whitespace-nowrap tabular-nums">₱{e.amount}</td></tr>)}</tbody></table></div>}
 <div className="flex gap-3"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>{page} / {data.transactions.totalPages}</span><button disabled={page >= data.transactions.totalPages} onClick={() => setPage(page + 1)}>Next</button></div>
 </>}
 </section>;
}
