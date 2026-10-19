import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Modal from '../ui/Modal';
import { formatCurrency } from '../../utils/currency';

const DELETE_REASONS = [
    'Duplicate entry',
    'Wrong supplier',
    'Wrong amount',
    'Wrong bills selected',
    'Invalid / typo date',
    'Test entry',
    'Other',
];

const LABEL_CLASS = 'block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1';
const INPUT_CLASS = 'w-full text-xs p-2.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-danger-500';

/**
 * Shared Delete Erroneous Payment Modal used across Outbound Treasury, Print History,
 * and AP Payment Register.
 *
 * Implements the deletion invariant:
 * - Shows exact payment/cheque details and all bills whose scheduled allocations will be released
 * - If the cheque has been printed, requires an extra confirmation that the physical leaf was never released
 * - Offers a "Spoiled Physical Cheque? Use Void Instead" shortcut when a physical leaf was spoiled
 */
const DeletePaymentModal = ({
    isOpen,
    onClose,
    chequeRecordId,
    apPaymentId,
    initialData = null,
    onDeleted,
    onSwitchToVoid,
    onSwitchToReplace,
}) => {
    const [loadingEligibility, setLoadingEligibility] = useState(false);
    const [eligibilityData, setEligibilityData] = useState(null);

    const [reasonCategory, setReasonCategory] = useState('Duplicate entry');
    const [notes, setNotes] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [confirmPrintedNotReleased, setConfirmPrintedNotReleased] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const target = eligibilityData?.target || initialData || {};
    const allocations = eligibilityData?.allocations || initialData?.allocations || initialData?.bills || [];
    const deleteRule = eligibilityData?.eligibility?.deletePayment;

    const effectiveChequeId = target.cheque_record_id || chequeRecordId || initialData?.cheque_record_id || initialData?.id;
    const effectivePaymentId = target.ap_payment_id || apPaymentId || initialData?.ap_payment_id || initialData?.payment_id;
    const isPrinted = Boolean(target.is_printed || deleteRule?.requiresPrintedConfirmation);

    useEffect(() => {
        if (!isOpen) return;
        setReasonCategory('Duplicate entry');
        setNotes('');
        setConfirmDelete(false);
        setConfirmPrintedNotReleased(false);

        const cId = chequeRecordId || initialData?.cheque_record_id || initialData?.id;
        const pId = apPaymentId || initialData?.ap_payment_id || initialData?.payment_id;
        if (!cId && !pId) return;

        setLoadingEligibility(true);
        const req = cId
            ? api.get(`/ap/outbound-clearance/${cId}/eligibility`)
            : api.get(`/ap/payments/${pId}/eligibility`);

        req.then((res) => {
            setEligibilityData(res.data?.data || null);
        })
            .catch((err) => {
                console.error('Failed to load delete eligibility:', err);
            })
            .finally(() => {
                setLoadingEligibility(false);
            });
    }, [isOpen, chequeRecordId, apPaymentId, initialData]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!confirmDelete) {
            toast.error('Please confirm that this payment was never released or cleared');
            return;
        }
        if (isPrinted && !confirmPrintedNotReleased) {
            toast.error('Please confirm that the printed cheque was never released and has been destroyed');
            return;
        }
        if (reasonCategory === 'Other' && !notes.trim()) {
            toast.error('Please provide details in Notes when selecting "Other"');
            return;
        }

        const composedReason = notes.trim()
            ? `${reasonCategory}: ${notes.trim()}`
            : reasonCategory;

        setSubmitting(true);
        try {
            const endpoint = effectiveChequeId
                ? `/ap/outbound-clearance/${effectiveChequeId}/delete`
                : `/ap/payments/${effectivePaymentId}/delete`;
            const res = await api.post(endpoint, {
                reason: composedReason,
                notes: notes.trim() || undefined,
                confirm_delete: true,
                confirm_printed_not_released: isPrinted ? confirmPrintedNotReleased : false,
            });
            toast.success('Erroneous payment deleted and bill allocations released.');
            if (onDeleted) onDeleted(res.data?.data || res.data);
            onClose();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to delete payment');
        } finally {
            setSubmitting(false);
        }
    };

    const payeeDisplay = target.payee || target.supplier_name || initialData?.company_name || initialData?.supplier_name || initialData?.payee || '—';
    const chequeNoDisplay = target.cheque_number || initialData?.cheque_number || initialData?.reference_number || (effectivePaymentId ? `Payment #${effectivePaymentId}` : `#${effectiveChequeId}`);
    const amountDisplay = formatCurrency(target.amount ?? initialData?.amount ?? 0);
    const dateDisplay = String(target.cheque_date || target.payment_date || initialData?.cheque_date || initialData?.payment_date || '—').slice(0, 10);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Delete Erroneous Payment?"
            maxWidth="max-w-lg"
        >
            {loadingEligibility ? (
                <div className="py-8 text-center text-xs text-gray-500 dark:text-slate-400 animate-pulse">
                    Checking payment status and bill allocations…
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Summary */}
                    <div className="p-3.5 bg-danger-50/70 dark:bg-danger-900/15 border border-danger-200 dark:border-danger-900/40 rounded-xl space-y-2 text-xs">
                        <div className="flex flex-wrap justify-between items-center gap-2">
                            <span className="font-bold text-gray-900 dark:text-slate-100 text-sm">{payeeDisplay}</span>
                            <span className="font-mono font-bold text-sm text-danger-700 dark:text-danger-400">{amountDisplay}</span>
                        </div>
                        <div className="text-gray-600 dark:text-slate-300 flex flex-wrap gap-x-3 gap-y-1">
                            {effectivePaymentId && <span>Payment <strong className="font-mono">#{effectivePaymentId}</strong></span>}
                            {target.cheque_number && (
                                <>
                                    <span>·</span>
                                    <span>Cheque <strong className="font-mono">#{target.cheque_number}</strong></span>
                                </>
                            )}
                            <span>·</span>
                            <span>Dated <strong className="font-mono">{dateDisplay}</strong></span>
                            <span>·</span>
                            <span>Status: <strong>{target.status || target.pdc_status || initialData?.pdc_status || 'ISSUED'}</strong></span>
                        </div>
                    </div>

                    {deleteRule && !deleteRule.allowed ? (
                        <div role="alert" className="p-3.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl text-xs text-amber-900 dark:text-amber-200 space-y-2">
                            <p className="font-bold">Cannot Delete This Record</p>
                            <p>{deleteRule.message}</p>
                        </div>
                    ) : (
                        <>
                            <div className="p-3 bg-gray-50 dark:bg-slate-800/70 border border-gray-200 dark:border-slate-700 rounded-xl space-y-2 text-xs text-gray-700 dark:text-slate-300">
                                <p className="font-semibold text-gray-900 dark:text-slate-100">This will:</p>
                                <ul className="list-disc pl-4 space-y-1">
                                    <li>Remove this erroneous payment from active AP, Treasury, and Print queues</li>
                                    {allocations.length > 0 && (
                                        <li>
                                            Release bill allocations:{' '}
                                            {allocations.map((a) => (
                                                <span key={a.bill_id} className="inline-block mr-1.5 font-mono font-semibold">
                                                    #{a.bill_number || a.bill_id} ({formatCurrency(a.amount_allocated ?? a.amount)})
                                                </span>
                                            ))}
                                        </li>
                                    )}
                                    {target.cheque_number && (
                                        <li>
                                            Release cheque number <strong className="font-mono">#{target.cheque_number}</strong> so it can be reused if the physical cheque was never written
                                        </li>
                                    )}
                                </ul>
                            </div>

                            {effectiveChequeId && (onSwitchToVoid || onSwitchToReplace) && (
                                <div className="p-2.5 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-900/40 rounded-lg text-[11px] text-blue-900 dark:text-blue-200 flex flex-wrap items-center justify-between gap-2">
                                    <span>Spoiled a physical paper leaf? Keep its cheque number reserved instead:</span>
                                    <div className="flex items-center gap-2">
                                        {onSwitchToReplace && (
                                            <button
                                                type="button"
                                                onClick={() => { onClose(); onSwitchToReplace(target); }}
                                                className="font-bold underline hover:text-blue-700 cursor-pointer"
                                            >
                                                Replace Cheque
                                            </button>
                                        )}
                                        {onSwitchToVoid && (
                                            <button
                                                type="button"
                                                onClick={() => { onClose(); onSwitchToVoid(target); }}
                                                className="font-bold underline hover:text-blue-700 cursor-pointer"
                                            >
                                                Void Cheque
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            <div>
                                <label className={LABEL_CLASS} htmlFor="delete-payment-reason">Reason</label>
                                <select
                                    id="delete-payment-reason"
                                    value={reasonCategory}
                                    onChange={(e) => setReasonCategory(e.target.value)}
                                    className={INPUT_CLASS}
                                >
                                    {DELETE_REASONS.map((r) => (
                                        <option key={r} value={r}>{r}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className={LABEL_CLASS} htmlFor="delete-payment-notes">
                                    Notes {reasonCategory === 'Other' ? <span className="text-danger-600">(required)</span> : '(optional)'}
                                </label>
                                <input
                                    id="delete-payment-notes"
                                    type="text"
                                    value={notes}
                                    onChange={(e) => setNotes(e.target.value)}
                                    required={reasonCategory === 'Other'}
                                    className={INPUT_CLASS}
                                    placeholder="Explain why this payment entry is being deleted"
                                />
                            </div>

                            <div className="space-y-2 pt-1">
                                <label className="flex items-start gap-2 text-xs text-gray-800 dark:text-slate-200 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={confirmDelete}
                                        onChange={(e) => setConfirmDelete(e.target.checked)}
                                        className="mt-0.5 rounded text-danger-600 focus:ring-danger-500"
                                    />
                                    <span>
                                        I confirm this cheque/payment was never released to the supplier or cleared by the bank.
                                    </span>
                                </label>

                                {isPrinted && (
                                    <label className="flex items-start gap-2 p-2.5 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-900/40 rounded-lg text-xs text-warning-900 dark:text-warning-200 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={confirmPrintedNotReleased}
                                            onChange={(e) => setConfirmPrintedNotReleased(e.target.checked)}
                                            className="mt-0.5 rounded text-warning-600 focus:ring-warning-500"
                                        />
                                        <span>
                                            This cheque has a print log entry. I confirm the physical cheque was never handed to the payee (or was only printed on plain paper) and will not be presented to the bank.
                                        </span>
                                    </label>
                                )}
                            </div>
                        </>
                    )}

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-lg cursor-pointer"
                        >
                            Cancel
                        </button>
                        {(!deleteRule || deleteRule.allowed) && (
                            <button
                                type="submit"
                                disabled={submitting || !confirmDelete || (isPrinted && !confirmPrintedNotReleased)}
                                className="px-4 py-2 text-xs font-bold text-white bg-danger-600 hover:bg-danger-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                            >
                                {submitting ? 'Deleting…' : 'Delete Payment'}
                            </button>
                        )}
                    </div>
                </form>
            )}
        </Modal>
    );
};

export default DeletePaymentModal;
