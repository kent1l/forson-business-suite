import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Modal from '../ui/Modal';
import { useAuth } from '../../contexts/AuthContext';

// Avoid linter warnings for a component only referenced from JSX (see the
// same pattern in components/refunds/InvoiceDetailsModal.jsx)
void Modal;

const MIN_REASON_LENGTH = 10;

const inputClass = "w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500";
const labelClass = "block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1";

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');

/**
 * Generic "change the transaction date" modal, backed by
 * packages/api/routes/transactionDateRoutes.js. Works for any registered
 * kind (see transactionDateService.js's KIND_HANDLERS) — pass the kind and
 * id of the record being corrected.
 *
 * Flow: pick a date + write a reason -> the preview endpoint reports every
 * dependent row that would move (inventory, ledgers, due dates, WAC) and any
 * blocking conflicts -> "Apply" is disabled until the preview comes back
 * clean and the reason is long enough.
 */
const ChangeTransactionDateModal = ({ isOpen, onClose, kind, id, currentDate, transactionLabel, onApplied }) => {
    const { hasPermission } = useAuth();
    const canUnrestricted = hasPermission('transaction:change_date_unrestricted');

    const [newDate, setNewDate] = useState('');
    const [reason, setReason] = useState('');
    const [preview, setPreview] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [applying, setApplying] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setNewDate(currentDate ? new Date(currentDate).toISOString().slice(0, 10) : '');
        setReason('');
        setPreview(null);
    }, [isOpen, currentDate]);

    useEffect(() => {
        if (!isOpen || !newDate) { setPreview(null); return; }
        let cancelled = false;
        setPreviewing(true);
        api.get(`/transaction-date/${kind}/${id}/preview`, { params: { new_date: newDate } })
            .then((res) => { if (!cancelled) setPreview(res.data); })
            .catch((err) => {
                if (cancelled) return;
                setPreview({
                    blocking_conflicts: [err.response?.data?.message || 'Failed to preview this change.'],
                    cascade_preview: [],
                    warnings: [],
                    wac_affected_parts: [],
                    can_apply: false,
                });
            })
            .finally(() => { if (!cancelled) setPreviewing(false); });
        return () => { cancelled = true; };
    }, [isOpen, newDate, kind, id]);

    const reasonValid = reason.trim().length >= MIN_REASON_LENGTH;
    const blockedByMonthPermission = preview?.crosses_month_boundary && !canUnrestricted;
    const canApply = !!preview && preview.can_apply && !blockedByMonthPermission && reasonValid && !previewing;

    const handleApply = async () => {
        setApplying(true);
        try {
            const res = await api.put(`/transaction-date/${kind}/${id}`, { new_date: newDate, reason: reason.trim() });
            toast.success('Transaction date updated.');
            onApplied && onApplied(res.data);
            onClose();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to change the transaction date.');
        } finally {
            setApplying(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Change Date — ${transactionLabel || ''}`} maxWidth="max-w-lg">
            <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className={labelClass}>Current Date</label>
                        <div className="px-3 py-2 border border-gray-200 dark:border-slate-700 rounded-lg bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm">
                            {fmtDate(currentDate)}
                        </div>
                    </div>
                    <div>
                        <label className={labelClass}>New Date</label>
                        <input type="date" value={newDate} max={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => setNewDate(e.target.value)} className={inputClass} />
                    </div>
                </div>

                <div>
                    <label className={labelClass}>Reason (required)</label>
                    <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                        placeholder="Why is this date being corrected? (minimum 10 characters)"
                        className={inputClass} />
                </div>

                {previewing && (
                    <p className="text-sm text-gray-500 dark:text-slate-400">Checking impact…</p>
                )}

                {preview && !previewing && (
                    <div className="space-y-3">
                        {preview.blocking_conflicts?.length > 0 && (
                            <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3">
                                <p className="text-sm font-medium text-red-800 dark:text-red-300 mb-1">This change cannot be applied:</p>
                                <ul className="text-sm text-red-700 dark:text-red-400 list-disc list-inside space-y-0.5">
                                    {preview.blocking_conflicts.map((c, i) => <li key={i}>{c}</li>)}
                                </ul>
                            </div>
                        )}

                        {blockedByMonthPermission && (
                            <div className="rounded-lg border border-red-300 dark:border-red-800 bg-red-50 dark:bg-red-950/40 p-3">
                                <p className="text-sm text-red-700 dark:text-red-400">
                                    This crosses a month boundary and requires the unrestricted date-change permission.
                                </p>
                            </div>
                        )}

                        {preview.warnings?.length > 0 && (
                            <div className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-3">
                                <ul className="text-sm text-amber-800 dark:text-amber-400 list-disc list-inside space-y-0.5">
                                    {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
                                </ul>
                            </div>
                        )}

                        {preview.cascade_preview?.length > 0 && (
                            <div>
                                <p className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">This will also update:</p>
                                <ul className="text-sm text-gray-600 dark:text-slate-400 list-disc list-inside space-y-0.5">
                                    {preview.cascade_preview.map((step, i) => (
                                        <li key={i}>{step.description}</li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {preview.wac_affected_parts?.length > 0 && (
                            <p className="text-sm text-gray-600 dark:text-slate-400">
                                {preview.wac_affected_parts.length} part{preview.wac_affected_parts.length === 1 ? '' : 's'} will have their weighted-average cost recomputed.
                            </p>
                        )}
                    </div>
                )}

                <div className="flex justify-end gap-3 pt-2">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">
                        Cancel
                    </button>
                    <button type="button" onClick={handleApply} disabled={!canApply || applying}
                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50">
                        {applying ? 'Applying…' : 'Apply Date Change'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default ChangeTransactionDateModal;
