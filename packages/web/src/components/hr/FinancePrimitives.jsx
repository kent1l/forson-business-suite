import { useEffect, useRef, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { createUuid } from '../../utils/createUuid';
import Modal from '../ui/Modal';
import StatusBadge from '../ui/StatusBadge';
import { financeStyles as styles, financeLabel, financeMoney } from './financePresentation';
import './employeeFinance.css';

export function FinanceField({ label, children, hint }) {
  return <label className="block min-w-0 space-y-1.5"><span className="text-xs font-semibold text-gray-600 dark:text-slate-300">{label}</span>{children}{hint && <span className={`block ${styles.muted}`}>{hint}</span>}</label>;
}
export function FinancePanel({ title, description, actions, children }) {
  return <section className={styles.card}><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{title}</h3>{description && <p className={`mt-1 ${styles.muted}`}>{description}</p>}</div>{actions}</div>{children}</section>;
}
export function FinanceNotice({ children, tone = 'info' }) {
  const color = tone === 'danger' ? 'border-danger-100 bg-danger-50 text-danger-700 dark:border-danger-700 dark:bg-danger-900/20 dark:text-danger-500' : tone === 'warning' ? 'border-warning-100 bg-warning-50 text-warning-700 dark:border-warning-700 dark:bg-warning-900/20 dark:text-warning-500' : 'border-primary-100 bg-primary-50 text-primary-700 dark:border-primary-700 dark:bg-primary-900/20 dark:text-primary-500';
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-lg border px-3 py-2.5 text-xs leading-relaxed ${color}`}>{children}</div>;
}
export function FinanceStatus({ value }) {
  const tone = ['Active', 'ACTIVE', 'CONFIRMED', 'RECONCILED', 'SETTLED', 'RECOVERED'].includes(value) ? 'success' : ['UNKNOWN', 'PENDING', 'NEEDS_REVIEW', 'On Hold', 'LEGACY_ACTIVE'].includes(value) ? 'warning' : ['FAILED', 'CANCELLED', 'Voided'].includes(value) ? 'danger' : 'neutral';
  return <StatusBadge tone={tone} label={financeLabel(value)} />;
}
export function FinanceFigures({ items }) {
  return <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">{items.map(([label, value]) => <div key={label} className="min-w-0"><dt className={styles.muted}>{label}</dt><dd className="mt-1 break-words text-sm font-semibold tabular-nums text-gray-900 dark:text-slate-100">{financeMoney(value)}</dd></div>)}</dl>;
}
export function FinanceDialog({ isOpen, onClose, title, children }) {
  const ref = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!isOpen) return;
    const previous = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusable = () => [...(ref.current?.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]') || [])].filter(el => !el.disabled && el.getClientRects().length);
    focusable()[0]?.focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const elements = focusable(); const first = elements[0]; const last = elements.at(-1);
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !ref.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !ref.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown, true);
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener('keydown', keydown, true); if (previous?.isConnected) previous.focus(); };
  }, [isOpen]);
  return isOpen ? <div ref={ref} role="dialog" aria-modal="true" aria-label={title} className="employee-finance"><Modal isOpen onClose={onClose} title={title} maxWidth="max-w-2xl" zIndexClass="z-[70]">{children}</Modal></div> : null;
}
export function FundingFields({ value, onChange, banks = [], direction = 'OUT', amount }) {
  const { user, hasPermission } = useAuth();
  const [sessions, setSessions] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const set = (key, v) => onChange({ ...value, [key]: v });
  useEffect(() => {
    if (value.method !== 'CASH') return;
    let live = true; setError('');
    if (!hasPermission('cash_drawer:view')) { setError('Cash drawer access is required to select your open session.'); return; }
    api.get('/cash-drawers/sessions', { params: { status: 'OPEN', custodian_id: user?.employee_id, limit: 100 } }).then(r => { if (live) setSessions(r.data.data || []); }).catch(e => { if (live) setError(e.response?.data?.message || 'Open drawer sessions could not load.'); });
    return () => { live = false; };
  }, [value.method, user?.employee_id, hasPermission, refresh]);
  useEffect(() => {
    setApprovals([]);
    if (value.method !== 'CASH' || !value.session_id || direction === 'IN') return;
    let live = true;
    api.get(`/cash-drawers/sessions/${value.session_id}/approvals`).then(r => { if (live) setApprovals((r.data.data || []).filter(a => a.action === 'MANUAL_RELEASE' && a.decision === 'APPROVED' && Number(a.requester_id) === Number(user?.employee_id) && Number(a.bound_version) === Number(value.version))); }).catch(() => { if (live) setError('Release approvals could not load. Refresh the drawer selection.'); });
    return () => { live = false; };
  }, [value.method, value.session_id, value.version, user?.employee_id, direction, refresh]);
  return <fieldset className="rounded-xl border border-gray-200 dark:border-slate-700 bg-gray-50/70 dark:bg-slate-900/40 p-4 space-y-4"><legend className="px-1 text-xs font-semibold text-gray-600 dark:text-slate-300">{direction === 'IN' ? 'Receipt evidence' : 'Payment evidence'}</legend>
    <FinanceField label="Method"><select className={styles.input} value={value.method} onChange={e => onChange({ method: e.target.value })}><option value="BANK">Bank</option><option value="CASH">Cash drawer</option></select></FinanceField>
    {value.method === 'BANK' ? <><FinanceField label="Company bank account"><select required className={styles.input} value={value.bank_account_id || ''} onChange={e => set('bank_account_id', e.target.value)}><option value="">Select account</option>{banks.map(b => <option key={b.bank_account_id} value={b.bank_account_id}>{b.account_name} — {b.bank_name}</option>)}</select></FinanceField>{!banks.length && <FinanceNotice tone="warning">No available company bank accounts. Add or activate an account in Treasury before recording a bank payment.</FinanceNotice>}<label className="flex items-start gap-2 text-xs text-gray-600 dark:text-slate-300"><input type="checkbox" checked={value.confirmed || false} onChange={e => set('confirmed', e.target.checked)} className="mt-0.5 accent-primary-600"/>Confirmed from bank evidence</label></> : <><FinanceField label="Your open cash drawer"><select required className={styles.input} value={value.session_id || ''} onChange={e => { const selected = sessions.find(s => String(s.session_id) === e.target.value); onChange({ ...value, session_id: selected?.session_id || '', version: selected ? Number(selected.version) : undefined, approval_id: '' }); }}><option value="">Select an open session</option>{sessions.map(s => <option key={s.session_id} value={s.session_id}>{s.drawer_name} · {s.session_code}</option>)}</select></FinanceField><button type="button" className={styles.button} onClick={() => { onChange({ ...value, session_id: '', version: undefined, approval_id: '' }); setRefresh(n => n + 1); }}>Refresh drawer availability</button>{error && <FinanceNotice tone="danger">{error}</FinanceNotice>}{!sessions.length && !error && <p className={styles.muted}>Open your cash drawer in Cash Box to continue.</p>}{direction === 'OUT' && <FinanceField label="Approved cash release" hint="Select an independent approval matching this release amount. Request a new review in Cash Box if none is available."><select required className={styles.input} value={value.approval_id || ''} onChange={e => set('approval_id', e.target.value)}><option value="">Select an approved release</option>{approvals.filter(a => !amount || financeMoney(a.bound_amount) === financeMoney(amount)).map(a => <option key={a.approval_id} value={a.approval_id}>{financeMoney(a.bound_amount)} · {a.reason}</option>)}</select></FinanceField>}</>}
    <div className="grid gap-4 sm:grid-cols-2"><FinanceField label="Bank / receipt reference"><input required className={styles.input} value={value.external_reference || ''} onChange={e => set('external_reference', e.target.value)}/></FinanceField><FinanceField label="Actual occurrence time (Manila)"><input required type="datetime-local" className={styles.input} value={value.local_time || ''} onChange={e => onChange({ ...value, local_time: e.target.value, occurred_at: e.target.value ? new Date(`${e.target.value}+08:00`).toISOString() : null })}/></FinanceField></div>
    <FinanceField label="Evidence reference"><input required className={styles.input} value={value.evidence || ''} onChange={e => set('evidence', e.target.value)}/></FinanceField>
    {value.method === 'CASH' && <FinanceField label="Late posting reason" hint="Required only if the event occurred before this session opened."><input className={styles.input} value={value.late_reason || ''} onChange={e => set('late_reason', e.target.value)}/></FinanceField>}
  </fieldset>;
}

export function FinanceCommand({
  scope,
  endpoint,
  body,
  onDone,
  children,
  label = 'Save',
  disabled = false
}) {
  const {
    user
  } = useAuth();
  const key = `employee-finance:${user?.employee_id}:${scope}`;
  const [pending, setPending] = useState(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) || 'null');
    } catch {
      return null;
    }
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      setPending(JSON.parse(sessionStorage.getItem(key) || 'null'));
    } catch {
      setPending(null);
    }
    setError('');
  }, [key]);
  const send = async event => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    let queued = false;
    try {
      const request = pending || {
        endpoint,
        body: {
          ...body,
          request_id: createUuid()
        }
      };
      sessionStorage.setItem(key, JSON.stringify(request));
      setPending(request);
      queued = true;
      await api.post(request.endpoint, request.body);
      sessionStorage.removeItem(key);
      setPending(null);
      toast.success('Financial record saved.');
      onDone?.();
    } catch (e) {
      if (e.response && (e.response.status < 500 || e.response.data?.code === 'DRAWER_DISABLED')) {
        sessionStorage.removeItem(key);
        setPending(null);
      }
      setError(!queued ? 'Secure browser storage is unavailable. No request was submitted.' : e.response?.data?.message || 'Outcome unknown. Retry the same request to reconcile; do not create a replacement.');
    } finally {
      setBusy(false);
    }
  };
  return <form onSubmit={send} className="space-y-4"><fieldset disabled={busy || Boolean(pending)} className="space-y-4">{children}</fieldset>{error && <FinanceNotice tone="danger">{error}</FinanceNotice>}{pending && <FinanceNotice tone="warning">A request is awaiting reconciliation. Retry preserves the original details.</FinanceNotice>}<button type="submit" disabled={busy || disabled && !pending} className={styles.primary}>{busy ? 'Saving…' : pending ? 'Reconcile same request' : label}</button></form>;
}
