import { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import { formatCurrency } from '../../utils/currency';

const MIN_REASON_LENGTH = 10;

/**
 * Reverses a posted A/R concession.
 *
 * Nothing is edited or deleted: reversing posts an equal and opposite document,
 * and both stay on the customer's statement forever. That is the point, so this
 * screen says so plainly rather than presenting itself as an undo.
 *
 * The ledger row that triggered this knows the document only by the reference
 * number printed on it, so the document is resolved by number on open — which
 * also lets the dialog show what is actually about to be reversed before the
 * user commits to it.
 */
const ReverseAdjustmentModal = ({ isOpen, onClose, ledgerRow, onReversed }) => {
    const [adjustment, setAdjustment] = useState(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [reason, setReason] = useState('');
    const [loadError, setLoadError] = useState(null);

    const adjustmentNo = ledgerRow?.primary_ref;

    useEffect(() => {
        if (!isOpen || !adjustmentNo) return;
        setLoading(true);
        setReason('');
        setAdjustment(null);
        setLoadError(null);
        api.get('/ar/adjustments', { params: { adjustment_no: adjustmentNo } })
            .then(res => {
                const match = (res.data || [])[0];
                if (!match) throw new Error(`Could not find adjustment ${adjustmentNo}.`);
                return api.get(`/ar/adjustments/${match.adjustment_id}`);
            })
            .then(res => setAdjustment(res.data))
            .catch(err => setLoadError(err?.response?.data?.message || err.message || 'Could not load this adjustment.'))
            .finally(() => setLoading(false));
    }, [isOpen, adjustmentNo]);

    const tooShort = reason.trim().length < MIN_REASON_LENGTH;

    const submit = async () => {
        if (tooShort || saving || !adjustment) return;
        setSaving(true);
        try {
            const { data } = await api.post(`/ar/adjustments/${adjustment.adjustment_id}/reverse`, {
                reason: reason.trim(),
            });
            toast.success(`${adjustment.adjustment_no} reversed by ${data.adjustment_no}.`);
            onReversed?.(data);
            onClose?.();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to reverse the adjustment.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Reverse Adjustment" maxWidth="max-w-lg">
            <div className="space-y-4">
                {loading && <p className="text-sm text-gray-500 dark:text-slate-400">Loading {adjustmentNo}…</p>}
                {loadError && <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>}

                {adjustment && (
                    <>
                        <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 space-y-1">
                            <div className="flex justify-between items-baseline">
                                <span className="font-mono font-semibold text-gray-900 dark:text-slate-100">
                                    {adjustment.adjustment_no}
                                </span>
                                <span className="font-mono font-bold text-gray-900 dark:text-slate-100">
                                    {formatCurrency(adjustment.total_amount)}
                                </span>
                            </div>
                            <p className="text-xs text-gray-600 dark:text-slate-400">
                                {adjustment.reason_label}
                                {adjustment.notes ? ` — ${adjustment.notes}` : ''}
                            </p>
                            <ul className="text-xs text-gray-500 dark:text-slate-400 pt-1 space-y-0.5">
                                {(adjustment.allocations || []).map(a => (
                                    <li key={a.invoice_id} className="flex justify-between">
                                        <span className="font-mono">{a.invoice_number}</span>
                                        <span className="font-mono">{formatCurrency(a.amount)} will be owed again</span>
                                    </li>
                                ))}
                            </ul>
                        </div>

                        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 p-3">
                            <p className="text-xs text-amber-900 dark:text-amber-200">
                                This posts an opposite entry rather than deleting anything. Both this adjustment and its
                                reversal stay on the customer&rsquo;s statement, which is what lets the history be audited.
                            </p>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-slate-400 mb-1">
                                Why is it being reversed? <span className="text-red-500">*</span>
                            </label>
                            <textarea
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                rows={3}
                                autoFocus
                                placeholder="At least 10 characters — this is printed alongside the reversal."
                                className="w-full px-3 py-2 rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm"
                            />
                            {reason.length > 0 && tooShort && (
                                <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                    {MIN_REASON_LENGTH - reason.trim().length} more character(s) needed.
                                </p>
                            )}
                        </div>
                    </>
                )}

                <div className="flex justify-end gap-3 pt-2 border-t border-gray-200 dark:border-slate-700">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 rounded text-sm font-semibold text-gray-700 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={submit}
                        disabled={tooShort || saving || !adjustment}
                        className="px-4 py-2 rounded text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
                    >
                        {saving ? 'Reversing…' : 'Reverse Adjustment'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default ReverseAdjustmentModal;
