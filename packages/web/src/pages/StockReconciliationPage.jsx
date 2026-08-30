import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import InfoTip from '../components/ui/InfoTip';
import Modal from '../components/ui/Modal';
import { useSettings } from '../contexts/SettingsContext';

const BASE = '/inventory/reconciliations';

/**
 * Review desk for automatic backfill reconciliations.
 *
 * The correction itself happens without asking — an encoder copying an invoice should
 * not have to reason about cycle count dates. This is where it stops being silent: what
 * was adjusted, why, and above all which parts have stock that documents prove arrived
 * but no count ever found.
 */
const StockReconciliationPage = () => {
    const { settings } = useSettings();
    const currency = settings?.DEFAULT_CURRENCY_SYMBOL || '₱';
    const money = (v) => (v == null ? '—' : `${currency}${Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
    const day = (d) => (d ? new Date(d).toLocaleDateString() : '—');

    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [statusFilter, setStatusFilter] = useState('OPEN');
    const [shortfallOnly, setShortfallOnly] = useState(false);
    const [timeline, setTimeline] = useState(null);
    const [reviewing, setReviewing] = useState(null);
    const [reviewNotes, setReviewNotes] = useState('');

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(BASE, {
                params: { status: statusFilter, ...(shortfallOnly ? { filter: 'shortfall' } : {}) },
            });
            setRows(res.data?.data || []);
            setSummary(res.data?.summary || null);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to load reconciliations.');
        } finally { setLoading(false); }
    }, [statusFilter, shortfallOnly]);

    useEffect(() => { load(); }, [load]);

    const openTimeline = async (partId) => {
        try {
            const res = await api.get(`${BASE}/parts/${partId}/timeline`);
            setTimeline(res.data);
        } catch (err) { toast.error(err.response?.data?.message || 'Failed to load timeline.'); }
    };

    const submitReview = async () => {
        try {
            await api.post(`${BASE}/${reviewing.recon_id}/review`, { notes: reviewNotes });
            toast.success('Marked as reviewed.');
            setReviewing(null);
            setReviewNotes('');
            load();
        } catch (err) { toast.error(err.response?.data?.message || 'Failed to save review.'); }
    };

    const card = 'rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4';
    const th = 'px-3 py-2 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400 whitespace-nowrap';
    const td = 'px-3 py-2 text-sm text-gray-900 dark:text-slate-100';

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                    Stock Reconciliation
                    <InfoTip label="Stock Reconciliation">
                        When a past receipt is backfilled but dated before a cycle count, the count already
                        recorded that stock. The receipt is applied for cost only and its quantity is cancelled,
                        so the same units are not counted twice. Every such correction is listed here.
                    </InfoTip>
                </h1>
                <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
                    Automatic corrections made when backfilled receipts overlapped an earlier count — and stock
                    those receipts prove arrived but no count ever found.
                </p>
            </div>

            {summary && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className={card}>
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Awaiting review</div>
                        <div className="text-2xl font-semibold text-gray-900 dark:text-slate-100 mt-1">{summary.open_count}</div>
                    </div>
                    <div className={card}>
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">With missing stock</div>
                        <div className="text-2xl font-semibold text-amber-600 dark:text-amber-400 mt-1">{summary.shortfall_count}</div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">Documented but never found</div>
                    </div>
                    <div className={card}>
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Units unaccounted for</div>
                        <div className="text-2xl font-semibold text-amber-600 dark:text-amber-400 mt-1">{Number(summary.shortfall_units)}</div>
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
                    className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm">
                    <option value="OPEN">Awaiting review</option>
                    <option value="REVIEWED">Reviewed</option>
                    <option value="ALL">All</option>
                </select>
                <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                    <input type="checkbox" checked={shortfallOnly} onChange={e => setShortfallOnly(e.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 dark:border-slate-600" />
                    Only those with missing stock
                </label>
            </div>

            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                        <tr>{['Part', 'Invoice', 'Receipt date', 'Documented', 'Count', 'Missing', 'WAC', ''].map((h, i) => <th key={i} className={th}>{h}</th>)}</tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                        {loading ? (
                            <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500 dark:text-slate-400">Loading…</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={8} className="px-3 py-8 text-center text-gray-500 dark:text-slate-400">Nothing to review.</td></tr>
                        ) : rows.map(r => (
                            <tr key={r.recon_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                                <td className={td}>
                                    <div>{r.display_name || `Part #${r.part_id}`}</div>
                                    <div className="text-xs font-mono text-gray-500 dark:text-slate-400">{r.internal_sku}</div>
                                </td>
                                <td className={`${td} font-mono text-xs`}>{r.supplier_invoice_no || r.grn_number}</td>
                                <td className={td}>{day(r.receipt_date)}</td>
                                <td className={td}>{Number(r.backfill_qty)}</td>
                                <td className={td}>
                                    {Number(r.counted_qty)}
                                    <span className="block text-xs text-gray-500 dark:text-slate-400">{day(r.counted_at)}</span>
                                </td>
                                <td className={td}>
                                    {Number(r.unexplained_shortfall) > 0 ? (
                                        <span className="px-2 py-0.5 rounded text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 font-medium">
                                            {Number(r.unexplained_shortfall)}
                                        </span>
                                    ) : <span className="text-gray-400">—</span>}
                                </td>
                                <td className={td}>
                                    <span className="text-xs text-gray-500 dark:text-slate-400">{money(r.wac_before)} → </span>
                                    {money(r.wac_after)}
                                </td>
                                <td className={td}>
                                    <div className="flex gap-2">
                                        <button onClick={() => openTimeline(r.part_id)} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Timeline</button>
                                        {r.status === 'OPEN' && (
                                            <button onClick={() => { setReviewing(r); setReviewNotes(''); }} className="text-xs text-primary-600 dark:text-primary-400 hover:underline">Review</button>
                                        )}
                                        {r.status === 'REVIEWED' && (
                                            <span className="text-xs text-gray-400" title={r.review_notes || ''}>Reviewed by {r.reviewed_by_name || '—'}</span>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <Modal isOpen={!!timeline} onClose={() => setTimeline(null)} title={timeline ? (timeline.part?.display_name || 'Part timeline') : ''}>
                {timeline && (
                    <div className="space-y-4">
                        <div className="text-sm text-gray-600 dark:text-slate-400">
                            Current stock <strong className="text-gray-900 dark:text-slate-100">{timeline.current_qty}</strong>
                            {' · '}WAC <strong className="text-gray-900 dark:text-slate-100">{money(timeline.part?.wac_cost)}</strong>
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700 max-h-96 overflow-y-auto">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 dark:bg-slate-800 sticky top-0">
                                    <tr>{['Date', 'Type', 'Qty', 'Unit cost', 'Balance', 'Reference'].map(h => <th key={h} className={th}>{h}</th>)}</tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                                    {timeline.ledger.map(l => (
                                        <tr key={l.inv_trans_id} className={l.notes?.startsWith('Auto-reconciled') ? 'bg-amber-50 dark:bg-amber-900/10' : ''}>
                                            <td className="px-3 py-2 whitespace-nowrap">{day(l.transaction_date)}</td>
                                            <td className="px-3 py-2">
                                                {l.trans_type}
                                                {l.is_backfill && <span className="ml-1 px-1.5 py-0.5 rounded text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">backfill</span>}
                                            </td>
                                            <td className={`px-3 py-2 ${Number(l.quantity) < 0 ? 'text-red-600 dark:text-red-400' : ''}`}>{Number(l.quantity)}</td>
                                            <td className="px-3 py-2">{l.unit_cost == null ? '—' : money(l.unit_cost)}</td>
                                            <td className="px-3 py-2 font-medium">{l.running_balance}</td>
                                            <td className="px-3 py-2 font-mono text-xs text-gray-500 dark:text-slate-400" title={l.notes || ''}>
                                                {l.supplier_invoice_no || l.reference_no}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {timeline.counts.length > 0 && (
                            <div className="text-xs text-gray-600 dark:text-slate-400">
                                <strong>Cycle counts:</strong>{' '}
                                {timeline.counts.map(c => `${day(c.counted_at)}: counted ${Number(c.counted_qty)} (books showed ${Number(c.system_qty_snapshot)})`).join(' · ')}
                            </div>
                        )}
                    </div>
                )}
            </Modal>

            <Modal isOpen={!!reviewing} onClose={() => setReviewing(null)} title="Review reconciliation">
                {reviewing && (
                    <div className="space-y-4">
                        <div className="text-sm text-gray-700 dark:text-slate-300 space-y-1">
                            <p>
                                Invoice <strong>{reviewing.supplier_invoice_no || reviewing.grn_number}</strong> documented{' '}
                                <strong>{Number(reviewing.backfill_qty)}</strong> units received {day(reviewing.receipt_date)}, which is
                                before the count of {day(reviewing.counted_at)}. Its quantity was cancelled so the stock the count
                                already recorded was not counted twice; its cost was applied.
                            </p>
                            {Number(reviewing.unexplained_shortfall) > 0 && (
                                <p className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-amber-800 dark:text-amber-200">
                                    <strong>{Number(reviewing.unexplained_shortfall)} units</strong> are documented as received but were
                                    never found by the count. They may have been sold without being recorded, miscounted, or lost.
                                </p>
                            )}
                        </div>
                        <div>
                            <label className="block text-sm text-gray-700 dark:text-slate-300 mb-1">Notes (optional)</label>
                            <textarea value={reviewNotes} onChange={e => setReviewNotes(e.target.value)} rows={3}
                                placeholder="What you found, or what should happen next…"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm" />
                        </div>
                        <div className="flex justify-end gap-2">
                            <button onClick={() => { setReviewing(null); openTimeline(reviewing.part_id); }}
                                className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg text-sm">
                                View timeline
                            </button>
                            <button onClick={submitReview} className="px-4 py-2 bg-primary-600 text-white rounded-lg text-sm hover:bg-primary-700">
                                Mark reviewed
                            </button>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default StockReconciliationPage;
