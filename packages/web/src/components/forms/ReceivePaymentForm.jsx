import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

// Utilities
const currency = (v) => `₱${(Number(v) || 0).toFixed(2)}`;

const ReceivePaymentForm = ({ customer, onSave, onCancel }) => {
    const [unpaidInvoices, setUnpaidInvoices] = useState([]);
    const [enabledMethods, setEnabledMethods] = useState([]);
    const [splits, setSplits] = useState([ // dynamic payment lines
        { id: 1, method_id: null, amount: '', reference: '' }
    ]);
    const [physicalReceiptNo, setPhysicalReceiptNo] = useState('');
    const [notes, setNotes] = useState('');
    const [allocations, setAllocations] = useState({}); // { invoice_id: amount }

    // Derived totals
    const totalSplitAmount = useMemo(() => splits.reduce((s, p) => s + (parseFloat(p.amount) || 0), 0), [splits]);
    const totalAllocated = useMemo(() => Object.values(allocations).reduce((sum, val) => sum + (parseFloat(val) || 0), 0), [allocations]);

    // Initial state snapshot for dirty check
    const initialFormData = useMemo(() => ({
        splits: [{ id: 1, method_id: null, amount: '', reference: '' }],
        physicalReceiptNo: '',
        notes: '',
        allocations: {}
    }), []);

    const isFormDirty = useMemo(() => {
        const currentData = { splits, physicalReceiptNo, notes, allocations };
        return JSON.stringify(currentData) !== JSON.stringify(initialFormData);
    }, [splits, physicalReceiptNo, notes, allocations, initialFormData]);

    const isFormElement = (element) => element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');

    // Load unpaid invoices for this customer
    useEffect(() => {
        if (!customer) return;
        api.get(`/customers/${customer.customer_id}/unpaid-invoices`).then(res => setUnpaidInvoices(res.data || [])).catch(() => setUnpaidInvoices([]));
    }, [customer]);

    // Load enabled payment methods
    useEffect(() => {
        api.get('/payment-methods/enabled').then(res => {
            const methods = (res.data || []).filter(m => m.enabled);
            setEnabledMethods(methods);
            // Set default method for first split if empty
            setSplits((prev) => prev.map((s) => ({ ...s, method_id: s.method_id ?? methods[0]?.method_id ?? null })));
        }).catch(() => setEnabledMethods([]));
    }, []);

    // Auto allocate by totalSplitAmount
    const autoAllocate = useCallback((amount) => {
        let remaining = amount;
        const next = {};
        for (const inv of unpaidInvoices) {
            if (remaining <= 0) break;
            const due = parseFloat(inv.balance_due) || 0;
            const add = Math.min(remaining, due);
            if (add > 0) next[inv.invoice_id] = add.toFixed(2);
            remaining -= add;
        }
        setAllocations(next);
    }, [unpaidInvoices]);

    // Keep allocations in sync with total split
    useEffect(() => {
        autoAllocate(totalSplitAmount);
    }, [totalSplitAmount, autoAllocate]);

    const handleAllocationChange = (invoiceId, value) => {
        const amt = parseFloat(value);
        setAllocations(a => ({ ...a, [invoiceId]: Number.isFinite(amt) ? value : '' }));
    };

    const addSplit = () => {
        const nextId = (splits[splits.length - 1]?.id || 0) + 1;
        const defaultMethod = enabledMethods[0]?.method_id ?? null;
        setSplits([...splits, { id: nextId, method_id: defaultMethod, amount: '', reference: '' }]);
    };
    const removeSplit = (id) => setSplits(splits.filter(s => s.id !== id));
    const updateSplit = (id, patch) => setSplits(splits.map(s => s.id === id ? { ...s, ...patch } : s));

    // Validation helpers
    const validateBeforeSubmit = useCallback(() => {
        if (!customer?.customer_id) {
            toast.error('Missing customer.');
            return false;
        }
        if (splits.length === 0) {
            toast.error('Add at least one payment.');
            return false;
        }
        // Validate splits
        for (const s of splits) {
            const method = enabledMethods.find(m => String(m.method_id) === String(s.method_id));
            if (!method) {
                toast.error('Select a valid payment method.');
                return false;
            }
            const amt = parseFloat(s.amount) || 0;
            if (amt <= 0) {
                toast.error('Each payment amount must be greater than 0.');
                return false;
            }
            const requiresRef = method?.config?.requires_reference;
            if (requiresRef && (!s.reference || String(s.reference).trim() === '')) {
                toast.error(`Reference is required for ${method.name}.`);
                return false;
            }
            const requiresReceipt = method?.config?.requires_receipt_no;
            if (requiresReceipt && (!physicalReceiptNo || String(physicalReceiptNo).trim() === '')) {
                toast.error(`Physical receipt number is required for ${method.name}.`);
                return false;
            }
        }
        // Validate allocations
        const overAllocated = unpaidInvoices.some(inv => (parseFloat(allocations[inv.invoice_id]) || 0) > (parseFloat(inv.balance_due) || 0) + 0.01);
        if (overAllocated) {
            toast.error('Cannot allocate more than the invoice balance.');
            return false;
        }
        const allocTotal = totalAllocated;
        if (Math.abs(allocTotal - totalSplitAmount) > 0.009) {
            toast.error('Allocated total must match total payment amount.');
            return false;
        }
        if (allocTotal <= 0) {
            toast.error('Allocate the payment to at least one invoice.');
            return false;
        }
        return true;
    }, [customer?.customer_id, splits, enabledMethods, physicalReceiptNo, unpaidInvoices, allocations, totalAllocated, totalSplitAmount]);

    // Distribute split payments across allocated invoices and call per-invoice API
    const submitPayments = useCallback(async () => {
        // Build an array of invoices with remaining allocation
        const invoices = unpaidInvoices
            .map(inv => ({ invoice_id: inv.invoice_id, remaining: parseFloat(allocations[inv.invoice_id]) || 0 }))
            .filter(x => x.remaining > 0);

        // Clone splits with remaining
        const lines = splits.map(s => ({
            method_id: s.method_id,
            amount_remaining: parseFloat(s.amount) || 0,
            reference: s.reference || null,
        })).filter(l => l.amount_remaining > 0);

        const perInvoicePayloads = new Map(); // invoice_id => payments[]

        for (const line of lines) {
            let toDistribute = line.amount_remaining;
            for (const inv of invoices) {
                if (toDistribute <= 0) break;
                if (inv.remaining <= 0) continue;
                const portion = Math.min(toDistribute, inv.remaining);
                const arr = perInvoicePayloads.get(inv.invoice_id) || [];
                arr.push({
                    method_id: line.method_id,
                    amount_paid: portion,
                    // Avoid tendered_amount to prevent change complexities across multiple invoices
                    reference: line.reference || null,
                    metadata: { ar_batch: true, customer_id: customer.customer_id }
                });
                perInvoicePayloads.set(inv.invoice_id, arr);
                inv.remaining -= portion;
                toDistribute -= portion;
            }
            if (toDistribute > 0.005) {
                throw new Error('Failed to distribute payment lines across invoices.');
            }
        }

        // Submit per invoice
        for (const [invoice_id, payments] of perInvoicePayloads.entries()) {
            await api.post(`/invoices/${invoice_id}/payments`, {
                payments,
                physical_receipt_no: physicalReceiptNo || null
            });
        }
    }, [unpaidInvoices, allocations, splits, physicalReceiptNo, customer?.customer_id]);

    const handleSubmit = useCallback(async (e) => {
        if (e) e.preventDefault();
        try {
            if (!validateBeforeSubmit()) return;
            await toast.promise(
                submitPayments(),
                {
                    loading: 'Processing payment...',
                    success: 'Payment processed successfully!',
                    error: (e) => e?.response?.data?.message || 'Failed to process payment.'
                }
            );
            onSave();
        } catch (err) {
            console.error('AR receive payment submit error:', err);
        }
    }, [validateBeforeSubmit, submitPayments, onSave]);

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

    // UI helpers
    const methodById = (id) => enabledMethods.find(m => String(m.method_id) === String(id));

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-gray-800">Receive Payment</h3>
                    <p className="text-sm text-gray-500">{customer?.company_name || `${customer?.first_name || ''} ${customer?.last_name || ''}`}</p>
                </div>
                <div className="flex items-center gap-3">
                    <div>
                        <label className="block text-xs font-medium text-gray-600">Physical Receipt No</label>
                        <input type="text" value={physicalReceiptNo} onChange={(e) => setPhysicalReceiptNo(e.target.value)} className="mt-1 w-48 px-3 py-2 border rounded-lg text-sm" placeholder="Optional" />
                    </div>
                </div>
            </div>

            {/* Split payments */}
            <div className="bg-gray-50 border rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-gray-700">Payment Methods</h4>
                    <button type="button" onClick={addSplit} className="text-xs px-2 py-1 bg-green-600 text-white rounded-md hover:bg-green-700">Add payment</button>
                </div>
                <div className="space-y-2">
                    {splits.map((s) => {
                        const m = methodById(s.method_id);
                        const refLabel = m?.config?.reference_label || 'Reference';
                        const showRef = m?.config?.requires_reference;
                        return (
                            <div key={s.id} className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end">
                                <div className="sm:col-span-5">
                                    <label className="block text-xs text-gray-600">Method</label>
                                    <select className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                                        value={s.method_id ?? ''}
                                        onChange={(e) => updateSplit(s.id, { method_id: e.target.value })}
                                    >
                                        <option value="" disabled>Select method</option>
                                        {enabledMethods.map(pm => (
                                            <option key={pm.method_id} value={pm.method_id}>{pm.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="sm:col-span-3">
                                    <label className="block text-xs text-gray-600">Amount</label>
                                    <input type="number" step="0.01" className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                                        value={s.amount}
                                        onChange={(e) => updateSplit(s.id, { amount: e.target.value })}
                                        placeholder="0.00" />
                                </div>
                                <div className="sm:col-span-3">
                                    <label className="block text-xs text-gray-600">{showRef ? refLabel : 'Reference'}{showRef ? ' *' : ''}</label>
                                    <input type="text" className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                                        value={s.reference}
                                        onChange={(e) => updateSplit(s.id, { reference: e.target.value })}
                                        placeholder={showRef ? 'Required' : 'Optional'} />
                                </div>
                                <div className="sm:col-span-1 flex justify-end">
                                    {splits.length > 1 && (
                                        <button type="button" onClick={() => removeSplit(s.id)} className="text-xs px-2 py-1 border rounded-md text-gray-600 hover:bg-gray-100">Remove</button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
                <div className="flex justify-between mt-3 text-sm font-medium">
                    <span>Total Payment</span>
                    <span>{currency(totalSplitAmount)}</span>
                </div>
            </div>

            {/* Allocate to invoices */}
            <div>
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-gray-700">Allocate to Invoices</h4>
                    <div className="flex gap-2">
                        <button type="button" className="text-xs px-2 py-1 border rounded-md hover:bg-gray-50" onClick={() => autoAllocate(totalSplitAmount)}>Auto-fill</button>
                        <button type="button" className="text-xs px-2 py-1 border rounded-md hover:bg-gray-50" onClick={() => setAllocations({})}>Clear</button>
                    </div>
                </div>
                <div className="max-h-64 overflow-y-auto border rounded-lg divide-y">
                    {unpaidInvoices.map(inv => (
                        <div key={inv.invoice_id} className="grid grid-cols-12 gap-3 items-center p-3">
                            <div className="col-span-6">
                                <div className="text-sm font-medium text-gray-800">{inv.invoice_number}</div>
                                <div className="text-xs text-gray-500">Balance: {currency(parseFloat(inv.balance_due))}</div>
                            </div>
                            <div className="col-span-6">
                                <label className="block text-xs text-gray-600">Amount to apply</label>
                                <input type="number" step="0.01" className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                                    value={allocations[inv.invoice_id] || ''}
                                    onChange={(e) => handleAllocationChange(inv.invoice_id, e.target.value)}
                                    placeholder="0.00" />
                            </div>
                        </div>
                    ))}
                </div>
                <div className="flex justify-between items-center font-semibold border-t pt-3 mt-3">
                    <span>Total Allocated</span>
                    <span>{currency(totalAllocated)}</span>
                </div>
                <div className="flex justify-between items-center font-semibold">
                    <span>Unallocated</span>
                    <span className={(totalSplitAmount - totalAllocated) !== 0 ? 'text-red-600' : ''}>{currency(totalSplitAmount - totalAllocated)}</span>
                </div>
            </div>

            {/* Notes */}
            <div>
                <label className="block text-sm font-medium text-gray-700">Notes (optional)</label>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded-lg text-sm" rows={2} placeholder="Add any notes for this receipt..." />
            </div>

            {/* Actions */}
            <div className="mt-2 flex justify-end gap-3">
                <button type="button" onClick={onCancel} className="px-4 py-2 border rounded-lg text-gray-700 hover:bg-gray-50">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50" disabled={totalSplitAmount <= 0}>
                    Receive Payment
                </button>
            </div>
        </form>
    );
};

export default ReceivePaymentForm;
