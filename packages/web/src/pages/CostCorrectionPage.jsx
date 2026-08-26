import { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import InfoTip from '../components/ui/InfoTip';
import { useSettings } from '../contexts/SettingsContext';

const BASE = '/inventory/cost-correction';

/**
 * Last resort for a part a cycle count confirmed holds real stock, for which no
 * receipt can be found at all. If a document exists, it belongs on the Goods Receipt
 * page's backfill mode instead — that path is faster and protected against entering
 * the same invoice twice, neither of which applies to a genuine estimate.
 */
const CostCorrectionPage = () => {
    const { settings } = useSettings();
    const currency = settings?.DEFAULT_CURRENCY_SYMBOL || '₱';
    const money = (v) => `${currency}${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const [term, setTerm] = useState('');
    const [results, setResults] = useState([]);
    const [status, setStatus] = useState(null);
    const [quantity, setQuantity] = useState('');
    const [unitCost, setUnitCost] = useState('');
    const [notes, setNotes] = useState('');
    const [posting, setPosting] = useState(false);
    const [history, setHistory] = useState([]);
    const [showHistory, setShowHistory] = useState(false);

    useEffect(() => {
        if (term.trim() === '') { setResults([]); return; }
        const t = setTimeout(async () => {
            try {
                const res = await api.get('/power-search/parts', { params: { keyword: term } });
                setResults(res.data || []);
            } catch { toast.error('Search failed.'); }
        }, 300);
        return () => clearTimeout(t);
    }, [term]);

    const selectPart = async (partId) => {
        try {
            const res = await api.get(`${BASE}/parts/${partId}`);
            setStatus(res.data);
            setQuantity(res.data.suggested_qty != null ? String(res.data.suggested_qty) : '');
            setUnitCost('');
            setNotes('');
            setResults([]);
            setTerm('');
        } catch (err) { toast.error(err.response?.data?.message || 'Could not load this part.'); }
    };

    const loadHistory = async () => {
        try {
            const res = await api.get(`${BASE}/audit-log`);
            setHistory(res.data || []);
            setShowHistory(true);
        } catch (err) { toast.error(err.response?.data?.message || 'Failed to load history.'); }
    };

    const post = async (e) => {
        e.preventDefault();
        setPosting(true);
        try {
            const res = await api.post(`${BASE}/parts/${status.part_id}/estimate`, {
                quantity, unit_cost: unitCost || null, notes,
            });
            toast.success(`Posted. WAC: ${money(res.data.old_wac_cost)} → ${money(res.data.new_wac_cost)}`);
            setStatus(null);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to post.');
        } finally { setPosting(false); }
    };

    const input = 'w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm';
    const qty = parseFloat(quantity) || 0;

    return (
        <div className="max-w-2xl space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                    Cost Correction
                    <InfoTip label="Cost Correction">
                        For a part a cycle count has confirmed holds real stock, but for which no supplier receipt
                        can be found anywhere. If you have a document — even an old one — use Backfill on the
                        Goods Receipt page instead; it is faster and checked against duplicate entry.
                    </InfoTip>
                </h1>
                <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
                    Last resort: estimate a cost for stock that is confirmed to exist but was never documented.
                </p>
                <button onClick={loadHistory} className="text-sm text-primary-600 dark:text-primary-400 hover:underline mt-1">
                    View past corrections
                </button>
            </div>

            {!status && (
                <div className="space-y-2">
                    <input
                        autoFocus
                        value={term}
                        onChange={e => setTerm(e.target.value)}
                        placeholder="Part name, SKU or part number…"
                        className={input}
                    />
                    <div className="divide-y divide-gray-200 dark:divide-slate-700 rounded-lg border border-gray-200 dark:border-slate-700">
                        {results.map(p => (
                            <button key={p.part_id} onClick={() => selectPart(p.part_id)}
                                className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-slate-800">
                                <div className="text-sm text-gray-900 dark:text-slate-100">{p.display_name || p.detail}</div>
                                <div className="text-xs font-mono text-gray-500 dark:text-slate-400">{p.internal_sku}</div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {status && (
                <div className="space-y-4">
                    <div className="rounded-xl border border-gray-200 dark:border-slate-700 p-4">
                        <div className="flex items-start justify-between">
                            <div>
                                <div className="font-medium text-gray-900 dark:text-slate-100">{status.display_name || status.detail}</div>
                                <div className="text-xs font-mono text-gray-500 dark:text-slate-400">{status.internal_sku}</div>
                            </div>
                            <button onClick={() => setStatus(null)} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-slate-300">Change</button>
                        </div>
                        <div className="grid grid-cols-2 gap-3 mt-3 text-sm">
                            <div>Current stock: <strong className="text-gray-900 dark:text-slate-100">{status.current_qty}</strong></div>
                            <div>Current WAC: <strong className="text-gray-900 dark:text-slate-100">{money(status.wac_cost)}</strong></div>
                            <div>
                                Last cycle count: {status.counted_qty == null
                                    ? <strong className="text-amber-600 dark:text-amber-400">Never counted</strong>
                                    : <strong className="text-gray-900 dark:text-slate-100">{status.counted_qty} on {new Date(status.counted_at).toLocaleDateString()}</strong>}
                            </div>
                            {status.suggested_qty != null && (
                                <div>Shortfall vs. count: <strong className="text-gray-900 dark:text-slate-100">{status.suggested_qty}</strong></div>
                            )}
                        </div>
                    </div>

                    {status.counted_qty == null && (
                        <div className="rounded-lg border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
                            This part has never been cycle counted. Get it counted first — estimating a cost for
                            unconfirmed stock is a guess on top of a guess.
                        </div>
                    )}

                    <form onSubmit={post} className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-sm text-gray-700 dark:text-slate-300 mb-1">Quantity to post</label>
                                <input type="number" step="any" value={quantity} onChange={e => setQuantity(e.target.value)} className={input} />
                                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                    Suggested from the count vs. current stock — adjust if you know better (e.g. sales happened since).
                                </p>
                            </div>
                            {qty > 0 && (
                                <div>
                                    <label className="block text-sm text-gray-700 dark:text-slate-300 mb-1">Estimated unit cost ({currency})</label>
                                    <input type="number" step="any" min="0" value={unitCost} onChange={e => setUnitCost(e.target.value)} className={input} />
                                </div>
                            )}
                        </div>
                        {qty < 0 && (
                            <p className="text-xs text-gray-500 dark:text-slate-400">
                                A negative quantity posts as a write-off — it corrects stock only and does not affect cost.
                            </p>
                        )}
                        <div>
                            <label className="block text-sm text-gray-700 dark:text-slate-300 mb-1">Where this estimate comes from</label>
                            <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} className={input}
                                placeholder="e.g. supplier price list checked, comparable item, verbal quote from supplier…" />
                        </div>
                        <div className="flex justify-end">
                            <button type="submit" disabled={posting || qty === 0}
                                className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-60 text-sm">
                                {posting ? 'Posting…' : 'Post correction'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            {showHistory && (
                <div className="rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden">
                    <table className="min-w-full text-sm">
                        <thead className="bg-gray-50 dark:bg-slate-800">
                            <tr>{['When', 'Part', 'Qty', 'WAC before', 'WAC after', 'By', 'Notes'].map(h => (
                                <th key={h} className="px-3 py-2 text-left text-xs text-gray-500 dark:text-slate-400">{h}</th>
                            ))}</tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 dark:divide-slate-700">
                            {history.length === 0 ? (
                                <tr><td colSpan={7} className="px-3 py-6 text-center text-gray-500 dark:text-slate-400">No corrections recorded yet.</td></tr>
                            ) : history.map(h => (
                                <tr key={h.log_id}>
                                    <td className="px-3 py-2 whitespace-nowrap">{new Date(h.actioned_at).toLocaleString()}</td>
                                    <td className="px-3 py-2">{h.display_name || h.internal_sku}</td>
                                    <td className="px-3 py-2">{Number(h.gap_qty)}</td>
                                    <td className="px-3 py-2">{h.wac_before == null ? '—' : money(h.wac_before)}</td>
                                    <td className="px-3 py-2">{h.wac_after == null ? '—' : money(h.wac_after)}</td>
                                    <td className="px-3 py-2">{h.actioned_by_name || '—'}</td>
                                    <td className="px-3 py-2 text-gray-500 dark:text-slate-400">{h.notes}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default CostCorrectionPage;
