import React, { useState, useMemo } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import MathExpressionInput from '../ui/MathExpressionInput';

const RefundForm = ({ invoice, lines, onRefundSuccess }) => {
    const { user } = useAuth();
    const { settings } = useSettings();
    const [refundLines, setRefundLines] = useState({});
    const [refundMethod, setRefundMethod] = useState('Cash');

    const handleCheckboxChange = (lineId, checked) => {
        const line = lines.find(l => l.invoice_line_id === lineId);
        if (!line || (line.quantity - line.quantity_refunded) <= 0) return;

        setRefundLines(prev => {
            const newLines = { ...prev };
            if (checked) {
                newLines[lineId] = {
                    ...line,
                    quantity: line.quantity - line.quantity_refunded // Default to max refundable quantity
                };
            } else {
                delete newLines[lineId];
            }
            return newLines;
        });
    };

    const handleQuantityChange = (lineId, quantity) => {
        const originalLine = lines.find(l => l.invoice_line_id === lineId);
        const maxRefundable = originalLine.quantity - originalLine.quantity_refunded;
        const num = typeof quantity === 'number' ? quantity : Number(quantity);
        const newQuantity = Math.max(0, Math.min(maxRefundable, isNaN(num) ? 0 : num));

        setRefundLines(prev => ({
            ...prev,
            [lineId]: {
                ...prev[lineId],
                quantity: newQuantity,
            },
        }));
    };

    const totalRefundAmount = useMemo(() => {
        return Object.values(refundLines).reduce((total, line) => {
            return total + (line.quantity * line.sale_price);
        }, 0);
    }, [refundLines]);

    const handleSubmitRefund = () => {
        const linesToRefund = Object.values(refundLines).filter(line => line.quantity > 0);
        if (linesToRefund.length === 0) {
            return toast.error('Please select at least one item to refund.');
        }

        const payload = {
            invoice_id: invoice.invoice_id,
            invoice_number: invoice.invoice_number,
            employee_id: user.employee_id,
            refund_payment_method: refundMethod,
            lines: linesToRefund.map(line => ({
                invoice_line_id: line.invoice_line_id,
                part_id: line.part_id,
                quantity: line.quantity
            })),
        };

        const promise = api.post('/refunds', payload);
        toast.promise(promise, {
            loading: 'Processing refund...',
            success: (res) => {
                onRefundSuccess();
                return res.data.message || 'Refund processed successfully!';
            },
            error: (err) => err.response?.data?.message || 'Failed to process refund.',
        });
    };

    return (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700">
            <div className="mb-4">
                <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1">
                    Refund Payout Method:
                </label>
                <select
                    value={refundMethod}
                    onChange={(e) => setRefundMethod(e.target.value)}
                    className="w-full md:w-64 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                >
                    <option value="Cash">Cash Payout</option>
                    <option value="GCash">GCash Transfer</option>
                    <option value="Card">Card Reversal</option>
                    <option value="Store Credit">Store Credit / Voucher</option>
                    <option value="AR reduction">Accounts Receivable Reduction</option>
                </select>
            </div>
            <h4 className="font-semibold text-gray-800 dark:text-slate-100 mb-2">Select items to refund:</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {lines.map(line => (
                    <div key={line.invoice_line_id} className="flex items-center space-x-3 bg-gray-50 dark:bg-slate-900/50 p-2 rounded-lg border border-gray-200/60 dark:border-slate-700/60">
                        <input
                            type="checkbox"
                            checked={!!refundLines[line.invoice_line_id]}
                            onChange={(e) => handleCheckboxChange(line.invoice_line_id, e.target.checked)}
                            className="h-4 w-4 rounded text-primary-600 dark:bg-slate-800 dark:border-slate-600 focus:ring-primary-500"
                            disabled={(line.quantity - line.quantity_refunded) <= 0}
                        />
                        <div className="flex-grow">
                            <p className={`text-sm font-medium ${ (line.quantity - line.quantity_refunded) <= 0 ? 'text-danger-600 dark:text-danger-400' : 'text-gray-900 dark:text-slate-100' }`}>{line.display_name}</p>
                            <p className={`text-xs ${ (line.quantity - line.quantity_refunded) <= 0 ? 'text-danger-500 dark:text-danger-400/80' : 'text-gray-500 dark:text-slate-400' }`}>Sold: {line.quantity}, Refunded: {line.quantity_refunded}, Available: {line.quantity - line.quantity_refunded}</p>
                        </div>
                        {refundLines[line.invoice_line_id] && (
                            <MathExpressionInput
                                precision={2}
                                value={refundLines[line.invoice_line_id].quantity}
                                onChange={(val) => handleQuantityChange(line.invoice_line_id, val)}
                                className="w-20 px-2 py-1 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-primary-500"
                                max={line.quantity - line.quantity_refunded}
                                min={0}
                            />
                        )}
                    </div>
                ))}
            </div>
            <div className="mt-4 pt-4 border-t border-gray-200 dark:border-slate-700 flex justify-between items-center">
                <div className="text-lg font-bold text-gray-900 dark:text-slate-100">
                    Total Refund: <span className="text-primary-600 dark:text-primary-400">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{totalRefundAmount.toFixed(2)}</span>
                </div>
                <button
                    onClick={handleSubmitRefund}
                    className="bg-primary-600 hover:bg-primary-700 text-white font-semibold px-4 py-2 rounded-lg transition-colors"
                >
                    Confirm Refund
                </button>
            </div>
        </div>
    );
};

export default RefundForm;