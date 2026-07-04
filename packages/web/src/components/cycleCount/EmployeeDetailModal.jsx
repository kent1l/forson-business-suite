import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

export default function EmployeeDetailModal({ employeeId, employeeName, onClose }) {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [innerTab, setInnerTab] = useState('overview');

    useEffect(() => {
        if (!employeeId) return;
        setLoading(true);
        api.get(`/inventory/cycle-count/employees/${employeeId}/detail`)
            .then(res => setData(res.data))
            .catch(() => toast.error('Failed to load employee detail.'))
            .finally(() => setLoading(false));
    }, [employeeId]);

    const statusBadge = (status) => {
        const map = {
            MATCHED_AUTO_APPROVED: { label: 'Auto-Matched', cls: 'bg-blue-100 text-blue-800' },
            APPROVED_ADJUSTED: { label: 'Approved', cls: 'bg-green-100 text-green-800' },
            PENDING_MANAGER_REVIEW: { label: 'Pending Review', cls: 'bg-orange-100 text-orange-800' },
            RECOUNT_REQUESTED: { label: 'Recount', cls: 'bg-yellow-100 text-yellow-800' },
        };
        const b = map[status] || { label: status, cls: 'bg-gray-100 text-gray-700' };
        return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${b.cls}`}>{b.label}</span>;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b">
                    <h2 className="text-xl font-bold">{employeeName}</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-2xl leading-none">&times;</button>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center py-16 text-gray-500">Loading…</div>
                ) : !data ? (
                    <div className="flex-1 flex items-center justify-center py-16 text-gray-500">No data available.</div>
                ) : (
                    <>
                        {/* Inner tabs */}
                        <div className="px-6 pt-3 border-b flex gap-6">
                            {['overview', 'history', 'pending'].map(t => (
                                <button
                                    key={t}
                                    onClick={() => setInnerTab(t)}
                                    className={`pb-3 text-sm font-medium border-b-2 transition-colors capitalize ${innerTab === t ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                                >
                                    {t === 'history' ? 'Count History' : t === 'pending' ? `Pending (${data.pending_lines.length})` : 'Overview'}
                                </button>
                            ))}
                        </div>

                        <div className="flex-1 overflow-y-auto p-6">
                            {innerTab === 'overview' && (
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                                    {[
                                        { label: 'Avg Speed (mins)', val: data.performance ? parseFloat(data.performance.avg_speed_mins).toFixed(1) : '—' },
                                        { label: 'Match Accuracy', val: data.performance ? `${parseFloat(data.performance.match_accuracy_percent).toFixed(1)}%` : '—' },
                                        { label: 'Discovery Volume', val: data.performance?.discovery_volume ?? '—' },
                                        { label: 'Pending Items', val: data.pending_lines.length },
                                    ].map(({ label, val }) => (
                                        <div key={label} className="bg-gray-50 rounded-lg p-4 text-center border">
                                            <div className="text-2xl font-bold text-blue-600">{val}</div>
                                            <div className="text-xs text-gray-500 mt-1">{label}</div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {innerTab === 'history' && (
                                data.recent_lines.length === 0 ? (
                                    <p className="text-gray-500 text-sm">No completed counts yet.</p>
                                ) : (
                                    <table className="min-w-full text-sm border border-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="py-2 px-3 border-b text-left">Part</th>
                                                <th className="py-2 px-3 border-b text-left">SKU</th>
                                                <th className="py-2 px-3 border-b text-center">Status</th>
                                                <th className="py-2 px-3 border-b text-right">Variance</th>
                                                <th className="py-2 px-3 border-b text-left">Counted At</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.recent_lines.map(l => {
                                                const v = parseFloat(l.variance_qty) || 0;
                                                const vc = v < 0 ? 'text-red-600' : v > 0 ? 'text-green-600' : 'text-gray-700';
                                                return (
                                                    <tr key={l.line_id} className="border-b hover:bg-gray-50">
                                                        <td className="py-2 px-3 max-w-xs truncate">{l.display_name}</td>
                                                        <td className="py-2 px-3 font-mono text-xs">{l.internal_sku}</td>
                                                        <td className="py-2 px-3 text-center">{statusBadge(l.status)}</td>
                                                        <td className={`py-2 px-3 text-right font-bold ${vc}`}>{v > 0 ? `+${v}` : v}</td>
                                                        <td className="py-2 px-3 text-xs text-gray-500 whitespace-nowrap">
                                                            {l.counted_at ? new Date(l.counted_at).toLocaleString() : '—'}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                )
                            )}

                            {innerTab === 'pending' && (
                                data.pending_lines.length === 0 ? (
                                    <p className="text-gray-500 text-sm">No pending items.</p>
                                ) : (
                                    <table className="min-w-full text-sm border border-gray-200">
                                        <thead className="bg-gray-50">
                                            <tr>
                                                <th className="py-2 px-3 border-b text-left">Part</th>
                                                <th className="py-2 px-3 border-b text-left">SKU</th>
                                                <th className="py-2 px-3 border-b text-left">Batch ID</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {data.pending_lines.map(l => (
                                                <tr key={l.line_id} className="border-b hover:bg-gray-50">
                                                    <td className="py-2 px-3 max-w-xs truncate">{l.display_name}</td>
                                                    <td className="py-2 px-3 font-mono text-xs">{l.internal_sku}</td>
                                                    <td className="py-2 px-3 text-gray-500">{l.batch_id}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                )
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
