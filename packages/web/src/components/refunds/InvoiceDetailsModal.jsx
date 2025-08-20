import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import RefundForm from './RefundForm';
import { useSettings } from '../../contexts/SettingsContext';

const InvoiceDetailsModal = ({ isOpen, onClose, invoice, onActionSuccess }) => {
    const { settings } = useSettings();
    const [lines, setLines] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showRefundForm, setShowRefundForm] = useState(false);

    useEffect(() => {
        if (isOpen && invoice) {
            setLoading(true);
            setShowRefundForm(false); // Reset on open
            api.get(`/invoices/${invoice.invoice_id}/lines`)
                .then(res => setLines(res.data))
                .catch(() => toast.error('Failed to load invoice details.'))
                .finally(() => setLoading(false));
        }
    }, [isOpen, invoice]);
    
    const handleRefundSuccess = () => {
        onClose(); // Close the modal
        onActionSuccess(); // Trigger a refresh on the parent page
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
                        <div className="pt-4 flex justify-end">
                            <button
                                onClick={() => setShowRefundForm(true)}
                                className="bg-red-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-red-700"
                            >
                                Process Refund
                            </button>
                        </div>
                    )}

                    {showRefundForm && <RefundForm invoice={invoice} lines={lines} onRefundSuccess={handleRefundSuccess} />}
                </div>
            )}
        </Modal>
    );
};

export default InvoiceDetailsModal;