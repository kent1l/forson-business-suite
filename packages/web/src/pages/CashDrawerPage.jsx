import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogPanel, DialogTitle } from '@headlessui/react';
import api from '../api';
import { createUuid } from '../utils/createUuid';
import KPICard from '../components/ui/KPICard';
import Icon from '../components/ui/Icon';
import StatusBadge from '../components/ui/StatusBadge';
import { ICONS } from '../constants';

const DENOMS = [
    ['PHP_1000', '₱1,000', 100000, 'Bill'],
    ['PHP_500', '₱500', 50000, 'Bill'],
    ['PHP_200', '₱200', 20000, 'Bill'],
    ['PHP_100', '₱100', 10000, 'Bill'],
    ['PHP_50', '₱50', 5000, 'Bill'],
    ['PHP_20', '₱20', 2000, 'Bill'],
    ['PHP_10', '₱10', 1000, 'Coin'],
    ['PHP_5', '₱5', 500, 'Coin'],
    ['PHP_1', '₱1', 100, 'Coin'],
    ['PHP_025', '₱0.25', 25, 'Coin'],
    ['PHP_010', '₱0.10', 10, 'Coin'],
    ['PHP_005', '₱0.05', 5, 'Coin'],
    ['PHP_001', '₱0.01', 1, 'Coin'],
];

const money = amount => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(Number(amount || 0));
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const formatTime = value => value ? new Date(value).toLocaleString('en-PH', { timeZone: 'Asia/Manila' }) : '—';

const CATEGORY_LABELS = {
    SALE: 'Sale',
    AR_RECEIPT: 'Customer collection',
    EXPENSE: 'Expense',
    SUPPLIER_PAYMENT: 'Supplier payment',
    CASH_REFUND: 'Cash refund',
    NOTEBOOK_RECEIPT: 'Notebook receipt',
    OTHER_RECEIPT: 'Other receipt',
    OWNER_DRAW: 'Owner withdrawal',
    OTHER_RELEASE: 'Other release',
    EMPLOYEE_ADVANCE: 'Employee advance',
    ADVANCE_RETURN: 'Advance return',
    ADVANCE_REIMBURSEMENT: 'Advance reimbursement',
    TRANSFER: 'Transfer',
    TRANSFER_RETURN: 'Transfer return',
    FINAL_HANDOVER: 'Final handover',
    CORRECTION: 'Correction',
    MIDDAY: 'Checkpoint count',
    CLOSING: 'Final count',
    DEPOSITED: 'Deposit confirmed',
    CONSUMPTION: 'Apply to expense/payment',
};
const formatCategory = cat => CATEGORY_LABELS[cat] || (cat ? cat.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase()) : '—');

const field = 'min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-primary-400 dark:focus:ring-primary-400/20';
const primaryButton = 'inline-flex min-h-11 items-center justify-center rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-700 active:bg-primary-800 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:cursor-not-allowed disabled:opacity-50 transition-colors cursor-pointer';
const secondaryButton = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 active:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-slate-400/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/60 disabled:cursor-not-allowed disabled:opacity-50 transition-colors cursor-pointer';
const dangerButton = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-red-400/20 dark:border-red-800 dark:bg-slate-900 dark:text-red-300 dark:hover:bg-red-950/40 disabled:cursor-not-allowed disabled:opacity-50 transition-colors cursor-pointer';
const button = primaryButton;
const validMoney = value => /^(0|[1-9]\d*)(\.\d{1,2})?$/.test(String(value));
const validQuantity = value => value == null || value === '' || (/^(0|[1-9]\d*)$/.test(String(value)) && Number(value) <= 2147483647);

function DenominationEditor({ value, onChange }) {
    const valid = DENOMS.every(([code]) => validQuantity(value[code]));
    const total = valid ? DENOMS.reduce((sum, [code, , cents]) => sum + BigInt(cents) * BigInt(value[code] || 0), 0n) : 0n;

    return (
        <div className="space-y-3">
            {!valid && <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">Quantities must be whole, nonnegative numbers.</p>}
            <div data-denominations className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:bg-slate-900/50 dark:text-slate-400">
                        <tr>
                            <th className="px-4 py-2.5">Denomination</th>
                            <th className="px-4 py-2.5 w-36 sm:w-44 text-right">Quantity</th>
                            <th className="px-4 py-2.5 text-right">Subtotal</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white dark:divide-slate-800 dark:bg-slate-900">
                        {DENOMS.map(([code, label, cents, type]) => {
                            const qty = value[code] ?? '';
                            const isValidLine = validQuantity(qty);
                            const lineSubtotal = isValidLine && qty !== '' ? (Number(cents) * Number(qty)) / 100 : 0;
                            return (
                                <tr key={code} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40">
                                    <td className="px-4 py-2 font-medium text-slate-900 dark:text-slate-100">
                                        <div className="flex items-center gap-2">
                                            <span>{label}</span>
                                            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-normal">({type})</span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-2 text-right">
                                        <input
                                            inputMode="numeric"
                                            type="number"
                                            min="0"
                                            step="1"
                                            aria-label={`Quantity for ${label}`}
                                            className={`${field} text-right tabular-nums py-1.5 min-h-9 h-9`}
                                            value={qty}
                                            onChange={event => onChange({ ...value, [code]: event.target.value })}
                                            onKeyDown={event => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    const inputs = [...event.currentTarget.closest('[data-denominations]').querySelectorAll('input')];
                                                    const next = inputs[inputs.indexOf(event.currentTarget) + 1] || event.currentTarget.form?.querySelector('textarea, button[type="submit"]');
                                                    next?.focus();
                                                }
                                            }}
                                        />
                                    </td>
                                    <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-700 dark:text-slate-300">
                                        {isValidLine ? money(lineSubtotal) : '—'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3 dark:bg-slate-900/60">
                <span className="text-sm font-medium text-slate-600 dark:text-slate-400">Total Counted</span>
                <span className="text-lg font-bold tabular-nums text-slate-900 dark:text-slate-50">
                    Counted: {valid ? money(Number(total) / 100) : 'Check quantities'}
                </span>
            </div>
        </div>
    );
}

function linesFromQuantities(quantities) {
    if (DENOMS.some(([code]) => !validQuantity(quantities[code]))) return null;
    return DENOMS.map(([code]) => ({ code, quantity: quantities[code] === '' || quantities[code] == null ? 0 : Number(quantities[code]) }));
}

function Panel({ title, action, children, className = '' }) {
    return (
        <section className={`rounded-xl border border-slate-200/80 bg-white p-5 shadow-card dark:border-slate-700 dark:bg-slate-800 ${className}`}>
            {title && (
                <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
                    {action}
                </div>
            )}
            {children}
        </section>
    );
}

function ReviewRequest({ action, session, amount, reason, value, onChange, post, busy, approvals = [] }) {
    const eligibleApprovals = (approvals || []).filter(item =>
        item.action === action &&
        String(item.session_id) === String(session?.session_id) &&
        item.decision === 'APPROVED'
    );
    const [manualMode, setManualMode] = useState(false);

    return (
        <div className="rounded-xl border border-warning-200 bg-warning-50/60 p-4 text-sm dark:border-warning-900/50 dark:bg-warning-950/20">
            <p className="font-semibold text-warning-900 dark:text-warning-200">Independent manager review is required for this release.</p>
            <div className="mt-3 flex flex-wrap gap-2">
                <button
                    type="button"
                    className={secondaryButton}
                    disabled={busy || !validMoney(amount) || Number(amount) <= 0 || !reason}
                    onClick={async () => {
                        const result = await post('/cash-drawers/approvals', {
                            action,
                            session_id: session.session_id,
                            expected_version: session.version,
                            amount,
                            reason,
                        }, `review-${action}`);
                        if (result) onChange(String(result.data.approval_id));
                    }}
                >
                    Request review
                </button>
            </div>
            <div className="mt-3">
                {eligibleApprovals.length > 0 && !manualMode ? (
                    <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Select approved review</label>
                        <select className={field} value={value || ''} onChange={event => onChange(event.target.value)}>
                            <option value="">Select an approved review</option>
                            {eligibleApprovals.map(app => (
                                <option key={app.approval_id} value={String(app.approval_id)}>
                                    Review #{app.approval_id} · {money(app.amount)} ({app.reason})
                                </option>
                            ))}
                        </select>
                        <button type="button" className="text-xs text-slate-500 underline hover:text-slate-700 dark:text-slate-400" onClick={() => setManualMode(true)}>
                            Or enter review ID manually
                        </button>
                    </div>
                ) : (
                    <div className="space-y-1">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Approved review ID</label>
                        <input className={field} placeholder="Approved review ID" value={value || ''} onChange={event => onChange(event.target.value)} />
                        {eligibleApprovals.length > 0 && (
                            <button type="button" className="text-xs text-slate-500 underline hover:text-slate-700 dark:text-slate-400" onClick={() => setManualMode(false)}>
                                Back to approved list
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function TransferEventForm({ transfer, drawers, post, busy, onSuccess }) {
    const [form, setForm] = useState({ stage: 'ACKNOWLEDGED', amount: '', evidence: '', receiving_session_id: '' });
    return (
        <form
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/40"
            onSubmit={async event => {
                event.preventDefault();
                const result = await post(`/cash-drawers/transfers/${transfer.transfer_id}/events`, form, `transfer-event-${transfer.transfer_id}`);
                if (result) {
                    setForm({ stage: 'ACKNOWLEDGED', amount: '', evidence: '', receiving_session_id: '' });
                    onSuccess?.();
                }
            }}
        >
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Record custody event for Transfer #{transfer.transfer_id}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium">Stage
                    <select className={field} value={form.stage} onChange={event => setForm({ ...form, stage: event.target.value })}>
                        <option>ACKNOWLEDGED</option><option>DEPOSITED</option><option>RETURNED</option><option>NOTE</option>
                    </select>
                </label>
                {form.stage !== 'NOTE' && (
                    <label className="block text-xs font-medium">Amount
                        <input className={field} inputMode="decimal" placeholder="Amount" required value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} />
                    </label>
                )}
            </div>
            {form.stage === 'RETURNED' && (
                <label className="block text-xs font-medium">Receiving open session
                    <select className={field} required value={form.receiving_session_id} onChange={event => setForm({ ...form, receiving_session_id: event.target.value })}>
                        <option value="">Select receiving session</option>
                        {drawers.filter(item => item.status === 'OPEN').map(item => (
                            <option key={item.session_id} value={item.session_id}>{item.name}</option>
                        ))}
                    </select>
                </label>
            )}
            <label className="block text-xs font-medium">Evidence / reference
                <input className={field} placeholder="Evidence / reference" required={form.stage !== 'NOTE'} value={form.evidence} onChange={event => setForm({ ...form, evidence: event.target.value })} />
            </label>
            <button className={primaryButton} disabled={busy}>Record custody event</button>
        </form>
    );
}

function AdvanceEventForm({ advance, drawers, post, busy, onSuccess }) {
    const [form, setForm] = useState({ kind: 'RETURN', amount: '', expense_id: '', ap_payment_id: '', receiving_session_id: '', notes: '', payer_employee_id: '', payer_evidence: '', approval_id: '' });
    const receiving = drawers.find(item => String(item.session_id) === String(form.receiving_session_id));
    return (
        <form
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/50 p-4 dark:border-slate-700 dark:bg-slate-800/40"
            onSubmit={async event => {
                event.preventDefault();
                const result = await post(`/cash-drawers/advances/${advance.advance_id}/events`, form, `advance-event-${advance.advance_id}`);
                if (result) {
                    setForm({ kind: 'RETURN', amount: '', expense_id: '', ap_payment_id: '', receiving_session_id: '', notes: '', payer_employee_id: '', payer_evidence: '', approval_id: '' });
                    onSuccess?.();
                }
            }}
        >
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Record advance event for Advance #{advance.advance_id}
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-medium">Kind
                    <select className={field} value={form.kind} onChange={event => setForm({ ...form, kind: event.target.value })}>
                        <option>RETURN</option><option>REIMBURSEMENT</option><option>CONSUMPTION</option><option>SETTLEMENT</option>
                    </select>
                </label>
                {form.kind !== 'SETTLEMENT' && (
                    <label className="block text-xs font-medium">Amount
                        <input className={field} inputMode="decimal" placeholder="Amount" required value={form.amount} onChange={event => setForm({ ...form, amount: event.target.value })} />
                    </label>
                )}
            </div>
            {form.kind === 'CONSUMPTION' && (
                <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-xs font-medium">Expense ID
                        <input className={field} type="number" placeholder="Expense ID" value={form.expense_id} onChange={event => setForm({ ...form, expense_id: event.target.value, ap_payment_id: '' })} />
                    </label>
                    <label className="block text-xs font-medium">Supplier payment ID
                        <input className={field} type="number" placeholder="Supplier payment ID" value={form.ap_payment_id} onChange={event => setForm({ ...form, ap_payment_id: event.target.value, expense_id: '' })} />
                    </label>
                </div>
            )}
            {form.kind === 'REIMBURSEMENT' && (
                <div className="grid gap-2 sm:grid-cols-2">
                    <label className="block text-xs font-medium">Expense ID
                        <input className={field} type="number" placeholder="Expense ID" required={!form.ap_payment_id} value={form.expense_id} onChange={event => setForm({ ...form, expense_id: event.target.value, ap_payment_id: '' })} />
                    </label>
                    <label className="block text-xs font-medium">Supplier payment ID
                        <input className={field} type="number" placeholder="Supplier payment ID" required={!form.expense_id} value={form.ap_payment_id} onChange={event => setForm({ ...form, ap_payment_id: event.target.value, expense_id: '' })} />
                    </label>
                </div>
            )}
            {['RETURN', 'REIMBURSEMENT'].includes(form.kind) && (
                <label className="block text-xs font-medium">Receiving open session
                    <select className={field} required value={form.receiving_session_id} onChange={event => setForm({ ...form, receiving_session_id: event.target.value })}>
                        <option value="">Open session for physical cash</option>
                        {drawers.filter(item => item.status === 'OPEN').map(item => (
                            <option key={item.session_id} value={item.session_id}>{item.name}</option>
                        ))}
                    </select>
                </label>
            )}
            <label className="block text-xs font-medium">Notes
                <input className={field} placeholder="Notes" value={form.notes} onChange={event => setForm({ ...form, notes: event.target.value })} />
            </label>
            {form.kind === 'REIMBURSEMENT' && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs dark:border-amber-900/40 dark:bg-amber-950/20">
                    <p className="font-medium text-amber-900 dark:text-amber-200">Document proof that this advance holder personally paid the source.</p>
                    <input className={field} type="number" placeholder="Payer employee ID" required value={form.payer_employee_id} onChange={event => setForm({ ...form, payer_employee_id: event.target.value })} />
                    <input className={field} placeholder="Verified receipt or evidence reference" required value={form.payer_evidence} onChange={event => setForm({ ...form, payer_evidence: event.target.value })} />
                </div>
            )}
            {form.kind === 'REIMBURSEMENT' && receiving?.status === 'OPEN' && (
                <ReviewRequest action="REIMBURSEMENT" session={receiving} amount={form.amount} reason={form.notes} value={form.approval_id} onChange={approval_id => setForm({ ...form, approval_id })} post={post} busy={busy} />
            )}
            <button className={primaryButton} disabled={busy}>Record advance event</button>
        </form>
    );
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
    const [drawerLoading, setDrawerLoading] = useState(true);

    const [movements, setMovements] = useState([]);
    const [registerPage, setRegisterPage] = useState(returnState.registerPage || 1);
    const [registerTotal, setRegisterTotal] = useState(0);
    const [registerSearch, setRegisterSearch] = useState(returnState.registerSearch || '');
    const [searchInput, setSearchInput] = useState(returnState.registerSearch || '');
    const [registerDirection, setRegisterDirection] = useState(returnState.registerDirection || '');
    const [registerCategory, setRegisterCategory] = useState(returnState.registerCategory || '');
    const [registerSource, setRegisterSource] = useState(returnState.registerSource || '');
    const [registerOperator, setRegisterOperator] = useState(returnState.registerOperator || '');
    const [registerTimeField, setRegisterTimeField] = useState(returnState.registerTimeField || 'recorded_at');
    const [registerFrom, setRegisterFrom] = useState(returnState.registerFrom || '');
    const [registerTo, setRegisterTo] = useState(returnState.registerTo || '');
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
    const [selectedMovement, setSelectedMovement] = useState(null);

    const [counts, setCounts] = useState([]);
    const [approvals, setApprovals] = useState([]);
    const [custody, setCustody] = useState({ transfers: [], advances: [] });
    const [custodyFilter, setCustodyFilter] = useState('PENDING');
    const [activeTransferEvent, setActiveTransferEvent] = useState(null);
    const [activeAdvanceEvent, setActiveAdvanceEvent] = useState(null);
    const [newTransferOpen, setNewTransferOpen] = useState(false);
    const [newAdvanceOpen, setNewAdvanceOpen] = useState(false);

    const [history, setHistory] = useState([]);
    const [historyPage, setHistoryPage] = useState(1);
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyFilters, setHistoryFilters] = useState({ from: '', to: '', status: '', custodian_id: '' });
    const [historyState, setHistoryState] = useState('loading');
    const [historyRefresh, setHistoryRefresh] = useState(0);
    const [historyError, setHistoryError] = useState('');
    const [historyDetail, setHistoryDetail] = useState(null);
    const [historyMovements, setHistoryMovements] = useState([]);
    const [historyCounts, setHistoryCounts] = useState([]);
    const [historyCountPage, setHistoryCountPage] = useState(1);
    const [historyCountTotal, setHistoryCountTotal] = useState(0);
    const [historyActivity, setHistoryActivity] = useState([]);
    const [historyActivityPage, setHistoryActivityPage] = useState(1);
    const [historyActivityTotal, setHistoryActivityTotal] = useState(0);
    const [historyActivityFilters, setHistoryActivityFilters] = useState({ employee_id: '', action: '', from: '', to: '' });
    const [historyCustody, setHistoryCustody] = useState({ transfers: [], advances: [] });
    const [historyDetailState, setHistoryDetailState] = useState('idle');
    const [historyMovementPage, setHistoryMovementPage] = useState(1);
    const [historyMovementTotal, setHistoryMovementTotal] = useState(0);

    const [tab, setTab] = useState(returnState.tab || 'Today');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [pendingWrite, setPendingWrite] = useState(() => {
        try {
            const prefix = `cash-box-write:${user?.employee_id}:`;
            for (const key of Object.keys(sessionStorage).filter(item => item.startsWith('cash-box-write:'))) {
                try {
                    const saved = JSON.parse(sessionStorage.getItem(key));
                    if (JSON.stringify(saved).includes('recipient_password') || JSON.stringify(saved).includes('ack_token')) {
                        sessionStorage.setItem(key, JSON.stringify({ key: saved.key, path: saved.path, reconcileOnly: true }));
                    }
                } catch { sessionStorage.removeItem(key); }
            }
            const key = Object.keys(sessionStorage).find(item => item.startsWith(prefix));
            try { return key ? { storageKey: key, ...JSON.parse(sessionStorage.getItem(key)) } : null; }
            catch { if (key) sessionStorage.removeItem(key); return null; }
        } catch { return { storageUnavailable: true }; }
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

    const [movementForm, setMovementForm] = useState({ direction: 'IN', category: 'NOTEBOOK_RECEIPT', amount: '', description: '', counterparty: '', physical_reference: '', occurred_at: '', late_reason: '', approval_id: '' });
    const [movementOpen, setMovementOpen] = useState(false);
    const [transferForm, setTransferForm] = useState({ amount: '', destination: '', recipient_id: '', approval_id: '' });
    const [advanceForm, setAdvanceForm] = useState({ employee_id: '', amount: '', purpose: '', approval_id: '' });
    const [approvalId, setApprovalId] = useState('');
    const [reviewReason, setReviewReason] = useState('');
    const [closeStep, setCloseStep] = useState(1);
    const [sourcesChecked, setSourcesChecked] = useState(false);
    const [closeNotes, setCloseNotes] = useState('');
    const [handover, setHandover] = useState({ amount: '', destination: '', recipient_id: '', recipient_password: '', evidence: '' });
    const [ack, setAck] = useState(null);

    const [cancelDialog, setCancelDialog] = useState({ open: false, type: '', reason: '' });

    const keys = useRef(new Map());
    const reloadId = useRef(0);
    const detailId = useRef(0);

    const draftKey = draftCount && `cash-box-count:${user?.employee_id}:${draftCount.session_id}:${draftCount.count_id}`;
    const countWindowValid = !!draftCount && !!session?.count_window_expires_at &&
        new Date(session.count_window_expires_at).getTime() > nowTick &&
        Number(session.version) === Number(draftCount.cutoff_version) &&
        Number(session.last_sequence) === Number(draftCount.cutoff_sequence) &&
        Number(user?.employee_id) === Number(draftCount.counter_id);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchInput !== registerSearch) {
                setRegisterPage(1);
                setRegisterSearch(searchInput);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchInput, registerSearch]);

    const reload = useCallback(async (desiredDrawerId = drawerId) => {
        const requestId = ++reloadId.current;
        const current = () => requestId === reloadId.current;
        setDrawerLoading(true);
        setError('');
        try {
            const drawerResponse = await api.get('/cash-drawers');
            if (!current()) return;
            const drawerRows = drawerResponse.data?.data || [];
            setDrawers(drawerRows);
            const chosen = String(desiredDrawerId || drawerRows[0]?.drawer_id || '');
            setDrawerId(chosen);
            setSession(null);
            setMovements([]);
            setCounts([]);
            setCustody({ transfers: [], advances: [] });
            setApprovals([]);
            setHistoryDetail(null);
            if (!chosen) return;
            const activeId = drawerRows.find(row => String(row.drawer_id) === chosen)?.session_id;
            const recent = activeId ? null : await api.get('/cash-drawers/sessions', { params: { drawer_id: chosen, limit: 1 } });
            if (!current()) return;
            const id = activeId || recent?.data?.data?.[0]?.session_id;
            if (!id) { setLastRefresh(new Date()); setHistoryRefresh(value => value + 1); return; }
            const results = await Promise.allSettled([
                api.get(`/cash-drawers/sessions/${id}`),
                api.get(`/cash-drawers/sessions/${id}/movements`, { params: {
                    page: registerPage, limit: 50,
                    search: registerSearch || undefined, direction: registerDirection || undefined,
                    category: registerCategory || undefined, source: registerSource || undefined,
                    operator: registerOperator || undefined, time_field: registerTimeField,
                    from: registerFrom || undefined, to: registerTo || undefined
                } }),
                api.get(`/cash-drawers/sessions/${id}/counts`),
                api.get(`/cash-drawers/sessions/${id}/custody`),
                api.get(`/cash-drawers/sessions/${id}/approvals`),
            ]);
            if (!current()) return;
            if (results[0].status !== 'fulfilled') throw results[0].reason;
            setSession(results[0].value.data.data);
            if (results[1].status === 'fulfilled') {
                const register = results[1].value.data;
                setMovements(register?.data || []);
                setRegisterTotal(register?.total || 0);
            }
            if (results[2].status === 'fulfilled') {
                const saved = results[2].value.data?.data || [];
                setCounts(saved);
                setDraftCount(saved.find(item => item.status === 'DRAFT') || null);
            }
            if (results[3].status === 'fulfilled') setCustody(results[3].value.data);
            if (results[4].status === 'fulfilled') setApprovals(results[4].value.data?.data || []);
            if (results.some(result => result.status === 'rejected')) setError('Some cash box data could not load. Refresh before a financial action.');
            setLastRefresh(new Date());
            setHistoryRefresh(value => value + 1);
        } catch (requestError) {
            if (current()) setError(requestError.response?.data?.message || 'Unable to refresh the cash drawer.');
        } finally {
            if (current()) setDrawerLoading(false);
        }
    }, [drawerId, registerPage, registerSearch, registerDirection, registerCategory, registerSource, registerOperator, registerTimeField, registerFrom, registerTo]);

    useEffect(() => {
        if (!drawerId) return undefined;
        let live = true;
        setHistoryState('loading');
        api.get('/cash-drawers/sessions', { params: { drawer_id: drawerId, page: historyPage, limit: 25, ...historyFilters } })
            .then(response => {
                if (!live) return;
                setHistory(response.data?.data || []);
                setHistoryTotal(response.data?.total || 0);
                setHistoryState('ready');
                setHistoryError('');
            }).catch(fetchError => {
                if (!live) return;
                setHistoryState('error');
                setHistoryError(fetchError.response?.data?.message || 'Session history could not load.');
            });
        return () => { live = false; };
    }, [drawerId, historyPage, historyFilters, historyRefresh]);

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
        sessionStorage.setItem(openingDraftKey, JSON.stringify({
            openDate, custodianId, openingSource, openingAmount,
            freshAmount, openingReason, openingApprovalId, quantities,
        }));
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
        if (pendingWrite?.storageUnavailable) { setError('Browser storage is unavailable. Financial submission was not sent.'); return null; }
        if (pendingWrite && pendingWrite.storageKey !== storageKey) {
            setError('Resolve the earlier cash write before starting another.');
            return null;
        }
        let saved = null;
        try { saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { sessionStorage.removeItem(storageKey); }
        const pending = keys.current.get(action) || saved;
        if (pending && pending.body && pending.body !== body) {
            setError('A previous write has an unknown result. Retry that exact request before changing this form.');
            setPendingWrite({ storageKey, ...pending });
            return null;
        }
        let key;
        try { key = pending?.body === body || (action === 'close' && pending?.key) ? pending.key : createUuid(); }
        catch { setError('This browser cannot generate a request key. Please use a supported browser.'); return null; }
        keys.current.set(action, { body: action === 'close' ? undefined : body, key, path });
        try { sessionStorage.setItem(storageKey, JSON.stringify(action === 'close' ? { key, path, reconcileOnly: true } : { body, key, path })); }
        catch { setError('Browser storage is unavailable. Financial submission was not sent.'); return null; }
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
            const definitive = requestError.response?.status >= 400 && requestError.response?.status < 500 &&
                requestError.response?.data?.code !== 'IDEMPOTENCY_CONFLICT';
            if (definitive) { keys.current.delete(action); sessionStorage.removeItem(storageKey); setPendingWrite(null); }
            else setPendingWrite(action === 'close' ? { storageKey, key, path, reconcileOnly: true } : { storageKey, body, key, path });
            setError(requestError.response?.data?.message || 'Action failed. Retry with the same request key.');
            return null;
        } finally { setBusy(false); }
    };

    const retryPending = async () => {
        if (!pendingWrite?.path) return;
        setBusy(true);
        try {
            if (pendingWrite.reconcileOnly) {
                const result = await api.get(`/cash-drawers/requests/${pendingWrite.key}`);
                if (result.data?.data?.status_code === 202) throw new Error('Request is still pending.');
            } else {
                await api.post(pendingWrite.path, JSON.parse(pendingWrite.body), { headers: { 'Idempotency-Key': pendingWrite.key } });
            }
            sessionStorage.removeItem(pendingWrite.storageKey);
            setPendingWrite(null);
            setError('');
            await reload();
        } catch (requestError) {
            if (requestError.response?.status === 404 && pendingWrite.reconcileOnly) {
                sessionStorage.removeItem(pendingWrite.storageKey);
                keys.current.set('close', { key: pendingWrite.key, path: pendingWrite.path });
                setPendingWrite(null);
                setAck(null);
                setCloseStep(4);
                setError('Close was not committed. Authenticate the recipient again; the original request key is reserved.');
            } else {
                setError(requestError.response?.data?.message || 'Result still unknown. Retry reconciliation with the original key.');
            }
        } finally { setBusy(false); }
    };

    const authenticateRecipient = async () => {
        try {
            const response = await api.post(`/cash-drawers/sessions/${session.session_id}/handover-ack`, {
                recipient_id: handover.recipient_id, recipient_password: handover.recipient_password,
                count_id: closingCount.count_id, expected_version: session.version,
                amount: handover.amount, destination: handover.destination,
            });
            setAck({ token: response.data.data.token, sessionId: session.session_id,
                version: session.version, countId: closingCount.count_id, amount: handover.amount,
                destination: handover.destination, recipientId: handover.recipient_id });
            setError('');
        } catch (requestError) {
            setAck(null);
            setError(requestError.response?.data?.message || 'Recipient authentication failed.');
        } finally {
            setHandover(current => ({ ...current, recipient_password: '' }));
        }
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
        const result = await post(`/cash-drawers/sessions/${session.session_id}/movements`, {
            ...movementForm,
            occurred_at: movementForm.occurred_at ? new Date(movementForm.occurred_at).toISOString() : undefined,
            expected_version: session.version
        }, 'movement');
        if (result) {
            setMovementForm({ direction: 'IN', category: 'NOTEBOOK_RECEIPT', amount: '', description: '', counterparty: '', physical_reference: '', occurred_at: '', late_reason: '', approval_id: '' });
            setMovementOpen(false);
        }
    };

    const beginCount = async kind => {
        const result = await post(`/cash-drawers/sessions/${session.session_id}/counts/start`, { kind, expected_version: session.version }, 'count-start');
        if (result) { setDraftCount(result.data); setCountQuantities({}); setCountNotes(''); }
    };

    const saveCount = async event => {
        event.preventDefault();
        const lines = linesFromQuantities(countQuantities);
        if (!lines) { setError('Count quantities must be whole, nonnegative numbers.'); return; }
        if (!countWindowValid) { setError('Count no longer valid. Refresh and start another count.'); return; }
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

    const loadHistoryDetail = async (sessionId, page = 1, countPage = 1, activityPage = 1, activityFilters = historyActivityFilters) => {
        const requestId = ++detailId.current;
        setHistoryDetailState('loading');
        if (page === 1) {
            setHistoryDetail(null);
            setHistoryMovements([]);
            setHistoryCounts([]);
            setHistoryActivity([]);
            setHistoryCustody({ transfers: [], advances: [] });
        }
        const results = await Promise.allSettled([
            api.get(`/cash-drawers/sessions/${sessionId}`),
            api.get(`/cash-drawers/sessions/${sessionId}/movements`, { params: { page, limit: 50 } }),
            api.get(`/cash-drawers/sessions/${sessionId}/counts`, { params: { page: countPage, limit: 50 } }),
            api.get(`/cash-drawers/sessions/${sessionId}/custody`),
            api.get(`/cash-drawers/sessions/${sessionId}/activity`, { params: { page: activityPage, limit: 50, ...activityFilters } }),
        ]);
        if (requestId !== detailId.current) return;
        if (results[0].status !== 'fulfilled') {
            setHistoryDetailState('error');
            return;
        }
        setHistoryDetail(results[0].value.data.data);
        if (results[1].status === 'fulfilled') {
            setHistoryMovements(results[1].value.data?.data || []);
            setHistoryMovementTotal(results[1].value.data?.total || 0);
            setHistoryMovementPage(page);
        }
        if (results[2].status === 'fulfilled') {
            setHistoryCounts(results[2].value.data?.data || []);
            setHistoryCountPage(countPage);
            setHistoryCountTotal(results[2].value.data?.total || 0);
        }
        if (results[3].status === 'fulfilled') setHistoryCustody(results[3].value.data);
        if (results[4].status === 'fulfilled') {
            setHistoryActivity(results[4].value.data?.data || []);
            setHistoryActivityPage(activityPage);
            setHistoryActivityTotal(results[4].value.data?.total || 0);
        }
        setHistoryDetailState(results.some(result => result.status === 'rejected') ? 'partial' : 'ready');
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
    const handoverReady = !handover.amount || (Number(handover.amount) > 0 && !!handover.destination && !!handover.recipient_id && !!ack?.token && ack.sessionId === session?.session_id && ack.version === session?.version && ack.countId === closingCount?.count_id && ack.amount === handover.amount && ack.destination === handover.destination && ack.recipientId === handover.recipient_id && !!handover.evidence);
    const handoverWithinCash = !handover.amount || (validMoney(handover.amount) && Number(handover.amount) <= Number(closingCount?.counted || 0) && Number(handover.amount) <= Number(closingCount?.expected || 0));

    const transferRemaining = item => Number(item.amount) - item.events.filter(event => ['DEPOSITED', 'RETURNED'].includes(event.stage)).reduce((sum, event) => sum + Number(event.amount), 0);
    const advanceRemaining = item => Number(item.amount) - item.events.filter(event => ['CONSUMPTION', 'RETURN'].includes(event.kind)).reduce((sum, event) => sum + Number(event.amount), 0);
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

    const navigateSource = (page, state = {}) => {
        const sourcePermission = { sales_history: 'invoicing:create', ar: 'ar:view', expenses: 'expenses:view', ap: 'ap:view' }[page];
        if (sourcePermission && Number(user?.permission_level_id) !== 10 && !user?.permissions?.includes(sourcePermission)) {
            setError('You do not have permission to open this source record. Ask an authorized employee to review it.');
            return;
        }
        const cashBoxReturn = {
            drawerId, registerPage, registerSearch, registerDirection, registerCategory, registerSource,
            registerOperator, registerTimeField, registerFrom, registerTo, tab,
        };
        sessionStorage.setItem(`cash-box-return:${user?.employee_id}`, JSON.stringify(cashBoxReturn));
        onNavigate?.(page, { ...state, cashBoxReturn });
    };

    useEffect(() => { setApprovalId(''); }, [closingCount?.count_id]);

    const openMovement = direction => {
        setTab('Today');
        setMovementForm(form => ({ ...form, direction, category: direction === 'IN' ? 'NOTEBOOK_RECEIPT' : 'OWNER_DRAW', approval_id: '' }));
        setMovementOpen(true);
    };

    const handleConfirmCancel = async () => {
        if (!cancelDialog.reason.trim()) return;
        if (cancelDialog.type === 'COUNT' && draftCount) {
            const result = await post(`/cash-drawers/counts/${draftCount.count_id}/cancel`, { reason: cancelDialog.reason }, 'cancel-count');
            if (result) {
                sessionStorage.removeItem(draftKey);
                setDraftCount(null);
                setCancelDialog({ open: false, type: '', reason: '' });
            }
        } else if (cancelDialog.type === 'CLOSING' && session) {
            const result = await post(`/cash-drawers/sessions/${session.session_id}/cancel-closing`, { reason: cancelDialog.reason, expected_version: session.version }, 'cancel-closing');
            if (result) {
                setCancelDialog({ open: false, type: '', reason: '' });
            }
        }
    };

    const renderMovementForm = () => (
        <form onSubmit={saveMovement} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Direction
                    <select
                        className={`${field} mt-1`}
                        value={movementForm.direction}
                        onChange={event => setMovementForm({
                            ...movementForm,
                            direction: event.target.value,
                            category: event.target.value === 'IN' ? 'NOTEBOOK_RECEIPT' : 'OWNER_DRAW',
                            approval_id: ''
                        })}
                    >
                        <option value="IN">Cash in</option>
                        <option value="OUT">Cash out</option>
                    </select>
                </label>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Category
                    <select
                        className={`${field} mt-1`}
                        value={movementForm.category}
                        onChange={event => setMovementForm({ ...movementForm, category: event.target.value })}
                    >
                        {(movementForm.direction === 'IN' ? ['NOTEBOOK_RECEIPT', 'OTHER_RECEIPT'] : ['OWNER_DRAW', 'OTHER_RELEASE']).map(cat => (
                            <option key={cat} value={cat}>{formatCategory(cat)}</option>
                        ))}
                    </select>
                </label>
            </div>

            {movementForm.direction === 'OUT' && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-800/60 dark:text-slate-300">
                    For an expense or supplier payment, record it in its owning workflow to maintain cross-ledger integrity.
                    <div className="mt-1 flex gap-3">
                        {canExpense && <button type="button" className="font-medium text-primary-600 underline hover:text-primary-700 dark:text-primary-400" onClick={() => navigateSource('expenses')}>Open Expenses</button>}
                        {canAP && <button type="button" className="font-medium text-primary-600 underline hover:text-primary-700 dark:text-primary-400" onClick={() => navigateSource('ap', { tab: 'payments' })}>Open Accounts Payable</button>}
                    </div>
                </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Amount
                    <input className={`${field} mt-1`} inputMode="decimal" placeholder="0.00" value={movementForm.amount} onChange={event => setMovementForm({ ...movementForm, amount: event.target.value })} required />
                </label>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Payer or recipient
                    <input className={`${field} mt-1`} placeholder="Name or entity" value={movementForm.counterparty} onChange={event => setMovementForm({ ...movementForm, counterparty: event.target.value })} />
                </label>
            </div>

            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Purpose
                <input className={`${field} mt-1`} placeholder="Reason for physical cash movement" value={movementForm.description} onChange={event => setMovementForm({ ...movementForm, description: event.target.value })} required />
            </label>

            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Physical reference{movementForm.category === 'NOTEBOOK_RECEIPT' ? ' (notebook and page required)' : ''}
                <input
                    className={`${field} mt-1`}
                    maxLength={120}
                    placeholder={movementForm.category === 'NOTEBOOK_RECEIPT' ? 'e.g., Book 3, Page 12' : 'Receipt or slip reference'}
                    value={movementForm.physical_reference}
                    onChange={event => setMovementForm({ ...movementForm, physical_reference: event.target.value })}
                    required={movementForm.category === 'NOTEBOOK_RECEIPT'}
                />
            </label>
            {movementForm.category === 'NOTEBOOK_RECEIPT' && (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Not yet encoded as sale. Link this receipt when entering the sale later to avoid posting the same cash twice.
                </p>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Occurred at (optional)
                    <input className={`${field} mt-1`} type="datetime-local" value={movementForm.occurred_at} onChange={event => setMovementForm({ ...movementForm, occurred_at: event.target.value })} />
                </label>
                {movementForm.occurred_at && (
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                        Late entry reason
                        <input className={`${field} mt-1`} placeholder="Reason for delayed entry" value={movementForm.late_reason} onChange={event => setMovementForm({ ...movementForm, late_reason: event.target.value })} />
                    </label>
                )}
            </div>

            <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300 space-y-1">
                <p>Authenticated operator: <span className="font-semibold text-slate-900 dark:text-slate-100">{user?.first_name} {user?.last_name}</span></p>
                <p>
                    Expected after entry: <span className="font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                        {movementAmountValid && session ? money(Number(session.expected) + (movementForm.direction === 'IN' ? 1 : -1) * Number(movementForm.amount)) : 'Enter a positive amount'}
                    </span> (preview)
                </p>
            </div>

            {movementForm.direction === 'OUT' && session && (
                <ReviewRequest
                    action="MANUAL_RELEASE"
                    session={session}
                    amount={movementForm.amount}
                    reason={movementForm.description}
                    value={movementForm.approval_id}
                    onChange={approval_id => setMovementForm({ ...movementForm, approval_id })}
                    post={post}
                    busy={busy}
                    approvals={approvals}
                />
            )}

            <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <button type="button" className={secondaryButton} onClick={() => setMovementOpen(false)}>Cancel</button>
                <button className={primaryButton} disabled={busy || !movementAmountValid || (movementForm.direction === 'OUT' && !movementForm.approval_id)}>
                    Post physical cash
                </button>
            </div>
        </form>
    );

    const activeFilterCount = [
        registerCategory,
        registerSource,
        registerOperator,
        registerFrom,
        registerTo,
    ].filter(Boolean).length;

    const activeFilterChips = [];
    if (registerSearch) activeFilterChips.push({ key: 'search', label: `"${registerSearch}"`, clear: () => { setRegisterSearch(''); setSearchInput(''); } });
    if (registerDirection) activeFilterChips.push({ key: 'direction', label: registerDirection === 'IN' ? 'Cash in' : 'Cash out', clear: () => setRegisterDirection('') });
    if (registerCategory) activeFilterChips.push({ key: 'category', label: formatCategory(registerCategory), clear: () => setRegisterCategory('') });
    if (registerSource) activeFilterChips.push({ key: 'source', label: registerSource, clear: () => setRegisterSource('') });
    if (registerOperator) {
        const emp = employees.find(e => String(e.employee_id) === String(registerOperator));
        activeFilterChips.push({ key: 'operator', label: emp ? emp.name : `Operator #${registerOperator}`, clear: () => setRegisterOperator('') });
    }
    if (registerFrom || registerTo) activeFilterChips.push({ key: 'dates', label: `${registerFrom || 'Start'} → ${registerTo || 'End'}`, clear: () => { setRegisterFrom(''); setRegisterTo(''); } });

    const clearAllRegisterFilters = () => {
        setRegisterSearch('');
        setSearchInput('');
        setRegisterDirection('');
        setRegisterCategory('');
        setRegisterSource('');
        setRegisterOperator('');
        setRegisterFrom('');
        setRegisterTo('');
        setRegisterPage(1);
    };

    const pendingReviewsCount = approvals.filter(a => a.decision === 'PENDING').length;
    const pendingTransfersCount = custody.transfers.filter(item => transferRemaining(item) > 0).length;
    const unsettledAdvancesCount = custody.advances.filter(item => !item.events.some(event => event.kind === 'SETTLEMENT')).length;

    const tabsList = [
        { key: 'Today', label: 'Today' },
        { key: 'Counts', label: 'Counts & Reviews', badge: pendingReviewsCount },
        { key: 'Handover & Advances', label: 'Handover & Advances', badge: pendingTransfersCount + unsettledAdvancesCount },
        { key: 'History', label: 'History' },
    ];

    return (
        <div className="mx-auto max-w-7xl space-y-6 text-slate-900 dark:text-slate-100">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50 sm:text-3xl">Cash Box</h1>
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Physical cash movements and reconciliation</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                        {drawerLoading ? (
                            <span>Loading drawer…</span>
                        ) : error && lastRefresh ? (
                            <span>Stale data · last updated {formatTime(lastRefresh)}</span>
                        ) : lastRefresh ? (
                            <span>Updated {formatTime(lastRefresh)}</span>
                        ) : (
                            <span>Loading</span>
                        )}
                        {session && (
                            <>
                                <span>·</span>
                                <span>{session.session_code}</span>
                                <span>·</span>
                                <span>{session.business_date}</span>
                                <span>·</span>
                                <span>Coordinator: <strong className="font-semibold text-slate-800 dark:text-slate-200">{session.custodian_name}</strong></span>
                                <span>·</span>
                                <StatusBadge
                                    tone={session.status === 'OPEN' ? 'success' : session.status === 'CLOSING' ? 'warning' : 'neutral'}
                                    label={session.status}
                                />
                            </>
                        )}
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <select
                        aria-label="Drawer"
                        className={`${field} w-auto min-w-[160px]`}
                        value={drawerId}
                        onChange={event => {
                            const next = event.target.value;
                            ++detailId.current;
                            setDrawerId(next);
                            setSession(null);
                            setRegisterPage(1);
                            setMovements([]);
                            setCounts([]);
                            setCustody({ transfers: [], advances: [] });
                            setApprovals([]);
                            setDrawerLoading(true);
                            setHistory([]);
                            setHistoryDetail(null);
                            setHistoryPage(1);
                            setHistoryState('loading');
                            reload(next);
                        }}
                    >
                        {drawers.map(d => (
                            <option key={d.drawer_id} value={d.drawer_id}>{d.name}</option>
                        ))}
                    </select>

                    <button type="button" className={secondaryButton} onClick={() => reload()} disabled={busy}>
                        Refresh
                    </button>

                    {session?.status === 'OPEN' && canCount && !draftCount && (
                        <button type="button" className={primaryButton} disabled={busy} onClick={() => beginCount('MIDDAY')}>
                            Count cash
                        </button>
                    )}

                    {!drawerLoading && !error && drawerId && !['OPEN', 'CLOSING'].includes(session?.status) && canOpen && (
                        <button type="button" className={primaryButton} onClick={() => setShowOpen(value => !value)}>
                            {showOpen ? 'Hide opening form' : 'Open cash box'}
                        </button>
                    )}

                    {session?.status === 'CLOSING' && canClose && (
                        <button type="button" className={primaryButton} onClick={() => setTab('Today')}>
                            Continue closing
                        </button>
                    )}
                </div>
            </div>

            {/* Global Alerts */}
            {error && (
                <div role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900 shadow-sm dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
                    <div className="flex items-center gap-2">
                        <Icon path={ICONS.warning} className="h-5 w-5 text-red-600 dark:text-red-400" />
                        <span>{error}</span>
                    </div>
                </div>
            )}

            {pendingWrite?.path && (
                <div className="rounded-xl border border-warning-300 bg-warning-50 p-4 shadow-sm dark:border-warning-900 dark:bg-warning-950/40">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm font-medium text-warning-900 dark:text-warning-200">
                            A previous financial submission is pending reconciliation with the server.
                        </p>
                        <button className={primaryButton} disabled={busy} onClick={retryPending}>
                            Retry pending request with original key
                        </button>
                    </div>
                </div>
            )}

            {!drawerLoading && !error && drawerId && !['OPEN', 'CLOSING'].includes(session?.status) && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-300">
                    <strong>No session open.</strong> Review previous sessions in History, or count the cash and choose Open cash box to start a session.
                </div>
            )}

            {/* Session KPI Overview */}
            {!drawerLoading && !error && session && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                        <KPICard
                            title="Expected cash"
                            value={money(session.expected)}
                            subtitle={`Opening ${money(session.opening_amount)}`}
                            icon="currency"
                            color="blue"
                        />
                        <KPICard
                            title="Latest count"
                            value={latest ? money(latest.counted) : 'Not counted'}
                            subtitle={latest ? `Cutoff #${latest.cutoff_sequence} · ${formatTime(latest.submitted_at)}` : 'No submitted count yet'}
                            icon="receipt"
                            color="gray"
                        />
                        <KPICard
                            title="Over / short at count"
                            value={latest ? (
                                Number(latest.variance) > 0 ? `+${money(latest.variance)} (Over)` :
                                Number(latest.variance) < 0 ? `-${money(Math.abs(latest.variance))} (Short)` :
                                `${money(0)} (Balanced)`
                            ) : '—'}
                            subtitle={stale ? 'Cash moved since cutoff' : latest ? 'At latest cutoff' : 'Count to verify'}
                            icon="warning"
                            color={latest ? (Number(latest.variance) < 0 ? 'red' : Number(latest.variance) > 0 ? 'amber' : 'green') : 'gray'}
                            urgent={Boolean(stale || (latest && Number(latest.variance) !== 0))}
                        />
                        <KPICard
                            title="Cash out"
                            value={money(outflow)}
                            subtitle={`Cash in ${money(session.total_in)}`}
                            icon="package"
                            color="gray"
                        />
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-xs text-slate-500 dark:text-slate-400">
                        <span>Opening {money(session.opening_amount)} · Cash in {money(session.total_in)} · Cash out {money(session.total_out)} — opening float is separate from receipts.</span>
                        {selectedDrawer && <span>{selectedDrawer.hardware_mode === 'ELECTRONIC_DRAWER' ? 'Electronic drawer mode' : 'Manual cash box'}</span>}
                    </div>

                    {/* Attention Alerts */}
                    {stale && (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-warning-200 bg-warning-50/70 p-3.5 text-sm text-warning-900 shadow-sm dark:border-warning-900/60 dark:bg-warning-950/30 dark:text-warning-200">
                            <div className="flex items-center gap-2">
                                <Icon path={ICONS.warning} className="h-5 w-5 text-warning-600 dark:text-warning-400" />
                                <span>{Number(session.last_sequence) - Number(latest.cutoff_sequence)} movements since count. Cash moved since this count — recount to verify current cash.</span>
                            </div>
                            {canCount && !draftCount && (
                                <button type="button" className="font-semibold underline hover:text-warning-950 dark:hover:text-warning-100" onClick={() => beginCount('MIDDAY')}>
                                    Recount cash
                                </button>
                            )}
                        </div>
                    )}

                    {/* Operational Action Bar for OPEN Session */}
                    {session.status === 'OPEN' && (
                        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 shadow-card dark:border-slate-700 dark:bg-slate-800">
                            <div className="flex flex-wrap items-center gap-2">
                                {canMove && (
                                    <button type="button" className={secondaryButton} disabled={!!draftCount} onClick={() => openMovement('IN')}>
                                        Cash in
                                    </button>
                                )}
                                {canMove && (
                                    <button type="button" className={secondaryButton} disabled={!!draftCount} onClick={() => openMovement('OUT')}>
                                        Cash out
                                    </button>
                                )}
                                {canTransfer && (
                                    <button type="button" className={secondaryButton} disabled={!!draftCount} onClick={() => setTab('Handover & Advances')}>
                                        Transfer
                                    </button>
                                )}
                            </div>
                            <div>
                                {canClose && (
                                    <button
                                        type="button"
                                        className={dangerButton}
                                        disabled={busy || !!draftCount}
                                        onClick={() => post(`/cash-drawers/sessions/${session.session_id}/start-closing`, { expected_version: session.version }, 'start-closing')}
                                    >
                                        Close drawer
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Open Cash Box Panel */}
            {!drawerLoading && !error && showOpen && !['OPEN', 'CLOSING'].includes(session?.status) && drawerId && canOpen && (
                <Panel title="Open cash box">
                    <form onSubmit={open} className="space-y-4">
                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Business date
                                <input type="date" value={openDate} onChange={event => setOpenDate(event.target.value)} className={`${field} mt-1`} required />
                            </label>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Person responsible for the cash
                                <select value={custodianId} onChange={event => setCustodianId(event.target.value)} className={`${field} mt-1`} required>
                                    <option value="">Select employee</option>
                                    {custodians.map(person => (
                                        <option key={person.employee_id} value={person.employee_id}>{person.name}</option>
                                    ))}
                                </select>
                            </label>
                        </div>

                        {custodianLoadError && <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">Could not load employees. Reload this page.</p>}

                        <div>
                            <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Physical Float Verification</span>
                            <DenominationEditor value={quantities} onChange={setQuantities} />
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Opening cash came from
                                <select className={`${field} mt-1`} value={openingSource} onChange={event => setOpeningSource(event.target.value)}>
                                    <option value="FRESH_FLOAT">Initial cash in box</option>
                                    <option value="PRIOR_RETAINED">Cash kept from last close</option>
                                </select>
                            </label>
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Opening cash amount
                                <input type="text" inputMode="decimal" value={openingAmount} onChange={event => setOpeningAmount(event.target.value)} className={`${field} mt-1`} required />
                            </label>
                        </div>

                        {openingSource === 'PRIOR_RETAINED' && (
                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                Additional cash added
                                <input className={`${field} mt-1`} inputMode="decimal" value={freshAmount} onChange={event => setFreshAmount(event.target.value)} required />
                            </label>
                        )}

                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Reason or source reference
                            <input value={openingReason} onChange={event => setOpeningReason(event.target.value)} className={`${field} mt-1`} placeholder="Optional reference note" />
                        </label>

                        {openingSource === 'PRIOR_RETAINED' && session?.status === 'CLOSED' && openingDifference !== 0n && (
                            <div className="rounded-xl border border-warning-300 bg-warning-50/70 p-4 text-sm dark:border-warning-900/60 dark:bg-warning-950/20">
                                <p className="font-medium text-warning-900 dark:text-warning-200">
                                    Prior retained actual: {money(session.close_snapshot?.retained_actual)} · Difference: {money(Number(openingDifference) / 100)}. Independent review is required.
                                </p>
                                <input className={`${field} mt-2`} placeholder="Approved bridge ID" value={openingApprovalId} onChange={event => setOpeningApprovalId(event.target.value)} />
                                <button
                                    type="button"
                                    className={`${secondaryButton} mt-2`}
                                    disabled={busy || !openingReason}
                                    onClick={async () => {
                                        const result = await post('/cash-drawers/approvals', {
                                            action: 'OPENING_BRIDGE',
                                            session_id: session.session_id,
                                            expected_version: session.version,
                                            amount: (Number(openingDifference) / 100).toFixed(2),
                                            reason: openingReason,
                                        }, 'opening-bridge');
                                        if (result) setOpeningApprovalId(String(result.data.approval_id));
                                    }}
                                >
                                    Request bridge review
                                </button>
                            </div>
                        )}

                        {!openingMatches && (
                            <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">
                                Opening sources must equal the denomination count before opening.
                            </p>
                        )}

                        <button disabled={busy || custodianLoadError || !custodians.length || !openingMatches} className={primaryButton}>
                            Verify and open cash box
                        </button>
                    </form>
                </Panel>
            )}

            {/* Navigation Tabs */}
            <div role="tablist" aria-label="Cash drawer sections" className="flex flex-wrap gap-2 border-b border-slate-200 pb-2 dark:border-slate-800">
                {tabsList.map(({ key: tabKey, label: tabLabel, badge: tabBadge }, index, names) => {
                    const isSelected = tab === tabKey;
                    return (
                        <button
                            key={tabKey}
                            type="button"
                            role="tab"
                            aria-selected={isSelected}
                            tabIndex={isSelected ? 0 : -1}
                            onClick={() => setTab(tabKey)}
                            onKeyDown={event => {
                                if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
                                    event.preventDefault();
                                    const next = (index + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length;
                                    setTab(names[next].key);
                                    event.currentTarget.parentElement.children[next].focus();
                                }
                            }}
                            className={`inline-flex min-h-11 items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all cursor-pointer ${
                                isSelected
                                    ? 'bg-primary-600 text-white shadow-sm dark:bg-primary-600'
                                    : 'bg-white text-slate-700 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/70 border border-slate-200/80 dark:border-slate-700'
                            }`}
                        >
                            <span>{tabLabel}</span>
                            {tabBadge > 0 && (
                                <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${
                                    isSelected ? 'bg-white/20 text-white' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
                                }`}>
                                    {tabBadge}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>

            {/* TAB CONTENT: Today */}
            {!drawerLoading && !error && session && tab === 'Today' && (
                <div className="space-y-4">
                    {/* Closing Stepper when CLOSING */}
                    {session.status === 'CLOSING' && (
                        <Panel title="Close cash box">
                            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">Step {closeStep} of 5 · cash writes are paused. Cancelling closing requires a reason and a fresh final count later.</p>
                            {closeStep === 1 && (
                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">1. Verify source completeness</h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-300">Check physical cash sales, refunds, expenses, supplier payments, transfers, and advances before the final count.</p>
                                    <label className="flex items-start gap-2 text-sm cursor-pointer">
                                        <input type="checkbox" className="mt-1 size-5 rounded border-slate-300 text-primary-600 focus:ring-primary-500" checked={sourcesChecked} onChange={event => setSourcesChecked(event.target.checked)} />
                                        <span>I checked the source records for this session.</span>
                                    </label>
                                    <div className="flex flex-wrap gap-2 pt-2">
                                        <button className={primaryButton} disabled={!sourcesChecked} onClick={() => setCloseStep(2)}>Continue to final count</button>
                                        {canClose && <button type="button" className={dangerButton} disabled={busy} onClick={() => setCancelDialog({ open: true, type: 'CLOSING', reason: '' })}>Cancel closing</button>}
                                    </div>
                                </div>
                            )}

                            {closeStep === 2 && (
                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">2. Final count</h3>
                                    {closingCount && (
                                        <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-900/60">
                                            Latest final count #{closingCount.count_id}: <strong className="font-semibold tabular-nums">{money(closingCount.counted)}</strong> against {money(closingCount.expected)} at cutoff #{closingCount.cutoff_sequence}.
                                        </div>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        {canCount && !draftCount && (
                                            <button className={secondaryButton} disabled={busy} onClick={() => beginCount('CLOSING')}>
                                                {closingCount ? 'Recount cash' : 'Count cash'}
                                            </button>
                                        )}
                                        <button className={primaryButton} disabled={!closingCount || !!draftCount} onClick={() => setCloseStep(3)}>
                                            Continue to variance review
                                        </button>
                                        <button type="button" className={secondaryButton} onClick={() => setCloseStep(1)}>Back</button>
                                    </div>
                                </div>
                            )}

                            {closeStep === 3 && (
                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">3. Review variance</h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-300">
                                        Expected {money(closingCount?.expected)} · counted {money(closingCount?.counted)} · over / short <strong className="font-semibold tabular-nums">{money(closingCount?.variance)}</strong> at cutoff #{closingCount?.cutoff_sequence}.
                                    </p>
                                    {Number(closingCount?.variance) !== 0 && (
                                        <div className="space-y-3 rounded-lg border border-warning-200 bg-warning-50/60 p-4 dark:border-warning-900/50 dark:bg-warning-950/20">
                                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                Reason for variance
                                                <input className={`${field} mt-1`} value={reviewReason} onChange={event => setReviewReason(event.target.value)} />
                                            </label>
                                            <button
                                                type="button"
                                                className={secondaryButton}
                                                disabled={busy || !reviewReason || !closingCount}
                                                onClick={async () => {
                                                    const result = await post('/cash-drawers/approvals', { session_id: session.session_id, count_id: closingCount.count_id, reason: reviewReason, expected_version: session.version }, 'approval');
                                                    if (result) setApprovalId(String(result.data.approval_id));
                                                }}
                                            >
                                                Request independent review
                                            </button>
                                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                                Review ID
                                                <input className={`${field} mt-1`} value={approvalId} onChange={event => setApprovalId(event.target.value)} />
                                            </label>
                                            {!approvedClosingReview && <p className="text-xs text-warning-800 dark:text-warning-300">Waiting for independent manager approval. Refresh after the manager decides.</p>}
                                        </div>
                                    )}
                                    <div className="flex flex-wrap gap-2">
                                        <button type="button" className={secondaryButton} onClick={() => setCloseStep(2)}>Back</button>
                                        <button className={primaryButton} disabled={!closingCount || (Number(closingCount.variance) !== 0 && !approvedClosingReview)} onClick={() => setCloseStep(4)}>
                                            Continue to handover
                                        </button>
                                    </div>
                                </div>
                            )}

                            {closeStep === 4 && (
                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">4. Handover and retain</h3>
                                    <p className="text-sm text-slate-600 dark:text-slate-300">Leave the amount blank to retain all counted cash in the box.</p>
                                    <div className="grid gap-3 sm:grid-cols-2">
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                            Final handover amount
                                            <input className={`${field} mt-1`} inputMode="decimal" value={handover.amount} onChange={event => { setHandover({ ...handover, amount: event.target.value }); setAck(null); }} />
                                        </label>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                            Destination
                                            <input className={`${field} mt-1`} value={handover.destination} onChange={event => { setHandover({ ...handover, destination: event.target.value }); setAck(null); }} />
                                        </label>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                            Recipient
                                            <select className={`${field} mt-1`} value={handover.recipient_id} onChange={event => { setHandover({ ...handover, recipient_id: event.target.value }); setAck(null); }}>
                                                <option value="">Select employee</option>
                                                {employees.map(person => (
                                                    <option key={person.employee_id} value={person.employee_id}>{person.name}</option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                            Acknowledgment evidence
                                            <input className={`${field} mt-1`} value={handover.evidence} onChange={event => setHandover({ ...handover, evidence: event.target.value })} />
                                        </label>
                                        {handover.amount && (
                                            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 sm:col-span-2">
                                                Recipient password
                                                <input type="password" autoComplete="off" className={`${field} mt-1`} value={handover.recipient_password} onChange={event => setHandover({ ...handover, recipient_password: event.target.value })} />
                                            </label>
                                        )}
                                        {handover.amount && (
                                            <div className="sm:col-span-2">
                                                <button type="button" className={secondaryButton} disabled={busy || !handover.recipient_password || !handover.recipient_id || !handover.destination || !validMoney(handover.amount)} onClick={authenticateRecipient}>
                                                    {ack ? 'Reauthenticate recipient' : 'Authenticate recipient'}
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-900/60 dark:text-slate-300">
                                        Retained actual {money(Number(closingCount?.counted || 0) - Number(handover.amount || 0))} · retained ledger {money(Number(closingCount?.expected || 0) - Number(handover.amount || 0))} (preview).
                                    </div>
                                    {!handoverWithinCash && <p role="alert" className="text-sm font-medium text-red-700 dark:text-red-400">Handover cannot exceed counted or expected cash.</p>}
                                    <div className="flex flex-wrap gap-2">
                                        <button type="button" className={secondaryButton} onClick={() => setCloseStep(3)}>Back</button>
                                        <button className={primaryButton} disabled={!handoverReady || !handoverWithinCash} onClick={() => setCloseStep(5)}>Review close</button>
                                    </div>
                                </div>
                            )}

                            {closeStep === 5 && (
                                <div className="space-y-4">
                                    <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">5. Review and confirm</h3>
                                    <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-700 dark:bg-slate-900/60 dark:text-slate-300 space-y-1.5">
                                        <p>Session {session.session_code} · custodian {session.custodian_name}</p>
                                        <p>Opening {money(session.opening_amount)} · cash in {money(session.total_in)} · cash out before final handover {money(session.total_out)}</p>
                                        <p>Expected at cutoff {money(closingCount?.expected)} · counted {money(closingCount?.counted)} · variance {money(closingCount?.variance)}</p>
                                        <p>Handover {money(handover.amount)} · retained actual {money(Number(closingCount?.counted || 0) - Number(handover.amount || 0))} · retained ledger {money(Number(closingCount?.expected || 0) - Number(handover.amount || 0))} (preview).</p>
                                    </div>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        Closing notes
                                        <textarea className={`${field} mt-1`} maxLength={2000} value={closeNotes} onChange={event => setCloseNotes(event.target.value)} />
                                    </label>
                                    <div className="flex flex-wrap gap-2">
                                        <button type="button" className={secondaryButton} onClick={() => setCloseStep(4)}>Back</button>
                                        <button className={primaryButton} disabled={busy || !canClose || !closingCount || !handoverReady || !handoverWithinCash || (Number(closingCount?.variance) !== 0 && !approvedClosingReview)} onClick={() => post(`/cash-drawers/sessions/${session.session_id}/close`, { count_id: closingCount.count_id, expected_version: session.version, approval_id: approvalId || null, handovers: handover.amount ? [{ amount: handover.amount, destination: handover.destination, recipient_id: handover.recipient_id, evidence: handover.evidence, ack_token: ack.token }] : [], notes: closeNotes }, 'close')}>
                                            Confirm close
                                        </button>
                                    </div>
                                </div>
                            )}
                        </Panel>
                    )}

                    {/* Full-width Movement Register */}
                    <Panel
                        title="Movement register"
                        action={
                            <div className="text-xs text-slate-500 dark:text-slate-400">
                                Showing {movements.length === 0 ? 0 : (registerPage - 1) * 50 + 1}–{Math.min(registerPage * 50, registerTotal)} of {registerTotal} entries
                            </div>
                        }
                    >
                        {/* Toolbar */}
                        <div className="space-y-3 pb-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <div className="relative min-w-[220px] flex-1 max-w-sm">
                                    <input
                                        aria-label="Search cash movements"
                                        className={`${field} pr-8`}
                                        placeholder="Search reference, purpose or operator"
                                        value={searchInput}
                                        onChange={event => setSearchInput(event.target.value)}
                                        onKeyDown={event => {
                                            if (event.key === 'Enter') {
                                                event.preventDefault();
                                                setRegisterPage(1);
                                                setRegisterSearch(searchInput);
                                            }
                                        }}
                                    />
                                    {searchInput && (
                                        <button
                                            type="button"
                                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                                            onClick={() => { setSearchInput(''); setRegisterSearch(''); setRegisterPage(1); }}
                                            aria-label="Clear search"
                                        >
                                            ✕
                                        </button>
                                    )}
                                </div>

                                <select
                                    aria-label="Direction"
                                    className={`${field} w-auto min-w-[130px]`}
                                    value={registerDirection}
                                    onChange={event => { setRegisterPage(1); setRegisterDirection(event.target.value); }}
                                >
                                    <option value="">All directions</option>
                                    <option value="IN">Cash in</option>
                                    <option value="OUT">Cash out</option>
                                </select>

                                <button
                                    type="button"
                                    className={`${secondaryButton} gap-1.5`}
                                    onClick={() => setShowAdvancedFilters(v => !v)}
                                >
                                    <Icon path={ICONS.adjust} className="h-4 w-4" />
                                    <span>Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}</span>
                                </button>

                                {activeFilterChips.length > 0 && (
                                    <button
                                        type="button"
                                        className="text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer px-2 py-1"
                                        onClick={clearAllRegisterFilters}
                                    >
                                        Clear all
                                    </button>
                                )}
                            </div>

                            {/* Active Filter Chips */}
                            {activeFilterChips.length > 0 && (
                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                    {activeFilterChips.map(chip => (
                                        <span
                                            key={chip.key}
                                            className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 dark:bg-slate-700 dark:text-slate-300"
                                        >
                                            {chip.label}
                                            <button
                                                type="button"
                                                className="hover:text-slate-900 dark:hover:text-white cursor-pointer ml-1"
                                                onClick={chip.clear}
                                                aria-label={`Remove filter ${chip.label}`}
                                            >
                                                ✕
                                            </button>
                                        </span>
                                    ))}
                                </div>
                            )}

                            {/* Collapsible Advanced Filters */}
                            {showAdvancedFilters && (
                                <div className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-700 dark:bg-slate-900/40 sm:grid-cols-2 lg:grid-cols-4">
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Category</label>
                                        <select
                                            aria-label="Category"
                                            className={`${field} mt-1`}
                                            value={registerCategory}
                                            onChange={event => { setRegisterPage(1); setRegisterCategory(event.target.value); }}
                                        >
                                            <option value="">All categories</option>
                                            {Object.entries(CATEGORY_LABELS).map(([catKey, catLabel]) => (
                                                <option key={catKey} value={catKey}>{catLabel}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Source</label>
                                        <select
                                            aria-label="Source"
                                            className={`${field} mt-1`}
                                            value={registerSource}
                                            onChange={event => { setRegisterPage(1); setRegisterSource(event.target.value); }}
                                        >
                                            <option value="">All sources</option>
                                            <option value="AUTOMATIC">Automatic</option>
                                            <option value="MANUAL">Manual</option>
                                            <option value="REVERSAL">Reversal</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Operator</label>
                                        <select
                                            aria-label="Operator"
                                            className={`${field} mt-1`}
                                            value={registerOperator}
                                            onChange={event => { setRegisterPage(1); setRegisterOperator(event.target.value); }}
                                        >
                                            <option value="">All operators</option>
                                            {employees.map(person => (
                                                <option key={person.employee_id} value={person.employee_id}>{person.name}</option>
                                            ))}
                                            {registerOperator && !employees.some(person => String(person.employee_id) === String(registerOperator)) && (
                                                <option value={registerOperator}>Operator #{registerOperator}</option>
                                            )}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">Time basis</label>
                                        <select
                                            aria-label="Time basis"
                                            className={`${field} mt-1`}
                                            value={registerTimeField}
                                            onChange={event => { setRegisterPage(1); setRegisterTimeField(event.target.value); }}
                                        >
                                            <option value="recorded_at">Recorded time</option>
                                            <option value="occurred_at">Occurred time</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">From date</label>
                                        <input
                                            type="date"
                                            className={`${field} mt-1`}
                                            value={registerFrom}
                                            onChange={event => { setRegisterPage(1); setRegisterFrom(event.target.value); }}
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">To date</label>
                                        <input
                                            type="date"
                                            className={`${field} mt-1`}
                                            value={registerTo}
                                            onChange={event => { setRegisterPage(1); setRegisterTo(event.target.value); }}
                                        />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Mobile Cards Layout */}
                        <div className="space-y-2.5 md:hidden">
                            {movements.map(item => (
                                <div
                                    key={item.movement_id}
                                    className="rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-700 dark:bg-slate-800"
                                >
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                <span className="font-mono text-xs font-semibold text-slate-500">#{item.sequence}</span>
                                                <StatusBadge
                                                    tone={item.direction === 'IN' ? 'success' : 'neutral'}
                                                    label={formatCategory(item.category)}
                                                />
                                                {item.reversal_of && <StatusBadge tone="danger" label="Reversal" />}
                                            </div>
                                            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{item.description}</p>
                                        </div>
                                        <span className={`text-base font-bold tabular-nums ${item.direction === 'IN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                            {item.direction === 'OUT' ? '−' : '+'}{money(item.amount)}
                                        </span>
                                    </div>
                                    <div className="mt-2.5 flex items-center justify-between border-t border-slate-100 pt-2 text-xs text-slate-500 dark:border-slate-700/60 dark:text-slate-400">
                                        <span>{formatTime(item.recorded_at)} · {item.operator_name}</span>
                                        <button
                                            type="button"
                                            className="font-semibold text-primary-600 underline hover:text-primary-700 dark:text-primary-400"
                                            onClick={() => setSelectedMovement(item)}
                                        >
                                            View
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Desktop Table View */}
                        <div className="hidden overflow-x-auto md:block">
                            <table className="w-full min-w-[760px] text-left text-sm">
                                <thead>
                                    <tr className="border-b border-slate-200 bg-slate-50/50 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-700 dark:bg-slate-900/30 dark:text-slate-400">
                                        <th className="py-3 px-3"># / Recorded</th>
                                        <th className="py-3 px-3">Type / Description / Reference</th>
                                        <th className="py-3 px-3 text-right">Cash in</th>
                                        <th className="py-3 px-3 text-right">Cash out</th>
                                        <th className="py-3 px-3 text-right">Running balance</th>
                                        <th className="py-3 px-3">Operator</th>
                                        <th className="py-3 px-3 text-right">Action</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                    {movements.map(item => (
                                        <tr key={item.movement_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/50">
                                            <td className="py-3 px-3 align-top font-mono text-xs">
                                                <span className="font-semibold text-slate-700 dark:text-slate-300">#{item.sequence}</span>
                                                <div className="text-[11px] text-slate-400">{formatTime(item.recorded_at)}</div>
                                            </td>
                                            <td className="py-3 px-3 align-top">
                                                <div className="flex flex-wrap items-center gap-1.5">
                                                    <StatusBadge
                                                        tone={item.direction === 'IN' ? 'success' : 'neutral'}
                                                        label={formatCategory(item.category)}
                                                    />
                                                    {item.reversal_of && <StatusBadge tone="danger" label="Reversal" />}
                                                    {item.late_reason && <StatusBadge tone="warning" label="Late" />}
                                                </div>
                                                <div className="mt-1 font-medium text-slate-900 dark:text-slate-100">{item.description}</div>
                                                <div className="text-xs text-slate-400 dark:text-slate-500">
                                                    {item.physical_reference || item.source_event_key || `Movement #${item.movement_id}`}
                                                </div>
                                            </td>
                                            <td className="py-3 px-3 align-top text-right tabular-nums font-semibold text-emerald-600 dark:text-emerald-400">
                                                {item.direction === 'IN' ? money(item.amount) : '—'}
                                            </td>
                                            <td className="py-3 px-3 align-top text-right tabular-nums font-semibold text-slate-800 dark:text-slate-200">
                                                {item.direction === 'OUT' ? money(item.amount) : '—'}
                                            </td>
                                            <td className="py-3 px-3 align-top text-right tabular-nums font-semibold text-slate-900 dark:text-slate-100">
                                                {money(item.balance_after)}
                                            </td>
                                            <td className="py-3 px-3 align-top text-slate-600 dark:text-slate-300">
                                                {item.operator_name}
                                            </td>
                                            <td className="py-3 px-3 align-top text-right">
                                                <button
                                                    type="button"
                                                    className="inline-flex min-h-8 items-center rounded-md border border-slate-300 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-700/60 cursor-pointer"
                                                    onClick={() => setSelectedMovement(item)}
                                                >
                                                    View
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {movements.length === 0 && (
                            <div className="py-8 text-center text-sm text-slate-500 dark:text-slate-400">
                                {registerTotal === 0 && !registerSearch && !registerDirection && !registerCategory && !registerSource
                                    ? 'No cash movements yet.'
                                    : 'No movements match these filters.'}
                            </div>
                        )}

                        {/* Pagination Footer */}
                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                            <span className="text-sm text-slate-600 dark:text-slate-400">
                                {registerTotal} entries · page {registerPage} of {Math.max(1, Math.ceil(registerTotal / 50))}
                            </span>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className={secondaryButton}
                                    disabled={registerPage <= 1}
                                    onClick={() => setRegisterPage(page => page - 1)}
                                >
                                    Previous
                                </button>
                                <button
                                    type="button"
                                    className={secondaryButton}
                                    disabled={registerPage * 50 >= registerTotal}
                                    onClick={() => setRegisterPage(page => page + 1)}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    </Panel>
                </div>
            )}

            {/* TAB CONTENT: Counts & Reviews */}
            {!drawerLoading && !error && session && tab === 'Counts' && (
                <div className="space-y-6">
                    <Panel title="Count snapshots">
                        <div className="space-y-3">
                            {counts.map(count => (
                                <div key={count.count_id} className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/40">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100">{count.kind} #{count.count_id}</strong>
                                            <StatusBadge tone={count.status === 'SUBMITTED' ? 'success' : count.status === 'CANCELLED' ? 'danger' : 'warning'} label={count.status} />
                                        </div>
                                        <span className="text-xs text-slate-500">{formatTime(count.submitted_at || count.started_at)}</span>
                                    </div>
                                    <div className="mt-2 grid gap-2 text-xs sm:grid-cols-4">
                                        <div>Cutoff sequence: <strong className="font-semibold">#{count.cutoff_sequence}</strong></div>
                                        <div>Expected: <strong className="font-semibold tabular-nums">{money(count.expected)}</strong></div>
                                        <div>Counted: <strong className="font-semibold tabular-nums">{count.counted === null ? 'Pending' : money(count.counted)}</strong></div>
                                        <div>Variance: <strong className="font-semibold tabular-nums">{count.variance === null ? 'Pending' : money(count.variance)}</strong></div>
                                    </div>
                                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                                        Counter: {count.counter_name || 'Staff'} · {count.lines?.map(line => `${line.code}: ${line.quantity}`).join(' · ')}
                                    </div>
                                    {count.notes && <p className="mt-2 text-xs italic text-slate-600 dark:text-slate-300">Notes: {count.notes}</p>}
                                </div>
                            ))}
                            {counts.length === 0 && <p className="py-4 text-center text-sm text-slate-500">No count snapshots recorded for this session.</p>}
                        </div>
                    </Panel>

                    <Panel title="Review requests">
                        <div className="space-y-3">
                            {approvals.map(item => (
                                <div key={item.approval_id} className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/40">
                                    <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div className="flex items-center gap-2">
                                            <strong className="text-sm font-semibold text-slate-900 dark:text-slate-100">Review #{item.approval_id}</strong>
                                            <StatusBadge tone={item.decision === 'APPROVED' ? 'success' : item.decision === 'REJECTED' ? 'danger' : 'warning'} label={item.decision} />
                                            <span className="text-xs text-slate-500">({item.action})</span>
                                        </div>
                                        <span className="text-xs font-semibold tabular-nums text-slate-700 dark:text-slate-300">{money(item.amount)}</span>
                                    </div>
                                    <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{item.reason}</p>
                                    {item.decision === 'PENDING' && canReview && Number(item.requester_id) !== Number(user?.employee_id) && (
                                        <div className="mt-3 flex gap-2">
                                            <button className={primaryButton} disabled={busy} onClick={() => post(`/cash-drawers/approvals/${item.approval_id}/decision`, { decision: 'APPROVED' }, `approve-${item.approval_id}`)}>
                                                Approve
                                            </button>
                                            <button className={dangerButton} disabled={busy} onClick={() => post(`/cash-drawers/approvals/${item.approval_id}/decision`, { decision: 'REJECTED' }, `reject-${item.approval_id}`)}>
                                                Reject
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                            {approvals.length === 0 && <p className="py-4 text-center text-sm text-slate-500">No review requests recorded for this session.</p>}
                        </div>
                    </Panel>
                </div>
            )}

            {/* TAB CONTENT: Handover & Advances */}
            {!drawerLoading && !error && session && tab === 'Handover & Advances' && (
                <div className="space-y-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="inline-flex rounded-lg bg-slate-100 p-1 dark:bg-slate-900" role="group" aria-label="Custody status filter">
                            {['PENDING', 'COMPLETED', 'ALL'].map(status => (
                                <button
                                    key={status}
                                    type="button"
                                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all cursor-pointer ${
                                        custodyFilter === status ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200'
                                    }`}
                                    onClick={() => setCustodyFilter(status)}
                                >
                                    {status[0] + status.slice(1).toLowerCase()}
                                </button>
                            ))}
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {session.status === 'OPEN' && !draftCount && canTransfer && (
                                <button type="button" className={secondaryButton} onClick={() => setNewTransferOpen(v => !v)}>
                                    {newTransferOpen ? 'Hide Transfer Form' : '+ New Transfer'}
                                </button>
                            )}
                            {session.status === 'OPEN' && !draftCount && canMove && (
                                <button type="button" className={secondaryButton} onClick={() => setNewAdvanceOpen(v => !v)}>
                                    {newAdvanceOpen ? 'Hide Advance Form' : '+ New Advance'}
                                </button>
                            )}
                        </div>
                    </div>

                    {/* New Transfer Drawer/Panel */}
                    {newTransferOpen && session.status === 'OPEN' && !draftCount && canTransfer && (
                        <Panel title="Release physical transfer">
                            <form
                                className="space-y-4"
                                onSubmit={async event => {
                                    event.preventDefault();
                                    const result = await post(`/cash-drawers/sessions/${session.session_id}/transfers`, { ...transferForm, expected_version: session.version }, 'transfer');
                                    if (result) {
                                        setTransferForm({ amount: '', destination: '', recipient_id: '', approval_id: '' });
                                        setNewTransferOpen(false);
                                    }
                                }}
                            >
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        Amount
                                        <input className={`${field} mt-1`} inputMode="decimal" placeholder="Amount" value={transferForm.amount} onChange={event => setTransferForm({ ...transferForm, amount: event.target.value })} required />
                                    </label>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        Destination
                                        <input className={`${field} mt-1`} placeholder="Safe, Vault, Branch…" value={transferForm.destination} onChange={event => setTransferForm({ ...transferForm, destination: event.target.value })} required />
                                    </label>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        Recipient
                                        <select className={`${field} mt-1`} value={transferForm.recipient_id} onChange={event => setTransferForm({ ...transferForm, recipient_id: event.target.value })} required>
                                            <option value="">Select employee</option>
                                            {employees.map(person => (
                                                <option key={person.employee_id} value={person.employee_id}>{person.name}</option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                                <ReviewRequest action="TRANSFER" session={session} amount={transferForm.amount} reason={transferForm.destination} value={transferForm.approval_id} onChange={approval_id => setTransferForm({ ...transferForm, approval_id })} post={post} busy={busy} approvals={approvals} />
                                <div className="flex justify-end gap-2">
                                    <button type="button" className={secondaryButton} onClick={() => setNewTransferOpen(false)}>Cancel</button>
                                    <button className={primaryButton} disabled={busy || !transferForm.amount || !transferForm.destination || !transferForm.recipient_id}>Release transfer</button>
                                </div>
                            </form>
                        </Panel>
                    )}

                    {/* New Advance Drawer/Panel */}
                    {newAdvanceOpen && session.status === 'OPEN' && !draftCount && canMove && (
                        <Panel title="Release employee advance">
                            <form
                                className="space-y-4"
                                onSubmit={async event => {
                                    event.preventDefault();
                                    const result = await post(`/cash-drawers/sessions/${session.session_id}/advances`, { ...advanceForm, expected_version: session.version }, 'advance');
                                    if (result) {
                                        setAdvanceForm({ employee_id: '', amount: '', purpose: '', approval_id: '' });
                                        setNewAdvanceOpen(false);
                                    }
                                }}
                            >
                                <div className="grid gap-3 sm:grid-cols-3">
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        Employee receiving advance
                                        <select className={`${field} mt-1`} value={advanceForm.employee_id} onChange={event => setAdvanceForm({ ...advanceForm, employee_id: event.target.value })} required>
                                            <option value="">Select employee</option>
                                            {employees.map(person => (
                                                <option key={person.employee_id} value={person.employee_id}>{person.name}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        Amount
                                        <input className={`${field} mt-1`} inputMode="decimal" placeholder="Amount" value={advanceForm.amount} onChange={event => setAdvanceForm({ ...advanceForm, amount: event.target.value })} required />
                                    </label>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        Purpose
                                        <input className={`${field} mt-1`} placeholder="Purpose" value={advanceForm.purpose} onChange={event => setAdvanceForm({ ...advanceForm, purpose: event.target.value })} required />
                                    </label>
                                </div>
                                <ReviewRequest action="ADVANCE" session={session} amount={advanceForm.amount} reason={advanceForm.purpose} value={advanceForm.approval_id} onChange={approval_id => setAdvanceForm({ ...advanceForm, approval_id })} post={post} busy={busy} approvals={approvals} />
                                <div className="flex justify-end gap-2">
                                    <button type="button" className={secondaryButton} onClick={() => setNewAdvanceOpen(false)}>Cancel</button>
                                    <button className={primaryButton} disabled={busy || !advanceForm.employee_id || !advanceForm.amount || !advanceForm.purpose}>Release advance</button>
                                </div>
                            </form>
                        </Panel>
                    )}

                    {/* Transfers and Advances Cards Grid */}
                    <div className="grid gap-6 lg:grid-cols-2">
                        {/* Transfers Column */}
                        <Panel title="Transfers">
                            <div className="space-y-3">
                                {visibleTransfers.map(item => {
                                    const rem = transferRemaining(item);
                                    return (
                                        <div key={item.transfer_id} className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/40 space-y-2">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                                    Transfer #{item.transfer_id} · <span className="tabular-nums">{money(item.amount)}</span> to {item.destination}
                                                </span>
                                                <StatusBadge tone={rem > 0 ? 'warning' : 'success'} label={rem > 0 ? `Awaiting ${money(rem)}` : 'Completed'} />
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                Recipient: {item.recipient_name} · {Math.max(0, Math.floor((nowTick - new Date(item.created_at)) / 86400000))} days old · {item.events.length} events
                                            </div>
                                            <div className="text-xs text-slate-600 dark:text-slate-400">
                                                {item.events.map(ev => `${ev.stage} ${money(ev.amount)}`).join(' · ') || 'No custody events yet'}
                                            </div>
                                            {canTransfer && (
                                                <div className="pt-2">
                                                    <button
                                                        type="button"
                                                        className={secondaryButton}
                                                        onClick={() => setActiveTransferEvent(activeTransferEvent === item.transfer_id ? null : item.transfer_id)}
                                                    >
                                                        {activeTransferEvent === item.transfer_id ? 'Cancel Event' : 'Record custody event'}
                                                    </button>
                                                    {activeTransferEvent === item.transfer_id && (
                                                        <div className="mt-3">
                                                            <TransferEventForm transfer={item} drawers={drawers} post={post} busy={busy} onSuccess={() => setActiveTransferEvent(null)} />
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {!visibleTransfers.length && <p className="py-4 text-center text-sm text-slate-500">No transfers match this filter.</p>}
                            </div>
                        </Panel>

                        {/* Employee Advances Column */}
                        <Panel title="Employee advances">
                            <div className="space-y-3">
                                {visibleAdvances.map(item => {
                                    const rem = advanceRemaining(item);
                                    const isSettled = item.events.some(e => e.kind === 'SETTLEMENT');
                                    return (
                                        <div key={item.advance_id} className="rounded-xl border border-slate-200/80 bg-slate-50/50 p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900/40 space-y-2">
                                            <div className="flex flex-wrap items-center justify-between gap-2">
                                                <span className="font-semibold text-slate-900 dark:text-slate-100">
                                                    Advance #{item.advance_id} · <span className="tabular-nums">{money(item.amount)}</span>
                                                </span>
                                                <StatusBadge tone={isSettled ? 'success' : 'warning'} label={isSettled ? 'Settled' : `Remaining ${money(rem)}`} />
                                            </div>
                                            <div className="text-xs text-slate-500">
                                                Employee: {item.employee_name} · Purpose: {item.purpose} · {Math.max(0, Math.floor((nowTick - new Date(item.created_at)) / 86400000))} days old · {item.events.length} events
                                            </div>
                                            <div className="text-xs text-slate-600 dark:text-slate-400">
                                                {item.events.map(ev => `${ev.kind} ${money(ev.amount)}`).join(' · ') || 'Outstanding'}
                                            </div>
                                            {canSettleAdvance && (
                                                <div className="pt-2">
                                                    <button
                                                        type="button"
                                                        className={secondaryButton}
                                                        onClick={() => setActiveAdvanceEvent(activeAdvanceEvent === item.advance_id ? null : item.advance_id)}
                                                    >
                                                        {activeAdvanceEvent === item.advance_id ? 'Cancel Event' : 'Record advance event'}
                                                    </button>
                                                    {activeAdvanceEvent === item.advance_id && (
                                                        <div className="mt-3">
                                                            <AdvanceEventForm advance={item} drawers={drawers} post={post} busy={busy} onSuccess={() => setActiveAdvanceEvent(null)} />
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                                {!visibleAdvances.length && <p className="py-4 text-center text-sm text-slate-500">No advances match this filter.</p>}
                            </div>
                        </Panel>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: History */}
            {tab === 'History' && (
                <Panel title="Session history">
                    <div className="grid gap-3 sm:grid-cols-4 pb-4">
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            From
                            <input type="date" className={`${field} mt-1`} value={historyFilters.from} onChange={event => { setHistoryPage(1); setHistoryFilters({ ...historyFilters, from: event.target.value }); }} />
                        </label>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            To
                            <input type="date" className={`${field} mt-1`} value={historyFilters.to} onChange={event => { setHistoryPage(1); setHistoryFilters({ ...historyFilters, to: event.target.value }); }} />
                        </label>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Status
                            <select className={`${field} mt-1`} value={historyFilters.status} onChange={event => { setHistoryPage(1); setHistoryFilters({ ...historyFilters, status: event.target.value }); }}>
                                <option value="">All</option>
                                <option>OPEN</option>
                                <option>CLOSING</option>
                                <option>CLOSED</option>
                            </select>
                        </label>
                        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            Custodian
                            <select className={`${field} mt-1`} value={historyFilters.custodian_id} onChange={event => { setHistoryPage(1); setHistoryFilters({ ...historyFilters, custodian_id: event.target.value }); }}>
                                <option value="">All</option>
                                {employees.map(person => (
                                    <option key={person.employee_id} value={person.employee_id}>{person.name}</option>
                                ))}
                            </select>
                        </label>
                    </div>

                    {historyState === 'loading' && <p role="status" className="py-4 text-sm text-slate-500">Loading session history…</p>}
                    {historyState === 'error' && <p role="alert" className="py-4 text-sm text-red-600">{historyError}{history.length > 0 ? ' Previously loaded results may be stale.' : ''}</p>}
                    {historyState === 'ready' && history.length === 0 && <p className="py-4 text-sm text-slate-500">No sessions match these filters. Opening cash is not required to view history.</p>}

                    <div className="space-y-2">
                        {history.map(item => (
                            <div key={item.session_id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
                                <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
                                    {item.session_code} · {item.business_date} · {item.custodian_name} · <StatusBadge tone={item.status === 'CLOSED' ? 'neutral' : item.status === 'OPEN' ? 'success' : 'warning'} label={item.status} /> · expected <strong className="tabular-nums font-semibold">{money(item.expected)}</strong>
                                </span>
                                <span className="flex items-center gap-2">
                                    <button className={secondaryButton} onClick={() => loadHistoryDetail(item.session_id)}>View</button>
                                    {item.status === 'CLOSED' && (
                                        <>
                                            <button className={secondaryButton} onClick={() => downloadReport(item.session_id, 'pdf')}>PDF</button>
                                            <button className={secondaryButton} onClick={() => downloadReport(item.session_id, 'csv')}>CSV</button>
                                        </>
                                    )}
                                </span>
                            </div>
                        ))}
                    </div>

                    {/* History Pagination */}
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4 dark:border-slate-800">
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                            Page {historyPage} of {Math.max(1, Math.ceil(historyTotal / 25))}
                        </span>
                        <div className="flex items-center gap-2">
                            <button className={secondaryButton} disabled={historyPage <= 1 || historyState === 'loading'} onClick={() => setHistoryPage(historyPage - 1)}>Previous</button>
                            <button className={secondaryButton} disabled={historyPage * 25 >= historyTotal || historyState === 'loading'} onClick={() => setHistoryPage(historyPage + 1)}>Next</button>
                        </div>
                    </div>

                    {/* History Detail Read-only Workspace */}
                    {historyDetailState === 'loading' && <p role="status" className="mt-4 text-sm text-slate-500">Loading session detail…</p>}
                    {historyDetailState === 'error' && <p role="alert" className="mt-4 text-sm text-red-600">Unable to load session detail.</p>}
                    {historyDetailState === 'partial' && <p role="alert" className="mt-4 text-sm text-warning-600">Some detail could not load. Displayed sections may be incomplete.</p>}

                    {historyDetail && (
                        <div className="mt-6 space-y-6 rounded-xl border border-slate-200 bg-slate-50/60 p-5 dark:border-slate-700 dark:bg-slate-900/40">
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 dark:border-slate-700">
                                <div>
                                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                                        Session {historyDetail.session_code} · <StatusBadge tone={historyDetail.status === 'CLOSED' ? 'neutral' : 'success'} label={historyDetail.status} />
                                    </h3>
                                    <p className="mt-1 text-xs text-slate-500">
                                        Opening {money(historyDetail.opening_amount)} · receipts {money(historyDetail.total_in)} · releases {money(historyDetail.total_out)}
                                    </p>
                                </div>
                                <button type="button" className={secondaryButton} onClick={() => setHistoryDetail(null)}>
                                    Close detail
                                </button>
                            </div>

                            {historyDetail.close_snapshot ? (
                                <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                                    Immutable close: expected {money(historyDetail.close_snapshot.expected)} · counted {money(historyDetail.close_snapshot.counted)} · variance {money(historyDetail.close_snapshot.variance)} · retained actual {money(historyDetail.close_snapshot.retained_actual)} · retained ledger {money(historyDetail.close_snapshot.retained_ledger)}.
                                </p>
                            ) : (
                                <p className="text-xs text-slate-500">Session remains active.</p>
                            )}

                            {/* History Movements */}
                            <section className="space-y-3">
                                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Movements</h4>
                                <p className="text-xs text-slate-500">Cash entering or leaving the box; recorded order determines the running balance.</p>
                                <div className="space-y-2">
                                    {historyMovements.map(item => (
                                        <div key={item.movement_id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800 space-y-1">
                                            <div className="flex justify-between font-semibold">
                                                <span>#{item.sequence} · {item.direction} {money(item.amount)} · balance {money(item.balance_after)}</span>
                                                <span className="text-slate-500">{formatTime(item.recorded_at)}</span>
                                            </div>
                                            <p>{formatCategory(item.category)} — {item.description}</p>
                                            <p className="text-slate-400">Operator: {item.operator_name} · Reference: {item.physical_reference || item.source_event_key || 'Manual'}</p>
                                            {item.invoice_id && (
                                                <button type="button" className="text-primary-600 underline" onClick={() => navigateSource('sales_history', { invoice_id: item.invoice_id })}>
                                                    Open invoice #{item.invoice_id}
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    {historyMovements.length === 0 && <p className="text-xs text-slate-400">No movements recorded.</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button className={secondaryButton} disabled={historyMovementPage <= 1} onClick={() => loadHistoryDetail(historyDetail.session_id, historyMovementPage - 1, historyCountPage, historyActivityPage)}>Previous</button>
                                    <span className="text-xs text-slate-500">Page {historyMovementPage} of {Math.max(1, Math.ceil(historyMovementTotal / 50))}</span>
                                    <button className={secondaryButton} disabled={historyMovementPage * 50 >= historyMovementTotal} onClick={() => loadHistoryDetail(historyDetail.session_id, historyMovementPage + 1, historyCountPage, historyActivityPage)}>Next</button>
                                </div>
                            </section>

                            {/* History Counts */}
                            <section className="space-y-3">
                                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Counts</h4>
                                <div className="space-y-2">
                                    {historyCounts.map(item => (
                                        <div key={item.count_id} className="rounded-lg border border-slate-200 bg-white p-3 text-xs dark:border-slate-700 dark:bg-slate-800 space-y-1">
                                            <div className="flex justify-between font-semibold">
                                                <span>{item.kind} · {item.status} · cutoff #{item.cutoff_sequence}</span>
                                                <span>{formatTime(item.submitted_at)}</span>
                                            </div>
                                            <p>Expected {money(item.expected)} · counted {money(item.counted)} · variance {money(item.variance)} · counter {item.counter_name}</p>
                                            <p className="text-slate-400">{item.lines?.map(l => `${l.code}: ${l.quantity}`).join(' · ')}</p>
                                        </div>
                                    ))}
                                    {!historyCounts.length && <p className="text-xs text-slate-400">No counts recorded.</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button className={secondaryButton} disabled={historyCountPage <= 1} onClick={() => loadHistoryDetail(historyDetail.session_id, historyMovementPage, historyCountPage - 1, historyActivityPage)}>Previous counts</button>
                                    <span className="text-xs text-slate-500">Page {historyCountPage} of {Math.max(1, Math.ceil(historyCountTotal / 50))}</span>
                                    <button className={secondaryButton} disabled={historyCountPage * 50 >= historyCountTotal} onClick={() => loadHistoryDetail(historyDetail.session_id, historyMovementPage, historyCountPage + 1, historyActivityPage)}>Next counts</button>
                                </div>
                            </section>

                            {/* History Activity */}
                            <section className="space-y-3">
                                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Activity</h4>
                                <p className="text-xs text-slate-500">Audit log records of operations, movements, and reviews.</p>
                                <div className="grid gap-2 sm:grid-cols-4 pb-2">
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        Employee
                                        <select className={`${field} mt-1`} value={historyActivityFilters.employee_id} onChange={event => { const next = { ...historyActivityFilters, employee_id: event.target.value }; setHistoryActivityFilters(next); loadHistoryDetail(historyDetail.session_id, historyMovementPage, historyCountPage, 1, next); }}>
                                            <option value="">All</option>
                                            {employees.map(person => (
                                                <option key={person.employee_id} value={person.employee_id}>{person.name}</option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        Action
                                        <input className={`${field} mt-1`} placeholder="POST, CLOSE…" value={historyActivityFilters.action} maxLength={40} onChange={event => { const next = { ...historyActivityFilters, action: event.target.value.toUpperCase().replace(/[^A-Z_]/g, '') }; setHistoryActivityFilters(next); loadHistoryDetail(historyDetail.session_id, historyMovementPage, historyCountPage, 1, next); }} />
                                    </label>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        From
                                        <input type="date" className={`${field} mt-1`} value={historyActivityFilters.from} onChange={event => { const next = { ...historyActivityFilters, from: event.target.value }; setHistoryActivityFilters(next); loadHistoryDetail(historyDetail.session_id, historyMovementPage, historyCountPage, 1, next); }} />
                                    </label>
                                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                        To
                                        <input type="date" className={`${field} mt-1`} value={historyActivityFilters.to} onChange={event => { const next = { ...historyActivityFilters, to: event.target.value }; setHistoryActivityFilters(next); loadHistoryDetail(historyDetail.session_id, historyMovementPage, historyCountPage, 1, next); }} />
                                    </label>
                                </div>
                                <div className="space-y-1.5">
                                    {historyActivity.map(item => (
                                        <div key={item.audit_id} className="rounded border border-slate-100 bg-white p-2.5 text-xs dark:border-slate-800 dark:bg-slate-800/80">
                                            <span className="font-semibold text-slate-800 dark:text-slate-200">{item.action}</span> · {item.target_type} #{item.target_id} · {item.actor_name} · <span className="text-slate-400">{formatTime(item.recorded_at)}</span> · {item.reason || item.metadata?.description || '—'}
                                            {item.metadata?.amount && ` · ${item.metadata.direction === 'OUT' ? '−' : '+'}${money(item.metadata.amount)}`}
                                            {(item.metadata?.source_event_key || item.metadata?.physical_reference) && ` · ${item.metadata.physical_reference || item.metadata.source_event_key}`}
                                        </div>
                                    ))}
                                    {!historyActivity.length && <p className="text-xs text-slate-400">No activity events match these filters.</p>}
                                </div>
                                <div className="flex items-center gap-2">
                                    <button className={secondaryButton} disabled={historyActivityPage <= 1} onClick={() => loadHistoryDetail(historyDetail.session_id, historyMovementPage, historyCountPage, historyActivityPage - 1)}>Previous activity</button>
                                    <span className="text-xs text-slate-500">Page {historyActivityPage} of {Math.max(1, Math.ceil(historyActivityTotal / 50))}</span>
                                    <button className={secondaryButton} disabled={historyActivityPage * 50 >= historyActivityTotal} onClick={() => loadHistoryDetail(historyDetail.session_id, historyMovementPage, historyCountPage, historyActivityPage + 1)}>Next activity</button>
                                </div>
                            </section>

                            {/* Later Custody */}
                            <section className="space-y-3">
                                <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Custody after the closing snapshot</h4>
                                <p className="text-xs text-slate-500">Recorded later; the original close remains unchanged.</p>
                                <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
                                    {historyActivity.filter(item => item.action === 'ADDENDUM').map(item => (
                                        <div key={item.audit_id}>Addendum · {formatTime(item.recorded_at)} · {item.reason} · {item.metadata?.note || ''}</div>
                                    ))}
                                    {historyCustody.transfers.map(item => (
                                        <div key={item.transfer_id}>
                                            Transfer #{item.transfer_id} · {item.events.filter(event => !historyDetail.closed_at || new Date(event.recorded_at) > new Date(historyDetail.closed_at)).map(event => `${event.stage} ${money(event.amount)} ${formatTime(event.recorded_at)}`).join(' · ')}
                                        </div>
                                    ))}
                                    {historyCustody.advances.map(item => (
                                        <div key={item.advance_id}>
                                            Advance #{item.advance_id} · {item.events.filter(event => !historyDetail.closed_at || new Date(event.created_at) > new Date(historyDetail.closed_at)).map(event => `${event.kind} ${money(event.amount)} ${formatTime(event.created_at)}`).join(' · ')}
                                        </div>
                                    ))}
                                </div>
                            </section>
                        </div>
                    )}
                </Panel>
            )}

            {/* FOCUSED DIALOG: Cash in / Cash out (Both Desktop & Mobile) */}
            <Dialog open={movementOpen && session?.status === 'OPEN' && !draftCount && canMove} onClose={() => setMovementOpen(false)} className="relative z-50">
                <div className="fixed inset-0 bg-slate-950/70" aria-hidden="true" />
                <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
                    <div className="flex min-h-full items-center justify-center">
                        <DialogPanel className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900 dark:text-slate-100">
                            <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                                <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                    {movementForm.direction === 'IN' ? 'Cash In' : 'Cash Out'}
                                </DialogTitle>
                                <button type="button" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer" onClick={() => setMovementOpen(false)}>✕</button>
                            </div>
                            {renderMovementForm()}
                        </DialogPanel>
                    </div>
                </div>
            </Dialog>

            {/* FOCUSED DIALOG: Movement Detail Sheet */}
            <Dialog open={Boolean(selectedMovement)} onClose={() => setSelectedMovement(null)} className="relative z-50">
                <div className="fixed inset-0 bg-slate-950/70" aria-hidden="true" />
                <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
                    <div className="flex min-h-full items-center justify-center">
                        <DialogPanel className="w-full max-w-xl rounded-xl bg-white p-6 shadow-xl dark:bg-slate-900 dark:text-slate-100">
                            {selectedMovement && (
                                <div className="space-y-4">
                                    <div className="flex items-start justify-between border-b border-slate-100 pb-3 dark:border-slate-800">
                                        <div>
                                            <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                                Movement #{selectedMovement.sequence}
                                            </DialogTitle>
                                            <div className="mt-1 flex items-center gap-1.5">
                                                <StatusBadge
                                                    tone={selectedMovement.direction === 'IN' ? 'success' : 'neutral'}
                                                    label={formatCategory(selectedMovement.category)}
                                                />
                                                {selectedMovement.reversal_of && <StatusBadge tone="danger" label="Reversal" />}
                                                <span className="text-xs text-slate-500">{selectedMovement.source_event_key ? 'Automatic' : 'Manual'}</span>
                                            </div>
                                        </div>
                                        <button type="button" className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer" onClick={() => setSelectedMovement(null)}>✕</button>
                                    </div>

                                    <div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/60">
                                        <div className="flex items-baseline justify-between">
                                            <span className="text-xs uppercase tracking-wider text-slate-500">Amount</span>
                                            <span className={`text-2xl font-bold tabular-nums ${selectedMovement.direction === 'IN' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-slate-50'}`}>
                                                {selectedMovement.direction === 'OUT' ? '−' : '+'}{money(selectedMovement.amount)}
                                            </span>
                                        </div>
                                        <div className="mt-1 flex items-baseline justify-between text-xs text-slate-500 dark:text-slate-400">
                                            <span>Balance after posted entry:</span>
                                            <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-300">{money(selectedMovement.balance_after)}</span>
                                        </div>
                                    </div>

                                    <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
                                        <div><strong>Purpose:</strong> {selectedMovement.description}</div>
                                        <div><strong>Operator:</strong> {selectedMovement.operator_name}</div>
                                        <div><strong>Recorded at:</strong> {formatTime(selectedMovement.recorded_at)}</div>
                                        <div><strong>Occurred at:</strong> {formatTime(selectedMovement.occurred_at)}</div>
                                        <div><strong>Counterparty:</strong> {selectedMovement.counterparty || '—'}</div>
                                        <div><strong>Physical reference:</strong> {selectedMovement.physical_reference || '—'}</div>
                                        <div><strong>Source key:</strong> {selectedMovement.source_event_key || 'Manual entry'}</div>
                                        {selectedMovement.late_reason && <div><strong>Late reason:</strong> {selectedMovement.late_reason}</div>}
                                        {selectedMovement.reversal_of && <div><strong>Reversal of:</strong> Movement #{selectedMovement.reversal_of}</div>}
                                    </div>

                                    {/* Workflow Links */}
                                    <div className="border-t border-slate-100 pt-3 dark:border-slate-800 flex flex-wrap gap-3">
                                        {selectedMovement.invoice_id && (
                                            <button type="button" className="text-xs font-semibold text-primary-600 underline hover:text-primary-700" onClick={() => navigateSource('sales_history', { invoice_id: selectedMovement.invoice_id, invoice_number: selectedMovement.invoice_number, startDate: String(selectedMovement.invoice_date).slice(0, 10), endDate: String(selectedMovement.invoice_date).slice(0, 10) })}>
                                                Open invoice #{selectedMovement.invoice_id}
                                            </button>
                                        )}
                                        {selectedMovement.customer_payment_id && (
                                            <button type="button" className="text-xs font-semibold text-primary-600 underline hover:text-primary-700" onClick={() => navigateSource('ar', { customer_id: selectedMovement.customer_id, customer_payment_id: selectedMovement.customer_payment_id })}>
                                                Open A/R payment #{selectedMovement.customer_payment_id}
                                            </button>
                                        )}
                                        {selectedMovement.expense_id && (
                                            <button type="button" className="text-xs font-semibold text-primary-600 underline hover:text-primary-700" onClick={() => navigateSource('expenses', { expense_id: selectedMovement.expense_id })}>
                                                Open expense #{selectedMovement.expense_id}
                                            </button>
                                        )}
                                        {selectedMovement.ap_payment_id && (
                                            <button type="button" className="text-xs font-semibold text-primary-600 underline hover:text-primary-700" onClick={() => navigateSource('ap', { tab: 'payments', payment_id: selectedMovement.ap_payment_id })}>
                                                Open supplier payment #{selectedMovement.ap_payment_id}
                                            </button>
                                        )}
                                    </div>

                                    <div className="flex justify-end pt-2">
                                        <button type="button" className={secondaryButton} onClick={() => setSelectedMovement(null)}>Close</button>
                                    </div>
                                </div>
                            )}
                        </DialogPanel>
                    </div>
                </div>
            </Dialog>

            {/* FOCUSED DIALOG: Active Count Modal */}
            <Dialog open={Boolean(draftCount)} onClose={() => {}} className="relative z-50">
                <div className="fixed inset-0 bg-slate-950/70" aria-hidden="true" />
                <div className="fixed inset-0 overflow-y-auto p-4 sm:p-6">
                    <div className="flex min-h-full items-center justify-center">
                        <DialogPanel className="flex min-h-screen w-full flex-col bg-white p-6 text-slate-900 shadow-xl dark:bg-slate-900 dark:text-slate-100 sm:min-h-0 sm:max-w-3xl sm:rounded-xl">
                            <DialogTitle className="text-lg font-bold text-slate-900 dark:text-slate-100">
                                {draftCount?.kind === 'CLOSING' ? 'Final count' : 'Count cash'} · cutoff #{draftCount?.cutoff_sequence}
                            </DialogTitle>
                            <div className="my-3 rounded-lg border border-warning-200 bg-warning-50/70 p-3 text-xs text-warning-900 dark:border-warning-900/50 dark:bg-warning-950/30 dark:text-warning-200">
                                Cash activity paused. Started {formatTime(draftCount?.started_at)} · valid until {formatTime(session?.count_window_expires_at)} · expected at cutoff <strong className="tabular-nums font-semibold">{money(draftCount?.expected)}</strong>.
                            </div>
                            {countPreview !== null && (
                                <p className="mb-3 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-200">
                                    Preview over / short: {money(Number(countPreview) / 100 - Number(draftCount?.expected || 0))} ({(Number(countPreview) / 100 - Number(draftCount?.expected || 0)) > 0 ? 'Over' : (Number(countPreview) / 100 - Number(draftCount?.expected || 0)) < 0 ? 'Short' : 'Balanced'}). Server calculation is final.
                                </p>
                            )}
                            {!countWindowValid && (
                                <p role="alert" className="mb-3 text-sm font-medium text-red-700 dark:text-red-400">
                                    Count no longer valid. Cancel this count and start again.
                                </p>
                            )}
                            <form onSubmit={saveCount} className="flex flex-1 flex-col space-y-4">
                                <DenominationEditor value={countQuantities} onChange={setCountQuantities} />
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                                    Count notes
                                    <textarea className={`${field} mt-1`} maxLength={1000} placeholder="Notes on count or cash condition" value={countNotes} onChange={event => setCountNotes(event.target.value)} />
                                </label>
                                <div className="sticky bottom-0 mt-auto flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-white pt-4 dark:border-slate-700 dark:bg-slate-900">
                                    <button
                                        type="button"
                                        className={dangerButton}
                                        disabled={busy}
                                        onClick={() => setCancelDialog({ open: true, type: 'COUNT', reason: '' })}
                                    >
                                        Cancel count
                                    </button>
                                    <button className={primaryButton} disabled={busy || !countWindowValid}>
                                        {draftCount?.kind === 'CLOSING' ? 'Submit final count' : 'Save count and resume'}
                                    </button>
                                </div>
                            </form>
                        </DialogPanel>
                    </div>
                </div>
            </Dialog>

            {/* FOCUSED DIALOG: Cancellation Reason Dialog */}
            <Dialog open={cancelDialog.open} onClose={() => {}} className="relative z-50">
                <div className="fixed inset-0 bg-slate-950/70" aria-hidden="true" />
                <div className="fixed inset-0 flex items-center justify-center p-4">
                    <DialogPanel className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800 dark:text-slate-100">
                        <DialogTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
                            {cancelDialog.type === 'COUNT' ? 'Cancel cash count' : 'Cancel closing session'}
                        </DialogTitle>
                        <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                            {cancelDialog.type === 'COUNT'
                                ? 'Cancelling this count will resume normal operations without updating the cutoff. A cancellation reason is required for the audit log.'
                                : 'Cancelling closing will restore cash operations. A cancellation reason is required for the audit log.'}
                        </p>
                        <label className="mt-4 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {cancelDialog.type === 'COUNT' ? 'Reason for cancelling count' : 'Reason for cancelling closing'}
                            <textarea
                                required
                                className={`${field} mt-1`}
                                rows={3}
                                placeholder="Reason is required..."
                                value={cancelDialog.reason}
                                onChange={e => setCancelDialog(c => ({ ...c, reason: e.target.value }))}
                            />
                        </label>
                        <div className="mt-6 flex justify-end gap-2">
                            <button
                                type="button"
                                className={secondaryButton}
                                disabled={busy}
                                onClick={() => setCancelDialog({ open: false, type: '', reason: '' })}
                            >
                                {cancelDialog.type === 'COUNT' ? 'Keep counting' : 'Keep closing'}
                            </button>
                            <button
                                type="button"
                                className={dangerButton}
                                disabled={busy || !cancelDialog.reason.trim()}
                                onClick={handleConfirmCancel}
                            >
                                Confirm cancellation
                            </button>
                        </div>
                    </DialogPanel>
                </div>
            </Dialog>

            {!drawerLoading && !error && !session && !drawerId && (
                <p className="py-8 text-center text-sm text-slate-500">No cash drawer is configured.</p>
            )}
        </div>
    );
}
