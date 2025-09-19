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
        <Modal isOpen={isOpen} onClose={onClose} title={`Details for Invoice #${invoice.invoice_number}`} maxWidth="max-w-2xl">
            {loading ? <p>Loading details...</p> : (
                <div className="space-y-4">
                    {/* Physical Receipt Number Editing Section - Only shown when editing */}
                    {isEditingReceiptNo && (
                        <div className="bg-gray-50 p-4 rounded-lg border-2 border-cyan-200">
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
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
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                                            placeholder="e.g., SI-1234, ABC/5678, or XYZ 9999"
                                            autoFocus
                                        />
                                        <span className="text-xs text-gray-500 whitespace-nowrap">
                                            Formats instantly as you type
                                        </span>
                                        <button
                                            onClick={handleSaveReceiptNo}
                                            className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 transition-colors duration-200"
                                        >
                                            Save
                                        </button>
                                        <button
                                            onClick={handleCancelEditReceiptNo}
                                            className="bg-gray-500 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-600 transition-colors duration-200"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div>
                        <h3 className="font-semibold text-gray-800">Items Sold</h3>
                        <ul className="divide-y divide-gray-200 mt-2">
                            {lines.map(line => (
                                <li key={line.invoice_line_id} className="py-2 flex justify-between items-center">
                                    <div>
                                        <p className="text-sm font-medium">{line.display_name}</p>
                                        <p className="text-xs text-gray-500">
                                            {line.quantity} x {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(line.sale_price).toFixed(2)}
                                        </p>
                                    </div>
                                    <p className="text-sm font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{(line.quantity * line.sale_price).toFixed(2)}</p>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Payments Section */}
                    {payments.length > 0 && (
                        <div>
                            <h3 className="font-semibold text-gray-800">Payments</h3>
                            <div className="mt-2 space-y-2">
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
                        <div className="pt-4 flex justify-between items-center gap-3">
                            <div className="flex gap-2">
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
                                        className="bg-white border border-red-300 text-red-600 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-red-50"
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