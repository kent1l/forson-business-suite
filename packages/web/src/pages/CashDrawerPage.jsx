import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import api from '../api';

const DENOMS = [
    ['PHP_1000', '₱1,000', 100000], ['PHP_500', '₱500', 50000], ['PHP_200', '₱200', 20000],
    ['PHP_100', '₱100', 10000], ['PHP_50', '₱50', 5000], ['PHP_20', '₱20', 2000],
    ['PHP_10', '₱10', 1000], ['PHP_5', '₱5', 500], ['PHP_1', '₱1', 100],
    ['PHP_025', '₱0.25', 25], ['PHP_010', '₱0.10', 10], ['PHP_005', '₱0.05', 5], ['PHP_001', '₱0.01', 1],
];
const money = amount => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount || 0));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const field = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:ring-2 focus:ring-amber-500 dark:border-slate-700 dark:bg-slate-900 dark:text-white';
const button = 'min-h-11 rounded-lg bg-amber-600 px-4 py-2 font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50';
const validMoney = value => /^(0|[1-9]\d*)(\.\d{1,2})?$/.test(String(value));
const validQuantity = value => value == null || value === '' || (/^(0|[1-9]\d*)$/.test(String(value)) && Number(value) <= 2147483647);

function DenominationEditor({ value, onChange }) {
    const valid = DENOMS.every(([code]) => validQuantity(value[code]));
    const total = valid ? DENOMS.reduce((sum, [code, , cents]) => sum + BigInt(cents) * BigInt(value[code] || 0), 0n) : 0n;
    return <div>
        {!valid && <p role="alert" className="mb-2 text-red-700 dark:text-red-300">Quantities must be whole, nonnegative numbers.</p>}
        <div data-denominations className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {DENOMS.map(([code, label]) => <label key={code} className="block text-sm font-medium">
                <span className="mb-1 block">{label}</span>
                <input inputMode="numeric" type="number" min="0" step="1" className={field} value={value[code] ?? ''}
                    onChange={event => onChange({ ...value, [code]: event.target.value })}
                    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); const inputs = [...event.currentTarget.closest('[data-denominations]').querySelectorAll('input')]; const next = inputs[inputs.indexOf(event.currentTarget) + 1] || event.currentTarget.form?.querySelector('textarea'); next?.focus(); } }} />
            </label>)}
        </div>
        <p className="sticky bottom-0 mt-3 bg-white py-2 text-right text-lg font-bold tabular-nums dark:bg-slate-900">Counted: {valid ? money(Number(total) / 100) : 'Check quantities'}</p>
    </div>;
}

function linesFromQuantities(quantities) {
    if (DENOMS.some(([code]) => !validQuantity(quantities[code]))) return null;
    return DENOMS.map(([code]) => ({ code, quantity: quantities[code] === '' || quantities[code] == null ? 0 : Number(quantities[code]) }));
}

function Panel({ title, children }) {
    return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>{children}
    </section>;
}

function ReviewRequest({ action, session, amount, reason, value, onChange, post, busy }) {
    return <div className="rounded border border-amber-300 p-2 text-sm dark:border-amber-800">
        <p>Independent manager review is required for this release.</p>
        <button type="button" className={`${button} mt-2`} disabled={busy || !validMoney(amount) || Number(amount) <= 0 || !reason}
            onClick={async () => {
                const result = await post('/cash-drawers/approvals', { action, session_id: session.session_id,
                    expected_version: session.version, amount, reason }, `review-${action}`);
                if (result) onChange(String(result.data.approval_id));
            }}>Request review</button>
        <input className={`${field} mt-2`} placeholder="Approved review ID" value={value || ''} onChange={event => onChange(event.target.value)} />
    </div>;
}

function TransferEventForm({ transfer, drawers, post, busy }) {
    const [form, setForm] = useState({ stage: 'ACKNOWLEDGED', amount: '', evidence: '', receiving_session_id: '' });
    return <form className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-700" onSubmit={async event => {
        event.preventDefault();
        const result = await post(`/cash-drawers/transfers/${transfer.transfer_id}/events`, form, `transfer-event-${transfer.transfer_id}`);
        if (result) setForm({ stage: 'ACKNOWLEDGED', amount: '', evidence: '', receiving_session_id: '' });
    }}>
        <strong>Transfer #{transfer.transfer_id} · {money(transfer.amount)} · {transfer.recipient_name}</strong>
        <p className="text-xs">{transfer.events.map(item => `${item.stage} ${money(item.amount)}`).join(' · ') || 'No custody confirmation yet'}</p>
        <select className={field} value={form.stage} onChange={event => setForm({ ...form, stage: event.target.value })}><option>ACKNOWLEDGED</option><option>DEPOSITED</option><option>RETURNED</option><option>NOTE</option></select>
        {form.stage !== 'NOTE' && <input className={field} inputMode="decimal" placeholder="Amount" required value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} />}
        {form.stage === 'RETURNED' && <select className={field} required value={form.receiving_session_id} onChange={event => setForm({ ...form, receiving_session_id: event.target.value })}><option value="">Receiving open session</option>{drawers.filter(item => item.status === 'OPEN').map(item => <option key={item.session_id} value={item.session_id}>{item.name}</option>)}</select>}
        <input className={field} placeholder="Evidence / reference" required={form.stage !== 'NOTE'} value={form.evidence} onChange={event => setForm({ ...form, evidence: event.target.value })} />
        <button className={button} disabled={busy}>Record custody event</button>
    </form>;
}

function AdvanceEventForm({ advance, drawers, post, busy }) {
    const [form, setForm] = useState({ kind: 'RETURN', amount: '', expense_id: '', ap_payment_id: '', receiving_session_id: '', notes: '' });
    const receiving = drawers.find(item => String(item.session_id) === String(form.receiving_session_id));
    return <form className="space-y-2 rounded border border-slate-200 p-3 dark:border-slate-700" onSubmit={async event => {
        event.preventDefault();
        const result = await post(`/cash-drawers/advances/${advance.advance_id}/events`, form, `advance-event-${advance.advance_id}`);
        if (result) setForm({ kind: 'RETURN', amount: '', expense_id: '', ap_payment_id: '', receiving_session_id: '', notes: '' });
    }}>
        <strong>Advance #{advance.advance_id} · {money(advance.amount)} · {advance.employee_name}</strong>
        <p className="text-xs">{advance.events.map(item => `${item.kind} ${money(item.amount)}`).join(' · ') || 'Outstanding'}</p>
        <select className={field} value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value })}><option>RETURN</option><option>REIMBURSEMENT</option><option>CONSUMPTION</option><option>SETTLEMENT</option></select>
        {form.kind !== 'SETTLEMENT' && <input className={field} inputMode="decimal" placeholder="Amount" required value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} />}
        {form.kind === 'CONSUMPTION' && <div className="grid gap-2 sm:grid-cols-2"><input className={field} type="number" placeholder="Expense ID" value={form.expense_id} onChange={event => setForm({ ...form, expense_id: event.target.value, ap_payment_id: '' })} /><input className={field} type="number" placeholder="Supplier payment ID" value={form.ap_payment_id} onChange={event => setForm({ ...form, ap_payment_id: event.target.value, expense_id: '' })} /></div>}
        {form.kind === 'REIMBURSEMENT' && <div className="grid gap-2 sm:grid-cols-2"><input className={field} type="number" placeholder="Expense ID" required={!form.ap_payment_id} value={form.expense_id} onChange={event => setForm({ ...form, expense_id: event.target.value, ap_payment_id: '' })} /><input className={field} type="number" placeholder="Supplier payment ID" required={!form.expense_id} value={form.ap_payment_id} onChange={event => setForm({ ...form, ap_payment_id: event.target.value, expense_id: '' })} /></div>}
        {['RETURN','REIMBURSEMENT'].includes(form.kind) && <select className={field} required value={form.receiving_session_id} onChange={event => setForm({ ...form, receiving_session_id: event.target.value })}><option value="">Open session for physical cash</option>{drawers.filter(item => item.status === 'OPEN').map(item => <option key={item.session_id} value={item.session_id}>{item.name}</option>)}</select>}
        <input className={field} placeholder="Notes" value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} />
        {form.kind === 'REIMBURSEMENT' && receiving?.status === 'OPEN' && <ReviewRequest action="REIMBURSEMENT" session={receiving} amount={form.amount} reason={form.notes}
            value={form.approval_id} onChange={approval_id => setForm({ ...form, approval_id })} post={post} busy={busy} />}
        <button className={button} disabled={busy}>Record advance event</button>
    </form>;
}

export default function CashDrawerPage({ user, onNavigate, pageState }) {
    const openingDraftKey = `cash-box-opening:${user?.employee_id}`;
    const [openingSaved] = useState(() => {
        try { return JSON.parse(sessionStorage.getItem(openingDraftKey) || 'null') || {}; }
        catch { sessionStorage.removeItem(openingDraftKey); return {}; }
    });
    const [returnState] = useState(() => {
        try { return pageState || JSON.parse(sessionStorage.getItem(`cash-box-return:${user?.employee_id}`) || 'null') || {}; }
        catch { return pageState || {}; }
    });
    const [drawers, setDrawers] = useState([]);
    const [drawerId, setDrawerId] = useState(String(returnState.drawerId || ''));
    const [session, setSession] = useState(null);
    const [movements, setMovements] = useState([]);
    const [registerPage, setRegisterPage] = useState(returnState.registerPage || 1);
    const [registerTotal, setRegisterTotal] = useState(0);
    const [registerSearch, setRegisterSearch] = useState(returnState.registerSearch || '');
    const [registerDirection, setRegisterDirection] = useState(returnState.registerDirection || '');
    const [registerCategory, setRegisterCategory] = useState(returnState.registerCategory || '');
    const [registerSource, setRegisterSource] = useState(returnState.registerSource || '');
    const [registerOperator, setRegisterOperator] = useState(returnState.registerOperator || '');
    const [registerTimeField, setRegisterTimeField] = useState(returnState.registerTimeField || 'recorded_at');
    const [registerFrom, setRegisterFrom] = useState(returnState.registerFrom || '');
    const [registerTo, setRegisterTo] = useState(returnState.registerTo || '');
    const [selectedMovement, setSelectedMovement] = useState(null);
    const [counts, setCounts] = useState([]);
    const [approvals, setApprovals] = useState([]);
    const [custody, setCustody] = useState({ transfers: [], advances: [] });
    const [custodyFilter, setCustodyFilter] = useState('PENDING');
    const [history, setHistory] = useState([]);
    const [historyDetail, setHistoryDetail] = useState(null);
    const [tab, setTab] = useState(returnState.tab || 'Today');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [pendingWrite, setPendingWrite] = useState(() => {
        const prefix = `cash-box-write:${user?.employee_id}:`;
        const key = Object.keys(sessionStorage).find(item => item.startsWith(prefix));
        try { return key ? { storageKey: key, ...JSON.parse(sessionStorage.getItem(key)) } : null; }
        catch { if (key) sessionStorage.removeItem(key); return null; }
    });
    const [lastRefresh, setLastRefresh] = useState(null);
    const [openDate, setOpenDate] = useState(openingSaved.openDate || today());
    const [custodians, setCustodians] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [custodianLoadError, setCustodianLoadError] = useState(false);
    const [custodianId, setCustodianId] = useState(openingSaved.custodianId || String(user?.employee_id || ''));
    const [openingSource, setOpeningSource] = useState(openingSaved.openingSource || 'FRESH_FLOAT');
    const [openingAmount, setOpeningAmount] = useState(openingSaved.openingAmount || '0.00');
    const [freshAmount, setFreshAmount] = useState(openingSaved.freshAmount || '0.00');
    const [openingReason, setOpeningReason] = useState(openingSaved.openingReason || '');
    const [openingApprovalId, setOpeningApprovalId] = useState(openingSaved.openingApprovalId || '');
    const [showOpen, setShowOpen] = useState(false);
    const [quantities, setQuantities] = useState(openingSaved.quantities || {});
    const [countQuantities, setCountQuantities] = useState({});
    const [countNotes, setCountNotes] = useState('');
    const [draftCount, setDraftCount] = useState(null);
    const [nowTick, setNowTick] = useState(Date.now());
    const [movementForm, setMovementForm] = useState({ direction: 'IN', category: 'NOTEBOOK_RECEIPT', amount: '', description: '', counterparty: '', physical_reference: '', occurred_at: '', late_reason: '' });
    const [movementOpen, setMovementOpen] = useState(false);
    const [transferForm, setTransferForm] = useState({ amount: '', destination: '', recipient_id: '' });
    const [advanceForm, setAdvanceForm] = useState({ employee_id: '', amount: '', purpose: '' });
    const [approvalId, setApprovalId] = useState('');
    const [reviewReason, setReviewReason] = useState('');
    const [closeStep, setCloseStep] = useState(1);
    const [sourcesChecked, setSourcesChecked] = useState(false);
    const [closeNotes, setCloseNotes] = useState('');
    const [handover, setHandover] = useState({ amount: '', destination: '', recipient_id: '', recipient_password: '', evidence: '' });
    const keys = useRef(new Map());
    const draftKey = draftCount && `cash-box-count:${user?.employee_id}:${draftCount.session_id}:${draftCount.count_id}`;
    const countWindowValid = !!draftCount && !!session?.count_window_expires_at &&
        new Date(session.count_window_expires_at).getTime() > nowTick &&
        Number(session.version) === Number(draftCount.cutoff_version) &&
        Number(session.last_sequence) === Number(draftCount.cutoff_sequence) &&
        Number(user?.employee_id) === Number(draftCount.counter_id);

    const reload = useCallback(async (desiredDrawerId = drawerId) => {
        try {
            const drawerResponse = await api.get('/cash-drawers');
            const drawerRows = drawerResponse.data?.data || [];
            setDrawers(drawerRows);
            const chosen = desiredDrawerId || String(drawerRows[0]?.drawer_id || '');
            if (!chosen) return;
            setDrawerId(String(chosen));
            const sessionsResponse = await api.get('/cash-drawers/sessions', { params: { drawer_id: chosen, limit: 50 } });
            const sessions = sessionsResponse.data?.data || [];
            setHistory(sessions);
            const active = sessions.find(item => item.status !== 'CLOSED');
            const current = active || sessions[0];
            if (!current) { setSession(null); setMovements([]); setCounts([]); return; }
            const id = current.session_id;
            const [detail, register, savedCounts, savedCustody, savedApprovals] = await Promise.all([
                api.get(`/cash-drawers/sessions/${id}`), api.get(`/cash-drawers/sessions/${id}/movements`,
                    { params: { page: registerPage, limit: 50, search: registerSearch || undefined, direction: registerDirection || undefined,
                        category: registerCategory || undefined, source: registerSource || undefined, operator: registerOperator || undefined,
                        time_field: registerTimeField, from: registerFrom || undefined, to: registerTo || undefined } }),
                api.get(`/cash-drawers/sessions/${id}/counts`), api.get(`/cash-drawers/sessions/${id}/custody`),
                api.get(`/cash-drawers/sessions/${id}/approvals`),
            ]);
            setSession(detail.data.data);
            setMovements(register.data?.data || []);
            setRegisterTotal(register.data?.total || 0);
            setSelectedMovement(selected => (register.data?.data || []).find(item => item.movement_id === selected?.movement_id) || null);
            setCounts(savedCounts.data?.data || []);
            setDraftCount((savedCounts.data?.data || []).find(item => item.status === 'DRAFT') || null);
            setCustody(savedCustody.data || { transfers: [], advances: [] });
            setApprovals(savedApprovals.data?.data || []);
            setLastRefresh(new Date());
            setError('');
        } catch (requestError) {
            setError(requestError.response?.data?.message || 'Unable to refresh the cash drawer.');
        }
    }, [drawerId, registerPage, registerSearch, registerDirection, registerCategory, registerSource, registerOperator, registerTimeField, registerFrom, registerTo]);

    useEffect(() => {
        if (!draftKey) return;
        try {
            const saved = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
            if (saved && countWindowValid) {
                setCountQuantities(saved.quantities || {});
                setCountNotes(saved.notes || '');
            }
        } catch { sessionStorage.removeItem(draftKey); }
    }, [draftKey, countWindowValid]);

    useEffect(() => {
        if (draftKey && draftCount?.status === 'DRAFT') sessionStorage.setItem(draftKey, JSON.stringify({ quantities: countQuantities, notes: countNotes }));
    }, [draftKey, draftCount?.status, countQuantities, countNotes]);
    useEffect(() => {
        if (!draftCount) return undefined;
        const timer = setInterval(() => setNowTick(Date.now()), 10000);
        return () => clearInterval(timer);
    }, [draftCount]);
    useEffect(() => {
        if (session?.status === 'OPEN' || session?.status === 'CLOSING') {
            sessionStorage.removeItem(openingDraftKey);
            return;
        }
        sessionStorage.setItem(openingDraftKey, JSON.stringify({ openDate, custodianId, openingSource, openingAmount,
            freshAmount, openingReason, openingApprovalId, quantities }));
    }, [openingDraftKey, session?.status, openDate, custodianId, openingSource, openingAmount, freshAmount, openingReason, openingApprovalId, quantities]);

    useEffect(() => { reload(); }, [reload]);
    useEffect(() => {
        let live = true;
        api.get('/cash-drawers/custodians').then(response => {
            if (live) {
                const people = response.data?.data || [];
                setCustodians(people);
                setCustodianId(current => people.some(person => String(person.employee_id) === current) ? current : '');
                setCustodianLoadError(false);
            }
        }).catch(() => { if (live) setCustodianLoadError(true); });
        return () => { live = false; };
    }, []);
    useEffect(() => {
        let live = true;
        api.get('/cash-drawers/employees').then(response => { if (live) setEmployees(response.data?.data || []); })
            .catch(() => { if (live) setError('Unable to load eligible recipients. Refresh before a cash release.'); });
        return () => { live = false; };
    }, []);
    useEffect(() => {
        if (session?.status === 'CLOSED' && !openingSaved.openingAmount) {
            setOpeningSource('PRIOR_RETAINED');
            setOpeningAmount(session.close_snapshot?.retained_actual || '0.00');
        }
    }, [session?.session_id, session?.status, openingSaved.openingAmount, session?.close_snapshot?.retained_actual]);
    useEffect(() => {
        const onFocus = () => reload();
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [reload]);

    const post = async (path, payload, action = path) => {
        const body = JSON.stringify(payload);
        const storageKey = `cash-box-write:${user?.employee_id}:${action}`;
        if (pendingWrite && pendingWrite.storageKey !== storageKey) {
            setError('Resolve the earlier cash write before starting another.');
            return null;
        }
        let saved = null;
        try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { sessionStorage.removeItem(storageKey); }
        const pending = keys.current.get(action) || saved;
        if (pending && pending.body !== body) {
            setError('A previous write has an unknown result. Retry that exact request before changing this form.');
            setPendingWrite({ storageKey, ...pending });
            return null;
        }
        const key = pending?.body === body ? pending.key : crypto.randomUUID();
        keys.current.set(action, { body, key, path });
        sessionStorage.setItem(storageKey, JSON.stringify({ body, key, path }));
        setBusy(true);
        setError('');
        try {
            const response = await api.post(path, payload, { headers: { 'Idempotency-Key': key } });
            keys.current.delete(action);
            sessionStorage.removeItem(storageKey);
            setPendingWrite(null);
            await reload();
            window.dispatchEvent(new Event('cash-drawer-updated'));
            return response.data;
        } catch (requestError) {
            if (requestError.response) { keys.current.delete(action); sessionStorage.removeItem(storageKey); setPendingWrite(null); }
            else setPendingWrite({ storageKey, body, key, path });
            setError(requestError.response?.data?.message || 'Action failed. Retry with the same request key.');
            return null;
        } finally { setBusy(false); }
    };

    const retryPending = async () => {
        if (!pendingWrite?.path) return;
        setBusy(true);
        try {
            await api.post(pendingWrite.path, JSON.parse(pendingWrite.body), { headers: { 'Idempotency-Key': pendingWrite.key } });
            sessionStorage.removeItem(pendingWrite.storageKey);
            setPendingWrite(null);
            setError('');
            await reload();
        } catch (requestError) {
            if (requestError.response) { sessionStorage.removeItem(pendingWrite.storageKey); setPendingWrite(null); }
            setError(requestError.response?.data?.message || 'Result still unknown. Retry this request with its original key.');
        } finally { setBusy(false); }
    };

    const open = async event => {
        event.preventDefault();
        const lines = linesFromQuantities(quantities);
        if (!lines) { setError('Opening quantities must be whole, nonnegative numbers.'); return; }
        const sources = openingSource === 'PRIOR_RETAINED'
            ? [{ kind: 'PRIOR_RETAINED', amount: openingAmount }, { kind: 'FRESH_FLOAT', amount: freshAmount }]
            : [{ kind: 'FRESH_FLOAT', amount: openingAmount }];
        const created = await post(`/cash-drawers/${drawerId}/sessions`, { business_date: openDate, custodian_id: Number(custodianId),
            opening_lines: lines, opening_sources: sources,
            prior_session_id: session?.status === 'CLOSED' ? session.session_id : null,
            approval_id: openingApprovalId || null, reason: openingReason || null }, 'open');
        if (created) { sessionStorage.removeItem(openingDraftKey); setQuantities({}); setOpeningAmount('0.00'); setShowOpen(false); }
    };

    const saveMovement = async event => {
        event.preventDefault();
        const result = await post(`/cash-drawers/sessions/${session.session_id}/movements`, { ...movementForm,
            occurred_at: movementForm.occurred_at ? new Date(movementForm.occurred_at).toISOString() : undefined,
            expected_version: session.version }, 'movement');
        if (result) { setMovementForm({ direction: 'IN', category: 'NOTEBOOK_RECEIPT', amount: '', description: '', counterparty: '', physical_reference: '', occurred_at: '', late_reason: '' }); setMovementOpen(false); }
    };

    const beginCount = async kind => {
        const result = await post(`/cash-drawers/sessions/${session.session_id}/counts/start`, { kind, expected_version: session.version }, 'count-start');
        if (result) { setDraftCount(result.data); setCountQuantities({}); setCountNotes(''); }
    };

    const saveCount = async event => {
        event.preventDefault();
        const lines = linesFromQuantities(countQuantities);
        if (!lines) { setError('Count quantities must be whole, nonnegative numbers.'); return; }
        if (!countWindowValid) {
            setError('Count no longer valid. Refresh and start another count.'); return;
        }
        const result = await post(`/cash-drawers/counts/${draftCount.count_id}/submit`, { lines, notes: countNotes }, 'count-submit');
        if (result) { sessionStorage.removeItem(draftKey); setDraftCount(null); setCountNotes(''); }
    };

    const downloadReport = async (sessionId, format) => {
        try {
            const response = await api.get(`/cash-drawers/sessions/${sessionId}/report`, { params: { format }, responseType: 'blob' });
            const url = URL.createObjectURL(response.data);
            const link = document.createElement('a');
            link.href = url;
            link.download = `cash-drawer-${sessionId}.${format}`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch (requestError) { setError(requestError.response?.data?.message || 'Unable to export the closed report.'); }
    };

    const loadHistoryDetail = async sessionId => {
        try {
            const response = await api.get(`/cash-drawers/sessions/${sessionId}`);
            setHistoryDetail(response.data.data);
        } catch (requestError) { setError(requestError.response?.data?.message || 'Unable to open this session.'); }
    };

    const latest = session?.latest_count;
    const canOpen = Number(user?.permission_level_id) === 10 || user?.permissions?.includes('cash_drawer:open');
    const canReview = Number(user?.permission_level_id) === 10 || user?.permissions?.includes('cash_drawer:review');
    const canCount = Number(user?.permission_level_id) === 10 || user?.permissions?.includes('cash_drawer:count');
    const canClose = Number(user?.permission_level_id) === 10 || user?.permissions?.includes('cash_drawer:close');
    const canMove = Number(user?.permission_level_id) === 10 || user?.permissions?.includes('cash_drawer:move');
    const canTransfer = Number(user?.permission_level_id) === 10 || user?.permissions?.includes('cash_drawer:transfer');
    const canSettleAdvance = Number(user?.permission_level_id) === 10 || user?.permissions?.includes('cash_drawer:settle_advance');
    const canExpense = Number(user?.permission_level_id) === 10 || user?.permissions?.includes('expenses:view');
    const canAP = Number(user?.permission_level_id) === 10 || user?.permissions?.includes('ap:view');
    const selectedDrawer = drawers.find(item => String(item.drawer_id) === String(drawerId));
    const stale = latest && Number(session.last_sequence) > Number(latest.cutoff_sequence);
    const outflow = session?.total_out || '0.00';
    const closingCount = counts.find(item => item.kind === 'CLOSING' && item.status === 'SUBMITTED');
    const approvedClosingReview = approvals.some(item => String(item.approval_id) === String(approvalId) &&
        String(item.count_id) === String(closingCount?.count_id) && item.decision === 'APPROVED');
    const handoverReady = !handover.amount || (Number(handover.amount) > 0 && !!handover.destination && !!handover.recipient_id && !!handover.recipient_password && !!handover.evidence);
    const handoverWithinCash = !handover.amount || (validMoney(handover.amount) && Number(handover.amount) <= Number(closingCount?.counted || 0) && Number(handover.amount) <= Number(closingCount?.expected || 0));
    const transferRemaining = item => Number(item.amount) - item.events.filter(event => ['DEPOSITED','RETURNED'].includes(event.stage)).reduce((sum, event) => sum + Number(event.amount), 0);
    const advanceRemaining = item => Number(item.amount) - item.events.filter(event => ['CONSUMPTION','RETURN'].includes(event.kind)).reduce((sum, event) => sum + Number(event.amount), 0);
    const visibleTransfers = custody.transfers.filter(item => custodyFilter === 'ALL' || (custodyFilter === 'PENDING') === (transferRemaining(item) > 0));
    const visibleAdvances = custody.advances.filter(item => custodyFilter === 'ALL' || (custodyFilter === 'PENDING') === !item.events.some(event => event.kind === 'SETTLEMENT'));
    const priorCents = BigInt(Math.round(Number(session?.close_snapshot?.retained_actual || 0) * 100));
    const openingDifference = (openingSource !== 'PRIOR_RETAINED' || validMoney(openingAmount)
        ? BigInt(Math.round(Number(openingSource === 'PRIOR_RETAINED' ? openingAmount : 0) * 100)) - priorCents : 0n);
    const countLines = linesFromQuantities(countQuantities);
    const countPreview = countLines && countLines.reduce((sum, line) => sum + BigInt(DENOMS.find(([code]) => code === line.code)[2]) * BigInt(line.quantity), 0n);
    const openingLines = linesFromQuantities(quantities);
    const openingPreview = openingLines && openingLines.reduce((sum, line) => sum + BigInt(DENOMS.find(([code]) => code === line.code)[2]) * BigInt(line.quantity), 0n);
    const openingSourcesTotal = Number(openingAmount || 0) + (openingSource === 'PRIOR_RETAINED' ? Number(freshAmount || 0) : 0);
    const openingMatches = openingPreview !== null && validMoney(openingAmount) && (openingSource !== 'PRIOR_RETAINED' || validMoney(freshAmount)) && Number.isFinite(openingSourcesTotal) && openingSourcesTotal >= 0 &&
        openingPreview === BigInt(Math.round(openingSourcesTotal * 100));
    const movementAmountValid = validMoney(movementForm.amount) && Number(movementForm.amount) > 0;
    const formatTime = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—';
    const navigateSource = (page, state = {}) => {
        const sourcePermission = { sales_history: 'invoicing:create', ar: 'ar:view', expenses: 'expenses:view', ap: 'ap:view' }[page];
        if (sourcePermission && Number(user?.permission_level_id) !== 10 && !user?.permissions?.includes(sourcePermission)) {
            setError('You do not have permission to open this source record. Ask an authorized employee to review it.');
            return;
        }
        const cashBoxReturn = { drawerId, registerPage, registerSearch, registerDirection, registerCategory, registerSource,
            registerOperator, registerTimeField, registerFrom, registerTo, tab };
        sessionStorage.setItem(`cash-box-return:${user?.employee_id}`, JSON.stringify(cashBoxReturn));
        onNavigate?.(page, { ...state, cashBoxReturn });
    };
    useEffect(() => { setApprovalId(''); }, [closingCount?.count_id]);

    const renderMovementForm = () => <form onSubmit={saveMovement} className="space-y-3">
        <label className="block">Direction<select className={field} value={movementForm.direction} onChange={event => setMovementForm({ ...movementForm, direction: event.target.value, category: event.target.value === 'IN' ? 'NOTEBOOK_RECEIPT' : 'OWNER_DRAW', approval_id: '' })}><option value="IN">Cash in</option><option value="OUT">Cash out</option></select></label>
        <label className="block">Category<select className={field} value={movementForm.category} onChange={event => setMovementForm({ ...movementForm, category: event.target.value })}>{(movementForm.direction === 'IN' ? ['NOTEBOOK_RECEIPT','OTHER_RECEIPT'] : ['OWNER_DRAW','OTHER_RELEASE']).map(category => <option key={category}>{category}</option>)}</select></label>
        {movementForm.direction === 'OUT' && <p className="text-sm">For an expense or supplier payment, use its owning workflow. {canExpense && <button type="button" className="underline" onClick={() => navigateSource('expenses')}>Open Expenses</button>} {canAP && <button type="button" className="underline" onClick={() => navigateSource('ap', { tab: 'payments' })}>Open Accounts Payable</button>}</p>}
        <label className="block">Amount<input className={field} inputMode="decimal" value={movementForm.amount} onChange={event => setMovementForm({ ...movementForm, amount: event.target.value })} required /></label>
        <label className="block">Purpose<input className={field} value={movementForm.description} onChange={event => setMovementForm({ ...movementForm, description: event.target.value })} required /></label>
        <label className="block">Payer or recipient<input className={field} value={movementForm.counterparty} onChange={event => setMovementForm({ ...movementForm, counterparty: event.target.value })} /></label>
        <label className="block">Physical reference{movementForm.category === 'NOTEBOOK_RECEIPT' ? ' (notebook and page required)' : ''}<input className={field} maxLength={120} value={movementForm.physical_reference} onChange={event => setMovementForm({ ...movementForm, physical_reference: event.target.value })} required={movementForm.category === 'NOTEBOOK_RECEIPT'} /></label>
        {movementForm.category === 'NOTEBOOK_RECEIPT' && <p className="text-sm">Not yet encoded as sale. Link this receipt when entering the sale later to avoid posting the same cash twice.</p>}
        <label className="block">Occurred at<input className={field} type="datetime-local" value={movementForm.occurred_at} onChange={event => setMovementForm({ ...movementForm, occurred_at: event.target.value })} /></label>
        {movementForm.occurred_at && <label className="block">Late entry reason, if before session opening<input className={field} value={movementForm.late_reason} onChange={event => setMovementForm({ ...movementForm, late_reason: event.target.value })} /></label>}
        <p className="text-sm">Authenticated operator: {user?.first_name} {user?.last_name}</p>
        <p className="text-sm">Expected after entry: {movementAmountValid ? money(Number(session.expected) + (movementForm.direction === 'IN' ? 1 : -1) * Number(movementForm.amount)) : 'Enter a positive amount'} (preview)</p>
        {movementForm.direction === 'OUT' && <ReviewRequest action="MANUAL_RELEASE" session={session} amount={movementForm.amount} reason={movementForm.description}
            value={movementForm.approval_id} onChange={approval_id => setMovementForm({ ...movementForm, approval_id })} post={post} busy={busy} />}
        <button className={button} disabled={busy || !movementAmountValid || (movementForm.direction === 'OUT' && !movementForm.approval_id)}>Post physical cash</button>
    </form>;
    const openMovement = direction => {
        setTab('Today');
        setMovementForm(form => ({ ...form, direction, category: direction === 'IN' ? 'NOTEBOOK_RECEIPT' : 'OWNER_DRAW', approval_id: '' }));
        const mobile = window.matchMedia('(max-width: 767px)').matches;
        setMovementOpen(mobile);
        if (!mobile) requestAnimationFrame(() => document.getElementById('cash-movement-form')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };

    return <div className="mx-auto max-w-7xl space-y-5 text-slate-900 dark:text-slate-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h1 className="text-2xl font-bold">Cash Box</h1><p className="text-sm text-slate-500 dark:text-slate-400">{error && lastRefresh ? `Stale data · last updated ${formatTime(lastRefresh)}` : lastRefresh ? `Updated ${formatTime(lastRefresh)}` : 'Loading'}</p></div>
            <div className="flex gap-2"><select aria-label="Drawer" className={field} value={drawerId} onChange={event => reload(event.target.value)}>{drawers.map(drawer => <option key={drawer.drawer_id} value={drawer.drawer_id}>{drawer.name}</option>)}</select><button className={button} onClick={() => reload()} disabled={busy}>Refresh</button></div>
        </div>
        {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</div>}
        {pendingWrite?.path && <button className={button} disabled={busy} onClick={retryPending}>Retry pending request with original key</button>}
        {selectedDrawer && <p className="text-sm text-slate-600 dark:text-slate-300">{selectedDrawer.hardware_mode === 'ELECTRONIC_DRAWER' ? 'Electronic drawer mode; count cash manually until a device is connected.' : 'Manual cash box · Electronic drawer support can be added later.'}</p>}
        {!session && drawerId && <p className="text-sm text-slate-600 dark:text-slate-300">Count the cash in the box, then open the session. Cash payments will appear here automatically.</p>}
        {session && <>
            <p className="text-sm">{session.session_code} · {session.business_date} · Responsible: {session.custodian_name} · <strong>{session.status}</strong></p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[["Expected cash", money(session.expected)], ["Latest count", latest ? money(latest.counted) : 'Not counted'],
                    ["Over / short at count", latest ? money(latest.variance) : '—'], ["Cash out", money(outflow)]].map(([label, value]) =>
                    <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-sm text-slate-500 dark:text-slate-400">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{value}</p></div>)}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">Opening {money(session.opening_amount)} · Count cutoff {latest ? `#${latest.cutoff_sequence} at ${formatTime(latest.submitted_at)}` : 'none'}{stale ? ` · ${Number(session.last_sequence) - Number(latest.cutoff_sequence)} movements since count; recount to verify current cash` : ''}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">Cash in {money(session.total_in)} · Cash out {money(session.total_out)} · opening float is separate from receipts.</p>
            {session.status === 'OPEN' && <div className="flex flex-wrap gap-2">
                {canMove && <button className={button} disabled={!!draftCount} onClick={() => openMovement('IN')}>Cash in</button>}
                {canMove && <button className={button} disabled={!!draftCount} onClick={() => openMovement('OUT')}>Cash out</button>}
                {canTransfer && <button className={button} disabled={!!draftCount} onClick={() => setTab('Handover & Advances')}>Transfer</button>}
                {canCount && !draftCount && <button className={button} disabled={busy} onClick={() => beginCount('MIDDAY')}>Count cash</button>}
                {canClose && <button className={button} disabled={busy || !!draftCount} onClick={() => post(`/cash-drawers/sessions/${session.session_id}/start-closing`, { expected_version: session.version }, 'start-closing')}>Close drawer</button>}
            </div>}
        </>}
        {session?.status === 'CLOSED' && canOpen && <button className={button} onClick={() => setShowOpen(value => !value)}>{showOpen ? 'Hide opening form' : 'Open a new session'}</button>}
        {(!session || (session.status === 'CLOSED' && showOpen)) && drawerId && canOpen && <Panel title="Open cash box"><form onSubmit={open} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2"><label>Business date<input type="date" value={openDate} onChange={event => setOpenDate(event.target.value)} className={field} required /></label><label>Person responsible for the cash<select value={custodianId} onChange={event => setCustodianId(event.target.value)} className={field} required><option value="">Select employee</option>{custodians.map(person => <option key={person.employee_id} value={person.employee_id}>{person.name}</option>)}</select></label></div>
            {custodianLoadError && <p role="alert" className="text-sm text-red-700 dark:text-red-300">Could not load employees. Reload this page.</p>}
            <DenominationEditor value={quantities} onChange={setQuantities} />
            <div className="grid gap-3 sm:grid-cols-2"><label>Opening cash came from<select className={field} value={openingSource} onChange={event => setOpeningSource(event.target.value)}><option value="FRESH_FLOAT">Initial cash in box</option><option value="PRIOR_RETAINED">Cash kept from last close</option></select></label><label>Opening cash amount<input type="text" inputMode="decimal" value={openingAmount} onChange={event => setOpeningAmount(event.target.value)} className={field} required /></label></div>
            {openingSource === 'PRIOR_RETAINED' && <label>Additional cash added<input className={field} inputMode="decimal" value={freshAmount} onChange={event => setFreshAmount(event.target.value)} required /></label>}
            <label>Reason or source reference<input value={openingReason} onChange={event => setOpeningReason(event.target.value)} className={field} /></label>
            {openingSource === 'PRIOR_RETAINED' && session?.status === 'CLOSED' && openingDifference !== 0n && <div className="rounded border border-amber-300 p-3"><p>Prior retained actual: {money(session.close_snapshot?.retained_actual)} · Difference: {money(Number(openingDifference) / 100)}. Independent review is required.</p><input className={field} placeholder="Approved bridge ID" value={openingApprovalId} onChange={event => setOpeningApprovalId(event.target.value)} /><button type="button" className={`${button} mt-2`} disabled={busy || !openingReason} onClick={async () => { const result = await post('/cash-drawers/approvals', { action: 'OPENING_BRIDGE', session_id: session.session_id, expected_version: session.version, amount: (Number(openingDifference) / 100).toFixed(2), reason: openingReason }, 'opening-bridge'); if (result) setOpeningApprovalId(String(result.data.approval_id)); }}>Request bridge review</button></div>}
            {!openingMatches && <p role="alert" className="text-sm text-red-700 dark:text-red-300">Opening sources must equal the denomination count before opening.</p>}
            <button disabled={busy || custodianLoadError || !custodians.length || !openingMatches} className={button}>Verify and open cash box</button>
        </form></Panel>}
        {session && <>
            <Dialog open={movementOpen && session.status === 'OPEN' && !draftCount && canMove} onClose={() => setMovementOpen(false)} className="relative z-50 md:hidden">
                <div className="fixed inset-0 bg-slate-950/70" aria-hidden="true" />
                <div className="fixed inset-0 overflow-y-auto bg-white dark:bg-slate-900">
                    <DialogPanel className="min-h-screen p-4 text-slate-900 dark:text-slate-100">
                        <div className="mb-4 flex items-center justify-between"><DialogTitle className="text-xl font-bold">{movementForm.direction === 'IN' ? 'Cash in' : 'Cash out'}</DialogTitle><button className="min-h-11 rounded border px-3" onClick={() => setMovementOpen(false)}>Close</button></div>
                        {renderMovementForm()}
                    </DialogPanel>
                </div>
            </Dialog>
            <div role="tablist" aria-label="Cash drawer sections" className="flex flex-wrap gap-2">{['Today','Counts','Handover & Advances','History'].map((name, index, names) => <button key={name} type="button" role="tab" aria-selected={tab === name} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)} onKeyDown={event => { if (['ArrowLeft','ArrowRight'].includes(event.key)) { event.preventDefault(); const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length; setTab(names[next]); event.currentTarget.parentElement.children[next].focus(); } }} className={`min-h-11 rounded-lg px-4 ${tab === name ? 'bg-slate-900 text-white dark:bg-amber-600' : 'bg-white dark:bg-slate-800'}`}>{name}</button>)}</div>
            {tab === 'Today' && <div className="flex flex-wrap items-center gap-2">
                <input aria-label="Search cash movements" className={`${field} max-w-xs`} placeholder="Search reference, purpose or operator" value={registerSearch}
                    onChange={event => { setRegisterPage(1); setRegisterSearch(event.target.value); }} />
                <select aria-label="Direction" className={`${field} max-w-40`} value={registerDirection} onChange={event => { setRegisterPage(1); setRegisterDirection(event.target.value); }}>
                    <option value="">All directions</option><option value="IN">Cash in</option><option value="OUT">Cash out</option>
                </select>
                <input aria-label="Category" list="cash-box-categories" className={`${field} max-w-48`} placeholder="All categories" value={registerCategory} onChange={event => { setRegisterPage(1); setRegisterCategory(event.target.value); }} />
                <datalist id="cash-box-categories">{['SALE','AR_RECEIPT','EXPENSE','SUPPLIER_PAYMENT','CASH_REFUND','NOTEBOOK_RECEIPT','OTHER_RECEIPT','OWNER_DRAW','OTHER_RELEASE','EMPLOYEE_ADVANCE','ADVANCE_RETURN','ADVANCE_REIMBURSEMENT','TRANSFER','TRANSFER_RETURN','FINAL_HANDOVER','CORRECTION'].map(category => <option key={category} value={category} />)}</datalist>
                <select aria-label="Source" className={`${field} max-w-40`} value={registerSource} onChange={event => { setRegisterPage(1); setRegisterSource(event.target.value); }}>
                    <option value="">All sources</option><option value="AUTOMATIC">Automatic</option><option value="MANUAL">Manual</option><option value="REVERSAL">Reversal</option>
                </select>
                <input aria-label="Operator ID" className={`${field} max-w-36`} type="number" min="1" placeholder="Operator ID" value={registerOperator} onChange={event => { setRegisterPage(1); setRegisterOperator(event.target.value); }} />
                <select aria-label="Time basis" className={`${field} max-w-44`} value={registerTimeField} onChange={event => { setRegisterPage(1); setRegisterTimeField(event.target.value); }}><option value="recorded_at">Recorded time</option><option value="occurred_at">Occurred time</option></select>
                <label className="text-xs">From<input type="date" className={field} value={registerFrom} onChange={event => { setRegisterPage(1); setRegisterFrom(event.target.value); }} /></label>
                <label className="text-xs">To<input type="date" className={field} value={registerTo} onChange={event => { setRegisterPage(1); setRegisterTo(event.target.value); }} /></label>
                <span className="text-sm">{registerTotal} entries · page {registerPage}</span>
                <button className="min-h-11 rounded border px-3" disabled={registerPage <= 1} onClick={() => setRegisterPage(page => page - 1)}>Previous</button>
                <button className="min-h-11 rounded border px-3" disabled={registerPage * 50 >= registerTotal} onClick={() => setRegisterPage(page => page + 1)}>Next</button>
            </div>}
            {tab === 'Today' && <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
                <Panel title="Movement register">
                    <div className="space-y-2 md:hidden">{movements.map(item => <button key={item.movement_id} className="min-h-11 w-full rounded-lg border border-slate-200 p-3 text-left dark:border-slate-700" onClick={() => setSelectedMovement(item)}><span className="flex justify-between gap-2 font-semibold"><span>#{item.sequence} · {item.category}</span><span className="tabular-nums">{item.direction === 'OUT' ? '−' : '+'}{money(item.amount)}</span></span><span className="block text-sm">{item.description}</span><span className="block text-xs text-slate-500 dark:text-slate-400">{formatTime(item.recorded_at)} · {item.operator_name} · balance {money(item.balance_after)}</span></button>)}</div>
                    <div className="hidden overflow-x-auto md:block"><table className="w-full min-w-[760px] text-sm"><thead><tr className="border-b text-left"><th className="py-2"># / recorded</th><th>Type / description / reference</th><th className="text-right">Cash in</th><th className="text-right">Cash out</th><th className="text-right">Running balance</th><th>Operator</th></tr></thead><tbody>{movements.map(item => <tr key={item.movement_id} className="border-b border-slate-100 dark:border-slate-800"><td className="py-2">#{item.sequence}<br />{formatTime(item.recorded_at)}</td><td><button className="min-h-11 text-left underline decoration-dotted" onClick={() => setSelectedMovement(item)}>{item.category}</button><br /><span>{item.description}</span><br /><span className="text-xs text-slate-500 dark:text-slate-400">{item.physical_reference || item.source_event_key || `Movement #${item.movement_id}`} · {item.reversal_of ? 'Reversal' : item.source_event_key ? 'Automatic' : 'Manual'}{item.late_reason ? ' · Late entry' : ''}</span></td><td className="text-right tabular-nums">{item.direction === 'IN' ? money(item.amount) : '—'}</td><td className="text-right tabular-nums">{item.direction === 'OUT' ? money(item.amount) : '—'}</td><td className="text-right tabular-nums">{money(item.balance_after)}</td><td>{item.operator_name}</td></tr>)}</tbody></table></div>
                    {movements.length === 0 && <p className="py-4 text-slate-500">{registerTotal === 0 && !registerSearch && !registerDirection && !registerCategory && !registerSource ? 'No cash movements yet.' : 'No movements match these filters.'}</p>}
                </Panel>
                <div className="space-y-4">
                    <Panel title="Latest count"><p className="font-semibold">{latest ? money(latest.counted) : 'Not counted'}</p><p className="text-sm">{latest ? `Submitted ${formatTime(latest.submitted_at)} · cutoff #${latest.cutoff_sequence}` : 'No submitted count yet.'}</p>{latest && <p className="text-sm">Over / short at cutoff: {money(latest.variance)}</p>}{stale && <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">{Number(session.last_sequence) - Number(latest.cutoff_sequence)} movements since count. Recount to verify current cash.</p>}<p className="mt-2 text-sm">{custody.transfers.filter(item => !item.events.some(event => event.stage === 'DEPOSITED')).length} transfers awaiting deposit · {custody.advances.filter(item => !item.events.some(event => event.kind === 'SETTLEMENT')).length} advances unsettled</p></Panel>
                    {session.status === 'OPEN' && !draftCount && canMove && <div id="cash-movement-form" className="hidden md:block"><Panel title="Cash in / out">{renderMovementForm()}</Panel></div>}
                    {session.status === 'CLOSING' && !draftCount && canCount && <button className={button} disabled={busy} onClick={() => beginCount('CLOSING')}>Start final count</button>}
                    {session.status === 'CLOSING' && canClose && <button className={button} disabled={busy} onClick={() => { const reason = window.prompt('Reason for cancelling closing'); if (reason) post(`/cash-drawers/sessions/${session.session_id}/cancel-closing`, { reason, expected_version: session.version }, 'cancel-closing'); }}>Cancel closing</button>}
                </div>
            </div>}
            {tab === 'Today' && movements.length > 0 && <Panel title="Movement detail">
                <select className={field} aria-label="Select movement" value={selectedMovement?.movement_id || ''}
                    onChange={event => setSelectedMovement(movements.find(item => String(item.movement_id) === event.target.value) || null)}>
                    <option value="">Select an entry to inspect</option>
                    {movements.map(item => <option key={item.movement_id} value={item.movement_id}>#{item.sequence} · {item.category} · {money(item.amount)}</option>)}
                </select>
                {selectedMovement && <div className="mt-3 space-y-1 text-sm">
                    <p>{selectedMovement.direction} {money(selectedMovement.amount)} · balance after {money(selectedMovement.balance_after)}</p>
                    <p>{selectedMovement.description}</p>
                    <p>Operator {selectedMovement.operator_name} · occurred {formatTime(selectedMovement.occurred_at)} · recorded {formatTime(selectedMovement.recorded_at)}</p>
                    <p>Source: {selectedMovement.source_event_key || 'manual'} · Physical reference: {selectedMovement.physical_reference || '—'} · Counterparty: {selectedMovement.counterparty || '—'}</p>
                    {selectedMovement.late_reason && <p>Late entry reason: {selectedMovement.late_reason}</p>}
                    {selectedMovement.reversal_of && <p>Reversal of movement #{selectedMovement.reversal_of}</p>}
                    {selectedMovement.invoice_id && <button className="min-h-11 underline" onClick={() => navigateSource('sales_history', { invoice_id: selectedMovement.invoice_id, invoice_number: selectedMovement.invoice_number, startDate: String(selectedMovement.invoice_date).slice(0, 10), endDate: String(selectedMovement.invoice_date).slice(0, 10) })}>Open invoice #{selectedMovement.invoice_id}</button>}
                    {selectedMovement.customer_payment_id && <button className="min-h-11 underline" onClick={() => navigateSource('ar', { customer_id: selectedMovement.customer_id, customer_payment_id: selectedMovement.customer_payment_id })}>Open A/R payment #{selectedMovement.customer_payment_id}</button>}
                    {selectedMovement.expense_id && <button className="min-h-11 underline" onClick={() => navigateSource('expenses', { expense_id: selectedMovement.expense_id })}>Open expense #{selectedMovement.expense_id}</button>}
                    {selectedMovement.ap_payment_id && <button className="min-h-11 underline" onClick={() => navigateSource('ap', { tab: 'payments', payment_id: selectedMovement.ap_payment_id })}>Open supplier payment #{selectedMovement.ap_payment_id}</button>}
                </div>}
            </Panel>}
            <Dialog open={!!draftCount} onClose={() => {}} className="relative z-50">
                <div className="fixed inset-0 bg-slate-950/70" aria-hidden="true" />
                <div className="fixed inset-0 overflow-y-auto p-0 sm:p-4">
                    <div className="flex min-h-full items-center justify-center">
                        <DialogPanel className="flex min-h-screen w-full flex-col bg-white p-4 text-slate-900 dark:bg-slate-900 dark:text-slate-100 sm:min-h-0 sm:max-w-3xl sm:rounded-xl sm:p-6">
                            <DialogTitle className="text-xl font-bold">{draftCount?.kind === 'CLOSING' ? 'Final count' : 'Count cash'} · cutoff #{draftCount?.cutoff_sequence}</DialogTitle>
                            <p className="my-3 text-sm">Cash activity paused. Started {formatTime(draftCount?.started_at)} · valid until {formatTime(session.count_window_expires_at)} · expected at cutoff {money(draftCount?.expected)}.</p>
                            {countPreview !== null && <p className="mb-3 font-semibold">Preview over / short: {money(Number(countPreview) / 100 - Number(draftCount?.expected || 0))}. Server calculation is final.</p>}
                            {!countWindowValid && <p role="alert" className="mb-3 text-red-700 dark:text-red-300">Count no longer valid. Cancel this count and start again.</p>}
                            <form onSubmit={saveCount} className="flex flex-1 flex-col">
                                <DenominationEditor value={countQuantities} onChange={setCountQuantities} />
                                <label className="mt-3 block">Count notes<textarea className={field} maxLength={1000} value={countNotes} onChange={event => setCountNotes(event.target.value)} /></label>
                                <div className="sticky bottom-0 mt-auto flex flex-wrap gap-2 border-t border-slate-200 bg-white pt-3 dark:border-slate-700 dark:bg-slate-900">
                                    <button className={button} disabled={busy || !countWindowValid}>{draftCount?.kind === 'CLOSING' ? 'Submit final count' : 'Save count and resume'}</button>
                                    <button type="button" className={button} disabled={busy} onClick={async () => { const reason = window.prompt('Reason for cancelling count'); if (reason) { const result = await post(`/cash-drawers/counts/${draftCount.count_id}/cancel`, { reason }, 'cancel-count'); if (result) { sessionStorage.removeItem(draftKey); setDraftCount(null); } } }}>Cancel count</button>
                                </div>
                            </form>
                        </DialogPanel>
                    </div>
                </div>
            </Dialog>
            {tab === 'Counts' && <Panel title="Count snapshots"><div className="space-y-3">{counts.map(count => <div key={count.count_id} className="rounded border border-slate-200 p-3 dark:border-slate-700"><strong>{count.kind} #{count.count_id}</strong> · {count.status} · {formatTime(count.submitted_at || count.started_at)}<p>Cutoff #{count.cutoff_sequence} · Expected {money(count.expected)} · Counted {count.counted === null ? 'Pending' : money(count.counted)} · Variance {count.variance === null ? 'Pending' : money(count.variance)}</p><p className="text-xs">{count.lines.map(line => `${line.code}: ${line.quantity}`).join(' · ')}</p>{count.notes && <p className="text-sm">Notes: {count.notes}</p>}</div>)}{approvals.map(item => <div key={item.approval_id} className="rounded border border-slate-200 p-3 dark:border-slate-700"><strong>Review #{item.approval_id}</strong> · {item.action} · {item.decision}<p>{item.reason}</p>{item.decision === 'PENDING' && canReview && Number(item.requester_id) !== Number(user?.employee_id) && <div className="mt-2 flex gap-2"><button className={button} disabled={busy} onClick={() => post(`/cash-drawers/approvals/${item.approval_id}/decision`, { decision: 'APPROVED' }, `approve-${item.approval_id}`)}>Approve</button><button className={button} disabled={busy} onClick={() => post(`/cash-drawers/approvals/${item.approval_id}/decision`, { decision: 'REJECTED' }, `reject-${item.approval_id}`)}>Reject</button></div>}</div>)}</div></Panel>}
            {tab === 'Handover & Advances' && session.status === 'OPEN' && !draftCount && <div className="grid gap-4 lg:grid-cols-2">
                {canTransfer && <ReviewRequest action="TRANSFER" session={session} amount={transferForm.amount} reason={transferForm.destination}
                    value={transferForm.approval_id} onChange={approval_id => setTransferForm({ ...transferForm, approval_id })} post={post} busy={busy} />}
                {canMove && <ReviewRequest action="ADVANCE" session={session} amount={advanceForm.amount} reason={advanceForm.purpose}
                    value={advanceForm.approval_id} onChange={approval_id => setAdvanceForm({ ...advanceForm, approval_id })} post={post} busy={busy} />}
            </div>}
            {tab === 'Handover & Advances' && <div className="flex flex-wrap gap-2" role="group" aria-label="Custody status filter">{['PENDING','COMPLETED','ALL'].map(status => <button key={status} className={`min-h-11 rounded-lg px-4 ${custodyFilter === status ? 'bg-slate-900 text-white dark:bg-amber-600' : 'bg-white dark:bg-slate-800'}`} onClick={() => setCustodyFilter(status)}>{status[0] + status.slice(1).toLowerCase()}</button>)}</div>}
            {tab === 'Handover & Advances' && <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Transfers"><div className="space-y-2">{visibleTransfers.map(item => <p key={item.transfer_id}>#{item.transfer_id} · released {money(item.amount)} to {item.destination} · {item.recipient_name} · awaiting {money(transferRemaining(item))} · {Math.max(0, Math.floor((nowTick - new Date(item.created_at)) / 86400000))} days old · {item.events.length} events</p>)}{!visibleTransfers.length && <p className="text-sm">No transfers match this filter.</p>}</div>{session.status === 'OPEN' && !draftCount && canTransfer && <form className="mt-3 space-y-2" onSubmit={async event => { event.preventDefault(); const result = await post(`/cash-drawers/sessions/${session.session_id}/transfers`, { ...transferForm, expected_version: session.version }, 'transfer'); if (result) setTransferForm({ amount: '', destination: '', recipient_id: '' }); }}><input className={field} placeholder="Amount" value={transferForm.amount} onChange={event => setTransferForm({ ...transferForm, amount: event.target.value })} required /><input className={field} placeholder="Destination" value={transferForm.destination} onChange={event => setTransferForm({ ...transferForm, destination: event.target.value })} required /><label className="block">Recipient<select className={field} value={transferForm.recipient_id} onChange={event => setTransferForm({ ...transferForm, recipient_id: event.target.value })} required><option value="">Select employee</option>{employees.map(person => <option key={person.employee_id} value={person.employee_id}>{person.name}</option>)}</select></label><button className={button} disabled={busy}>Release transfer</button></form>}</Panel>
                <Panel title="Employee advances"><div className="space-y-2">{visibleAdvances.map(item => <p key={item.advance_id}>#{item.advance_id} · released {money(item.amount)} · {item.employee_name} · remaining {money(advanceRemaining(item))} · {Math.max(0, Math.floor((nowTick - new Date(item.created_at)) / 86400000))} days old · {item.events.length} events</p>)}{!visibleAdvances.length && <p className="text-sm">No advances match this filter.</p>}</div>{session.status === 'OPEN' && !draftCount && canMove && <form className="mt-3 space-y-2" onSubmit={async event => { event.preventDefault(); const result = await post(`/cash-drawers/sessions/${session.session_id}/advances`, { ...advanceForm, expected_version: session.version }, 'advance'); if (result) setAdvanceForm({ employee_id: '', amount: '', purpose: '' }); }}><label className="block">Employee receiving advance<select className={field} value={advanceForm.employee_id} onChange={event => setAdvanceForm({ ...advanceForm, employee_id: event.target.value })} required><option value="">Select employee</option>{employees.map(person => <option key={person.employee_id} value={person.employee_id}>{person.name}</option>)}</select></label><input className={field} placeholder="Amount" value={advanceForm.amount} onChange={event => setAdvanceForm({ ...advanceForm, amount: event.target.value })} required /><input className={field} placeholder="Purpose" value={advanceForm.purpose} onChange={event => setAdvanceForm({ ...advanceForm, purpose: event.target.value })} required /><button className={button} disabled={busy}>Release advance</button></form>}</Panel>
            </div>}
            {tab === 'Handover & Advances' && <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">{canTransfer && visibleTransfers.map(item => <TransferEventForm key={item.transfer_id} transfer={item} drawers={drawers} post={post} busy={busy} />)}</div>
                <div className="space-y-3">{canSettleAdvance && visibleAdvances.map(item => <AdvanceEventForm key={item.advance_id} advance={item} drawers={drawers} post={post} busy={busy} />)}</div>
            </div>}
            {tab === 'History' && <Panel title="Session history"><div className="space-y-2">{history.map(item => <div key={item.session_id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-3 dark:border-slate-700"><span>{item.session_code} · {item.business_date} · {item.custodian_name} · {item.status} · expected {money(item.expected)}</span><span className="flex gap-2"><button className="min-h-11 underline" onClick={() => loadHistoryDetail(item.session_id)}>View</button>{item.status === 'CLOSED' && <><button className="min-h-11 underline" onClick={() => downloadReport(item.session_id, 'pdf')}>PDF</button><button className="min-h-11 underline" onClick={() => downloadReport(item.session_id, 'csv')}>CSV</button></>}</span></div>)}</div>{historyDetail && <div className="mt-4 rounded border border-slate-200 p-3 dark:border-slate-700"><h3 className="font-semibold">{historyDetail.session_code} · {historyDetail.status}</h3><p>Opening {money(historyDetail.opening_amount)} · receipts {money(historyDetail.total_in)} · releases {money(historyDetail.total_out)}</p>{historyDetail.close_snapshot ? <p>Final expected {money(historyDetail.close_snapshot.expected)} · counted {money(historyDetail.close_snapshot.counted)} · over / short {money(historyDetail.close_snapshot.variance)} · retained actual {money(historyDetail.close_snapshot.retained_actual)} · retained ledger {money(historyDetail.close_snapshot.retained_ledger)}.</p> : <p>Session remains active.</p>}<p className="text-sm">This financial snapshot is read only. Later custody events are shown separately.</p></div>}</Panel>}
            {session.status === 'CLOSING' && <Panel title="Close cash box">
                <p className="mb-3 text-sm">Step {closeStep} of 5 · cash writes are paused. Cancelling closing requires a reason and a fresh final count later.</p>
                {closeStep === 1 && <div className="space-y-3"><h3 className="font-semibold">1. Verify source completeness</h3><p>Check physical cash sales, refunds, expenses, supplier payments, transfers, and advances before the final count.</p><label className="flex items-start gap-2"><input type="checkbox" className="mt-1 size-5" checked={sourcesChecked} onChange={event => setSourcesChecked(event.target.checked)} /><span>I checked the source records for this session.</span></label><button className={button} disabled={!sourcesChecked} onClick={() => setCloseStep(2)}>Continue to final count</button></div>}
                {closeStep === 2 && <div className="space-y-3"><h3 className="font-semibold">2. Final count</h3>{closingCount && <p>Latest final count #{closingCount.count_id}: {money(closingCount.counted)} against {money(closingCount.expected)} at cutoff #{closingCount.cutoff_sequence}.</p>}<div className="flex flex-wrap gap-2">{canCount && !draftCount && <button className={button} disabled={busy} onClick={() => beginCount('CLOSING')}>{closingCount ? 'Recount cash' : 'Count cash'}</button>}<button className={button} disabled={!closingCount || !!draftCount} onClick={() => setCloseStep(3)}>Continue to variance review</button></div></div>}
                {closeStep === 3 && <div className="space-y-3"><h3 className="font-semibold">3. Review variance</h3><p>Expected {money(closingCount?.expected)} · counted {money(closingCount?.counted)} · over / short {money(closingCount?.variance)} at cutoff #{closingCount?.cutoff_sequence}.</p>{Number(closingCount?.variance) !== 0 && <><label className="block">Reason for variance<input className={field} value={reviewReason} onChange={event => setReviewReason(event.target.value)} /></label><button className={button} disabled={busy || !reviewReason || !closingCount} onClick={async () => { const result = await post('/cash-drawers/approvals', { session_id: session.session_id, count_id: closingCount.count_id, reason: reviewReason, expected_version: session.version }, 'approval'); if (result) setApprovalId(String(result.data.approval_id)); }}>Request independent review</button><label className="block">Review ID<input className={field} value={approvalId} onChange={event => setApprovalId(event.target.value)} /></label>{!approvedClosingReview && <p className="text-sm">Waiting for independent manager approval. Refresh after the manager decides.</p>}</>}<div className="flex gap-2"><button className={button} onClick={() => setCloseStep(2)}>Back</button><button className={button} disabled={!closingCount || (Number(closingCount.variance) !== 0 && !approvedClosingReview)} onClick={() => setCloseStep(4)}>Continue to handover</button></div></div>}
                {closeStep === 4 && <div className="space-y-3"><h3 className="font-semibold">4. Handover and retain</h3><p>Leave the amount blank to retain all counted cash in the box.</p><div className="grid gap-2 sm:grid-cols-2"><label>Final handover amount<input className={field} inputMode="decimal" value={handover.amount} onChange={event => setHandover({ ...handover, amount: event.target.value })} /></label><label>Destination<input className={field} value={handover.destination} onChange={event => setHandover({ ...handover, destination: event.target.value })} /></label><label>Recipient<select className={field} value={handover.recipient_id} onChange={event => setHandover({ ...handover, recipient_id: event.target.value })}><option value="">Select employee</option>{employees.map(person => <option key={person.employee_id} value={person.employee_id}>{person.name}</option>)}</select></label><label>Acknowledgment evidence<input className={field} value={handover.evidence} onChange={event => setHandover({ ...handover, evidence: event.target.value })} /></label>{handover.amount && <label>Recipient password<input type="password" autoComplete="off" className={field} value={handover.recipient_password} onChange={event => setHandover({ ...handover, recipient_password: event.target.value })} /></label>}</div><p>Retained actual {money(Number(closingCount?.counted || 0) - Number(handover.amount || 0))} · retained ledger {money(Number(closingCount?.expected || 0) - Number(handover.amount || 0))} (preview).</p>{!handoverWithinCash && <p role="alert" className="text-red-700 dark:text-red-300">Handover cannot exceed counted or expected cash.</p>}<div className="flex gap-2"><button className={button} onClick={() => setCloseStep(3)}>Back</button><button className={button} disabled={!handoverReady || !handoverWithinCash} onClick={() => setCloseStep(5)}>Review close</button></div></div>}
                {closeStep === 5 && <div className="space-y-3"><h3 className="font-semibold">5. Review and confirm</h3><p>Session {session.session_code} · custodian {session.custodian_name}</p><p>Opening {money(session.opening_amount)} · cash in {money(session.total_in)} · cash out before final handover {money(session.total_out)}</p><p>Expected at cutoff {money(closingCount?.expected)} · counted {money(closingCount?.counted)} · variance {money(closingCount?.variance)}</p><p>Handover {money(handover.amount)} · retained actual {money(Number(closingCount?.counted || 0) - Number(handover.amount || 0))} · retained ledger {money(Number(closingCount?.expected || 0) - Number(handover.amount || 0))} (preview).</p><label className="block">Closing notes<textarea className={field} maxLength={2000} value={closeNotes} onChange={event => setCloseNotes(event.target.value)} /></label><div className="flex gap-2"><button className={button} onClick={() => setCloseStep(4)}>Back</button><button className={button} disabled={busy || !canClose || !closingCount || !handoverReady || !handoverWithinCash || (Number(closingCount?.variance) !== 0 && !approvedClosingReview)} onClick={() => post(`/cash-drawers/sessions/${session.session_id}/close`, { count_id: closingCount.count_id, expected_version: session.version, approval_id: approvalId || null, handovers: handover.amount ? [handover] : [], notes: closeNotes }, 'close')}>Confirm close</button></div></div>}
            </Panel>}
            {session.status === 'CLOSED' && <p className="text-sm">Closed report is final.</p>}
        </>}
        {!session && !drawerId && <p>No cash drawer is configured.</p>}
    </div>;
}
