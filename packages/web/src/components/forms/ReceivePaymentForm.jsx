import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { formatCurrency as currency } from '../../utils/currency';
import Icon from '../ui/Icon';
import InfoTip from '../ui/InfoTip';
import MathExpressionInput from '../ui/MathExpressionInput';
import { ICONS } from '../../constants';
import { allocateCash, withheldFor as computeWithheld, cashCapFor as computeCashCap } from '../../utils/withholdingSettlement';

const ReceivePaymentForm = ({ customer, onSave, onCancel }) => {
    const [unpaidInvoices, setUnpaidInvoices] = useState([]);
    const [enabledMethods, setEnabledMethods] = useState([]);
    const [walletBalance, setWalletBalance] = useState(0);
    const [splits, setSplits] = useState([
        { id: 1, method_id: null, amount: '', reference: '', cheque_date: '' }
    ]);
    const [physicalReceiptNo, setPhysicalReceiptNo] = useState('');
    const [notes, setNotes] = useState('');
    const [allocations, setAllocations] = useState({});
    // Expected withholding per invoice, from the server. Keyed by invoice_id.
    const [withholdingByInvoice, setWithholdingByInvoice] = useState({});
    // Only the amounts the clerk has typed over. Everything else stays derived, so a
    // change to the allocation keeps flowing through to the deduction.
    const [withheldOverrides, setWithheldOverrides] = useState({});

    // Derived totals
    const totalSplitAmount = useMemo(() => splits.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0), [splits]);
    const totalAllocated = useMemo(() => Object.values(allocations).reduce((sum, val) => sum + (parseFloat(val) || 0), 0), [allocations]);
    const overpaymentAmount = useMemo(() => Math.max(0, totalSplitAmount - totalAllocated), [totalSplitAmount, totalAllocated]);
    const unallocatedDeficit = useMemo(() => Math.max(0, totalAllocated - totalSplitAmount), [totalSplitAmount, totalAllocated]);

    // Initial state snapshot for dirty check
    const initialFormData = useMemo(() => ({
        splits: [{ id: 1, method_id: null, amount: '', reference: '', cheque_date: '' }],
        physicalReceiptNo: '',
        notes: '',
        allocations: {}
    }), []);

    const isFormDirty = useMemo(() => {
        const currentData = { splits, physicalReceiptNo, notes, allocations };
        return JSON.stringify(currentData) !== JSON.stringify(initialFormData);
    }, [splits, physicalReceiptNo, notes, allocations, initialFormData]);

    const isFormElement = (element) => element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');

    // Load unpaid invoices & wallet info
    useEffect(() => {
        if (!customer?.customer_id) return;
        api.get(`/customers/${customer.customer_id}/unpaid-invoices`).then(res => setUnpaidInvoices(res.data || [])).catch(() => setUnpaidInvoices([]));
        api.get(`/customers/${customer.customer_id}/wallet`).then(res => setWalletBalance(res.data?.balance || 0)).catch(() => setWalletBalance(0));
        // Empty for an ordinary customer, so the whole withholding UI keys off the
        // payload rather than re-checking the flag in half a dozen places.
        api.get(`/withholding/customers/${customer.customer_id}/expected`)
            .then(res => setWithholdingByInvoice(
                Object.fromEntries((res.data || []).map(w => [String(w.invoice_id), w]))
            ))
            .catch(() => setWithholdingByInvoice({}));
    }, [customer]);

    // Load enabled payment methods
    useEffect(() => {
        api.get('/payment-methods/enabled').then(res => {
            const methods = (res.data || []).filter(m => m.enabled);
            setEnabledMethods(methods);
            setSplits((prev) => prev.map((s) => ({ ...s, method_id: s.method_id ?? methods[0]?.method_id ?? null })));
        }).catch(() => setEnabledMethods([]));
    }, []);

    const hasWithholding = useMemo(() => Object.keys(withholdingByInvoice).length > 0, [withholdingByInvoice]);

    /**
     * Tax deducted for one invoice, given the cash applied to it.
     *
     * Delegates to the shared rules in utils/withholdingSettlement.js so the form and
     * its tests can never drift apart. Only the manual override lives here, because
     * that is UI state rather than arithmetic.
     */
    const withheldFor = useCallback((inv) => {
        const key = String(inv.invoice_id);
        if (withheldOverrides[key] !== undefined) return parseFloat(withheldOverrides[key]) || 0;
        return computeWithheld(inv, withholdingByInvoice[key], parseFloat(allocations[inv.invoice_id]) || 0);
    }, [withholdingByInvoice, withheldOverrides, allocations]);

    const autoAllocate = useCallback((amount) => {
        const next = allocateCash(unpaidInvoices, amount, withholdingByInvoice);
        setAllocations(Object.fromEntries(
            Object.entries(next).map(([id, val]) => [id, val.toFixed(2)])
        ));
    }, [unpaidInvoices, withholdingByInvoice]);

    useEffect(() => {
        autoAllocate(totalSplitAmount);
    }, [totalSplitAmount, autoAllocate]);

    // The cash a withholding customer is expected to send: every open invoice
    // settled, less the tax they will deduct.
    //
    // Shown as guidance only -- deliberately NOT written into the amount field. The
    // amount received is an observation of the cheque in the clerk's hand, not
    // something the system is entitled to assert. Prefilling it invites the figure to
    // be accepted unread, and a wrong amount accepted unread is a receivable settled
    // against money that never arrived.
    const expectedNetCash = useMemo(
        () => Math.round(unpaidInvoices.reduce(
            (sum, inv) => sum + computeCashCap(inv, withholdingByInvoice[String(inv.invoice_id)]), 0
        ) * 100) / 100,
        [unpaidInvoices, withholdingByInvoice]
    );

    const handleAllocationChange = (invoiceId, value) => {
        setAllocations(a => ({ ...a, [invoiceId]: value }));
    };

    const handleWithheldChange = (invoiceId, value) => {
        setWithheldOverrides(w => ({ ...w, [String(invoiceId)]: value }));
    };

    // Only invoices actually being settled carry a deduction.
    const withholdingRows = useMemo(
        () => unpaidInvoices
            .filter(inv => withholdingByInvoice[String(inv.invoice_id)])
            .map(inv => ({ inv, withheld: withheldFor(inv) }))
            .filter(r => r.withheld > 0),
        [unpaidInvoices, withholdingByInvoice, withheldFor]
    );

    const totalWithheld = useMemo(
        () => Math.round(withholdingRows.reduce((sum, r) => sum + r.withheld, 0) * 100) / 100,
        [withholdingRows]
    );

    const withholdingPayload = useMemo(
        () => withholdingRows.map(r => ({ invoice_id: r.inv.invoice_id, amount_withheld: r.withheld })),
        [withholdingRows]
    );

    const addSplit = () => {
        const nextId = (splits[splits.length - 1]?.id || 0) + 1;
        const defaultMethod = enabledMethods[0]?.method_id ?? null;
        setSplits([...splits, { id: nextId, method_id: defaultMethod, amount: '', reference: '', cheque_date: '' }]);
    };
    const removeSplit = (id) => setSplits(splits.filter(s => s.id !== id));
    const updateSplit = (id, patch) => setSplits(splits.map(s => s.id === id ? { ...s, ...patch } : s));

    const methodById = (id) => enabledMethods.find(m => String(m.method_id) === String(id));

    // Validation
    const validateBeforeSubmit = useCallback(() => {
        if (!customer?.customer_id) {
            toast.error('Missing customer.');
            return false;
        }
        if (splits.length === 0) {
            toast.error('Add at least one payment method.');
            return false;
        }
        for (const s of splits) {
            const method = methodById(s.method_id);
            if (!method) {
                toast.error('Select a valid payment method.');
                return false;
            }
            const amt = parseFloat(s.amount);
            if (!Number.isFinite(amt) || amt <= 0) {
                toast.error('Payment amounts must be positive.');
                return false;
            }
            if (method.code === 'store_wallet' && amt > walletBalance) {
                toast.error(`Insufficient store wallet balance (${currency(walletBalance)}) for this payment.`);
                return false;
            }
            if (method.config?.requires_reference && !s.reference?.trim()) {
                toast.error(`Reference / Cheque # is required for ${method.name}.`);
                return false;
            }
        }
        return true;
    }, [customer?.customer_id, splits, enabledMethods, walletBalance]);

    // Submit: one POST /payments call per split line (payment instrument).
    // A single cheque → one customer_payment row → one PDC desk entry (not one per invoice).
    const submitPayments = useCallback(async () => {
        const invoices = unpaidInvoices
            .map(inv => ({
                invoice_id: inv.invoice_id,
                allocated: parseFloat(allocations[inv.invoice_id]) || 0,
                remaining: parseFloat(allocations[inv.invoice_id]) || 0,
            }))
            .filter(inv => inv.allocated > 0);

        let withholdingSent = false;

        for (const s of splits) {
            const lineAmount = parseFloat(s.amount) || 0;
            if (lineAmount <= 0) continue;

            // Distribute this split line's amount across invoices proportionally
            let toDistribute = lineAmount;
            const lineAllocations = [];

            for (const inv of invoices) {
                if (toDistribute <= 0.005) break;
                if (inv.remaining <= 0) continue;
                const portion = parseFloat(Math.min(toDistribute, inv.remaining).toFixed(2));
                lineAllocations.push({ invoice_id: inv.invoice_id, amount_allocated: portion });
                inv.remaining -= portion;
                toDistribute -= portion;
            }

            await api.post('/payments', {
                customer_id: customer.customer_id,
                amount: lineAmount,
                method_id: s.method_id,
                reference: s.reference || null,
                cheque_date: s.cheque_date || null,
                notes: notes || null,
                physical_receipt_no: physicalReceiptNo || null,
                allocations: lineAllocations,
                // Attached to the first instrument only. The deduction belongs to the
                // collection as a whole, not to any one cheque, and repeating it on
                // each split line would record the same withheld peso several times.
                withholding: withholdingSent ? [] : withholdingPayload,
            });
            withholdingSent = true;
        }
    }, [unpaidInvoices, allocations, splits, physicalReceiptNo, notes, customer?.customer_id, withholdingPayload]);

    const handleSubmit = useCallback(async (e) => {
        if (e) e.preventDefault();
        try {
            if (!validateBeforeSubmit()) return;
            await toast.promise(
                submitPayments(),
                {
                    loading: 'Processing payment receipt...',
                    success: 'Payment receipt processed successfully!',
                    error: (e) => e?.response?.data?.message || 'Failed to process payment.'
                }
            );
            onSave();
        } catch (err) {
            console.error('AR receive payment submit error:', err);
        }
    }, [validateBeforeSubmit, submitPayments, onSave]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target && isFormElement(e.target)) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); handleSubmit(); }
            else if (e.key === 'Escape') {
                if (isFormDirty) {
                    const confirmCancel = window.confirm('You have unsaved changes. Are you sure you want to cancel?');
                    if (!confirmCancel) return;
                }
                onCancel();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleSubmit, onCancel, isFormDirty]);

    const customerDisplayName = customer?.company_name || `${customer?.first_name || ''} ${customer?.last_name || ''}`;

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* Header Banner */}
            <div className="bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white p-5 rounded-2xl shadow-lg border border-slate-800 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-indigo-600/30 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-bold text-xl shadow-inner">
                        {customerDisplayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h3 className="text-lg font-bold text-white tracking-tight">{customerDisplayName}</h3>
                            <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                                ID #{customer?.customer_id}
                            </span>
                        </div>
                        <div className="mt-1 flex items-center gap-3 text-xs text-slate-300">
                            <span>Store Wallet Credit:</span>
                            <span className="font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                                {currency(walletBalance)}
                            </span>
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-3 w-full md:w-auto">
                    <div>
                        <label className="block text-[11px] font-medium text-slate-300 uppercase tracking-wider mb-1">Physical Receipt #</label>
                        <input
                            type="text"
                            value={physicalReceiptNo}
                            onChange={(e) => setPhysicalReceiptNo(e.target.value)}
                            className="w-44 px-3 py-1.5 bg-slate-800/80 border border-slate-700 rounded-lg text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all"
                            placeholder="e.g. OR-88491"
                        />
                    </div>
                </div>
            </div>

            {/* Quick Financial Summary Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Received</span>
                        <div className="text-lg font-bold font-mono text-slate-900 mt-0.5">{currency(totalSplitAmount)}</div>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center font-bold">
                        ₱
                    </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Allocated to Invoices</span>
                        <div className="text-lg font-bold font-mono text-emerald-700 mt-0.5">{currency(totalAllocated)}</div>
                    </div>
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <Icon path={ICONS.check} className="w-5 h-5" />
                    </div>
                </div>

                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                    <div>
                        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Store Wallet Deposit</span>
                        <div className={`text-lg font-bold font-mono mt-0.5 ${overpaymentAmount > 0 ? 'text-amber-600 font-extrabold' : 'text-slate-500'}`}>
                            {currency(overpaymentAmount)}
                        </div>
                    </div>
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${overpaymentAmount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'}`}>
                        <Icon path={ICONS.bank} className="w-5 h-5" />
                    </div>
                </div>
            </div>

            {/* Overpayment Prompt Banner */}
            {overpaymentAmount > 0 && (
                <div className="p-4 bg-amber-50/90 border border-amber-200 rounded-xl text-xs text-amber-900 flex items-start gap-3 shadow-sm animate-fade-in">
                    <Icon path={ICONS.info} className="w-5 h-5 shrink-0 text-amber-600" />
                    <div className="flex-1">
                        <span className="font-bold text-amber-950">Overpayment Detected: </span>
                        <span>
                            Total received amount exceeds invoice allocations by <strong>{currency(overpaymentAmount)}</strong>. This excess balance will be automatically deposited into <strong>{customerDisplayName}</strong>'s Store Wallet credit balance upon saving.
                        </span>
                    </div>
                </div>
            )}

            {unallocatedDeficit > 0 && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-center gap-2">
                    <Icon path={ICONS.warning} className="w-4 h-4 shrink-0 text-red-600" />
                    <span>Allocated invoice total exceeds payment received by <strong>{currency(unallocatedDeficit)}</strong>. Please adjust split payments or invoice allocations.</span>
                </div>
            )}

            {/* Main grid: Left (Payment Methods) | Right (Allocations) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* Left Column: Split Payment Methods */}
                <div className="lg:col-span-5 space-y-4">
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50/80 border-b border-slate-200">
                            <div>
                                <h4 className="text-sm font-bold text-slate-800">Payment Breakdown</h4>
                                <p className="text-[11px] text-slate-500">Multi-channel split payment lines</p>
                            </div>
                            <button
                                type="button"
                                onClick={addSplit}
                                className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-all flex items-center gap-1.5"
                            >
                                <span className="text-sm font-bold">+</span> Add Line
                            </button>
                        </div>

                        <div className="p-4 space-y-3">
                            {splits.map((s) => {
                                const m = methodById(s.method_id);
                                const refLabel = m?.config?.reference_label || 'Reference';
                                const showRef = m?.config?.requires_reference;
                                const isCheque = m?.code === 'cheque' || m?.code === 'pdc' || m?.type === 'cheque' || m?.name?.toLowerCase()?.includes('cheque');

                                return (
                                    <div
                                        key={s.id}
                                        className="p-3.5 bg-slate-50/60 border border-slate-200 hover:border-slate-300 rounded-xl space-y-3 transition-all"
                                    >
                                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                                            <div className="sm:col-span-6">
                                                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1 flex items-center gap-1">
                                                    Payment Method
                                                    <InfoTip label="Payment Method">
                                                        Cash and GCash post to the customer's balance immediately. Cheque and bank
                                                        transfer are recorded as <strong>pending</strong> until someone marks them
                                                        settled — the balance doesn't move for that portion until then.
                                                    </InfoTip>
                                                </label>
                                                <select
                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-medium text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-xs transition-all"
                                                    value={s.method_id ?? ''}
                                                    onChange={(e) => updateSplit(s.id, { method_id: e.target.value })}
                                                >
                                                    <option value="" disabled>Select method</option>
                                                    {enabledMethods.map(pm => (
                                                        <option key={pm.method_id} value={pm.method_id}>{pm.name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            <div className="sm:col-span-6">
                                                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">Amount</label>
                                                <div className="relative">
                                                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-xs font-bold text-slate-400">₱</span>
                                                    <MathExpressionInput
                                                        precision={2}
                                                        className="w-full pl-7 pr-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono font-bold text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-xs transition-all"
                                                        value={s.amount}
                                                        onChange={(val) => updateSplit(s.id, { amount: val })}
                                                        placeholder="0.00"
                                                    />
                                                </div>
                                            </div>

                                            <div className={isCheque ? "sm:col-span-6" : "sm:col-span-12"}>
                                                <label className="block text-[11px] font-semibold text-slate-600 uppercase tracking-wider mb-1">
                                                    {showRef ? refLabel : 'Reference / Ref #'}{showRef ? ' *' : ''}
                                                </label>
                                                <input
                                                    type="text"
                                                    className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-sm font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-xs transition-all"
                                                    value={s.reference}
                                                    onChange={(e) => updateSplit(s.id, { reference: e.target.value })}
                                                    placeholder={showRef ? 'Required (e.g. Cheque #)' : 'Optional'}
                                                />
                                            </div>

                                            {isCheque && (
                                                <div className="sm:col-span-6">
                                                    <label className="block text-[11px] font-bold text-indigo-900 uppercase tracking-wider mb-1 flex items-center gap-1">
                                                        <Icon path={ICONS.calendar} className="w-3 h-3" /> Date on Cheque (Maturity)
                                                    </label>
                                                    <input
                                                        type="date"
                                                        className="w-full px-3 py-2 bg-indigo-50/60 border border-indigo-300 rounded-lg text-sm font-semibold text-indigo-950 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 shadow-xs transition-all"
                                                        value={s.cheque_date || ''}
                                                        onChange={(e) => updateSplit(s.id, { cheque_date: e.target.value })}
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        {splits.length > 1 && (
                                            <div className="flex justify-end pt-1 border-t border-slate-200/60">
                                                <button
                                                    type="button"
                                                    onClick={() => removeSplit(s.id)}
                                                    className="text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2.5 py-1 rounded-md transition-all"
                                                >
                                                    Remove Line
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {/* Right Column: Invoice Allocations */}
                <div className="lg:col-span-7 space-y-4">
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-3.5 bg-slate-50/80 border-b border-slate-200">
                            <div>
                                <h4 className="text-sm font-bold text-slate-800">Invoice Allocations</h4>
                                <p className="text-[11px] text-slate-500">Apply payment across outstanding balance due</p>
                            </div>
                            <div className="flex gap-2">
                                <button
                                    type="button"
                                    className="text-xs font-semibold px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 transition-all"
                                    onClick={() => autoAllocate(totalSplitAmount)}
                                >
                                    Auto-fill
                                </button>
                                <button
                                    type="button"
                                    className="text-xs font-semibold px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg border border-slate-300 transition-all"
                                    onClick={() => setAllocations({})}
                                >
                                    Clear
                                </button>
                            </div>
                        </div>

                        {hasWithholding && (
                            <div className="mx-5 mt-4 p-3 rounded-xl bg-sky-50 border border-sky-200">
                                <div className="flex items-start justify-between gap-4 flex-wrap">
                                    <div>
                                        <div className="text-xs font-bold uppercase tracking-wider text-sky-800 flex items-center gap-1">
                                            Tax withheld at source
                                            <InfoTip label="Tax withheld at source">
                                                This customer deducts tax from what they pay and remits it to BIR under our TIN. The invoice is still settled in full &mdash; partly by cash, partly by the BIR certificate they will issue. Each amount is prefilled from that invoice&rsquo;s VAT-exclusive base, and prorated if you are only settling part of the balance; adjust it to match what they actually deducted.
                                            </InfoTip>
                                        </div>
                                        <p className="text-[11px] text-sky-700 mt-0.5 leading-snug">
                                            Enter the cash you actually received; the deduction below follows from it.
                                            {expectedNetCash > 0 && (
                                                <> If they withhold in full, expect <span className="font-mono font-semibold">{currency(expectedNetCash)}</span>.</>
                                            )}
                                        </p>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[11px] text-sky-700">Invoices settled</div>
                                        <div className="text-lg font-bold text-sky-900 font-mono">
                                            {currency(totalAllocated + totalWithheld)}
                                        </div>
                                        <div className="text-[11px] text-sky-700 font-mono">
                                            {currency(totalAllocated)} cash + {currency(totalWithheld)} withheld
                                        </div>
                                    </div>
                                </div>
                                {/* Recording no deduction for a withholding customer is a
                                    real outcome, not an empty state -- it means they paid
                                    gross this time. Said out loud, because the alternative
                                    is a clerk who typed the invoice total by habit and
                                    never notices the certificate has gone missing. */}
                                {totalAllocated > 0 && totalWithheld === 0 && (
                                    <div className="mt-2 pt-2 border-t border-sky-200 text-[11px] text-amber-800">
                                        <strong>No tax withheld on this payment.</strong> The cash entered covers the
                                        balance in full, so no BIR certificate will be expected. Expected net cash if
                                        they do withhold: <span className="font-mono">{currency(expectedNetCash)}</span>.
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="p-0">
                            <div className="hidden md:grid grid-cols-12 gap-3 px-5 py-2.5 bg-slate-100/70 text-[11px] font-bold uppercase tracking-wider text-slate-600 border-b border-slate-200">
                                <div className={hasWithholding ? 'col-span-4' : 'col-span-6'}>Invoice #</div>
                                <div className="col-span-2 text-right">Balance Due</div>
                                {hasWithholding && <div className="col-span-3">Tax Withheld</div>}
                                <div className={hasWithholding ? 'col-span-3' : 'col-span-4'}>Cash Applied</div>
                            </div>

                            <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                                {unpaidInvoices.map(inv => {
                                    const balance = parseFloat(inv.balance_due) || 0;
                                    const allocVal = parseFloat(allocations[inv.invoice_id]) || 0;
                                    const wt = withholdingByInvoice[String(inv.invoice_id)];
                                    const withheldValue = withheldFor(inv);
                                    // Cash plus tax cannot settle more than is owed, and the
                                    // deduction itself cannot exceed what could plausibly be
                                    // withheld -- the server rejects both.
                                    const over = allocVal + withheldValue > balance + 0.01;
                                    const overWithheld = !!wt && withheldValue > Number(wt.ceiling) + 0.01;

                                    return (
                                        <div key={inv.invoice_id} className="grid grid-cols-12 gap-3 items-center px-5 py-3.5 hover:bg-slate-50/70 transition-all">
                                            <div className={`col-span-12 ${hasWithholding ? 'md:col-span-4' : 'md:col-span-6'}`}>
                                                <div className="text-sm font-bold text-slate-900">{inv.invoice_number}</div>
                                                <div className="text-xs text-slate-500">
                                                    Date: {inv.invoice_date ? new Date(inv.invoice_date).toLocaleDateString() : 'N/A'}
                                                </div>
                                                {wt && (
                                                    <div className="text-[11px] text-sky-700 mt-0.5">
                                                        {wt.components.map(c => `${c.atc_code} ${(c.rate_snapshot * 100).toFixed(0)}%`).join(' + ')} on {currency(wt.base)}
                                                    </div>
                                                )}
                                            </div>

                                            <div className="hidden md:block md:col-span-2 text-right text-sm font-mono font-bold text-slate-800">
                                                {currency(balance)}
                                            </div>

                                            {hasWithholding && (
                                                <div className="col-span-12 md:col-span-3">
                                                    {wt ? (
                                                        <div className="relative">
                                                            <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-xs font-bold text-sky-500">₱</span>
                                                            <MathExpressionInput
                                                                precision={2}
                                                                className={`w-full pl-6 pr-2.5 py-1.5 border rounded-lg text-sm font-mono font-bold transition-all ${
                                                                    overWithheld
                                                                        ? 'border-red-300 bg-red-50 text-red-900 focus:ring-red-400'
                                                                        : 'border-sky-300 bg-sky-50 text-sky-900 focus:ring-sky-500 focus:border-sky-500'
                                                                }`}
                                                                value={withheldOverrides[String(inv.invoice_id)] !== undefined
                                                                    ? withheldOverrides[String(inv.invoice_id)]
                                                                    : (withheldValue ? withheldValue.toFixed(2) : '')}
                                                                onChange={(val) => handleWithheldChange(inv.invoice_id, val)}
                                                                placeholder="0.00"
                                                            />
                                                        </div>
                                                    ) : (
                                                        <span className="text-xs text-slate-400">&mdash;</span>
                                                    )}
                                                </div>
                                            )}

                                            <div className={`col-span-12 ${hasWithholding ? 'md:col-span-3' : 'md:col-span-4'}`}>
                                                <div className="relative">
                                                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center text-xs font-bold text-slate-400">₱</span>
                                                    <MathExpressionInput
                                                        precision={2}
                                                        className={`w-full pl-6 pr-2.5 py-1.5 border rounded-lg text-sm font-mono font-bold transition-all ${
                                                            over
                                                                ? 'border-red-300 bg-red-50 text-red-900 focus:ring-red-400'
                                                                : 'border-slate-300 bg-white text-slate-900 focus:ring-indigo-500 focus:border-indigo-500'
                                                        }`}
                                                        value={allocations[inv.invoice_id] || ''}
                                                        onChange={(val) => handleAllocationChange(inv.invoice_id, val)}
                                                        placeholder="0.00"
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}

                                {unpaidInvoices.length === 0 && (
                                    <div className="p-8 text-center text-sm text-slate-500">
                                        No outstanding unpaid invoices found for this customer.
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Notes Box */}
                    <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-4">
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">Receipt Notes (optional)</label>
                        <textarea
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all placeholder-slate-400"
                            rows={2}
                            placeholder="Add internal notes or memo regarding this payment..."
                        />
                    </div>
                </div>
            </div>

            {/* Actions Bar */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-200">
                <div className="text-xs text-slate-500 flex items-center gap-3">
                    <span>Press <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">Ctrl + S</kbd> to submit</span>
                    <span>•</span>
                    <span>Press <kbd className="px-1.5 py-0.5 bg-slate-100 border border-slate-300 rounded text-[10px] font-mono">Esc</kbd> to cancel</span>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        type="button"
                        onClick={onCancel}
                        className="px-5 py-2.5 border border-slate-300 rounded-xl text-sm font-semibold text-slate-700 hover:bg-slate-50 transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-md hover:shadow-lg transition-all"
                    >
                        Process & Save Payment
                    </button>
                </div>
            </div>
        </form>
    );
};

export default ReceivePaymentForm;
