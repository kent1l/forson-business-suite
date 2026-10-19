import { useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Modal from '../ui/Modal';
import { formatCurrency } from '../../utils/currency';

const REPLACE_REASONS = [
    'Wrong date',
    'Spoiled physical cheque / printer jam',
    'Wrong bank account',
    'Wrong cheque number',
    'Bounced / returned by bank',
    'Stale cheque (>6 months)',
    'Other',
];

const LABEL_CLASS = 'block text-xs font-semibold text-gray-700 dark:text-slate-300 mb-1';
const INPUT_CLASS = 'w-full text-xs p-2.5 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-warning-500';

const formatDateShort = (val) => {
    if (!val) return '—';
    const str = String(val).slice(0, 10);
    return str;
};

/**
 * Shared Replace Cheque Modal used across Outbound Treasury, Print History, and AP Payment Register.
 *
 * Implements the unified workflow:
 * - Pre-fills the existing bank account (or allows switching to another active bank account of the same currency)
 * - Auto-suggests the next cheque number for the selected bank account
 * - Defaults to keeping the existing cheque date unless "Change date" is checked
 * - Transfers all bill allocations atomically to the replacement cheque
 * - Shows a post-replace confirmation banner with Print Replacement / Done actions
 */
const ReplaceChequeModal = ({
    isOpen,
    onClose,
    chequeRecordId,
    apPaymentId,
    initialData = null,
    onReplaced,
    onPrintReplacement,
}) => {
    const [loadingEligibility, setLoadingEligibility] = useState(false);
    const [eligibilityData, setEligibilityData] = useState(null);
    const [bankAccounts, setBankAccounts] = useState([]);

    const [bankAccountId, setBankAccountId] = useState('');
    const [newChequeNumber, setNewChequeNumber] = useState('');
    const [changeDate, setChangeDate] = useState(false);
    const [newChequeDate, setNewChequeDate] = useState('');
    const [reasonCategory, setReasonCategory] = useState('Wrong date');
    const [notes, setNotes] = useState('');
    const [confirmRecoveredOrStopped, setConfirmRecoveredOrStopped] = useState(false);

    const [conflictError, setConflictError] = useState(null);
    const [submitting, setSubmitting] = useState(false);
    const [completedResult, setCompletedResult] = useState(null);

    const chequeNumberInputRef = useRef(null);

    const target = eligibilityData?.target || initialData || {};
    const allocations = eligibilityData?.allocations || initialData?.allocations || initialData?.bills || [];
    const replaceRule = eligibilityData?.eligibility?.replace;

    useEffect(() => {
        if (!isOpen) {
            setCompletedResult(null);
            setConflictError(null);
            return;
        }

        const effectiveChequeId = chequeRecordId || initialData?.cheque_record_id || initialData?.id;
        const effectivePaymentId = apPaymentId || initialData?.ap_payment_id || initialData?.payment_id;

        setCompletedResult(null);
        setConflictError(null);
        setChangeDate(false);
        setReasonCategory('Wrong date');
        setNotes('');
        setConfirmRecoveredOrStopped(false);

        setLoadingEligibility(true);
        const eligibilityPromise = effectiveChequeId
            ? api.get(`/ap/outbound-clearance/${effectiveChequeId}/eligibility`)
            : effectivePaymentId
                ? api.get(`/ap/payments/${effectivePaymentId}/eligibility`)
                : Promise.resolve(null);

        Promise.all([
            eligibilityPromise,
            api.get('/bank-accounts'),
        ])
            .then(([eligRes, baRes]) => {
                const elig = eligRes?.data?.data || null;
                setEligibilityData(elig);
                const allBanks = (baRes?.data?.data || baRes?.data || []).filter((b) => b.is_active !== false);
                setBankAccounts(allBanks);

                const initialBankId = elig?.target?.bank_account_id || initialData?.bank_account_id || '';
                const initialDate = String(elig?.target?.cheque_date || initialData?.cheque_date || '').slice(0, 10);
                setBankAccountId(initialBankId ? String(initialBankId) : '');
                setNewChequeDate(initialDate);

                const status = elig?.target?.status || initialData?.pdc_status || initialData?.status;
                if (status === 'BOUNCED') {
                    setReasonCategory('Bounced / returned by bank');
                } else if (status === 'STALE' || elig?.target?.maturity_status === 'STALE_CHEQUE') {
                    setReasonCategory('Stale cheque (>6 months)');
                }
            })
            .catch((err) => {
                console.error('Failed to load cheque replacement eligibility:', err);
                toast.error(err.response?.data?.message || 'Failed to load cheque details');
            })
            .finally(() => {
                setLoadingEligibility(false);
                setTimeout(() => {
                    chequeNumberInputRef.current?.focus();
                }, 50);
            });
    }, [isOpen, chequeRecordId, apPaymentId, initialData]);

    // Suggest next cheque number whenever bankAccountId changes
    useEffect(() => {
        if (!isOpen || !bankAccountId || completedResult) return;
        let cancelled = false;
        api.get('/ap/cheque-register/next-number', { params: { bank_account_id: bankAccountId } })
            .then((res) => {
                const suggested = res.data?.data?.next_cheque_number;
                if (!cancelled && suggested) {
                    setNewChequeNumber(suggested);
                }
            })
            .catch(() => {});
        return () => { cancelled = true; };
    }, [isOpen, bankAccountId, completedResult]);

    const sourceBank = useMemo(
        () => bankAccounts.find((b) => String(b.bank_account_id) === String(target.bank_account_id)),
        [bankAccounts, target.bank_account_id]
    );

    const compatibleBanks = useMemo(() => {
        if (!sourceBank?.currency) return bankAccounts;
        return bankAccounts.filter((b) => !b.currency || b.currency === sourceBank.currency);
    }, [bankAccounts, sourceBank]);

    const selectedBank = useMemo(
        () => bankAccounts.find((b) => String(b.bank_account_id) === String(bankAccountId)),
        [bankAccounts, bankAccountId]
    );

    const origDateStr = formatDateShort(target.cheque_date || initialData?.cheque_date);
    const effectiveChequeId = target.cheque_record_id || chequeRecordId || initialData?.cheque_record_id || initialData?.id;
    const isDeposited = (target.status || target.pdc_status) === 'DEPOSITED';

    const handleSubmit = async (e) => {
        e.preventDefault();
        setConflictError(null);

        if (!effectiveChequeId) {
            toast.error('Cheque record ID is missing');
            return;
        }
        if (!bankAccountId) {
            toast.error('Please select a bank account');
            return;
        }
        if (!newChequeNumber.trim()) {
            toast.error('New cheque number is required');
            return;
        }
        const finalDate = changeDate ? newChequeDate : origDateStr;
        if (!finalDate) {
            toast.error('Cheque date is required');
            return;
        }
        if (reasonCategory === 'Other' && !notes.trim()) {
            toast.error('Please provide details in Notes when selecting "Other"');
            return;
        }
        if (isDeposited && !confirmRecoveredOrStopped) {
            toast.error('Confirm that the deposited cheque was recovered or stopped at the bank');
            return;
        }

        const composedReason = notes.trim()
            ? `${reasonCategory}: ${notes.trim()}`
            : reasonCategory;

        setSubmitting(true);
        try {
            const res = await api.post(`/ap/outbound-clearance/${effectiveChequeId}/replace`, {
                bank_account_id: Number(bankAccountId),
                new_cheque_number: newChequeNumber.trim(),
                new_cheque_date: finalDate,
                reason: composedReason,
                notes: notes.trim() || undefined,
                confirm_recovered_or_stopped: confirmRecoveredOrStopped,
            });
            const resultData = res.data?.data || res.data;
            setCompletedResult({
                ...resultData,
                oldChequeNumber: target.cheque_number || initialData?.cheque_number,
                newChequeNumber: resultData?.newChequeNumber || newChequeNumber.trim(),
                newChequeDate: resultData?.newChequeDate || finalDate,
                payee: target.payee || target.supplier_name || initialData?.company_name || initialData?.payee,
                amount: target.amount || initialData?.amount,
            });
            toast.success(`Cheque #${target.cheque_number || effectiveChequeId} replaced with #${newChequeNumber.trim()}`);
            if (onReplaced) onReplaced(resultData);
        } catch (err) {
            if (err.response?.status === 409 && err.response?.data?.code === 'DUPLICATE_CHEQUE_NUMBER') {
                setConflictError(err.response.data.details?.conflict || { message: err.response.data.message });
            } else {
                toast.error(err.response?.data?.message || 'Failed to replace cheque');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const payeeDisplay = target.payee || target.supplier_name || initialData?.company_name || initialData?.payee || '—';
    const chequeNoDisplay = target.cheque_number || initialData?.cheque_number || `#${effectiveChequeId}`;
    const amountDisplay = formatCurrency(target.amount ?? initialData?.amount ?? 0);

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={completedResult ? 'Replacement Cheque Issued' : `Replace Cheque #${chequeNoDisplay}`}
            maxWidth="max-w-lg"
        >
            {loadingEligibility ? (
                <div className="py-8 text-center text-xs text-gray-500 dark:text-slate-400 animate-pulse">
                    Loading cheque details and bill allocations…
                </div>
            ) : completedResult ? (
                <div className="space-y-4">
                    <div className="p-4 bg-success-50 dark:bg-success-900/20 border border-success-200 dark:border-success-900/40 rounded-xl space-y-2 text-xs text-success-900 dark:text-success-200">
                        <p className="font-bold text-sm">
                            ✓ Cheque #{completedResult.oldChequeNumber} replaced by #{completedResult.newChequeNumber}
                        </p>
                        <p>
                            Old cheque <strong>#{completedResult.oldChequeNumber}</strong> is now marked <strong>REPLACED</strong> (its number stays reserved in the audit sequence) and all bill allocations have been moved to <strong>#{completedResult.newChequeNumber}</strong>.
                        </p>
                        <div className="pt-1 font-mono text-[11px] space-y-0.5">
                            <div>Payee: <strong>{completedResult.payee}</strong></div>
                            <div>Amount: <strong>{formatCurrency(completedResult.amount)}</strong></div>
                            <div>Cheque Date: <strong>{completedResult.newChequeDate}</strong></div>
                        </div>
                    </div>

                    <div className="flex flex-wrap justify-end gap-2 pt-2">
                        {onPrintReplacement && completedResult.newChequeRecordId && (
                            <button
                                type="button"
                                onClick={() => {
                                    onPrintReplacement({
                                        cheque_record_id: completedResult.newChequeRecordId,
                                        id: completedResult.newChequeRecordId,
                                        cheque_number: completedResult.newChequeNumber,
                                        cheque_date: completedResult.newChequeDate,
                                        payee: completedResult.payee,
                                        company_name: completedResult.payee,
                                        amount: completedResult.amount,
                                        template_id: completedResult.templateId,
                                        bank_account_id: completedResult.bankAccountId,
                                    });
                                    onClose();
                                }}
                                className="px-4 py-2 text-xs font-bold text-white bg-primary-600 hover:bg-primary-700 rounded-lg shadow-xs cursor-pointer"
                            >
                                🖨️ Print Replacement Cheque
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-semibold text-gray-700 dark:text-slate-200 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-lg cursor-pointer"
                        >
                            Done
                        </button>
                    </div>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    {/* Summary Header */}
                    <div className="p-3.5 bg-gray-50 dark:bg-slate-900/60 border border-gray-200 dark:border-slate-700 rounded-xl space-y-2 text-xs">
                        <div className="flex flex-wrap justify-between items-center gap-2">
                            <span className="font-bold text-gray-900 dark:text-slate-100 text-sm">{payeeDisplay}</span>
                            <span className="font-mono font-bold text-sm text-primary-700 dark:text-primary-400">{amountDisplay}</span>
                        </div>
                        <div className="text-gray-600 dark:text-slate-400 flex flex-wrap gap-x-3 gap-y-1">
                            <span>Current: <strong className="font-mono text-gray-800 dark:text-slate-200">#{chequeNoDisplay}</strong></span>
                            <span>·</span>
                            <span>{target.bank_account_name || initialData?.bank_account_name || 'Bank Account'}</span>
                            <span>·</span>
                            <span>Dated <strong className="font-mono">{origDateStr}</strong></span>
                        </div>
                        {allocations.length > 0 && (
                            <div className="pt-1.5 border-t border-gray-200 dark:border-slate-700 text-[11px] text-gray-600 dark:text-slate-400">
                                <span className="font-semibold text-gray-700 dark:text-slate-300">Bills: </span>
                                {allocations.map((a) => (
                                    <span key={a.bill_id} className="inline-block mr-2 font-mono">
                                        #{a.bill_number || a.bill_id} ({formatCurrency(a.amount_allocated ?? a.amount)})
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    {replaceRule && !replaceRule.allowed && (
                        <div role="alert" className="p-3 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-900/40 rounded-lg text-xs text-danger-800 dark:text-danger-300">
                            {replaceRule.message}
                        </div>
                    )}

                    {/* Form Fields */}
                    <div className="space-y-3">
                        <div>
                            <label className={LABEL_CLASS} htmlFor="replace-cheque-bank">Bank account</label>
                            <select
                                id="replace-cheque-bank"
                                value={bankAccountId}
                                onChange={(e) => setBankAccountId(e.target.value)}
                                className={INPUT_CLASS}
                                required
                            >
                                <option value="">Select bank account…</option>
                                {compatibleBanks.map((ba) => (
                                    <option key={ba.bank_account_id} value={ba.bank_account_id}>
                                        {ba.account_name} — {ba.bank_name}
                                    </option>
                                ))}
                            </select>
                            {selectedBank && !selectedBank.default_cheque_template_id && (
                                <p className="text-[11px] text-warning-700 dark:text-warning-400 mt-1">
                                    ⚠️ No default print template is linked to this bank account yet.
                                </p>
                            )}
                        </div>

                        <div>
                            <label className={LABEL_CLASS} htmlFor="replace-cheque-number">New cheque number</label>
                            <input
                                ref={chequeNumberInputRef}
                                id="replace-cheque-number"
                                type="text"
                                value={newChequeNumber}
                                onChange={(e) => {
                                    setNewChequeNumber(e.target.value);
                                    setConflictError(null);
                                }}
                                className={`${INPUT_CLASS} font-mono`}
                                placeholder="e.g. 0313084"
                                required
                            />
                            <p className="text-[11px] text-gray-500 dark:text-slate-400 mt-1">
                                Suggested from the selected bank&apos;s cheque sequence — edit to match the physical cheque leaf.
                            </p>
                        </div>

                        {conflictError && (
                            <div role="alert" className="p-3 bg-danger-50 dark:bg-danger-900/20 border border-danger-200 dark:border-danger-900/40 rounded-lg text-xs text-danger-800 dark:text-danger-300 space-y-1">
                                <p className="font-bold">Duplicate Cheque Number</p>
                                <p>
                                    Cheque <strong>#{conflictError.cheque_number || newChequeNumber}</strong> already exists on this bank account
                                    {conflictError.payee ? ` (Payee: ${conflictError.payee}, Status: ${conflictError.status})` : ''}.
                                </p>
                            </div>
                        )}

                        <div className="p-3 bg-gray-50 dark:bg-slate-800/70 border border-gray-200 dark:border-slate-700 rounded-lg space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-gray-700 dark:text-slate-300">
                                    Cheque date: <strong className="font-mono">{changeDate ? newChequeDate : `${origDateStr} (unchanged)`}</strong>
                                </span>
                                <label className="flex items-center gap-1.5 text-xs font-semibold text-primary-700 dark:text-primary-400 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={changeDate}
                                        onChange={(e) => setChangeDate(e.target.checked)}
                                        className="rounded text-primary-600 focus:ring-primary-500"
                                    />
                                    <span>Change date</span>
                                </label>
                            </div>
                            {changeDate && (
                                <input
                                    type="date"
                                    value={newChequeDate}
                                    onChange={(e) => setNewChequeDate(e.target.value)}
                                    className={INPUT_CLASS}
                                    required
                                />
                            )}
                        </div>

                        <div>
                            <label className={LABEL_CLASS} htmlFor="replace-cheque-reason">Reason</label>
                            <select
                                id="replace-cheque-reason"
                                value={reasonCategory}
                                onChange={(e) => setReasonCategory(e.target.value)}
                                className={INPUT_CLASS}
                            >
                                {REPLACE_REASONS.map((r) => (
                                    <option key={r} value={r}>{r}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className={LABEL_CLASS} htmlFor="replace-cheque-notes">
                                Notes {reasonCategory === 'Other' ? <span className="text-danger-600">(required)</span> : '(optional)'}
                            </label>
                            <input
                                id="replace-cheque-notes"
                                type="text"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                required={reasonCategory === 'Other'}
                                className={INPUT_CLASS}
                                placeholder="e.g. Paper jammed on printer, re-issued on next leaf"
                            />
                        </div>

                        {isDeposited && (
                            <label className="flex items-start gap-2 p-2.5 bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-900/40 rounded-lg text-xs text-warning-900 dark:text-warning-300 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={confirmRecoveredOrStopped}
                                    onChange={(e) => setConfirmRecoveredOrStopped(e.target.checked)}
                                    className="mt-0.5 rounded text-warning-600 focus:ring-warning-500"
                                />
                                <span>
                                    I confirm that deposited cheque <strong>#{chequeNoDisplay}</strong> has been physically recovered or stopped at the bank before issuing this replacement.
                                </span>
                            </label>
                        )}
                    </div>

                    <div className="p-3 bg-warning-50/80 dark:bg-warning-900/15 border border-warning-200 dark:border-warning-900/40 rounded-lg text-[11px] text-warning-900 dark:text-warning-300">
                        Old cheque <strong>#{chequeNoDisplay}</strong> will be marked <strong>REPLACED</strong> (its number stays reserved) and bill allocations will move to <strong>#{newChequeNumber || '…'}</strong>.
                    </div>

                    <div className="flex justify-end gap-2 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-xs font-semibold text-gray-600 dark:text-slate-300 bg-gray-100 dark:bg-slate-700 hover:bg-gray-200 dark:hover:bg-slate-600 rounded-lg cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting || (replaceRule && !replaceRule.allowed)}
                            className="px-4 py-2 text-xs font-bold text-white bg-warning-600 hover:bg-warning-700 rounded-lg shadow-xs cursor-pointer disabled:opacity-50"
                        >
                            {submitting ? 'Issuing Replacement…' : 'Issue Replacement'}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
};

export default ReplaceChequeModal;
