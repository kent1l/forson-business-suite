/**
 * CustomerInvoiceDetailsModal Component
 *
 * A modal component that displays detailed information about a customer's payable invoices
 * in the Accounts Receivable section of the Forson Business Suite.
 *
 * Features:
 * - Shows a table of invoices with due dates, amounts, and balances
 * - Displays payment status with color-coded badges (overdue, due today, days remaining)
 * - Click on invoice rows to view detailed line items in a slide-out drawer
 * - Displays item display name, quantity, price, and line total for each invoice item
 * - Handles loading states and empty states gracefully
 *
 * Used in: AccountsReceivablePage.jsx for customer invoice drill-down functionality
 */

import { useMemo, useState } from 'react';
import Modal from '../ui/Modal';
import Drawer from '../ui/Drawer';
import { formatCurrency } from '../../utils/currency';
import api from '../../api';
import toast from 'react-hot-toast';

const CustomerInvoiceDetailsModal = ({
    isOpen,
    onClose,
    title,
    invoices = [],
    loading = false
}) => {
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [invoiceLines, setInvoiceLines] = useState([]);
    const [linesLoading, setLinesLoading] = useState(false);

    // Compute grand total for the invoice lines
    const linesTotal = useMemo(() => {
        if (!invoiceLines || invoiceLines.length === 0) return 0;
        return invoiceLines.reduce((sum, line) => sum + (Number(line.quantity) * Number(line.sale_price || 0)), 0);
    }, [invoiceLines]);

    const handleInvoiceClick = async (invoice) => {
        setSelectedInvoice(invoice);
        setDrawerOpen(true);
        setLinesLoading(true);

        try {
            const response = await api.get(`/invoices/${invoice.invoice_id}/lines`);
            setInvoiceLines(response.data);
        } catch (error) {
            console.error('Failed to fetch invoice lines:', error);
            toast.error('Failed to load invoice details');
            setInvoiceLines([]);
        } finally {
            setLinesLoading(false);
        }
    };

    const handleDrawerClose = () => {
        setDrawerOpen(false);
        setSelectedInvoice(null);
        setInvoiceLines([]);
    };
    return (
        <>
            <Modal
                isOpen={isOpen}
                onClose={onClose}
                title={title}
                maxWidth="max-w-6xl"
            >
                <div className="space-y-4">
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <span className="ml-2 text-gray-600">Loading customer invoices...</span>
                        </div>
                    ) : invoices.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            No payable invoices found for this customer.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200">
                                    <tr>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Invoice #</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Physical Receipt #</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Invoice Date</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Due Date</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Amount</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-right">Balance Due</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoices.map(invoice => {
                                        const dueDate = new Date(invoice.due_date);
                                        const today = new Date();
                                        const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

                                        let statusText, statusColor;
                                        if (daysDiff < 0) {
                                            statusText = `${Math.abs(daysDiff)} days overdue`;
                                            statusColor = 'bg-red-100 text-red-800';
                                        } else if (daysDiff === 0) {
                                            statusText = 'Due today';
                                            statusColor = 'bg-orange-100 text-orange-800';
                                        } else {
                                            statusText = `${daysDiff} days remaining`;
                                            statusColor = 'bg-green-100 text-green-800';
                                        }

                                        return (
                                            <tr
                                                key={invoice.invoice_id}
                                                className="border-b border-gray-200 hover:bg-gray-50 transition-colors cursor-pointer"
                                                onClick={() => handleInvoiceClick(invoice)}
                                            >
                                                <td className="p-3 text-sm font-mono">{invoice.invoice_number}</td>
                                                <td className="p-3 text-sm font-mono">{invoice.physical_receipt_no || 'N/A'}</td>
                                                <td className="p-3 text-sm">{new Date(invoice.invoice_date).toLocaleDateString()}</td>
                                                <td className="p-3 text-sm">{dueDate.toLocaleDateString()}</td>
                                                <td className="p-3 text-sm text-right font-mono">{formatCurrency(invoice.total_amount)}</td>
                                                <td className="p-3 text-sm text-right font-mono font-medium">{formatCurrency(invoice.balance_due)}</td>
                                                <td className="p-3 text-sm text-center">
                                                    <div className="flex items-center justify-center gap-2">
                                                        <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>{statusText}</span>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </Modal>

            {/* Invoice Details Drawer */}
            <Drawer
                isOpen={drawerOpen}
                onClose={handleDrawerClose}
                title={`Invoice ${selectedInvoice?.invoice_number} - Line Items`}
                position="right"
                size="lg"
            >
                {linesLoading ? (
                    <div className="flex items-center justify-center py-8">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        <span className="ml-2 text-gray-600">Loading invoice items...</span>
                    </div>
                ) : invoiceLines.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                        No items found for this invoice.
                    </div>
                ) : (
                    <div className="space-y-4">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200">
                                    <tr>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Item</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-center">Quantity</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-right">Price</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {invoiceLines.map((line, index) => (
                                        <tr key={index} className="border-b border-gray-200">
                                            <td className="p-3 text-sm">{line.display_name}</td>
                                            <td className="p-3 text-sm text-center font-mono">{line.quantity}</td>
                                            <td className="p-3 text-sm text-right font-mono">{formatCurrency(line.sale_price)}</td>
                                            <td className="p-3 text-sm text-right font-mono">{formatCurrency(line.quantity * line.sale_price)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                                <tfoot>
                                    <tr>
                                        <td className="p-3 text-sm" colSpan={2}></td>
                                        <td className="p-3 text-sm text-right font-semibold text-gray-700 border-t border-gray-200">Grand Total</td>
                                        <td className="p-3 text-sm text-right font-mono font-semibold border-t border-gray-200">
                                            {formatCurrency(linesTotal)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                )}
            </Drawer>
        </>
    );
};

export default CustomerInvoiceDetailsModal;
