import { useCallback, useEffect, useRef, useState } from 'react';
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

function DenominationEditor({ value, onChange }) {
    const total = DENOMS.reduce((sum, [code, , cents]) => sum + BigInt(cents) * BigInt(value[code] || 0), 0n);
    return <div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {DENOMS.map(([code, label]) => <label key={code} className="block text-sm font-medium">
                <span className="mb-1 block">{label}</span>
                <input inputMode="numeric" type="number" min="0" step="1" className={field} value={value[code] ?? ''}
                    onChange={event => onChange({ ...value, [code]: event.target.value })} />
            </label>)}
        </div>
        <p className="mt-3 text-right text-lg font-bold tabular-nums">Counted: {money(Number(total) / 100)}</p>
    </div>;
}

function linesFromQuantities(quantities) {
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
        <button type="button" className={`${button} mt-2`} disabled={busy || !amount || !reason}
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
        <strong>Transfer #{transfer.transfer_id} · {money(transfer.amount)} · recipient #{transfer.recipient_id}</strong>
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
        <strong>Advance #{advance.advance_id} · {money(advance.amount)} · employee #{advance.employee_id}</strong>
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

export default function CashDrawerPage({ user, onNavigate }) {
    const [drawers, setDrawers] = useState([]);
    const [drawerId, setDrawerId] = useState('');
    const [session, setSession] = useState(null);
    const [movements, setMovements] = useState([]);
    const [registerPage, setRegisterPage] = useState(1);
    const [registerTotal, setRegisterTotal] = useState(0);
    const [registerSearch, setRegisterSearch] = useState('');
    const [registerDirection, setRegisterDirection] = useState('');
    const [selectedMovement, setSelectedMovement] = useState(null);
    const [counts, setCounts] = useState([]);
    const [approvals, setApprovals] = useState([]);
    const [custody, setCustody] = useState({ transfers: [], advances: [] });
    const [history, setHistory] = useState([]);
    const [tab, setTab] = useState('Today');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [lastRefresh, setLastRefresh] = useState(null);
    const [openDate, setOpenDate] = useState(today());
    const [custodianId, setCustodianId] = useState(String(user?.employee_id || ''));
    const [openingSource, setOpeningSource] = useState('FRESH_FLOAT');
    const [openingAmount, setOpeningAmount] = useState('0.00');
    const [freshAmount, setFreshAmount] = useState('0.00');
    const [openingReason, setOpeningReason] = useState('');
    const [openingApprovalId, setOpeningApprovalId] = useState('');
    const [showOpen, setShowOpen] = useState(false);
    const [quantities, setQuantities] = useState({});
    const [countQuantities, setCountQuantities] = useState({});
    const [draftCount, setDraftCount] = useState(null);
    const [movementForm, setMovementForm] = useState({ direction: 'IN', category: 'NOTEBOOK_RECEIPT', amount: '', description: '', counterparty: '' });
    const [transferForm, setTransferForm] = useState({ amount: '', destination: '', recipient_id: '' });
    const [advanceForm, setAdvanceForm] = useState({ employee_id: '', amount: '', purpose: '' });
    const [approvalId, setApprovalId] = useState('');
    const [reviewReason, setReviewReason] = useState('');
    const [handover, setHandover] = useState({ amount: '', destination: '', recipient_id: '', recipient_password: '', evidence: '' });
    const keys = useRef(new Map());

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
                    { params: { page: registerPage, limit: 50, search: registerSearch || undefined, direction: registerDirection || undefined } }),
                api.get(`/cash-drawers/sessions/${id}/counts`), api.get(`/cash-drawers/sessions/${id}/custody`),
                api.get(`/cash-drawers/sessions/${id}/approvals`),
            ]);
            setSession(detail.data.data);
            setMovements(register.data?.data || []);
            setRegisterTotal(register.data?.total || 0);
            setSelectedMovement(null);
            setCounts(savedCounts.data?.data || []);
            setDraftCount((savedCounts.data?.data || []).find(item => item.status === 'DRAFT') || null);
            setCustody(savedCustody.data || { transfers: [], advances: [] });
            setApprovals(savedApprovals.data?.data || []);
            setLastRefresh(new Date());
            setError('');
        } catch (requestError) {
            setError(requestError.response?.data?.message || 'Unable to refresh the cash drawer.');
        }
    }, [drawerId, registerPage, registerSearch, registerDirection]);

    useEffect(() => { reload(); }, [reload]);
    useEffect(() => {
        if (session?.status === 'CLOSED') {
            setOpeningSource('PRIOR_RETAINED');
            setOpeningAmount(session.close_snapshot?.retained_actual || '0.00');
        }
    }, [session?.session_id, session?.status]);
    useEffect(() => {
        const onFocus = () => reload();
        window.addEventListener('focus', onFocus);
        return () => window.removeEventListener('focus', onFocus);
    }, [reload]);

    const post = async (path, payload, action = path) => {
        const body = JSON.stringify(payload);
        const pending = keys.current.get(action);
        const key = pending?.body === body ? pending.key : crypto.randomUUID();
        keys.current.set(action, { body, key });
        setBusy(true);
        setError('');
        try {
            const response = await api.post(path, payload, { headers: { 'Idempotency-Key': key } });
            keys.current.delete(action);
            await reload();
            window.dispatchEvent(new Event('cash-drawer-updated'));
            return response.data;
        } catch (requestError) {
            setError(requestError.response?.data?.message || 'Action failed. Retry with the same request key.');
            return null;
        } finally { setBusy(false); }
    };

    const open = async event => {
        event.preventDefault();
        const lines = linesFromQuantities(quantities);
        const sources = openingSource === 'PRIOR_RETAINED'
            ? [{ kind: 'PRIOR_RETAINED', amount: openingAmount }, { kind: 'FRESH_FLOAT', amount: freshAmount }]
            : [{ kind: 'FRESH_FLOAT', amount: openingAmount }];
        const created = await post(`/cash-drawers/${drawerId}/sessions`, { business_date: openDate, custodian_id: Number(custodianId),
            opening_lines: lines, opening_sources: sources,
            prior_session_id: session?.status === 'CLOSED' ? session.session_id : null,
            approval_id: openingApprovalId || null, reason: openingReason || null }, 'open');
        if (created) { setQuantities({}); setOpeningAmount('0.00'); setShowOpen(false); }
    };

    const saveMovement = async event => {
        event.preventDefault();
        const result = await post(`/cash-drawers/sessions/${session.session_id}/movements`, { ...movementForm,
            expected_version: session.version }, 'movement');
        if (result) setMovementForm({ direction: 'IN', category: 'NOTEBOOK_RECEIPT', amount: '', description: '', counterparty: '' });
    };

    const beginCount = async kind => {
        const result = await post(`/cash-drawers/sessions/${session.session_id}/counts/start`, { kind, expected_version: session.version }, 'count-start');
        if (result) { setDraftCount(result.data); setCountQuantities({}); }
    };

    const saveCount = async event => {
        event.preventDefault();
        const result = await post(`/cash-drawers/counts/${draftCount.count_id}/submit`, { lines: linesFromQuantities(countQuantities) }, 'count-submit');
        if (result) setDraftCount(null);
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

    const latest = session?.latest_count;
    const selectedDrawer = drawers.find(item => String(item.drawer_id) === String(drawerId));
    const stale = latest && Number(session.last_sequence) > Number(latest.cutoff_sequence);
    const outflow = session?.total_out || '0.00';
    const closingCount = counts.find(item => item.kind === 'CLOSING' && item.status === 'SUBMITTED');
    const priorCents = BigInt(Math.round(Number(session?.close_snapshot?.retained_actual || 0) * 100));
    const openingDifference = BigInt(Math.round(Number(openingSource === 'PRIOR_RETAINED' ? openingAmount : 0) * 100)) - priorCents;
    const formatTime = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—';

    return <div className="mx-auto max-w-7xl space-y-5 text-slate-900 dark:text-slate-100">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h1 className="text-2xl font-bold">Cash Box</h1><p className="text-sm text-slate-500 dark:text-slate-400">Track the notes and coins held at the counter · {lastRefresh ? `Refreshed ${formatTime(lastRefresh)}` : 'Waiting for server'}</p></div>
            <div className="flex gap-2"><select aria-label="Drawer" className={field} value={drawerId} onChange={event => reload(event.target.value)}>{drawers.map(drawer => <option key={drawer.drawer_id} value={drawer.drawer_id}>{drawer.name}</option>)}</select><button className={button} onClick={() => reload()} disabled={busy}>Refresh</button></div>
        </div>
        {error && <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{error}</div>}
        {selectedDrawer && <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm dark:border-slate-800 dark:bg-slate-900">
            <strong>Current setup: {selectedDrawer.hardware_mode === 'ELECTRONIC_DRAWER' ? 'Electronic drawer' : 'Manual cash box'}</strong>
            <p className="mt-1 text-slate-600 dark:text-slate-300">{selectedDrawer.hardware_mode === 'ELECTRONIC_DRAWER'
                ? 'Electronic drawer mode is reserved for future device integration. Continue to count physical cash manually until a connected device is installed and verified.'
                : 'FBS records cash movements and compares them with your manual denomination counts. No electronic drawer hardware is connected; that option is reserved for a future setup.'}</p>
        </div>}
        {!session && drawerId && <Panel title="Start here: open the counter drawer">
            <ol className="list-inside list-decimal space-y-2 text-sm text-slate-700 dark:text-slate-200">
                <li>Count the notes and coins currently in the drawer below. Enter the same total as the opening source amount.</li>
                <li>Verify and open the session. This opening cash becomes the starting balance; it is not recorded as a sale.</li>
                <li>On a sales or payment screen, select this open session in the cash payment destination bar. Cash receipts then appear here automatically. Count again later to compare the physical cash with the expected balance.</li>
            </ol>
            <p className="mt-3 text-sm text-slate-600 dark:text-slate-300">Use manual Cash In or Cash Out only for physical cash events that do not already have their own sale, supplier payment, expense or refund form.</p>
        </Panel>}
        {session && <>
            <p className="text-sm">{session.session_code} · {session.business_date} · Custodian #{session.custodian_id} · <strong>{session.status}</strong></p>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                {[["Expected cash", money(session.expected)], ["Latest count", latest ? money(latest.counted) : 'Not counted'],
                    ["Over / short at count", latest ? money(latest.variance) : '—'], ["Cash out", money(outflow)]].map(([label, value]) =>
                    <div key={label} className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"><p className="text-sm text-slate-500 dark:text-slate-400">{label}</p><p className="mt-1 text-xl font-bold tabular-nums">{value}</p></div>)}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">Opening {money(session.opening_amount)} · Count cutoff {latest ? `#${latest.cutoff_sequence} at ${formatTime(latest.submitted_at)}` : 'none'}{stale ? ` · ${Number(session.last_sequence) - Number(latest.cutoff_sequence)} movements since count; recount to verify current cash` : ''}</p>
            {session.status === 'OPEN' && <p className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-100">The denomination count is a snapshot. Cash sales and payments add to the expected balance automatically after you select this session on the payment screen. Use Count cash to check the drawer again; use the manual form only for cash events without another FBS transaction.</p>}
        </>}
        {session?.status === 'CLOSED' && <button className={button} onClick={() => setShowOpen(value => !value)}>{showOpen ? 'Hide opening form' : 'Open a new session'}</button>}
        {(!session || (session.status === 'CLOSED' && showOpen)) && drawerId && <Panel title="Verify and open drawer"><form onSubmit={open} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2"><label>Business date<input type="date" value={openDate} onChange={event => setOpenDate(event.target.value)} className={field} required /></label><label>Custodian employee ID<input type="number" min="1" value={custodianId} onChange={event => setCustodianId(event.target.value)} className={field} required /></label></div>
            <DenominationEditor value={quantities} onChange={setQuantities} />
            <div className="grid gap-3 sm:grid-cols-2"><label>Opening source<select className={field} value={openingSource} onChange={event => setOpeningSource(event.target.value)}><option value="FRESH_FLOAT">Fresh verified float</option><option value="PRIOR_RETAINED">Prior retained custody</option></select></label><label>Source amount<input type="text" inputMode="decimal" value={openingAmount} onChange={event => setOpeningAmount(event.target.value)} className={field} required /></label></div>
            {openingSource === 'PRIOR_RETAINED' && <label>Additional fresh float<input className={field} inputMode="decimal" value={freshAmount} onChange={event => setFreshAmount(event.target.value)} required /></label>}
            <label>Reason or source reference<input value={openingReason} onChange={event => setOpeningReason(event.target.value)} className={field} /></label>
            {openingSource === 'PRIOR_RETAINED' && session?.status === 'CLOSED' && openingDifference !== 0n && <div className="rounded border border-amber-300 p-3"><p>Prior retained actual: {money(session.close_snapshot?.retained_actual)} · Difference: {money(Number(openingDifference) / 100)}. Independent review is required.</p><input className={field} placeholder="Approved bridge ID" value={openingApprovalId} onChange={event => setOpeningApprovalId(event.target.value)} /><button type="button" className={`${button} mt-2`} disabled={busy || !openingReason} onClick={async () => { const result = await post('/cash-drawers/approvals', { action: 'OPENING_BRIDGE', session_id: session.session_id, expected_version: session.version, amount: (Number(openingDifference) / 100).toFixed(2), reason: openingReason }, 'opening-bridge'); if (result) setOpeningApprovalId(String(result.data.approval_id)); }}>Request bridge review</button></div>}
            <button disabled={busy} className={button}>Verify and open drawer</button>
        </form></Panel>}
        {session && <>
            <div role="tablist" aria-label="Cash drawer sections" className="flex flex-wrap gap-2">{['Today','Counts','Handover & Advances','History'].map(name => <button key={name} type="button" role="tab" aria-selected={tab === name} onClick={() => setTab(name)} className={`min-h-11 rounded-lg px-4 ${tab === name ? 'bg-slate-900 text-white dark:bg-amber-600' : 'bg-white dark:bg-slate-800'}`}>{name}</button>)}</div>
            {tab === 'Today' && session.status === 'OPEN' && movementForm.direction === 'OUT' &&
                <ReviewRequest action="MANUAL_RELEASE" session={session} amount={movementForm.amount} reason={movementForm.description}
                    value={movementForm.approval_id} onChange={approval_id => setMovementForm({ ...movementForm, approval_id })} post={post} busy={busy} />}
            {tab === 'Today' && <div className="flex flex-wrap items-center gap-2">
                <input className={`${field} max-w-xs`} placeholder="Search description or source" value={registerSearch}
                    onChange={event => { setRegisterPage(1); setRegisterSearch(event.target.value); }} />
                <select className={`${field} max-w-40`} value={registerDirection} onChange={event => { setRegisterPage(1); setRegisterDirection(event.target.value); }}>
                    <option value="">All directions</option><option value="IN">Cash in</option><option value="OUT">Cash out</option>
                </select>
                <span className="text-sm">{registerTotal} entries · page {registerPage}</span>
                <button className="min-h-11 rounded border px-3" disabled={registerPage <= 1} onClick={() => setRegisterPage(page => page - 1)}>Previous</button>
                <button className="min-h-11 rounded border px-3" disabled={registerPage * 50 >= registerTotal} onClick={() => setRegisterPage(page => page + 1)}>Next</button>
            </div>}
            {tab === 'Today' && <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
                <Panel title="Movement register"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="py-2"># / time</th><th>Type / source</th><th>Cash in</th><th>Cash out</th><th>Balance after entry</th></tr></thead><tbody>{movements.map(item => <tr key={item.movement_id} className="border-b border-slate-100 dark:border-slate-800"><td className="py-2">#{item.sequence}<br />{formatTime(item.recorded_at)}</td><td>{item.category}<br /><span className="text-slate-500">{item.description}</span></td><td>{item.direction === 'IN' ? money(item.amount) : '—'}</td><td>{item.direction === 'OUT' ? money(item.amount) : '—'}</td><td className="tabular-nums">{money(item.balance_after)}</td></tr>)}</tbody></table>{movements.length === 0 && <p className="py-4 text-slate-500">No movements. Opening float is shown separately above.</p>}</div></Panel>
                <div className="space-y-4">
                    {session.status === 'OPEN' && <Panel title="Cash in / cash out"><form onSubmit={saveMovement} className="space-y-3"><select className={field} value={movementForm.direction} onChange={event => setMovementForm({ ...movementForm, direction: event.target.value })}><option>IN</option><option>OUT</option></select><select className={field} value={movementForm.category} onChange={event => setMovementForm({ ...movementForm, category: event.target.value })}>{['NOTEBOOK_RECEIPT','OTHER_RECEIPT','OWNER_DRAW','OTHER_RELEASE'].map(category => <option key={category}>{category}</option>)}</select><input className={field} placeholder="Amount" inputMode="decimal" value={movementForm.amount} onChange={event => setMovementForm({ ...movementForm, amount: event.target.value })} required /><input className={field} placeholder="Purpose / reference" value={movementForm.description} onChange={event => setMovementForm({ ...movementForm, description: event.target.value })} required /><input className={field} placeholder="Payer or recipient" value={movementForm.counterparty} onChange={event => setMovementForm({ ...movementForm, counterparty: event.target.value })} /><button className={button} disabled={busy}>Post physical cash</button></form><p className="mt-2 text-xs text-slate-500">Supplier payments and expenses belong in their owning forms; select drawer funding there.</p></Panel>}
                    {session.status === 'OPEN' && <button className={button} disabled={busy} onClick={() => beginCount('MIDDAY')}>Count cash</button>}
                    {session.status === 'OPEN' && <button className={button} disabled={busy} onClick={() => post(`/cash-drawers/sessions/${session.session_id}/start-closing`, { expected_version: session.version }, 'start-closing')}>Start closing</button>}
                    {session.status === 'CLOSING' && <button className={button} disabled={busy} onClick={() => beginCount('CLOSING')}>Start final count</button>}
                    {session.status === 'CLOSING' && <button className={button} disabled={busy} onClick={() => { const reason = window.prompt('Reason for cancelling closing'); if (reason) post(`/cash-drawers/sessions/${session.session_id}/cancel-closing`, { reason, expected_version: session.version }, 'cancel-closing'); }}>Cancel closing</button>}
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
                    <p>Operator #{selectedMovement.actor_id} · occurred {formatTime(selectedMovement.occurred_at)} · recorded {formatTime(selectedMovement.recorded_at)}</p>
                    <p>Source: {selectedMovement.source_event_key || 'manual'} · Counterparty: {selectedMovement.counterparty || '—'}</p>
                    {selectedMovement.reversal_of && <p>Reversal of movement #{selectedMovement.reversal_of}</p>}
                    {selectedMovement.invoice_id && <button className="min-h-11 underline" onClick={() => onNavigate?.('sales_history', { invoice_id: selectedMovement.invoice_id })}>Open invoice #{selectedMovement.invoice_id}</button>}
                    {selectedMovement.customer_payment_id && <button className="min-h-11 underline" onClick={() => onNavigate?.('ar', { customer_id: selectedMovement.customer_id })}>Open A/R payment #{selectedMovement.customer_payment_id}</button>}
                    {selectedMovement.expense_id && <button className="min-h-11 underline" onClick={() => onNavigate?.('expenses')}>Open expense #{selectedMovement.expense_id}</button>}
                    {selectedMovement.ap_payment_id && <button className="min-h-11 underline" onClick={() => onNavigate?.('ap')}>Open supplier payment #{selectedMovement.ap_payment_id}</button>}
                </div>}
            </Panel>}
            {draftCount && <Panel title={`${draftCount.kind} count · cutoff #${draftCount.cutoff_sequence}`}><p className="mb-3 text-sm">Expected at cutoff: {money(draftCount.expected)} · Cash writes paused until {formatTime(session.count_window_expires_at)}.</p><form onSubmit={saveCount}><DenominationEditor value={countQuantities} onChange={setCountQuantities} /><div className="mt-3 flex gap-2"><button className={button} disabled={busy}>Submit count</button><button type="button" className={button} disabled={busy} onClick={async () => { const reason = window.prompt('Reason for cancelling count'); if (reason) { const result = await post(`/cash-drawers/counts/${draftCount.count_id}/cancel`, { reason }, 'cancel-count'); if (result) setDraftCount(null); } }}>Cancel count</button></div></form></Panel>}
            {tab === 'Counts' && <Panel title="Count snapshots"><div className="space-y-3">{counts.map(count => <div key={count.count_id} className="rounded border border-slate-200 p-3 dark:border-slate-700"><strong>{count.kind} #{count.count_id}</strong> · {count.status} · {formatTime(count.submitted_at || count.started_at)}<p>Cutoff #{count.cutoff_sequence} · Expected {money(count.expected)} · Counted {count.counted === null ? 'Pending' : money(count.counted)} · Variance {count.variance === null ? 'Pending' : money(count.variance)}</p><p className="text-xs">{count.lines.map(line => `${line.code}: ${line.quantity}`).join(' · ')}</p></div>)}{approvals.map(item => <div key={item.approval_id} className="rounded border border-slate-200 p-3 dark:border-slate-700"><strong>Review #{item.approval_id}</strong> · {item.action} · {item.decision}<p>{item.reason}</p>{item.decision === 'PENDING' && <div className="mt-2 flex gap-2"><button className={button} disabled={busy} onClick={() => post(`/cash-drawers/approvals/${item.approval_id}/decision`, { decision: 'APPROVED' }, `approve-${item.approval_id}`)}>Approve</button><button className={button} disabled={busy} onClick={() => post(`/cash-drawers/approvals/${item.approval_id}/decision`, { decision: 'REJECTED' }, `reject-${item.approval_id}`)}>Reject</button></div>}</div>)}</div></Panel>}
            {tab === 'Handover & Advances' && session.status === 'OPEN' && <div className="grid gap-4 lg:grid-cols-2">
                <ReviewRequest action="TRANSFER" session={session} amount={transferForm.amount} reason={transferForm.destination}
                    value={transferForm.approval_id} onChange={approval_id => setTransferForm({ ...transferForm, approval_id })} post={post} busy={busy} />
                <ReviewRequest action="ADVANCE" session={session} amount={advanceForm.amount} reason={advanceForm.purpose}
                    value={advanceForm.approval_id} onChange={approval_id => setAdvanceForm({ ...advanceForm, approval_id })} post={post} busy={busy} />
            </div>}
            {tab === 'Handover & Advances' && <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="Transfers"><div className="space-y-2">{custody.transfers.map(item => <p key={item.transfer_id}>#{item.transfer_id} · {money(item.amount)} to {item.destination} · recipient #{item.recipient_id} · {item.events.length} events</p>)}</div>{session.status === 'OPEN' && <form className="mt-3 space-y-2" onSubmit={async event => { event.preventDefault(); const result = await post(`/cash-drawers/sessions/${session.session_id}/transfers`, { ...transferForm, expected_version: session.version }, 'transfer'); if (result) setTransferForm({ amount: '', destination: '', recipient_id: '' }); }}><input className={field} placeholder="Amount" value={transferForm.amount} onChange={event => setTransferForm({ ...transferForm, amount: event.target.value })} required /><input className={field} placeholder="Destination" value={transferForm.destination} onChange={event => setTransferForm({ ...transferForm, destination: event.target.value })} required /><input className={field} type="number" placeholder="Recipient employee ID" value={transferForm.recipient_id} onChange={event => setTransferForm({ ...transferForm, recipient_id: event.target.value })} required /><button className={button} disabled={busy}>Release transfer</button></form>}</Panel>
                <Panel title="Employee advances"><div className="space-y-2">{custody.advances.map(item => <p key={item.advance_id}>#{item.advance_id} · {money(item.amount)} · employee #{item.employee_id} · {item.events.length} events</p>)}</div>{session.status === 'OPEN' && <form className="mt-3 space-y-2" onSubmit={async event => { event.preventDefault(); const result = await post(`/cash-drawers/sessions/${session.session_id}/advances`, { ...advanceForm, expected_version: session.version }, 'advance'); if (result) setAdvanceForm({ employee_id: '', amount: '', purpose: '' }); }}><input className={field} type="number" placeholder="Employee ID" value={advanceForm.employee_id} onChange={event => setAdvanceForm({ ...advanceForm, employee_id: event.target.value })} required /><input className={field} placeholder="Amount" value={advanceForm.amount} onChange={event => setAdvanceForm({ ...advanceForm, amount: event.target.value })} required /><input className={field} placeholder="Purpose" value={advanceForm.purpose} onChange={event => setAdvanceForm({ ...advanceForm, purpose: event.target.value })} required /><button className={button} disabled={busy}>Release advance</button></form>}</Panel>
            </div>}
            {tab === 'Handover & Advances' && <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3">{custody.transfers.map(item => <TransferEventForm key={item.transfer_id} transfer={item} drawers={drawers} post={post} busy={busy} />)}</div>
                <div className="space-y-3">{custody.advances.map(item => <AdvanceEventForm key={item.advance_id} advance={item} drawers={drawers} post={post} busy={busy} />)}</div>
            </div>}
            {tab === 'History' && <Panel title="Session history"><div className="space-y-2">{history.map(item => <div key={item.session_id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 p-3 dark:border-slate-700"><span>{item.session_code} · {item.business_date} · {item.status} · expected {money(item.expected)}</span>{item.status === 'CLOSED' && <span className="flex gap-2"><button className="min-h-11 underline" onClick={() => downloadReport(item.session_id, 'pdf')}>PDF</button><button className="min-h-11 underline" onClick={() => downloadReport(item.session_id, 'csv')}>CSV</button></span>}</div>)}</div></Panel>}
            {session.status === 'CLOSING' && closingCount && <Panel title="Close drawer"><p className="mb-3">Final count {money(closingCount.counted)} · expected {money(closingCount.expected)} · variance {money(closingCount.variance)}. This comparison stays tied to cutoff #{closingCount.cutoff_sequence}.</p>{Number(closingCount.variance) !== 0 && <div className="mb-3 space-y-2"><input className={field} placeholder="Reason for difference" value={reviewReason} onChange={event => setReviewReason(event.target.value)} /><button className={button} disabled={busy || !reviewReason} onClick={async () => { const result = await post('/cash-drawers/approvals', { session_id: session.session_id, count_id: closingCount.count_id, reason: reviewReason, expected_version: session.version }, 'approval'); if (result) setApprovalId(String(result.data.approval_id)); }}>Request independent review</button><input className={field} placeholder="Approved review ID" value={approvalId} onChange={event => setApprovalId(event.target.value)} /></div>}<div className="grid gap-2 sm:grid-cols-2"><input className={field} placeholder="Final handover amount (optional)" value={handover.amount} onChange={event => setHandover({ ...handover, amount: event.target.value })} /><input className={field} placeholder="Destination" value={handover.destination} onChange={event => setHandover({ ...handover, destination: event.target.value })} /><input className={field} type="number" placeholder="Recipient employee ID" value={handover.recipient_id} onChange={event => setHandover({ ...handover, recipient_id: event.target.value })} /><input className={field} placeholder="Acknowledgment evidence" value={handover.evidence} onChange={event => setHandover({ ...handover, evidence: event.target.value })} /></div><button className={`${button} mt-3`} disabled={busy} onClick={() => post(`/cash-drawers/sessions/${session.session_id}/close`, { count_id: closingCount.count_id, expected_version: session.version, approval_id: approvalId || null, handovers: handover.amount ? [handover] : [] }, 'close')}>Confirm close</button></Panel>}
            {session.status === 'CLOSING' && handover.amount && <label className="block rounded border border-amber-300 p-3">Recipient password for handover acknowledgment<input type="password" autoComplete="off" className={field} value={handover.recipient_password} onChange={event => setHandover({ ...handover, recipient_password: event.target.value })} /></label>}
            {session.status === 'CLOSED' && <p className="text-sm">Closed reports are immutable. Later custody events appear in the handover history.</p>}
        </>}
        {!session && !drawerId && <p>No cash drawer is configured.</p>}
    </div>;
}
