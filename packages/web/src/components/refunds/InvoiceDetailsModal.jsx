import React, { useState, useEffect } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import RefundForm from './RefundForm';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import { formatPhysicalReceiptNumber } from '../../utils/receiptNumberFormatter';

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
    const [isEditingReceiptNo, setIsEditingReceiptNo] = useState(false);
    const [editingReceiptNo, setEditingReceiptNo] = useState('');
    const [saveSuccess, setSaveSuccess] = useState(false);

    useEffect(() => {
        if (isOpen && invoice) {
            setLoading(true);
            setShowRefundForm(false); // Reset on open
            setIsEditingReceiptNo(false); // Reset editing state
            setSaveSuccess(false); // Reset success state
            setEditingReceiptNo(invoice.physical_receipt_no || ''); // Initialize with current value
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

    const handleEditReceiptNo = () => {
        setIsEditingReceiptNo(true);
        setSaveSuccess(false); // Reset success state when starting edit
    };

    const handleSaveReceiptNo = async () => {
        try {
            const response = await api.put(`/invoices/${invoice.invoice_id}/physical-receipt-no`, {
                physical_receipt_no: formatPhysicalReceiptNumber(editingReceiptNo)
            });

            // Update the invoice object with the new value
            invoice.physical_receipt_no = response.data.physical_receipt_no;

            // Update the editing state with the formatted value for immediate visual feedback
            setEditingReceiptNo(response.data.physical_receipt_no || '');

            // Show success state
            setSaveSuccess(true);

            toast.success('Physical receipt number updated successfully');

            // Show formatted result for 1.5 seconds before closing edit mode
            setTimeout(() => {
                setIsEditingReceiptNo(false);
                setSaveSuccess(false); // Reset success state
                onActionSuccess(); // Refresh the parent page

                // Notify other parts of the app that invoices changed
                try {
                    window.dispatchEvent(new CustomEvent('invoices:changed'));
                } catch {
                    // ignore if window not available
                }
            }, 1500);

        } catch (error) {
            const message = error.response?.data?.message || 'Failed to update physical receipt number';
            toast.error(message);
        }
    };    const handleCancelEditReceiptNo = () => {
        setEditingReceiptNo(invoice.physical_receipt_no || '');
        setIsEditingReceiptNo(false);
    };


    if (!isOpen || !invoice) return null;

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Details for Invoice #${invoice.invoice_number}`} maxWidth="max-w-2xl">
            {loading ? <p>Loading details...</p> : (
                <div className="space-y-4">
                    {/* Physical Receipt Number Editing Section - Only shown when editing */}
                    {isEditingReceiptNo && (
                        <div className={`p-4 rounded-lg border-2 ${saveSuccess ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-cyan-200'}`}>
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <label className="block text-sm font-medium text-gray-700 mb-2">
                                        Edit Physical Receipt No.
                                        {saveSuccess && <span className="ml-2 text-green-600 text-xs">✓ Formatted and saved!</span>}
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={editingReceiptNo}
                                            onChange={(e) => setEditingReceiptNo(e.target.value)}
                                            onBlur={(e) => {
                                                // Auto-format on blur for better UX
                                                const formatted = formatPhysicalReceiptNumber(e.target.value);
                                                setEditingReceiptNo(formatted || '');
                                            }}
                                            className={`flex-1 px-3 py-2 border rounded-lg text-sm font-mono focus:ring-2 ${
                                                saveSuccess
                                                    ? 'border-green-300 bg-green-50 focus:ring-green-500 focus:border-green-500'
                                                    : 'border-gray-300 focus:ring-cyan-500 focus:border-cyan-500'
                                            }`}
                                            placeholder="e.g., SI-1234, ABC/5678, or XYZ 9999"
                                            autoFocus
                                            readOnly={saveSuccess} // Make readonly when showing success
                                        />
                                        <span className="text-xs text-gray-500 whitespace-nowrap">
                                            {saveSuccess ? 'Formatted successfully' : 'Auto-formats to uppercase with dashes (e.g., SI-1234)'}
                                        </span>
                                        {!saveSuccess && (
                                            <>
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
                                            </>
                                        )}
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
                    
                    {!showRefundForm && (
                        <div className="pt-4 flex justify-between items-center gap-3">
                            <div className="flex gap-2">
                                {user?.permission_level_id === 10 ? (
                                    <>
                                        <button
                                            onClick={handleEditReceiptNo}
                                            className="bg-cyan-600 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-cyan-700 transition-colors duration-200 shadow-sm"
                                        >
                                            Edit Receipt No.
                                        </button>
                                        <button
                                            onClick={handleDelete}
                                            className="bg-white border border-red-300 text-red-600 text-sm font-semibold px-3 py-2 rounded-lg hover:bg-red-50"
                                        >
                                            Delete Invoice
                                        </button>
                                    </>
                                ) : (
                                    <button
                                        onClick={handleEditReceiptNo}
                                        className="bg-cyan-600 text-white text-sm font-semibold px-3 py-2 rounded-lg hover:bg-cyan-700 transition-colors duration-200 shadow-sm"
                                    >
                                        Edit Receipt No.
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