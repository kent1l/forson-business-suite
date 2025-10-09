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
    const { hasPermission } = useAuth();
    const [lines, setLines] = useState([]);
    const [payments, setPayments] = useState([]);
    const [paymentsForbidden, setPaymentsForbidden] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showRefundForm, setShowRefundForm] = useState(false);
    const [isEditingReceiptNo, setIsEditingReceiptNo] = useState(false);
    const [editingReceiptNo, setEditingReceiptNo] = useState('');

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


    if (!isOpen || !invoice) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Details for Invoice #${invoice.invoice_number}`} maxWidth="max-w-3xl">
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
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-gray-800">Items</h3>
                            {/* Legend */}
                            <div className="hidden sm:flex items-center gap-3 text-xs text-gray-500">
                                <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-rose-300"></span> Refunded</span>
                                <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-amber-300"></span> Partial</span>
                                <span className="inline-flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-emerald-300"></span> Remaining</span>
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
                                            <div className="text-right">
                                                <p className="text-sm font-mono text-gray-900">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{((Number(line.quantity) || 0) * (Number(line.sale_price) || 0)).toFixed(2)}</p>
                                                {isPartial && (
                                                    <p className="text-xs text-gray-500 mt-1">
                                                        Refunded value: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{((Number(line.sale_price) || 0) * refunded).toFixed(2)}
                                                    </p>
                                                )}
                                                {isFull && (
                                                    <p className="text-xs text-rose-600 mt-1 font-medium">No quantity remaining</p>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>

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
                                <button
                                    onClick={() => setShowRefundForm(true)}
                                    className="bg-red-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-red-700"
                                >
                                    Process Refund
                                </button>
                            </div>
                        </div>
                    )}

                    {showRefundForm && <RefundForm invoice={invoice} lines={lines} onRefundSuccess={handleRefundSuccess} />}
                </div>
            )}
        </Modal>
    );
};

export default InvoiceDetailsModal;