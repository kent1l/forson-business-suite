import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';
import PaginationControls from '../components/ui/PaginationControls';
import { useSettings } from '../contexts/SettingsContext';

const BUCKETS = [
    { key: 'all', label: 'All Issues' },
    { key: 'missing_wac', label: 'No Cost Basis', hint: 'Has stock on hand but no weighted average cost, so its inventory value and margin cannot be trusted.' },
    { key: 'negative_stock', label: 'Negative Stock', hint: 'System stock is below zero — items were sold that were never received, so the cost average is built on incomplete history.' },
    { key: 'missing_cost', label: 'No Cost Recorded', hint: 'The part was created without a cost, usually quick-added during a sale.' },
];

const SORTS = [
    { key: 'impact', label: 'Financial impact' },
    { key: 'negative_stock', label: 'Most negative stock' },
    { key: 'name', label: 'Name' },
];

const CostDataHealthPage = () => {
    const { settings } = useSettings();
    const currencySymbol = settings?.DEFAULT_CURRENCY_SYMBOL || '₱';

    const [rows, setRows] = useState([]);
    const [summary, setSummary] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [bucket, setBucket] = useState('all');
    const [sortBy, setSortBy] = useState('impact');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);

    const fetchData = useCallback(async () => {
        try {
            setError('');
            setLoading(true);
            const res = await api.get('/reports/data-integrity/inventory', {
                params: { bucket, sortBy, page, pageSize, paginated: 1 },
            });
            setRows(res.data?.data || []);
            setSummary(res.data?.summary || null);
            setTotal(res.data?.total || 0);
        } catch (err) {
            setError(err.response?.data?.message || err.message);
        } finally {
            setLoading(false);
        }
    }, [bucket, sortBy, page, pageSize]);

    useEffect(() => { fetchData(); }, [fetchData]);
    useEffect(() => { setPage(1); }, [bucket, sortBy]);

    const exportCsv = async () => {
        try {
            const res = await api.get('/reports/data-integrity/inventory', {
                params: { format: 'csv', bucket, sortBy },
                responseType: 'blob',
            });
            const url = window.URL.createObjectURL(new Blob([res.data]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'cost-data-health.csv');
            document.body.appendChild(link);
            link.click();
            link.remove();
            toast.success('Report exported successfully!');
        } catch {
            toast.error('Failed to export report.');
        }
    };

    const money = (v) => `${currencySymbol}${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const cardClass = 'rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4';

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                    Cost Data Health
                    <InfoTip label="Cost Data Health">
                        Parts whose cost data cannot be trusted for valuation or margin reporting. Weighted average
                        cost is derived from the goods receipt history, so a part with no receipts, or with sales
                        recorded before its receipts, ends up with a wrong or missing cost.
                    </InfoTip>
                </h1>
                <p className="text-sm text-gray-600 dark:text-slate-400 mt-1">
                    Review queue for inventory cost cleanup, ordered by how much reported value each part distorts.
                </p>
            </div>

            {summary && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className={cardClass}>
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Value at risk</div>
                        <div className="text-2xl font-semibold text-amber-600 dark:text-amber-400 mt-1">{money(summary.total_impact_estimate)}</div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">Estimated, across all flagged parts</div>
                    </div>
                    <div className={cardClass}>
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">No cost basis</div>
                        <div className="text-2xl font-semibold text-gray-900 dark:text-slate-100 mt-1">{summary.missing_wac}</div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">Have stock, no WAC</div>
                    </div>
                    <div className={cardClass}>
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Negative stock</div>
                        <div className="text-2xl font-semibold text-gray-900 dark:text-slate-100 mt-1">{summary.negative_stock}</div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">Sold more than received</div>
                    </div>
                    <div className={cardClass}>
                        <div className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">No cost recorded</div>
                        <div className="text-2xl font-semibold text-gray-900 dark:text-slate-100 mt-1">{summary.missing_cost}</div>
                        <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">Created without a cost</div>
                    </div>
                </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
                <div className="flex flex-wrap gap-2">
                    {BUCKETS.map(b => (
                        <button
                            key={b.key}
                            onClick={() => setBucket(b.key)}
                            className={`px-3 py-1.5 rounded-lg text-sm border transition ${
                                bucket === b.key
                                    ? 'bg-primary-600 text-white border-primary-600'
                                    : 'bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-300 border-gray-300 dark:border-slate-600 hover:bg-gray-50 dark:hover:bg-slate-700'
                            }`}
                            title={b.hint}
                        >
                            {b.label}
                        </button>
                    ))}
                </div>
                <div className="ml-auto flex items-center gap-2">
                    <label className="text-sm text-gray-600 dark:text-slate-400">Sort by</label>
                    <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value)}
                        className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm"
                    >
                        {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                    </select>
                    <button
                        type="button"
                        onClick={exportCsv}
                        className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 inline-flex items-center gap-1"
                    >
                        <Icon path={ICONS.download} className="h-4 w-4" />
                        CSV
                    </button>
                </div>
            </div>

            {error && (
                <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-300">
                    {error}
                </div>
            )}

            <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700">
                <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
                    <thead className="bg-gray-50 dark:bg-slate-800">
                        <tr>
                            {['SKU', 'Part', 'Issues', 'Stock', 'WAC', 'Last Cost', 'Value at risk'].map(h => (
                                <th key={h} className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-slate-400 whitespace-nowrap">{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700 bg-white dark:bg-slate-900">
                        {loading ? (
                            <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">Loading…</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500 dark:text-slate-400">No parts flagged in this category.</td></tr>
                        ) : rows.map(r => (
                            <tr key={r.part_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/50">
                                <td className="px-4 py-3 text-sm font-mono text-gray-600 dark:text-slate-400 whitespace-nowrap">{r.internal_sku}</td>
                                <td className="px-4 py-3 text-sm text-gray-900 dark:text-slate-100">
                                    {r.display_name || r.detail || <span className="italic text-gray-400">No description</span>}
                                    {r.tags && <span className="ml-2 text-xs text-gray-500 dark:text-slate-500">{r.tags}</span>}
                                </td>
                                <td className="px-4 py-3 text-sm whitespace-nowrap">
                                    <div className="flex flex-wrap gap-1">
                                        {r.is_negative_stock && <span className="px-2 py-0.5 rounded text-xs bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300">Negative</span>}
                                        {r.is_missing_wac && <span className="px-2 py-0.5 rounded text-xs bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300">No WAC</span>}
                                        {r.is_missing_cost && <span className="px-2 py-0.5 rounded text-xs bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">No cost</span>}
                                    </div>
                                </td>
                                <td className={`px-4 py-3 text-sm text-right whitespace-nowrap ${Number(r.stock_on_hand) < 0 ? 'text-red-600 dark:text-red-400 font-medium' : 'text-gray-900 dark:text-slate-100'}`}>
                                    {Number(r.stock_on_hand).toLocaleString()}
                                </td>
                                <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-slate-100 whitespace-nowrap">{money(r.wac_cost)}</td>
                                <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-slate-100 whitespace-nowrap">{money(r.last_cost)}</td>
                                <td className="px-4 py-3 text-sm text-right font-medium text-amber-600 dark:text-amber-400 whitespace-nowrap">{money(r.impact_estimate)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <PaginationControls
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={setPageSize}
            />
        </div>
    );
};

export default CostDataHealthPage;
