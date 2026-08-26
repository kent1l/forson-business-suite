import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import InfoTip from '../components/ui/InfoTip';
import Modal from '../components/ui/Modal';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import CostCorrectionEntryForm from '../components/costCorrection/CostCorrectionEntryForm';

const BASE = '/inventory/cost-correction';

const CostCorrectionPage = () => {
    const { hasPermission } = useAuth();
    const { settings } = useSettings();
    const currency = settings?.DEFAULT_CURRENCY_SYMBOL || '₱';

    const canPropose = hasPermission('wac_correction:propose');
    const canApprove = hasPermission('wac_correction:approve');

    const TABS = [
        canPropose && { id: 'my_queue', label: 'My Queue' },
        canApprove && { id: 'review', label: 'Pending Review' },
        canApprove && { id: 'history', label: 'History' },
    ].filter(Boolean);

    const [activeTab, setActiveTab] = useState(TABS[0]?.id || 'my_queue');
    const [tasks, setTasks] = useState([]);
    const [reviews, setReviews] = useState([]);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [activeLine, setActiveLine] = useState(null);
    const [reviewLine, setReviewLine] = useState(null);
    const [lookupOpen, setLookupOpen] = useState(false);
    const [lookupTerm, setLookupTerm] = useState('');
    const [lookupResults, setLookupResults] = useState([]);

    const money = (v) => `${currency}${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const refresh = useCallback(async () => {
        setLoading(true);
        try {
            if (activeTab === 'my_queue') setTasks((await api.get(`${BASE}/my-tasks`)).data || []);
            if (activeTab === 'review') setReviews((await api.get(`${BASE}/review`)).data || []);
            if (activeTab === 'history') setHistory((await api.get(`${BASE}/audit-log`)).data || []);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to load.');
        } finally {
            setLoading(false);
        }
    }, [activeTab]);

    useEffect(() => { refresh(); }, [refresh]);

    const openLine = async (lineId) => {
        try {
            const res = await api.get(`${BASE}/lines/${lineId}`);
            setActiveLine(res.data);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to open this part.');
        }
    };

    const openReview = async (lineId) => {
        try {
            const res = await api.get(`${BASE}/lines/${lineId}`);
            setReviewLine(res.data);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to open this correction.');
        }
    };

    const approve = async (lineId, notes) => {
        try {
            const res = await api.post(`${BASE}/lines/${lineId}/approve`, { notes });
            toast.success(`Cost corrected: ${money(res.data.old_wac_cost)} → ${money(res.data.new_wac_cost)}`);
            setReviewLine(null);
            refresh();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to approve.');
        }
    };

    const sendBack = async (lineId) => {
        const notes = window.prompt('What needs to change? The encoder will see this.');
        if (notes == null) return;
        try {
            await api.post(`${BASE}/lines/${lineId}/send-back`, { notes });
            toast.success('Sent back to the encoder.');
            setReviewLine(null);
            refresh();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to send back.');
        }
    };

    // Invoice-driven start: the encoder has a supplier document and finds the part,
    // instead of waiting for it to be assigned to them.
    useEffect(() => {
        if (!lookupOpen || lookupTerm.trim() === '') { setLookupResults([]); return; }
        const timer = setTimeout(async () => {
            try {
                const res = await api.get('/power-search/parts', { params: { keyword: lookupTerm } });
                setLookupResults(res.data || []);
            } catch {
                toast.error('Search failed.');
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [lookupTerm, lookupOpen]);

    const startFromPart = async (partId) => {
        try {
            const res = await api.post(`${BASE}/lines/for-part`, { part_id: partId });
            if (res.data.existing) toast('This part already has an open correction — opening it.', { icon: 'ℹ️' });
            setLookupOpen(false);
            setLookupTerm('');
            setLookupResults([]);
            await openLine(res.data.line_id);
            refresh();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Could not open this part.');
        }
    };

    const generateBatch = async () => {
        try {
            const res = await api.post(`${BASE}/generate-batch`, { limit: 50 });
            if (!res.data.batch_id) {
                toast('No eligible parts. Parts need an approved cycle count before their cost can be corrected.', { icon: 'ℹ️' });
            } else {
                toast.success(`Queued ${res.data.lines} parts for cost research.`);
            }
            refresh();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to generate a batch.');
        }
    };

    const th = 'px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400 whitespace-nowrap';
    const td = 'px-4 py-3 text-sm text-gray-900 dark:text-slate-100';

    return (
        <div className="space-y-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                        Cost Correction
                        <InfoTip label="Cost Correction">
                            Rebuilds an item&apos;s weighted average cost from the goods receipts that were never
                            entered. Enter the receipts you can document — date, quantity and unit cost from the
                            supplier invoice — and the system recalculates the average itself. You never type the
                            average directly; it is derived from the receipt history.
                        </InfoTip>
                    </h1>
                    <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
                        Research and approve cost corrections for parts whose quantity has already been counted.
                    </p>
                </div>
                <div className="flex gap-2">
                    {canPropose && (
                        <button onClick={() => setLookupOpen(true)} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">
                            Start from a supplier document
                        </button>
                    )}
                    {canApprove && (
                        <button onClick={generateBatch} className="px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 text-sm">
                            Queue next 50 by impact
                        </button>
                    )}
                </div>
            </div>

            <div className="border-b border-gray-200 dark:border-slate-700">
                <nav className="-mb-px flex space-x-8 overflow-x-auto">
                    {TABS.map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id)}
                            className={`whitespace-nowrap pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                                activeTab === tab.id
                                    ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                                    : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200'
                            }`}
                        >
                            {tab.label}
                            {tab.id === 'review' && reviews.length > 0 && (
                                <span className="ml-2 inline-block bg-red-500 text-white text-xs font-bold rounded-full px-1.5 py-0.5 leading-none">
                                    {reviews.length}
                                </span>
                            )}
                        </button>
                    ))}
                </nav>
            </div>

            {loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>}

            {!loading && activeTab === 'my_queue' && (
                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                        <thead className="bg-gray-50 dark:bg-slate-800">
                            <tr>{['SKU', 'Part', 'System Qty', 'Counted', 'Value at risk', 'Status', ''].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                            {tasks.length === 0 ? (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">Nothing assigned to you right now.</td></tr>
                            ) : tasks.map(t => (
                                <tr key={t.line_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                                    <td className={`${td} font-mono text-gray-600 dark:text-slate-400`}>{t.internal_sku}</td>
                                    <td className={td}>{t.display_name || t.detail}</td>
                                    <td className={td}>{Number(t.system_qty_snapshot)}</td>
                                    <td className={td}>{Number(t.counted_qty)}</td>
                                    <td className={`${td} text-amber-600 dark:text-amber-400 font-medium`}>{money(t.impact_estimate)}</td>
                                    <td className={td}>
                                        {t.review_notes && t.status === 'PENDING' && (
                                            <span className="text-xs text-red-600 dark:text-red-400">Sent back: {t.review_notes}</span>
                                        )}
                                        {!t.review_notes && <span className="text-xs text-gray-500">{t.entry_count} entries</span>}
                                    </td>
                                    <td className={td}>
                                        <button onClick={() => openLine(t.line_id)} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-700">
                                            Enter receipts
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {!loading && activeTab === 'review' && (
                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                        <thead className="bg-gray-50 dark:bg-slate-800">
                            <tr>{['SKU', 'Part', 'Proposed by', 'Receipts', 'Gap', 'Value at risk', ''].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                            {reviews.length === 0 ? (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">Nothing waiting for review.</td></tr>
                            ) : reviews.map(r => (
                                <tr key={r.line_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                                    <td className={`${td} font-mono text-gray-600 dark:text-slate-400`}>{r.internal_sku}</td>
                                    <td className={td}>{r.display_name || r.detail}</td>
                                    <td className={td}>{r.proposed_by_name || '—'}</td>
                                    <td className={td}>
                                        {r.entry_count}
                                        {r.estimate_count > 0 && (
                                            <span className="ml-2 px-2 py-0.5 rounded text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">
                                                {r.estimate_count} estimated
                                            </span>
                                        )}
                                    </td>
                                    <td className={td}>
                                        {Number(r.gap_qty) !== 0 && (
                                            <span className={Number(r.gap_qty) > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-600 dark:text-slate-400'}>
                                                {Number(r.gap_qty) > 0 ? `+${r.gap_qty} @ ${money(r.gap_unit_cost)} est.` : `${r.gap_qty} write-off`}
                                            </span>
                                        )}
                                    </td>
                                    <td className={`${td} text-amber-600 dark:text-amber-400 font-medium`}>{money(r.impact_estimate)}</td>
                                    <td className={td}>
                                        <button onClick={() => openReview(r.line_id)} className="px-3 py-1.5 bg-primary-600 text-white rounded-lg text-xs hover:bg-primary-700">
                                            Review
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {!loading && activeTab === 'history' && (
                <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
                    <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                        <thead className="bg-gray-50 dark:bg-slate-800">
                            <tr>{['When', 'Part', 'Action', 'WAC before', 'WAC after', 'By', 'Notes'].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                            {history.length === 0 ? (
                                <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">No corrections recorded yet.</td></tr>
                            ) : history.map(h => (
                                <tr key={h.log_id}>
                                    <td className={`${td} whitespace-nowrap`}>{new Date(h.actioned_at).toLocaleString()}</td>
                                    <td className={td}>{h.display_name || h.internal_sku}</td>
                                    <td className={td}>{h.action}</td>
                                    <td className={td}>{h.wac_before == null ? '—' : money(h.wac_before)}</td>
                                    <td className={td}>{h.wac_after == null ? '—' : money(h.wac_after)}</td>
                                    <td className={td}>{h.actioned_by_name || '—'}</td>
                                    <td className={`${td} text-gray-500 dark:text-slate-400`}>{h.notes}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <Modal isOpen={lookupOpen} onClose={() => setLookupOpen(false)} title="Find the part on your document">
                <div className="space-y-3">
                    <p className="text-sm text-gray-600 dark:text-slate-400">
                        Search for the item shown on the supplier invoice or delivery receipt.
                    </p>
                    <input
                        autoFocus
                        value={lookupTerm}
                        onChange={e => setLookupTerm(e.target.value)}
                        placeholder="Part name, SKU or part number…"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm"
                    />
                    <div className="max-h-72 overflow-y-auto divide-y divide-gray-200 dark:divide-slate-700 rounded-lg border border-gray-200 dark:border-slate-700">
                        {lookupResults.length === 0 ? (
                            <p className="px-3 py-4 text-sm text-gray-500 dark:text-slate-400">
                                {lookupTerm ? 'No matching parts.' : 'Start typing to search.'}
                            </p>
                        ) : lookupResults.map(p => (
                            <button
                                key={p.part_id}
                                onClick={() => startFromPart(p.part_id)}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800"
                            >
                                <div className="text-sm text-gray-900 dark:text-slate-100">{p.display_name || p.detail}</div>
                                <div className="text-xs font-mono text-gray-500 dark:text-slate-400">{p.internal_sku}</div>
                            </button>
                        ))}
                    </div>
                </div>
            </Modal>

            <Modal isOpen={!!activeLine} onClose={() => setActiveLine(null)} title="Reconstruct Goods Receipts">
                {activeLine && (
                    <CostCorrectionEntryForm
                        detail={activeLine}
                        currency={currency}
                        onSaved={() => { setActiveLine(null); refresh(); }}
                    />
                )}
            </Modal>

            <Modal isOpen={!!reviewLine} onClose={() => setReviewLine(null)} title="Review Cost Correction">
                {reviewLine && (
                    <div className="space-y-4">
                        <div className="text-sm text-gray-700 dark:text-slate-300">
                            <div className="font-medium">{reviewLine.line.part_id && (reviewLine.line.display_name || `Part #${reviewLine.line.part_id}`)}</div>
                            <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                                <div>Current system qty: <strong>{reviewLine.currentQty}</strong></div>
                                <div>Counted qty: <strong>{reviewLine.countedQty}</strong></div>
                                <div>Receipts proposed: <strong>{reviewLine.proposedQty}</strong></div>
                                <div>Remaining gap: <strong>{reviewLine.gapQty}</strong></div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 dark:bg-slate-800">
                                    <tr>{['Date', 'Qty', 'Unit cost', 'Source'].map(h => <th key={h} className="px-3 py-2 text-left text-xs text-gray-500 dark:text-slate-400">{h}</th>)}</tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                    {reviewLine.entries.map(e => (
                                        <tr key={e.entry_id}>
                                            <td className="px-3 py-2">{new Date(e.date_received).toLocaleDateString()}</td>
                                            <td className="px-3 py-2">{Number(e.quantity)}</td>
                                            <td className="px-3 py-2">{money(e.unit_cost)}</td>
                                            <td className="px-3 py-2 text-gray-500 dark:text-slate-400">
                                                {e.source_reference || <span className="text-amber-600 dark:text-amber-400">No document</span>}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {reviewLine.line.review_notes && (
                            <p className="text-sm text-gray-600 dark:text-slate-400">Encoder notes: {reviewLine.line.review_notes}</p>
                        )}

                        <p className="text-xs text-gray-500 dark:text-slate-400">
                            Approving posts these as dated stock receipts and recalculates the weighted average cost.
                            This affects margin reporting on future sales and cannot be undone from this screen.
                        </p>

                        <div className="flex justify-end gap-2">
                            <button onClick={() => sendBack(reviewLine.line.line_id)} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg text-sm">
                                Send back
                            </button>
                            <button onClick={() => approve(reviewLine.line.line_id)} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">
                                Approve &amp; post
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default CostCorrectionPage;
