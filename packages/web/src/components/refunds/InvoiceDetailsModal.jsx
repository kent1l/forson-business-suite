import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import RefundForm from './RefundForm';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import ReceiptActionModal from './ReceiptActionModal';
import ChangeTransactionDateModal from '../common/ChangeTransactionDateModal';
import TransactionDateHistory from '../common/TransactionDateHistory';
import InfoTip from '../ui/InfoTip';
import ExchangeModal from '../pos/ExchangeModal';
import SalesCorrectionModal from './SalesCorrectionModal';

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
void ExchangeModal;
void SalesCorrectionModal;
void ReceiptActionModal;

const InvoiceDetailsModal = ({ isOpen, onClose, invoice: initialInvoice, onActionSuccess }) => {
    const { settings } = useSettings();
    const { hasPermission } = useAuth();
    const [lines, setLines] = useState([]);
    const [payments, setPayments] = useState([]);
    const [paymentsForbidden, setPaymentsForbidden] = useState(false);
    const [loading, setLoading] = useState(false);
    const [showRefundForm, setShowRefundForm] = useState(false);
    const [showExchangeModal, setShowExchangeModal] = useState(false);
    const [isEditingReceiptNo, setIsEditingReceiptNo] = useState(false);
    const [showVoid, setShowVoid] = useState(false);
    const [invoice, setInvoice] = useState(initialInvoice);
    const [receiptHistory, setReceiptHistory] = useState([]);
    const [refreshKey, setRefreshKey] = useState(0);
    const [settlingPaymentId, setSettlingPaymentId] = useState(null);
    const [showChangeDate, setShowChangeDate] = useState(false);
    const [showSalesCorrection, setShowSalesCorrection] = useState(false);

    useEffect(() => {
        if (!isOpen || !initialInvoice) return;

        let cancelled = false;
        (async () => {
            setLoading(true);
            setShowRefundForm(false); // Reset on open
            setIsEditingReceiptNo(false); // Reset editing state
            setInvoice(initialInvoice);
            setShowVoid(false);
            setShowExchangeModal(false);
            setShowChangeDate(false);
            setShowSalesCorrection(false);
            setReceiptHistory([]);

            try {
                const { data: snapshot } = await api.get(`/invoices/${initialInvoice.invoice_id}/receipt-control`);
                if (cancelled) return;
                setInvoice({ ...initialInvoice, ...snapshot.invoice });
                setReceiptHistory(snapshot.history);
                const linesRes = await api.get(`/invoices/${initialInvoice.invoice_id}/lines-with-refunds`);
                if (cancelled) return;
                setLines(linesRes.data || []);

                // Then attempt to fetch payments. If payments are forbidden (403) we surface a clear message
                try {
                    const paymentsRes = await api.get(`/invoices/${initialInvoice.invoice_id}/payments`);
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
    }, [isOpen, initialInvoice, refreshKey]);
    
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

    const handleExchangeSuccess = () => {
        setShowExchangeModal(false);
        onClose(); // Close the modal
        onActionSuccess(); // Trigger a refresh on the parent page
        window.dispatchEvent(new CustomEvent('invoices:changed'));
    };

    const notifyChanged = () => {
        setRefreshKey(key => key + 1);
        onActionSuccess();
        window.dispatchEvent(new CustomEvent('invoices:changed'));
    };

    const handleMarkSettled = async (paymentId) => {
        if (settlingPaymentId) return;
        setSettlingPaymentId(paymentId);
        try {
            await api.put(`/invoices/payments/${paymentId}/settle`);
            toast.success('Payment marked as settled');
            
            // Refresh payments list
            setRefreshKey(key => key + 1);
            
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
        } finally { setSettlingPaymentId(null); }
    };


    if (!isOpen || !invoice) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Details for Invoice #${invoice.invoice_number}`} maxWidth="max-w-2xl">
            {loading || invoice.invoice_id !== initialInvoice?.invoice_id ? <p className="text-gray-500 dark:text-slate-400 py-4 text-center">Loading details...</p> : (
                <div className="space-y-4">
                    <div className="rounded border border-gray-200 p-3 text-sm dark:border-slate-700">
                        <span className="font-semibold">Physical receipt: </span>{invoice.physical_receipt_no || 'No paper receipt recorded'}
                        {receiptHistory.length > 0 && <details className="mt-2">
                            <summary className="cursor-pointer">Receipt history</summary>
                            <ul className="mt-2 space-y-2">
                                {receiptHistory.map(event => <li key={event.event_id}>
                                    <span className="font-mono">{event.original_suggestion || event.submitted_reference || 'Notebook'}</span>
                                    {event.event_type === 'REFERENCE_EDITED' && ` → ${event.submitted_reference || 'Notebook'}`}
                                    {' — '}{event.event_type.replaceAll('_', ' ')}: {event.reason}
                                    <div className="text-xs text-gray-500">{event.actor_name || 'System'} · {new Date(event.created_at).toLocaleString()}</div>
                                </li>)}
                            </ul>
                        </details>}
                    </div>

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
                                            {line.quantity} {line.measurement_unit || 'PC'} x {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(line.sale_price).toFixed(2)}
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
                                            {payment.payment_status?.toLowerCase() === 'pending' && invoice.status !== 'Cancelled' && hasPermission('invoicing:create') && (
                                                <button
                                                    disabled={!!settlingPaymentId}
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
                                {hasPermission('invoice:edit_receipt_no') && invoice.status !== 'Cancelled' && (
                                    <button
                                        onClick={() => setIsEditingReceiptNo(true)}
                                        className="bg-cyan-600 dark:bg-cyan-700 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-cyan-700 dark:hover:bg-cyan-600 transition-colors duration-200 shadow-sm"
                                    >
                                        Edit Receipt No.
                                    </button>
                                )}
                                {hasPermission('invoice:delete') && invoice.status !== 'Cancelled' && (
                                    <button
                                        onClick={() => setShowVoid(true)}
                                        className="bg-white dark:bg-slate-800 border border-danger-300 dark:border-danger-700 text-danger-600 dark:text-danger-400 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
                                    >
                                        Void Invoice
                                    </button>
                                )}
                                {settings?.ENABLE_SALES_CORRECTIONS === 'true' && hasPermission('sales_correction:create') && invoice.status !== 'Cancelled' && (
                                    <button
                                        onClick={() => setShowSalesCorrection(true)}
                                        className="bg-primary-600 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-primary-700 transition-colors"
                                    >
                                        Correct & Restart
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
                            <div className="flex-1 text-right flex justify-end gap-2">
                                {hasPermission('invoicing:create') && invoice.status !== 'Cancelled' && (
                                    <button
                                        onClick={() => setShowExchangeModal(true)}
                                        className="bg-primary-600 hover:bg-primary-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
                                    >
                                        Exchange Items
                                    </button>
                                )}
                                {invoice.status !== 'Cancelled' && hasPermission('invoicing:create') && <button
                                    onClick={() => setShowRefundForm(true)}
                                    className="bg-danger-600 hover:bg-danger-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
                                >
                                    Process Refund
                                </button>}
                            </div>
                        </div>
                    )}

                    {showRefundForm && <RefundForm invoice={invoice} lines={lines} onRefundSuccess={handleRefundSuccess} />}

                    <TransactionDateHistory kind="invoice" id={invoice.invoice_id} />
                </div>
            )}

            <ReceiptActionModal isOpen={isEditingReceiptNo} onClose={() => setIsEditingReceiptNo(false)} invoiceId={invoice.invoice_id}
                mode="edit" onSuccess={notifyChanged} />
            <ReceiptActionModal isOpen={showVoid} onClose={() => setShowVoid(false)} invoiceId={invoice.invoice_id}
                mode="void" onSuccess={() => { notifyChanged(); onClose(); }} />

            <ChangeTransactionDateModal
                isOpen={showChangeDate}
                onClose={() => setShowChangeDate(false)}
                kind="invoice"
                id={invoice.invoice_id}
                currentDate={invoice.invoice_date}
                transactionLabel={`Invoice #${invoice.invoice_number}`}
                onApplied={() => {
                    notifyChanged();
                }}
            />

            <ExchangeModal
                isOpen={showExchangeModal}
                onClose={() => setShowExchangeModal(false)}
                initialInvoice={invoice}
                onExchangeSuccess={handleExchangeSuccess}
                zIndexClass="z-50"
            />
            <SalesCorrectionModal
                isOpen={showSalesCorrection}
                onClose={() => setShowSalesCorrection(false)}
                invoice={invoice}
                onCompleted={() => {
                    notifyChanged();
                    onClose();
                }}
            />
        </Modal>
    );
};

export default InvoiceDetailsModal;
