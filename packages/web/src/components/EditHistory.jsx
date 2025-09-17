import { useState, useEffect, useCallback, useMemo } from 'react';
import Modal from './ui/Modal';
import api from '../api';
import toast from 'react-hot-toast';

const EditHistory = ({
    isOpen,
    onClose,
    invoiceId,
    invoiceNumber
}) => {
    const [history, setHistory] = useState([]); // raw history (kept for back-compat)
    const [timeline, setTimeline] = useState([]); // synthesized timeline from API
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchHistory = useCallback(async () => {
        if (!invoiceId) return;

        setLoading(true);
        setError(null);

        try {
            const response = await api.get(`/ar/invoice-due-date-history/${invoiceId}`);
            setHistory(response.data.history || []);
            setTimeline(response.data.timeline || []);
        } catch (err) {
            console.error('Failed to fetch due date history:', err);
            setError('Failed to load edit history');
            toast.error('Failed to load edit history');
        } finally {
            setLoading(false);
        }
    }, [invoiceId]);

    useEffect(() => {
        if (isOpen && invoiceId) {
            fetchHistory();
        }
    }, [isOpen, invoiceId, fetchHistory]);

    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const formatDateOnly = (dateString) => {
        if (!dateString) return 'N/A';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const formatDaysAdjustment = (adjustment) => {
        if (adjustment === null || adjustment === undefined) return '—';
        if (adjustment === 0) return '0';
        return adjustment > 0 ? `+${adjustment}` : `${adjustment}`;
    };

    const getAdjustmentColor = (adjustment) => {
        if (adjustment === null || adjustment === undefined) return 'text-gray-400';
        if (adjustment === 0) return 'text-gray-600';
        return adjustment > 0 ? 'text-green-600' : 'text-red-600';
    };

    // Compact row data with fallbacks when API lacks timeline (graceful degrade)
    const rows = useMemo(() => {
        if (timeline && timeline.length > 0) {
            // Use timeline directly (already in ascending order)
            return timeline.map((t, idx) => ({
                key: `tl-${idx}`,
                edited_on: t.edited_on,
                edited_by: t.edited_by?.full_name || 'Unknown',
                due_date: t.due_date,
                days_adjustment: t.kind === 'initial' ? null : (t.days_adjustment || 0),
                reason: t.reason || (t.kind === 'initial' ? 'Initial due date' : '')
            }));
        }

        // Fallback: derive from raw history (show new_due_date values in descending order)
        const derived = [...history]
            .sort((a, b) => new Date(a.edited_on) - new Date(b.edited_on))
            .map((h, i) => ({
                key: `h-${h.log_id || i}`,
                edited_on: h.edited_on,
                edited_by: h.edited_by?.full_name || 'Unknown',
                due_date: h.new_due_date,
                days_adjustment: h.days_adjustment || 0,
                reason: h.reason || ''
            }));
        return derived;
    }, [timeline, history]);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`Due Date Edit History - ${invoiceNumber || 'Invoice'}`}
            maxWidth="max-w-4xl"
        >
            <div className="space-y-4">
                {loading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        <span className="ml-2 text-gray-600">Loading edit history...</span>
                    </div>
                ) : error ? (
                    <div className="text-center py-8 text-red-600">
                        {error}
                    </div>
                ) : rows.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        No due date history found for this invoice.
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-sm">
                            <thead>
                                <tr className="border-b border-gray-200 bg-gray-50">
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Edited Date</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Edited By</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Due Date</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Days Adjustment</th>
                                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Reason</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map((r) => (
                                    <tr key={r.key} className="border-b border-gray-100 hover:bg-gray-50">
                                        <td className="px-3 py-2 whitespace-nowrap text-gray-800">{formatDate(r.edited_on)}</td>
                                        <td className="px-3 py-2 whitespace-nowrap text-gray-800">{r.edited_by}</td>
                                        <td className="px-3 py-2 whitespace-nowrap font-medium text-blue-700">{formatDateOnly(r.due_date)}</td>
                                        <td className={`px-3 py-2 whitespace-nowrap font-medium ${getAdjustmentColor(r.days_adjustment)}`}>{formatDaysAdjustment(r.days_adjustment)}</td>
                                        <td className="px-3 py-2 text-gray-700">
                                            {r.reason ? (
                                                <span className="inline-block max-w-[24ch] truncate align-middle" title={r.reason}>{r.reason}</span>
                                            ) : (
                                                <span className="text-gray-400">—</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </Modal>
    );
};

export default EditHistory;