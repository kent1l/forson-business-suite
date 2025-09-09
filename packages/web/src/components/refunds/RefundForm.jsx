import React, { useState, useMemo } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';

const RefundForm = ({ invoice, lines, onRefundSuccess }) => {
    const { user } = useAuth();
    const { settings } = useSettings();
    const [refundLines, setRefundLines] = useState({});

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
        const newQuantity = Math.max(0, Math.min(maxRefundable, Number(quantity)));

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
            lines: linesToRefund.map(line => ({
                part_id: line.part_id,
                quantity: line.quantity,
                sale_price: line.sale_price
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
        <div className="mt-4 pt-4 border-t">
            <h4 className="font-semibold text-gray-800 mb-2">Select items to refund:</h4>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-2">
                {lines.map(line => (
                    <div key={line.invoice_line_id} className="flex items-center space-x-3 bg-gray-50 p-2 rounded-lg">
                        <input
                            type="checkbox"
                            checked={!!refundLines[line.invoice_line_id]}
                            onChange={(e) => handleCheckboxChange(line.invoice_line_id, e.target.checked)}
                            className="h-4 w-4 rounded"
                            disabled={(line.quantity - line.quantity_refunded) <= 0}
                        />
                        <div className="flex-grow">
                            <p className={`text-sm font-medium ${ (line.quantity - line.quantity_refunded) <= 0 ? 'text-red-600' : '' }`}>{line.display_name}</p>
                            <p className={`text-xs text-gray-500 ${ (line.quantity - line.quantity_refunded) <= 0 ? 'text-red-600' : '' }`}>Sold: {line.quantity}, Refunded: {line.quantity_refunded}, Available: {line.quantity - line.quantity_refunded}</p>
                        </div>
                        {refundLines[line.invoice_line_id] && (
                            <input
                                type="number"
                                value={refundLines[line.invoice_line_id].quantity}
                                onChange={(e) => handleQuantityChange(line.invoice_line_id, e.target.value)}
                                className="w-20 px-2 py-1 border rounded-md text-sm"
                                max={line.quantity - line.quantity_refunded}
                                min="0"
                            />
                        )}
                    </div>
                ))}
            </div>
            <div className="mt-4 pt-4 border-t flex justify-between items-center">
                <div className="text-lg font-bold">
                    Total Refund: <span className="text-blue-600">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{totalRefundAmount.toFixed(2)}</span>
                </div>
                <button
                    onClick={handleSubmitRefund}
                    className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg hover:bg-blue-700"
                >
                    Confirm Refund
                </button>
            </div>
        </div>
    );
};

export default RefundForm;