import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSettings } from '../../contexts/SettingsContext';
import { formatCurrency } from '../../utils/currency';

const ACTION_LABELS = {
    APPROVED: { label: 'Approved', cls: 'bg-green-100 text-green-800' },
    RECOUNT_REQUESTED: { label: 'Recount', cls: 'bg-yellow-100 text-yellow-800' },
};

export default function AuditHistoryTab() {
    const { settings } = useSettings();
    const currencySymbol = settings?.DEFAULT_CURRENCY_SYMBOL || '₱';
    const [rows, setRows] = useState([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [offset, setOffset] = useState(0);
    const [actionFilter, setActionFilter] = useState('');
    const PAGE_SIZE = 50;

    const fetch = useCallback(async (off = 0, action = '') => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ limit: PAGE_SIZE, offset: off });
            if (action) params.set('action', action);
            const res = await api.get(`/inventory/cycle-count/audit-log?${params}`);
            setRows(res.data.rows);
            setTotal(res.data.total);
            setOffset(off);
        } catch {
            toast.error('Failed to load audit history.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetch(0, actionFilter); }, [fetch, actionFilter]);

    return (
        <div className="audit-history-tab">
            <div className="flex flex-wrap gap-3 items-center mb-4">
                <h3 className="text-lg font-semibold flex-1">Audit History</h3>
                <select
                    value={actionFilter}
                    onChange={e => setActionFilter(e.target.value)}
                    className="border border-gray-300 rounded px-3 py-1.5 text-sm"
                >
                    <option value="">All Actions</option>
                    <option value="APPROVED">Approved</option>
                    <option value="RECOUNT_REQUESTED">Recount Requested</option>
                </select>
                <button
                    onClick={() => fetch(0, actionFilter)}
                    disabled={loading}
                    className="bg-gray-200 hover:bg-gray-300 text-gray-800 text-sm font-medium py-1.5 px-3 rounded transition-colors"
                >
                    {loading ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            {loading ? (
                <div className="py-8 text-center text-gray-500">Loading audit history…</div>
            ) : rows.length === 0 ? (
                <p className="py-8 text-center text-gray-500">No audit history yet. Approved or recounted items will appear here.</p>
            ) : (
                <>
                    <div className="overflow-x-auto">
                        <table className="min-w-full bg-white border border-gray-200 text-sm">
                            <thead className="bg-gray-50">
                                <tr>
                                    <th className="py-2 px-3 border-b text-left">Date</th>
                                    <th className="py-2 px-3 border-b text-left">Part</th>
                                    <th className="py-2 px-3 border-b text-left">SKU</th>
                                    <th className="py-2 px-3 border-b text-center">Action</th>
                                    <th className="py-2 px-3 border-b text-right">System Qty</th>
                                    <th className="py-2 px-3 border-b text-right">Counted</th>
                                    <th className="py-2 px-3 border-b text-right">Variance</th>
                                    <th className="py-2 px-3 border-b text-right">Financial Impact</th>
                                    <th className="py-2 px-3 border-b text-left">Actioned By</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(row => {
                                    const v = parseFloat(row.variance_qty) || 0;
                                    const colorCls = v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : 'text-gray-700';
                                    const badge = ACTION_LABELS[row.action] || { label: row.action, cls: 'bg-gray-100 text-gray-700' };
                                    return (
                                        <tr key={row.log_id} className="hover:bg-gray-50 border-b last:border-0">
                                            <td className="py-2 px-3 whitespace-nowrap text-gray-500">
                                                {new Date(row.actioned_at).toLocaleString()}
                                            </td>
                                            <td className="py-2 px-3 max-w-xs truncate">{row.display_name}</td>
                                            <td className="py-2 px-3 font-mono text-xs">{row.internal_sku}</td>
                                            <td className="py-2 px-3 text-center">
                                                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${badge.cls}`}>
                                                    {badge.label}
                                                </span>
                                            </td>
                                            <td className="py-2 px-3 text-right">{row.system_qty_snapshot}</td>
                                            <td className="py-2 px-3 text-right font-medium">{row.counted_qty}</td>
                                            <td className={`py-2 px-3 text-right font-bold ${colorCls}`}>
                                                {v > 0 ? `+${v}` : v}
                                            </td>
                                            <td className={`py-2 px-3 text-right font-bold ${colorCls}`}>
                                                {formatCurrency(Math.abs(parseFloat(row.financial_impact) || 0), currencySymbol)}
                                            </td>
                                            <td className="py-2 px-3 text-gray-600">{row.actioned_by_name || '—'}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="flex items-center justify-between mt-3 text-sm text-gray-600">
                        <span>{total} total entries</span>
                        <div className="flex gap-2">
                            <button
                                disabled={offset === 0}
                                onClick={() => fetch(Math.max(0, offset - PAGE_SIZE), actionFilter)}
                                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-100"
                            >← Prev</button>
                            <span className="px-2 py-1">
                                {Math.floor(offset / PAGE_SIZE) + 1} / {Math.ceil(total / PAGE_SIZE) || 1}
                            </span>
                            <button
                                disabled={offset + PAGE_SIZE >= total}
                                onClick={() => fetch(offset + PAGE_SIZE, actionFilter)}
                                className="px-3 py-1 border rounded disabled:opacity-40 hover:bg-gray-100"
                            >Next →</button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
}
