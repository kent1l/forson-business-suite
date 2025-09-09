import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import RefundForm from './RefundForm';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';

// Avoid linter warnings for unused imports in JSX
void React;
void Modal;
void RefundForm;

const InvoiceDetailsModal = ({ isOpen, onClose, invoice, onActionSuccess }) => {
    const { settings } = useSettings();
    const { user } = useAuth();
    const [lines, setLines] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showRefundForm, setShowRefundForm] = useState(false);

    useEffect(() => {
        if (isOpen && invoice) {
            setLoading(true);
            setShowRefundForm(false); // Reset on open
            api.get(`/invoices/${invoice.invoice_id}/lines-with-refunds`)
                .then(res => setLines(res.data))
                .catch(() => toast.error('Failed to load invoice details.'))
                .finally(() => setLoading(false));
        }
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


    if (!isOpen || !invoice) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Details for Invoice #${invoice.invoice_number}`} maxWidth="max-w-2xl">
            {loading ? <p>Loading details...</p> : (
                <div className="space-y-4">
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
                    
                    {!showRefundForm && (
                        <div className="pt-4 flex justify-between items-center gap-3">
                            {user?.permission_level_id === 10 && (
                                <button
                                    onClick={handleDelete}
                                    className="bg-white border border-red-300 text-red-600 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-red-50"
                                >
                                    Delete Invoice
                                </button>
                            )}
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