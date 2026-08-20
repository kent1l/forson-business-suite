import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import PaginationControls from '../ui/PaginationControls';

const STATUS_META = {
    PENDING:                 { label: 'Pending',         cls: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' },
    PENDING_MANAGER_REVIEW:  { label: 'Awaiting Review', cls: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400' },
    MATCHED_AUTO_APPROVED:   { label: 'Matched ✓',       cls: 'bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-400' },
    APPROVED_ADJUSTED:       { label: 'Approved ✓',      cls: 'bg-success-100 dark:bg-success-900/30 text-success-700 dark:text-success-400' },
    RECOUNT_REQUESTED:       { label: 'Recount',         cls: 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400' },
};

function StatusBadge({ status }) {
    const m = STATUS_META[status] || { label: status, cls: 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' };
    return (
        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${m.cls}`}>
            {m.label}
        </span>
    );
}

export default function StaffProgressTab() {
    const [items, setItems] = useState([]);
    const [loading, setLoading] = useState(true);
    const [filter, setFilter] = useState('all'); // all | pending | done
    const [editingId, setEditingId] = useState(null);
    const [editValue, setEditValue] = useState('');
    const [saving, setSaving] = useState(false);

    // Pagination state
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [summary, setSummary] = useState({ all: 0, pending: 0, done: 0 });

    const fetch = useCallback(async (p = page, size = pageSize, f = filter) => {
        setLoading(true);
        try {
            const offset = (p - 1) * size;
            const res = await api.get('/inventory/cycle-count/my-progress', {
                params: { limit: size, offset, status: f }
            });
            setItems(res.data.rows);
            setTotal(res.data.total);
            if (res.data.summary) {
                setSummary(res.data.summary);
            }
        } catch {
            toast.error('Failed to load progress.');
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, filter]);

    useEffect(() => {
        fetch(page, pageSize, filter);
    }, [page, pageSize, filter]);

    const handleFilterChange = (newFilter) => {
        setFilter(newFilter);
        setPage(1);
    };

    const handleEditStart = (item) => {
        setEditingId(item.line_id);
        setEditValue(item.counted_qty !== null ? String(item.counted_qty) : '');
    };

    const handleEditCancel = () => {
        setEditingId(null);
        setEditValue('');
    };

    const handleEditSave = async (lineId) => {
        const qty = parseFloat(editValue);
        if (isNaN(qty) || qty < 0) {
            toast.error('Enter a valid count.');
            return;
        }
        setSaving(true);
        try {
            await api.patch(`/inventory/cycle-count/lines/${lineId}/edit-count`, { counted_qty: qty });
            toast.success('Count updated.');
            setEditingId(null);
            setEditValue('');
            fetch(page, pageSize, filter);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="staff-progress-tab">
            {/* Summary strip */}
            <div className="flex gap-4 mb-5">
                {[
                    { key: 'all',     label: 'All',            val: summary.all,     cls: 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-700' },
                    { key: 'pending', label: 'Pending Review', val: summary.pending, cls: 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-900/40 text-amber-900 dark:text-amber-200' },
                    { key: 'done',    label: 'Approved',       val: summary.done,    cls: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-900/40 text-emerald-900 dark:text-emerald-200' },
                ].map(({ key, label, val, cls }) => (
                    <button
                        key={key}
                        onClick={() => handleFilterChange(key)}
                        className={`flex-1 rounded-lg border p-3 text-center transition-all cursor-pointer ${cls} ${filter === key ? 'ring-2 ring-primary-500 font-semibold' : 'hover:opacity-80'}`}
                    >
                        <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">{val}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{label}</div>
                    </button>
                ))}
                <button
                    onClick={() => fetch(page, pageSize, filter)}
                    disabled={loading}
                    className="self-center px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg text-sm text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer"
                >
                    {loading ? '⟳' : '↻ Refresh'}
                </button>
            </div>

            {loading ? (
                <div className="py-10 text-center text-slate-400 dark:text-slate-500">Loading…</div>
            ) : items.length === 0 ? (
                <p className="py-10 text-center text-slate-400 dark:text-slate-500">No items to show.</p>
            ) : (
                <>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                        <table className="min-w-full text-sm bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                            <thead className="bg-slate-50 dark:bg-slate-700/40 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                                <tr>
                                    <th className="py-2 px-3 text-left">Part</th>
                                    <th className="py-2 px-3 text-left">SKU</th>
                                    <th className="py-2 px-3 text-center">Status</th>
                                    <th className="py-2 px-3 text-right">System Qty</th>
                                    <th className="py-2 px-3 text-right">Counted</th>
                                    <th className="py-2 px-3 text-right">Variance</th>
                                    <th className="py-2 px-3 text-center">Edit</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                {items.map(item => {
                                    const v = parseFloat(item.variance_qty) || 0;
                                    const vc = v < 0 ? 'text-danger-600 dark:text-danger-400' : v > 0 ? 'text-success-600 dark:text-success-400' : 'text-slate-700 dark:text-slate-300';
                                    const isEditing = editingId === item.line_id;
                                    const canEdit = item.status === 'PENDING_MANAGER_REVIEW';
                                    const showSystemQty = item.status !== 'PENDING_MANAGER_REVIEW';

                                    return (
                                        <tr key={item.line_id} className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors ${isEditing ? 'bg-primary-50 dark:bg-primary-900/20' : ''}`}>
                                            <td className="py-2 px-3 max-w-xs truncate font-medium text-slate-900 dark:text-slate-100">{item.display_name || item.detail}</td>
                                            <td className="py-2 px-3 font-mono text-xs text-slate-500 dark:text-slate-400">{item.internal_sku}</td>
                                            <td className="py-2 px-3 text-center"><StatusBadge status={item.status} /></td>
                                            <td className="py-2 px-3 text-right text-slate-500 dark:text-slate-400">{showSystemQty ? (item.system_qty_snapshot ?? '—') : <span className="text-slate-400 dark:text-slate-500 italic text-xs">hidden</span>}</td>
                                            <td className="py-2 px-3 text-right font-medium text-slate-900 dark:text-slate-100">
                                                {isEditing ? (
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        value={editValue}
                                                        onChange={e => setEditValue(e.target.value)}
                                                        className="w-24 bg-white dark:bg-slate-900 border border-primary-400 dark:border-primary-500 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm text-slate-900 dark:text-slate-100"
                                                        autoFocus
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') handleEditSave(item.line_id);
                                                            if (e.key === 'Escape') handleEditCancel();
                                                        }}
                                                    />
                                                ) : (
                                                    item.counted_qty ?? '—'
                                                )}
                                            </td>
                                            <td className={`py-2 px-3 text-right font-bold ${canEdit ? 'text-slate-400 dark:text-slate-500' : vc}`}>
                                                {canEdit ? '—' : (v > 0 ? `+${v}` : v)}
                                            </td>
                                            <td className="py-2 px-3 text-center">
                                                {canEdit && !isEditing && (
                                                    <button
                                                        onClick={() => handleEditStart(item)}
                                                        className="text-xs text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 border border-primary-200 dark:border-primary-800/60 rounded px-2 py-0.5 transition-colors cursor-pointer"
                                                    >
                                                        ✏ Edit
                                                    </button>
                                                )}
                                                {isEditing && (
                                                    <div className="flex gap-1 justify-center">
                                                        <button
                                                            onClick={() => handleEditSave(item.line_id)}
                                                            disabled={saving}
                                                            className="text-xs bg-success-600 hover:bg-success-700 text-white rounded px-2 py-0.5 disabled:opacity-50 cursor-pointer"
                                                        >
                                                            {saving ? '…' : '✓ Save'}
                                                        </button>
                                                        <button
                                                            onClick={handleEditCancel}
                                                            className="text-xs bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 rounded px-2 py-0.5 cursor-pointer"
                                                        >
                                                            ✕
                                                        </button>
                                                    </div>
                                                )}
                                                {!canEdit && (
                                                    <span className="text-xs text-slate-400 dark:text-slate-500">—</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    <div className="mt-4">
                        <PaginationControls
                            page={page}
                            pageSize={pageSize}
                            total={total}
                            onPageChange={setPage}
                            onPageSizeChange={(value) => {
                                setPageSize(value);
                                setPage(1);
                            }}
                        />
                    </div>
                </>
            )}
        </div>
    );
}
