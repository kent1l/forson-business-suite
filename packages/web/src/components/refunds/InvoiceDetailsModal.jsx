import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import RefundForm from './RefundForm';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatPhysicalReceiptNumber } from '../../utils/receiptNumberFormatter';

// Helper function to get payment status badge styles
const getPaymentStatusBadge = (status) => {
    switch (status?.toLowerCase()) {
        case 'settled':
            return 'bg-green-100 text-green-800';
        case 'pending':
            return 'bg-yellow-100 text-yellow-800';
        case 'failed':
            return 'bg-red-100 text-red-800';
        default:
            return 'bg-gray-100 text-gray-800';
    }
};

// Helper function to format payment status for display
const formatPaymentStatus = (status) => {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
};

// Avoid linter warnings for unused imports in JSX
void React;
void Modal;
void RefundForm;

const InvoiceDetailsModal = ({ isOpen, onClose, invoice, onActionSuccess }) => {
    const { settings } = useSettings();
    const { hasPermission, user } = useAuth();
    const [lines, setLines] = useState([]);
    const [payments, setPayments] = useState([]);
    const [paymentsForbidden, setPaymentsForbidden] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showRefundForm, setShowRefundForm] = useState(false);
    const [isEditingReceiptNo, setIsEditingReceiptNo] = useState(false);
    const [editingReceiptNo, setEditingReceiptNo] = useState('');
    // Inline refund UI state
    const [refundLines, setRefundLines] = useState({}); // { [invoice_line_id]: quantity }
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [selectedMethodId, setSelectedMethodId] = useState('');
    const [reference, setReference] = useState('');
    const [loadingMethods, setLoadingMethods] = useState(false);

    useEffect(() => {
        if (!isOpen || !invoice) return;

        let cancelled = false;
        (async () => {
            setLoading(true);
            setShowRefundForm(false); // Reset on open
            setIsEditingReceiptNo(false); // Reset editing state
            setEditingReceiptNo(invoice.physical_receipt_no || ''); // Initialize with current value

            try {
                // Fetch lines first (this should rarely fail independently)
                const linesRes = await api.get(`/invoices/${invoice.invoice_id}/lines-with-refunds`);
                if (cancelled) return;
                setLines(linesRes.data || []);

                // Then attempt to fetch payments. If payments are forbidden (403) we surface a clear message
                try {
                    const paymentsRes = await api.get(`/invoices/${invoice.invoice_id}/payments`);
                    if (cancelled) return;
                    setPayments(paymentsRes.data || []);
                    setPaymentsForbidden(false);
                } catch (err) {
                    if (cancelled) return;
                    console.error('Failed to fetch payments', err);
                    const status = err?.response?.status;
                    if (status === 403) {
                        setPayments([]);
                        setPaymentsForbidden(true);
                        toast.error('You do not have permission to view payments for this invoice.');
                    } else {
                        setPayments([]);
                        setPaymentsForbidden(false);
                        toast.error('Failed to load payments for this invoice.');
                    }
                }
            } catch (err) {
                if (cancelled) return;
                console.error('Failed to load invoice details', err);
                toast.error('Failed to load invoice details.');
                setLines([]);
                setPayments([]);
                setPaymentsForbidden(false);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [isOpen, invoice]);

    // Fetch payment methods when entering refund mode
    useEffect(() => {
        if (!showRefundForm) return;
        let cancelled = false;
        (async () => {
            setLoadingMethods(true);
            try {
                const response = await api.get('/payment-methods/enabled');
                if (cancelled) return;
                setPaymentMethods(response.data || []);
            } catch (error) {
                if (cancelled) return;
                console.error('Failed to fetch payment methods:', error);
                toast.error('Failed to load payment methods');
                setPaymentMethods([]);
            } finally {
                if (!cancelled) setLoadingMethods(false);
            }
        })();
        return () => { cancelled = true; };
    }, [showRefundForm]);
    
    const handleRefundSuccess = () => {
        onClose(); // Close the modal
        onActionSuccess(); // Trigger a refresh on the parent page
        // Notify other parts of the app that invoices changed
        try {
            window.dispatchEvent(new CustomEvent('invoices:changed'));
        } catch {
            // ignore if window not available
        }
    };

    const handleDelete = async () => {
        if (!invoice) return;
        if (!window.confirm(`Delete Invoice #${invoice.invoice_number}? This cannot be undone and will restore stock quantities.`)) return;
        try {
            await api.delete(`/invoices/${invoice.invoice_id}`);
            toast.success('Invoice deleted');
            onClose();
            onActionSuccess();
            // Notify other parts of the app that invoices changed
            try {
                window.dispatchEvent(new CustomEvent('invoices:changed'));
            } catch {
                // ignore if window not available
            }
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to delete invoice');
        }
    };

    const handleEditReceiptNo = () => {
        setIsEditingReceiptNo(true);
    };

    const handleSaveReceiptNo = async () => {
        try {
            // Format the value immediately
            const formattedValue = formatPhysicalReceiptNumber(editingReceiptNo);

            // Send the request
            const response = await api.put(`/invoices/${invoice.invoice_id}/physical-receipt-no`, {
                physical_receipt_no: formattedValue
            });

            // Update the invoice object with the server response
            invoice.physical_receipt_no = response.data.physical_receipt_no;

            toast.success('Physical receipt number updated successfully');

            // Close immediately - no delay needed
            setIsEditingReceiptNo(false);
            onActionSuccess();

            // Notify other parts of the app that invoices changed
            try {
                window.dispatchEvent(new CustomEvent('invoices:changed'));
            } catch {
                // ignore if window not available
            }

        } catch (error) {
            const message = error.response?.data?.message || 'Failed to update physical receipt number';
            toast.error(message);
        }
    };    const handleCancelEditReceiptNo = () => {
        setEditingReceiptNo(invoice.physical_receipt_no || '');
        setIsEditingReceiptNo(false);
    };

    const handleMarkSettled = async (paymentId) => {
        try {
            await api.post(`/payments/${paymentId}/settle`);
            toast.success('Payment marked as settled');
            
            // Refresh payments data
            const paymentsRes = await api.get(`/invoices/${invoice.invoice_id}/payments`);
            setPayments(paymentsRes.data || []);
            
            // Trigger refresh on parent page
            onActionSuccess();
            
            // Notify other parts of the app that invoices changed
            try {
                window.dispatchEvent(new CustomEvent('invoices:changed'));
            } catch {
                // ignore if window not available
            }
        } catch (error) {
            const message = error.response?.data?.message || 'Failed to mark payment as settled';
            toast.error(message);
        }
    };

    // Inline refund handlers
    const handleRefundCheckboxChange = (lineId, checked) => {
        const line = lines.find(l => l.invoice_line_id === lineId);
        if (!line) return;
        const remaining = Math.max((Number(line.quantity) || 0) - (Number(line.quantity_refunded) || 0), 0);
        if (remaining <= 0) return;
        setRefundLines(prev => {
            const next = { ...prev };
            if (checked) next[lineId] = remaining; else delete next[lineId];
            return next;
        });
    };

    const handleRefundQtyChange = (lineId, value) => {
        const line = lines.find(l => l.invoice_line_id === lineId);
        if (!line) return;
        const remaining = Math.max((Number(line.quantity) || 0) - (Number(line.quantity_refunded) || 0), 0);
        const n = Math.max(0, Math.min(remaining, Number(value)));
        setRefundLines(prev => ({ ...prev, [lineId]: n }));
    };

    const totalRefundAmount = Object.entries(refundLines).reduce((sum, [id, qty]) => {
        const line = lines.find(l => l.invoice_line_id === Number(id));
        const price = Number(line?.sale_price) || 0;
        return sum + (Number(qty) || 0) * price;
    }, 0);

    const handleSubmitInlineRefund = async () => {
        const entries = Object.entries(refundLines).filter(([, q]) => Number(q) > 0);
        if (entries.length === 0) return toast.error('Select at least one item to refund.');
        if (!selectedMethodId) return toast.error('Please select a payment method for the refund.');
        if (!user?.employee_id) return toast.error('Cannot determine employee for refund.');

        const linesPayload = entries.map(([id, qty]) => {
            const line = lines.find(l => l.invoice_line_id === Number(id));
            return {
                part_id: line.part_id,
                quantity: Number(qty),
                sale_price: Number(line.sale_price)
            };
        });

        const payload = {
            invoice_id: invoice.invoice_id,
            invoice_number: invoice.invoice_number,
            employee_id: user.employee_id,
            lines: linesPayload,
            method_id: selectedMethodId ? parseInt(selectedMethodId) : null,
            reference: reference.trim() || null
        };

        try {
            const promise = api.post('/refunds', payload);
            await toast.promise(promise, {
                loading: 'Processing refund...',
                success: (res) => res.data?.message || 'Refund processed successfully!',
                error: (err) => err.response?.data?.message || 'Failed to process refund.'
            });
            // Success flow mirrors RefundForm
            handleRefundSuccess();
        } catch {
            // toast already handled in promise
        }
    };


    if (!isOpen || !invoice) return null;

    return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Details for Invoice #${invoice.invoice_number}`} maxWidth="max-w-4xl">
            {loading ? <p>Loading details...</p> : (
                <div className="space-y-5">
                    {/* Physical Receipt Number Editing Section - Only shown when editing */}
                    {isEditingReceiptNo && (
                        <div className="bg-cyan-50 p-4 rounded-lg border border-cyan-200 shadow-sm">
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-800 mb-2">
                                        Edit Physical Receipt No.
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={editingReceiptNo}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                // Instant formatting as user types
                                                const formatted = formatPhysicalReceiptNumber(value);
                                                if (formatted !== editingReceiptNo) {
                                                    setEditingReceiptNo(formatted || '');
                                                }
                                            }}
                                            onBlur={(e) => {
                                                // Ensure final formatting on blur
                                                const formatted = formatPhysicalReceiptNumber(e.target.value);
                                                setEditingReceiptNo(formatted || '');
                                            }}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 bg-white"
                                            placeholder="e.g., SI-1234, ABC/5678, or XYZ 9999"
                                            autoFocus
                                        />
                                        <span className="text-xs text-gray-500 whitespace-nowrap">
                                            Formats instantly as you type
                                        </span>
                                        <button
                                            onClick={handleSaveReceiptNo}
                                            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors duration-200 shadow-sm"
                                        >
                                            Save
                                        </button>
                                        <button
                                            onClick={handleCancelEditReceiptNo}
                                            className="bg-gray-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 transition-colors duration-200 shadow-sm"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Items with refund visualization */}
                    <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <h3 className="text-sm font-semibold text-gray-800">Items</h3>
                            {/* Legend */}
                            <div className="flex items-center justify-between gap-3">
                                <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
                                    <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-rose-300"></span> Refunded</span>
                                    <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-amber-300"></span> Partial</span>
                                    <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-emerald-300"></span> Remaining</span>
                                </div>
                                {showRefundForm && (
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="text-gray-600">Selected: <span className="font-semibold">{Object.values(refundLines).filter(q => Number(q) > 0).length}</span></span>
                                        <span className="hidden sm:inline text-gray-400">•</span>
                                        <span className="text-gray-600">Total: <span className="font-mono font-semibold">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{totalRefundAmount.toFixed(2)}</span></span>
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const next = {};
                                                for (const line of lines) {
                                                    const qty = Number(line.quantity) || 0;
                                                    const refunded = Number(line.quantity_refunded || 0);
                                                    const remain = Math.max(qty - refunded, 0);
                                                    if (remain > 0) next[line.invoice_line_id] = remain;
                                                }
                                                setRefundLines(next);
                                            }}
                                            className="ml-2 px-2 py-1 rounded border text-gray-700 hover:bg-gray-50"
                                        >
                                            Select All
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setRefundLines({})}
                                            className="px-2 py-1 rounded border text-gray-700 hover:bg-gray-50"
                                        >
                                            Clear
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <ul className="mt-3 divide-y divide-gray-100">
                            {lines.map((line) => {
                                const qty = Number(line.quantity) || 0;
                                const refunded = Number(line.quantity_refunded || 0);
                                const remaining = Math.max(qty - refunded, 0);
                                const refundedPct = qty > 0 ? Math.min(refunded / qty, 1) : 0;
                                const isFull = refunded >= qty && qty > 0;
                                const isPartial = refunded > 0 && refunded < qty;
                                // Chip styles for quick status glance
                                const chipClass = isFull
                                    ? 'bg-rose-100 text-rose-700 border border-rose-200'
                                    : isPartial
                                        ? 'bg-amber-100 text-amber-700 border border-amber-200'
                                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200';
                                const chipText = isFull ? 'Fully Refunded' : isPartial ? 'Partially Refunded' : 'Not Refunded';
                                return (
                                    <li key={line.invoice_line_id} className="py-3">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="text-sm font-medium text-gray-900 truncate">{line.display_name}</p>
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${chipClass}`}>{chipText}</span>
                                                </div>
                                                <div className="mt-1 text-xs text-gray-500">
                                                    {qty} x {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{(Number(line.sale_price) || 0).toFixed(2)}
                                                    {refunded > 0 && (
                                                        <span className="ml-2 inline-flex items-center gap-1 text-rose-700">
                                                            Refunded: <span className="font-mono">{refunded}</span>
                                                        </span>
                                                    )}
                                                    {remaining >= 0 && (
                                                        <span className="ml-2 inline-flex items-center gap-1 text-emerald-700">
                                                            Remaining: <span className="font-mono">{remaining}</span>
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Progress Bar */}
                                                <div className="mt-2 h-2 w-full bg-gray-100 rounded-full overflow-hidden">
                                                    <div className="relative h-full w-full">
                                                        {/* refunded portion */}
                                                        <div
                                                            className="absolute left-0 top-0 h-full bg-rose-300"
                                                            style={{ width: `${refundedPct * 100}%` }}
                                                        />
                                                        {/* remaining portion for contrast on large screens */}
                                                        <div
                                                            className="absolute right-0 top-0 h-full bg-emerald-300"
                                                            style={{ width: `${(1 - refundedPct) * 100}%` }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-right w-64 shrink-0">
                                                <p className="text-sm font-mono text-gray-900">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{((Number(line.quantity) || 0) * (Number(line.sale_price) || 0)).toFixed(2)}</p>
                                                {isPartial && (
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Refunded value: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{((Number(line.sale_price) || 0) * refunded).toFixed(2)}
                                                    </p>
                                                )}
                                                {isFull && (
                                                    <p className="text-xs text-rose-600 mt-1 font-medium">No quantity remaining</p>
                                                )}
                                                {showRefundForm && remaining > 0 && (
                                                    <div className="mt-3 space-y-1">
                                                        <div className="flex items-center justify-end gap-3">
                                                            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
                                                                <input
                                                                    type="checkbox"
                                                                    className="h-4 w-4 rounded"
                                                                    checked={refundLines[line.invoice_line_id] > 0}
                                                                    onChange={(e) => handleRefundCheckboxChange(line.invoice_line_id, e.target.checked)}
                                                                />
                                                                <span>Select</span>
                                                            </label>
                                                            {refundLines[line.invoice_line_id] > 0 && (
                                                                <div className="flex items-center gap-2">
                                                                    <label className="text-xs text-gray-600">Qty</label>
                                                                    <input
                                                                        type="number"
                                                                        min={0}
                                                                        step={1}
                                                                        max={remaining}
                                                                        value={refundLines[line.invoice_line_id] ?? 0}
                                                                        onChange={(e) => handleRefundQtyChange(line.invoice_line_id, e.target.value)}
                                                                        className="w-24 px-2 py-1 border rounded-md text-sm text-right"
                                                                    />
                                                                </div>
                                                            )}
                                                        </div>
                                                        {refundLines[line.invoice_line_id] > 0 && (
                                                            <div className="text-[11px] text-gray-500">Max refundable: <span className="font-mono">{remaining}</span></div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

                    {/* Inline refund controls (compact) */}
                    {showRefundForm && (
                        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">
                                        Refund Method <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        value={selectedMethodId}
                                        onChange={(e) => setSelectedMethodId(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                                        disabled={loadingMethods}
                                    >
                                        <option value="">{loadingMethods ? 'Loading…' : 'Select method'}</option>
                                        {paymentMethods.map(pm => (
                                            <option key={pm.method_id} value={pm.method_id}>{pm.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-700 mb-1">Reference (optional)</label>
                                    <input
                                        type="text"
                                        value={reference}
                                        onChange={(e) => setReference(e.target.value)}
                                        placeholder="Txn ID / Check #"
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm bg-white"
                                        maxLength={200}
                                    />
                                </div>
                                <div className="flex md:justify-end md:text-right items-center md:items-end gap-4">
                                    <div className="text-sm">
                                        <div className="text-gray-600">Total Refund</div>
                                        <div className="text-xl font-semibold text-blue-700">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{totalRefundAmount.toFixed(2)}</div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={handleSubmitInlineRefund}
                                            className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 shadow-sm"
                                            disabled={Object.values(refundLines).every(q => !q || Number(q) <= 0)}
                                        >
                                            Confirm Refund
                                        </button>
                                        <button
                                            onClick={() => { setShowRefundForm(false); setRefundLines({}); }}
                                            className="px-4 py-2 rounded-lg border text-gray-700 hover:bg-gray-50"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Payments Section */}
                    {payments.length > 0 && (
                        <div className="bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-gray-800">Payments</h3>
                                {/* Totals quick glance */}
                                <div className="text-xs text-gray-600">
                                    <span className="mr-3">Settled: <span className="font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{payments.filter(p => p.payment_status?.toLowerCase() === 'settled').reduce((s, p) => s + (parseFloat(p.amount_paid || 0) || 0), 0).toFixed(2)}</span></span>
                                    {payments.some(p => p.payment_status?.toLowerCase() === 'pending') && (
                                        <span className="text-yellow-700">Pending: <span className="font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{payments.filter(p => p.payment_status?.toLowerCase() === 'pending').reduce((s, p) => s + (parseFloat(p.amount_paid || 0) || 0), 0).toFixed(2)}</span></span>
                                    )}
                                </div>
                            </div>
                            <div className="mt-3 space-y-2">
                                {payments.map(payment => (
                                    <div key={payment.payment_id} className="bg-gray-50 p-3 rounded-lg border">
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-sm font-medium">{payment.method_name || payment.payment_method}</span>
                                                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getPaymentStatusBadge(payment.payment_status)}`}>
                                                        {formatPaymentStatus(payment.payment_status)}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-gray-600">
                                                    <div>Amount: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(payment.amount_paid).toFixed(2)}</div>
                                                    {payment.tendered_amount && (
                                                        <div>Tendered: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(payment.tendered_amount).toFixed(2)}</div>
                                                    )}
                                                    {payment.change_amount && parseFloat(payment.change_amount) > 0 && (
                                                        <div>Change: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(payment.change_amount).toFixed(2)}</div>
                                                    )}
                                                    {payment.settled_at && (
                                                        <div className="text-xs text-gray-500">
                                                            Settled: {new Date(payment.settled_at).toLocaleString()}
                                                        </div>
                                                    )}
                                                    {payment.created_at && (
                                                        <div className="text-xs text-gray-500">
                                                            Created: {new Date(payment.created_at).toLocaleString()}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {payment.payment_status?.toLowerCase() === 'pending' && (
                                                <button
                                                    onClick={() => handleMarkSettled(payment.payment_id)}
                                                    className="bg-green-600 text-white text-xs px-3 py-1 rounded hover:bg-green-700 transition-colors"
                                                >
                                                    Mark Settled
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                
                                {/* Payment Summary */}
                                <div className="bg-blue-50 p-3 rounded-lg border border-blue-200 mt-3">
                                    <div className="text-sm">
                                        <div className="flex justify-between">
                                            <span>Total Paid:</span>
                                            <span className="font-mono">
                                                {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}
                                                {payments
                                                    .filter(p => p.payment_status?.toLowerCase() === 'settled')
                                                    .reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0)
                                                    .toFixed(2)}
                                            </span>
                                        </div>
                                        {payments.some(p => p.payment_status?.toLowerCase() === 'pending') && (
                                            <div className="flex justify-between text-yellow-700">
                                                <span>Pending:</span>
                                                <span className="font-mono">
                                                    {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}
                                                    {payments
                                                        .filter(p => p.payment_status?.toLowerCase() === 'pending')
                                                        .reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0)
                                                        .toFixed(2)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                    {paymentsForbidden && (
                        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
                            You do not have permission to view payment details for this invoice.
                        </div>
                    )}
                    
                    {!showRefundForm && (
                        <div className="pt-4 flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                            <div className="flex gap-2 flex-wrap">
                                {hasPermission('invoice:edit_receipt_no') && (
                                    <button
                                        onClick={handleEditReceiptNo}
                                        className="bg-cyan-600 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-cyan-700 transition-colors duration-200 shadow-sm"
                                    >
                                        Edit Receipt No.
                                    </button>
                                )}
                                {hasPermission('invoice:delete') && (
                                    <button
                                        onClick={handleDelete}
                                        className="bg-white border border-red-300 text-red-600 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-red-50 shadow-sm"
                                    >
                                        Delete Invoice
                                    </button>
                                )}
                            </div>
                            <div className="flex-1 text-right">
                                {!showRefundForm ? (
                                    <button
                                        onClick={() => setShowRefundForm(true)}
                                        className="bg-red-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-red-700"
                                    >
                                        Process Refund
                                    </button>
                                ) : (
                                    <button
                                        onClick={() => { setShowRefundForm(false); setRefundLines({}); }}
                                        className="bg-gray-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-gray-700"
                                    >
                                        Close Refund
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* The legacy RefundForm component is intentionally not rendered to avoid duplication.
                        We keep the import and a void reference at top to preserve linting behavior. */}
                </div>
            )}
        </Modal>
    );
};

export default InvoiceDetailsModal;