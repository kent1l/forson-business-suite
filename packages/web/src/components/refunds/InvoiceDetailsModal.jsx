import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import RefundForm from './RefundForm';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatPhysicalReceiptNumber } from '../../utils/receiptNumberFormatter';
import ChangeTransactionDateModal from '../common/ChangeTransactionDateModal';
import TransactionDateHistory from '../common/TransactionDateHistory';
import InfoTip from '../ui/InfoTip';

// Helper function to get payment status badge styles
const getPaymentStatusBadge = (status) => {
    switch (status?.toLowerCase()) {
        case 'settled':
            return 'bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-400';
        case 'pending':
            return 'bg-warning-100 dark:bg-warning-900/30 text-warning-800 dark:text-warning-400';
        case 'failed':
            return 'bg-danger-100 dark:bg-danger-900/30 text-danger-800 dark:text-danger-400';
        default:
            return 'bg-neutral-100 dark:bg-slate-700 text-neutral-800 dark:text-slate-300';
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
void ChangeTransactionDateModal;
void TransactionDateHistory;
void InfoTip;

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
    const [showChangeDate, setShowChangeDate] = useState(false);

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
        if (!window.confirm(`Void Invoice #${invoice.invoice_number}? This will restore stock quantities, reverse its effect on the customer's A/R balance, and free up its physical receipt number for reuse. The invoice record itself is kept for audit history and marked Cancelled.`)) return;
        try {
            await api.delete(`/invoices/${invoice.invoice_id}`);
            toast.success('Invoice voided');
            onClose();
            onActionSuccess();
            // Notify other parts of the app that invoices changed
            try {
                window.dispatchEvent(new CustomEvent('invoices:changed'));
            } catch {
                // ignore if window not available
            }
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to void invoice');
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

            // Trigger UI updates
            setIsEditingReceiptNo(false);
            toast.success('Physical receipt number updated');
            
            // Trigger refresh on parent page
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
    };

    const handleCancelEditReceiptNo = () => {
        setIsEditingReceiptNo(false);
        setEditingReceiptNo(invoice.physical_receipt_no || ''); // Reset to current value
    };

    const handleMarkSettled = async (paymentId) => {
        try {
            await api.patch(`/payments/${paymentId}/settle`);
            toast.success('Payment marked as settled');
            
            // Refresh payments list
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
            {loading ? <p className="text-gray-500 dark:text-slate-400 py-4 text-center">Loading details...</p> : (
                <div className="space-y-4">
                    {/* Physical Receipt Number Editing Section - Only shown when editing */}
                    {isEditingReceiptNo && (
                        <div className="bg-gray-50 dark:bg-slate-900/50 p-4 rounded-lg border-2 border-cyan-300 dark:border-cyan-700">
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                                        Edit Physical Receipt No.
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={editingReceiptNo}
                                            onChange={(e) => {
                                                const value = e.target.value;
                                                const formatted = formatPhysicalReceiptNumber(value);
                                                if (formatted !== editingReceiptNo) {
                                                    setEditingReceiptNo(formatted || '');
                                                }
                                            }}
                                            onBlur={(e) => {
                                                const formatted = formatPhysicalReceiptNumber(e.target.value);
                                                setEditingReceiptNo(formatted || '');
                                            }}
                                            className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg text-sm font-mono bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                                            placeholder="e.g., SI-1234, ABC/5678, or XYZ 9999"
                                            autoFocus
                                        />
                                        <span className="text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
                                            Formats instantly as you type
                                        </span>
                                        <button
                                            onClick={handleSaveReceiptNo}
                                            className="bg-success-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-success-700 transition-colors duration-200"
                                        >
                                            Save
                                        </button>
                                        <button
                                            onClick={handleCancelEditReceiptNo}
                                            className="bg-gray-500 dark:bg-slate-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-600 dark:hover:bg-slate-500 transition-colors duration-200"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4 bg-slate-50 dark:bg-slate-900/50 p-4 rounded-lg text-sm text-slate-700 dark:text-slate-300 mb-4 border border-slate-100 dark:border-slate-700 shadow-xs">
                        <div>
                            <span className="font-semibold text-slate-400 dark:text-slate-500 block text-[10px] uppercase tracking-wider mb-0.5">Issuer (Staged By)</span>
                            <span className="font-medium text-slate-800 dark:text-slate-100">{invoice.employee_first_name} {invoice.employee_last_name}</span>
                        </div>
                        <div>
                            <span className="font-semibold text-slate-400 dark:text-slate-500 block text-[10px] uppercase tracking-wider mb-0.5">Approved By</span>
                            <span className="font-medium text-slate-800 dark:text-slate-100">{invoice.approved_by_name || 'System Auto-Approved'}</span>
                        </div>
                        <div className="border-t border-slate-200/60 dark:border-slate-700/60 pt-2">
                            <span className="font-semibold text-slate-400 dark:text-slate-500 block text-[10px] uppercase tracking-wider mb-0.5">Submitted On</span>
                            <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{invoice.submitted_at ? new Date(invoice.submitted_at).toLocaleString('en-US') : 'N/A'}</span>
                        </div>
                        <div className="border-t border-slate-200/60 dark:border-slate-700/60 pt-2">
                            <span className="font-semibold text-slate-400 dark:text-slate-500 block text-[10px] uppercase tracking-wider mb-0.5">Approved On</span>
                            <span className="font-mono text-xs text-slate-700 dark:text-slate-300">{invoice.approved_at ? new Date(invoice.approved_at).toLocaleString('en-US') : 'N/A'}</span>
                        </div>
                    </div>

                    <div>
                        <h3 className="font-semibold text-gray-800 dark:text-slate-100">Items Sold</h3>
                        <ul className="divide-y divide-gray-200 dark:divide-slate-700 mt-2">
                            {lines.map(line => (
                                <li key={line.invoice_line_id} className="py-2 flex justify-between items-center text-gray-900 dark:text-slate-100">
                                    <div>
                                        <p className="text-sm font-medium text-gray-900 dark:text-slate-100">{line.display_name}</p>
                                        <p className="text-xs text-gray-500 dark:text-slate-400">
                                            {line.quantity} x {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(line.sale_price).toFixed(2)}
                                        </p>
                                    </div>
                                    <p className="text-sm font-mono font-semibold text-gray-900 dark:text-slate-100">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{(line.quantity * line.sale_price).toFixed(2)}</p>
                                </li>
                            ))}
                        </ul>
                    </div>

                    {/* Payments Section */}
                    {payments.length > 0 && (
                        <div>
                            <h3 className="font-semibold text-gray-800 dark:text-slate-100 flex items-center gap-1">
                                Payments
                                <InfoTip label="Payment Status">
                                    <strong>Settled</strong> payments have cleared. <strong>Pending</strong> payments (e.g. an
                                    unconfirmed GCash transfer) haven't affected the balance yet — use Mark Settled once funds
                                    clear. <strong>Failed</strong> payments didn't go through.
                                </InfoTip>
                            </h3>
                            <div className="mt-2 space-y-2">
                                {payments.map(payment => (
                                    <div key={payment.payment_id} className="bg-gray-50 dark:bg-slate-900/50 p-3 rounded-lg border border-gray-200 dark:border-slate-700">
                                        <div className="flex justify-between items-start">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{payment.method_name || payment.payment_method}</span>
                                                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getPaymentStatusBadge(payment.payment_status)}`}>
                                                        {formatPaymentStatus(payment.payment_status)}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-gray-600 dark:text-slate-300">
                                                    <div>Amount: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(payment.amount_paid).toFixed(2)}</div>
                                                    {payment.tendered_amount && (
                                                        <div>Tendered: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(payment.tendered_amount).toFixed(2)}</div>
                                                    )}
                                                    {payment.change_amount && parseFloat(payment.change_amount) > 0 && (
                                                        <div>Change: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(payment.change_amount).toFixed(2)}</div>
                                                    )}
                                                    {payment.settled_at && (
                                                        <div className="text-xs text-gray-500 dark:text-slate-400">
                                                            Settled: {new Date(payment.settled_at).toLocaleString()}
                                                        </div>
                                                    )}
                                                    {payment.created_at && (
                                                        <div className="text-xs text-gray-500 dark:text-slate-400">
                                                            Created: {new Date(payment.created_at).toLocaleString()}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                            {payment.payment_status?.toLowerCase() === 'pending' && (
                                                <button
                                                    onClick={() => handleMarkSettled(payment.payment_id)}
                                                    className="bg-success-600 text-white text-xs px-3 py-1 rounded hover:bg-success-700 transition-colors"
                                                >
                                                    Mark Settled
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                
                                {/* Payment Summary */}
                                <div className="bg-primary-50 dark:bg-primary-950/40 p-3 rounded-lg border border-primary-200 dark:border-primary-800/60 mt-3">
                                    <div className="text-sm text-gray-900 dark:text-slate-100">
                                        <div className="flex justify-between">
                                            <span className="flex items-center gap-1">
                                                Total Paid:
                                                <InfoTip label="Total Paid">
                                                    Sum of settled payments only — Pending payments are shown separately below
                                                    and not included here.
                                                </InfoTip>
                                            </span>
                                            <span className="font-mono font-semibold">
                                                {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}
                                                {payments
                                                    .filter(p => p.payment_status?.toLowerCase() === 'settled')
                                                    .reduce((sum, p) => sum + parseFloat(p.amount_paid || 0), 0)
                                                    .toFixed(2)}
                                            </span>
                                        </div>
                                        {payments.some(p => p.payment_status?.toLowerCase() === 'pending') && (
                                            <div className="flex justify-between text-warning-700 dark:text-warning-300 font-semibold">
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
                        <div className="mt-4 p-3 bg-warning-50 dark:bg-warning-950/40 border border-warning-200 dark:border-warning-800/60 rounded-lg text-sm text-warning-800 dark:text-warning-300">
                            You do not have permission to view payment details for this invoice.
                        </div>
                    )}
                    
                    {!showRefundForm && (
                        <div className="pt-4 flex justify-between items-center gap-3">
                            <div className="flex gap-2">
                                {hasPermission('invoice:edit_receipt_no') && (
                                    <button
                                        onClick={handleEditReceiptNo}
                                        className="bg-cyan-600 dark:bg-cyan-700 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-cyan-700 dark:hover:bg-cyan-600 transition-colors duration-200 shadow-sm"
                                    >
                                        Edit Receipt No.
                                    </button>
                                )}
                                {hasPermission('invoice:delete') && invoice.status !== 'Cancelled' && (
                                    <button
                                        onClick={handleDelete}
                                        className="bg-white dark:bg-slate-800 border border-danger-300 dark:border-danger-700 text-danger-600 dark:text-danger-400 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
                                    >
                                        Void Invoice
                                    </button>
                                )}
                                {hasPermission(['transaction:change_date', 'transaction:change_date_unrestricted']) && (
                                    <button
                                        onClick={() => setShowChangeDate(true)}
                                        className="bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                                    >
                                        Change Date
                                    </button>
                                )}
                            </div>
                            <div className="flex-1 text-right">
                                <button
                                    onClick={() => setShowRefundForm(true)}
                                    className="bg-danger-600 hover:bg-danger-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
                                >
                                    Process Refund
                                </button>
                            </div>
                        </div>
                    )}

                    {showRefundForm && <RefundForm invoice={invoice} lines={lines} onRefundSuccess={handleRefundSuccess} />}

                    <TransactionDateHistory kind="invoice" id={invoice.invoice_id} />
                </div>
            )}

            <ChangeTransactionDateModal
                isOpen={showChangeDate}
                onClose={() => setShowChangeDate(false)}
                kind="invoice"
                id={invoice.invoice_id}
                currentDate={invoice.invoice_date}
                transactionLabel={`Invoice #${invoice.invoice_number}`}
                onApplied={() => {
                    onActionSuccess();
                    try {
                        window.dispatchEvent(new CustomEvent('invoices:changed'));
                    } catch {
                        // ignore if window not available
                    }
                }}
            />
        </Modal>
    );
};

export default InvoiceDetailsModal;