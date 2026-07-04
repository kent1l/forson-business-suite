import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

const STATUS_META = {
    PENDING:                 { label: 'Pending',         cls: 'bg-gray-100 text-gray-600' },
    PENDING_MANAGER_REVIEW:  { label: 'Awaiting Review', cls: 'bg-orange-100 text-orange-700' },
    MATCHED_AUTO_APPROVED:   { label: 'Matched ✓',       cls: 'bg-blue-100 text-blue-700' },
    APPROVED_ADJUSTED:       { label: 'Approved ✓',      cls: 'bg-green-100 text-green-700' },
    RECOUNT_REQUESTED:       { label: 'Recount',         cls: 'bg-yellow-100 text-yellow-700' },
};

function StatusBadge({ status }) {
    const m = STATUS_META[status] || { label: status, cls: 'bg-gray-100 text-gray-600' };
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

    const fetch = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/inventory/cycle-count/my-progress');
            setItems(res.data);
        } catch {
            toast.error('Failed to load progress.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetch(); }, [fetch]);

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
            await fetch();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save.');
        } finally {
            setSaving(false);
        }
    };

    const filtered = items.filter(i => {
        if (filter === 'pending') return i.status === 'PENDING';
        if (filter === 'done') return i.status !== 'PENDING';
        return true;
    });

    const pendingCount = items.filter(i => i.status === 'PENDING').length;
    const doneCount = items.filter(i => i.status !== 'PENDING').length;

    return (
        <div className="staff-progress-tab">
            {/* Summary strip */}
            <div className="flex gap-4 mb-5">
                {[
                    { key: 'all',     label: 'All',       val: items.length,  cls: 'bg-gray-50 border-gray-200' },
                    { key: 'pending', label: 'Pending',   val: pendingCount,  cls: 'bg-orange-50 border-orange-200' },
                    { key: 'done',    label: 'Completed', val: doneCount,     cls: 'bg-green-50 border-green-200' },
                ].map(({ key, label, val, cls }) => (
                    <button
                        key={key}
                        onClick={() => setFilter(key)}
                        className={`flex-1 rounded-lg border p-3 text-center transition-all ${cls} ${filter === key ? 'ring-2 ring-blue-400' : 'hover:opacity-80'}`}
                    >
                        <div className="text-2xl font-bold text-gray-800">{val}</div>
                        <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                    </button>
                ))}
                <button
                    onClick={fetch}
                    disabled={loading}
                    className="self-center px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-500 hover:bg-gray-100 transition-colors"
                >
                    {loading ? '⟳' : '↻ Refresh'}
                </button>
            </div>

            {loading ? (
                <div className="py-10 text-center text-gray-400">Loading…</div>
            ) : filtered.length === 0 ? (
                <p className="py-10 text-center text-gray-400">No items to show.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-sm border border-gray-200 bg-white">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="py-2 px-3 border-b text-left">Part</th>
                                <th className="py-2 px-3 border-b text-left">SKU</th>
                                <th className="py-2 px-3 border-b text-center">Status</th>
                                <th className="py-2 px-3 border-b text-right">System Qty</th>
                                <th className="py-2 px-3 border-b text-right">Counted</th>
                                <th className="py-2 px-3 border-b text-right">Variance</th>
                                <th className="py-2 px-3 border-b text-center">Edit</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.map(item => {
                                const v = parseFloat(item.variance_qty) || 0;
                                const vc = v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : 'text-gray-700';
                                const isEditing = editingId === item.line_id;
                                const canEdit = item.status === 'PENDING';

                                return (
                                    <tr key={item.line_id} className={`border-b hover:bg-gray-50 ${isEditing ? 'bg-blue-50' : ''}`}>
                                        <td className="py-2 px-3 max-w-xs truncate">{item.display_name || item.detail}</td>
                                        <td className="py-2 px-3 font-mono text-xs text-gray-500">{item.internal_sku}</td>
                                        <td className="py-2 px-3 text-center"><StatusBadge status={item.status} /></td>
                                        <td className="py-2 px-3 text-right text-gray-500">{item.system_qty_snapshot ?? '—'}</td>
                                        <td className="py-2 px-3 text-right font-medium">
                                            {isEditing ? (
                                                <input
                                                    type="number"
                                                    min="0"
                                                    step="1"
                                                    value={editValue}
                                                    onChange={e => setEditValue(e.target.value)}
                                                    className="w-24 border border-blue-400 rounded px-2 py-1 text-right focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
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
                                        <td className={`py-2 px-3 text-right font-bold ${canEdit ? 'text-gray-300' : vc}`}>
                                            {canEdit ? '—' : (v > 0 ? `+${v}` : v)}
                                        </td>
                                        <td className="py-2 px-3 text-center">
                                            {canEdit && !isEditing && (
                                                <button
                                                    onClick={() => handleEditStart(item)}
                                                    className="text-xs text-blue-600 hover:text-blue-800 border border-blue-200 rounded px-2 py-0.5 transition-colors"
                                                >
                                                    ✏ Edit
                                                </button>
                                            )}
                                            {isEditing && (
                                                <div className="flex gap-1 justify-center">
                                                    <button
                                                        onClick={() => handleEditSave(item.line_id)}
                                                        disabled={saving}
                                                        className="text-xs bg-green-600 hover:bg-green-700 text-white rounded px-2 py-0.5 disabled:opacity-50"
                                                    >
                                                        {saving ? '…' : '✓ Save'}
                                                    </button>
                                                    <button
                                                        onClick={handleEditCancel}
                                                        className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 rounded px-2 py-0.5"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            )}
                                            {!canEdit && (
                                                <span className="text-xs text-gray-300">—</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}
