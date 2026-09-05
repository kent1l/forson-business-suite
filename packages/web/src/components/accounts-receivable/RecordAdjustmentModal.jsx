import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import MathExpressionInput from '../ui/MathExpressionInput';
import LoadingState from '../ui/LoadingState';
import EmptyState from '../ui/EmptyState';
import { formatCurrency } from '../../utils/currency';
import { useSettings } from '../../contexts/SettingsContext';

/**
 * Records a standalone A/R concession — a balance written down with no payment
 * attached: bad debt, a dispute settled, a billing error the customer never
 * returned goods for.
 *
 * The thing this screen is built to prevent is a floating credit. Every peso
 * has to land on a named invoice, so the form is invoice-first: pick the
 * invoices, type what is being forgiven on each, and the document total is
 * whatever those add up to. There is no "total" field to type into, because a
 * total that does not reconcile to specific invoices is exactly the broken
 * free-text adjustment this replaces.
 *
 * A discount granted *while collecting* is not this form — it belongs in the
 * payment modal, so the cash and the concession are one transaction.
 */

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
const MIN_NOTE_LENGTH = 10;

const RecordAdjustmentModal = ({ isOpen, onClose, customer, onSaved }) => {
    const { settings } = useSettings();
    const confirmPercent = Number(settings?.AR_ADJUSTMENT_CONFIRM_PERCENT ?? 10);

    const [invoices, setInvoices] = useState([]);
    const [reasons, setReasons] = useState([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    const [amounts, setAmounts] = useState({});   // invoice_id -> string
    const [reasonCode, setReasonCode] = useState('');
    const [notes, setNotes] = useState('');
    const [confirming, setConfirming] = useState(false);

    // A fresh idempotency key per opening of the form. A double-click or a retry
    // after a dropped connection then returns the document the first attempt
    // created instead of forgiving the balance twice.
    const [clientRef, setClientRef] = useState(null);

    const customerId = customer?.customer_id;

    useEffect(() => {
        if (!isOpen || !customerId) return;
        setLoading(true);
        setAmounts({});
        setNotes('');
        setConfirming(false);
        setClientRef(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);

        Promise.all([
            api.get(`/ar/customers/${customerId}/adjustable-invoices`),
            api.get('/ar/adjustment-reasons', { params: { applies_to: 'WRITE_DOWN' } }),
        ])
            .then(([invRes, reasonRes]) => {
                setInvoices(invRes.data || []);
                setReasons(reasonRes.data || []);
                setReasonCode(prev => prev || (reasonRes.data || [])[0]?.reason_code || '');
            })
            .catch(() => {
                setInvoices([]);
                setReasons([]);
                toast.error('Could not load this customer’s open invoices.');
            })
            .finally(() => setLoading(false));
    }, [isOpen, customerId]);

    const selectedReason = useMemo(
        () => reasons.find(r => r.reason_code === reasonCode) || null,
        [reasons, reasonCode]
    );

    const allocations = useMemo(
        () => invoices
            .map(inv => ({ invoice_id: inv.invoice_id, amount: round2(parseFloat(amounts[inv.invoice_id]) || 0) }))
            .filter(a => a.amount > 0),
        [invoices, amounts]
    );

    const total = useMemo(() => round2(allocations.reduce((s, a) => s + a.amount, 0)), [allocations]);

    // Mirrors the server's rules so the button explains itself rather than
    // letting the user find out by being rejected.
    const problems = useMemo(() => {
        const list = [];
        if (allocations.length === 0) {
            list.push('Enter an amount against at least one invoice.');
        }
        for (const inv of invoices) {
            const amt = round2(parseFloat(amounts[inv.invoice_id]) || 0);
            if (amt > Number(inv.outstanding) + 0.005) {
                list.push(`${inv.invoice_number}: ${formatCurrency(amt)} is more than the ${formatCurrency(inv.outstanding)} still outstanding.`);
            }
        }
        if (!reasonCode) list.push('Choose a reason.');
        if (selectedReason?.max_amount != null && total > Number(selectedReason.max_amount) + 0.005) {
            list.push(`${selectedReason.label} is capped at ${formatCurrency(selectedReason.max_amount)}.`);
        }
        if (selectedReason?.requires_note && notes.trim().length < MIN_NOTE_LENGTH) {
            list.push(`${selectedReason.label} needs a note of at least ${MIN_NOTE_LENGTH} characters.`);
        }
        return list;
    }, [allocations, invoices, amounts, reasonCode, selectedReason, notes, total]);

    // A concession worth a large share of an invoice is worth a second look —
    // a speed bump against a mis-keyed amount, not an approval gate.
    const needsConfirm = useMemo(() => {
        if (!confirmPercent) return false;
        return invoices.some(inv => {
            const amt = round2(parseFloat(amounts[inv.invoice_id]) || 0);
            const outstanding = Number(inv.outstanding) || 0;
            return amt > 0 && outstanding > 0 && (amt / outstanding) * 100 > confirmPercent;
        });
    }, [invoices, amounts, confirmPercent]);

    const setAmount = (invoiceId, value) => {
        setAmounts(prev => ({ ...prev, [invoiceId]: value }));
        setConfirming(false);
    };

    const writeOffWhole = (inv) => setAmount(inv.invoice_id, String(Number(inv.outstanding).toFixed(2)));

    const submit = useCallback(async () => {
        if (problems.length > 0 || saving) return;
        if (needsConfirm && !confirming) { setConfirming(true); return; }

        setSaving(true);
        try {
            const { data } = await api.post('/ar/adjustments', {
                customer_id: customerId,
                adjustment_type: 'BALANCE_WRITE_DOWN',
                reason_code: reasonCode,
                notes: notes.trim() || null,
                client_ref: clientRef,
                allocations,
            });
            toast.success(`${data.adjustment_no} recorded — ${formatCurrency(data.total_amount)} written down.`);
            onSaved?.(data);
            onClose?.();
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to record the adjustment.');
            setConfirming(false);
        } finally {
            setSaving(false);
        }
    }, [problems, saving, needsConfirm, confirming, customerId, reasonCode, notes, clientRef, allocations, onSaved, onClose]);

    const customerName = customer?.name
        || customer?.company_name
        || [customer?.first_name, customer?.last_name].filter(Boolean).join(' ')
        || 'Customer';

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Record Balance Adjustment"
            maxWidth="max-w-3xl"
        >
            <div className="space-y-5">
                <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/60 p-3">
                    <p className="text-sm text-amber-900 dark:text-amber-200">
                        This writes down what <span className="font-semibold">{customerName}</span> owes without any
                        money being received. It is not a payment and will not appear in collections.
                    </p>
                    <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-1">
                        To grant a discount while collecting a payment, use Receive Payment instead so the cash and the
                        concession are recorded together.
                    </p>
                </div>

                {loading ? (
                    <LoadingState label="Loading open invoices…" />
                ) : invoices.length === 0 ? (
                    <EmptyState
                        title="Nothing outstanding"
                        description="This customer has no invoices with a balance to write down."
                    />
                ) : (
                    <>
                        <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                            <table className="w-full text-sm">
                                <thead className="text-xs uppercase bg-gray-100 dark:bg-slate-700/50 text-gray-600 dark:text-slate-300">
                                    <tr>
                                        <th className="px-4 py-2.5 text-left">Invoice</th>
                                        <th className="px-4 py-2.5 text-left">Date</th>
                                        <th className="px-4 py-2.5 text-right">Outstanding</th>
                                        <th className="px-4 py-2.5 text-right">Write Down</th>
                                        <th className="px-4 py-2.5"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-slate-700/60">
                                    {invoices.map(inv => {
                                        const amt = round2(parseFloat(amounts[inv.invoice_id]) || 0);
                                        const over = amt > Number(inv.outstanding) + 0.005;
                                        return (
                                            <tr key={inv.invoice_id} className="text-gray-800 dark:text-slate-200">
                                                <td className="px-4 py-2.5 font-mono text-xs font-semibold">{inv.invoice_number}</td>
                                                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                                                    {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : '—'}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono">{formatCurrency(inv.outstanding)}</td>
                                                <td className="px-4 py-2.5 text-right">
                                                    <MathExpressionInput
                                                        value={amounts[inv.invoice_id] ?? ''}
                                                        onChange={(val) => setAmount(inv.invoice_id, val)}
                                                        precision={2}
                                                        placeholder="0.00"
                                                        className={`w-32 text-right font-mono px-2 py-1 rounded border bg-white dark:bg-slate-900 ${
                                                            over
                                                                ? 'border-red-400 dark:border-red-600 text-red-700 dark:text-red-300'
                                                                : 'border-gray-300 dark:border-slate-600'
                                                        }`}
                                                    />
                                                </td>
                                                <td className="px-4 py-2.5 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => writeOffWhole(inv)}
                                                        className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                                                    >
                                                        Whole balance
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                                <tfoot className="bg-gray-50 dark:bg-slate-800/70 border-t border-gray-200 dark:border-slate-700">
                                    <tr>
                                        <td colSpan={3} className="px-4 py-3 text-right text-xs uppercase font-semibold text-gray-500 dark:text-slate-400">
                                            Total written down
                                        </td>
                                        <td className="px-4 py-3 text-right font-mono font-bold text-gray-900 dark:text-slate-100">
                                            {formatCurrency(total)}
                                        </td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-slate-400 mb-1">
                                    Reason
                                </label>
                                <select
                                    value={reasonCode}
                                    onChange={(e) => { setReasonCode(e.target.value); setConfirming(false); }}
                                    className="w-full px-3 py-2 rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
                                >
                                    {reasons.map(r => (
                                        <option key={r.reason_code} value={r.reason_code}>{r.label}</option>
                                    ))}
                                </select>
                                {selectedReason?.description && (
                                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">{selectedReason.description}</p>
                                )}
                            </div>
                            <div>
                                <label className="block text-xs font-semibold uppercase text-gray-600 dark:text-slate-400 mb-1">
                                    Note {selectedReason?.requires_note && <span className="text-red-500">*</span>}
                                </label>
                                <textarea
                                    value={notes}
                                    onChange={(e) => { setNotes(e.target.value); setConfirming(false); }}
                                    rows={3}
                                    placeholder={selectedReason?.requires_note
                                        ? 'Why is this being written down? (required)'
                                        : 'Optional context for whoever reviews this later'}
                                    className="w-full px-3 py-2 rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-sm"
                                />
                            </div>
                        </div>

                        {problems.length > 0 && (
                            <ul className="text-xs text-red-600 dark:text-red-400 space-y-1 list-disc list-inside">
                                {problems.map((p, i) => <li key={i}>{p}</li>)}
                            </ul>
                        )}

                        {confirming && problems.length === 0 && (
                            <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/60 p-3">
                                <p className="text-sm font-semibold text-red-900 dark:text-red-200">
                                    Write down {formatCurrency(total)}?
                                </p>
                                <p className="text-xs text-red-800/80 dark:text-red-300/80 mt-1">
                                    This is more than {confirmPercent}% of an invoice&rsquo;s balance. It can be reversed
                                    afterwards, but both the adjustment and its reversal stay on the customer&rsquo;s statement.
                                    Press Record again to confirm.
                                </p>
                            </div>
                        )}
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
                        disabled={problems.length > 0 || saving || loading || invoices.length === 0}
                        className="px-4 py-2 rounded text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-slate-700 disabled:cursor-not-allowed"
                    >
                        {saving ? 'Recording…' : confirming ? `Confirm ${formatCurrency(total)}` : 'Record Adjustment'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

export default RecordAdjustmentModal;
