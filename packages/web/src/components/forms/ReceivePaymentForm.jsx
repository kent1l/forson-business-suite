import React, { useState, useEffect, useMemo } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';

const ReceivePaymentForm = ({ customer, onSave, onCancel }) => {
    const { user } = useAuth();
    const [unpaidInvoices, setUnpaidInvoices] = useState([]);
    const [paymentAmount, setPaymentAmount] = useState(0);
    const [paymentMethod, setPaymentMethod] = useState('Cash');
    const [reference, setReference] = useState('');
    const [notes, setNotes] = useState('');
    const [allocations, setAllocations] = useState({});

    useEffect(() => {
        if (customer) {
            api.get(`/customers/${customer.customer_id}/unpaid-invoices`)
                .then(res => setUnpaidInvoices(res.data));
        }
    }, [customer]);

    const handleAmountChange = (e) => {
        const amount = parseFloat(e.target.value) || 0;
        setPaymentAmount(amount);
        autoAllocate(amount);
    };

    const autoAllocate = (amount) => {
        let remainingAmount = amount;
        const newAllocations = {};
        for (const invoice of unpaidInvoices) {
            if (remainingAmount <= 0) break;
            const amountToAllocate = Math.min(remainingAmount, parseFloat(invoice.balance_due));
            newAllocations[invoice.invoice_id] = amountToAllocate.toFixed(2);
            remainingAmount -= amountToAllocate;
        }
        setAllocations(newAllocations);
    };

    const handleAllocationChange = (invoiceId, value) => {
        const newAllocations = { ...allocations, [invoiceId]: value };
        setAllocations(newAllocations);
    };

    const totalAllocated = useMemo(() => {
        return Object.values(allocations).reduce((sum, val) => sum + (parseFloat(val) || 0), 0);
    }, [allocations]);

    const handleSubmit = (e) => {
        e.preventDefault();
        if (totalAllocated > paymentAmount) {
            return toast.error('Total allocated cannot exceed the payment amount.');
        }
        if (totalAllocated <= 0) {
            return toast.error('Please allocate the payment to at least one invoice.');
        }

        const payload = {
            customer_id: customer.customer_id,
            amount: paymentAmount,
            payment_method: paymentMethod,
            reference_number: reference,
            notes,
            allocations: Object.entries(allocations).map(([invoice_id, amount_allocated]) => ({
                invoice_id: parseInt(invoice_id),
                amount_allocated: parseFloat(amount_allocated) || 0
            }))
        };
        
        const promise = api.post('/payments', payload);
        toast.promise(promise, {
            loading: 'Processing payment...',
            success: () => {
                onSave();
                return 'Payment processed successfully!';
            },
            error: 'Failed to process payment.'
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Payment Amount</label>
                    <input type="number" step="0.01" value={paymentAmount} onChange={handleAmountChange} className="mt-1 w-full px-3 py-2 border rounded-lg" required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Payment Method</label>
                    <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded-lg">
                        <option>Cash</option>
                        <option>Credit Card</option>
                        <option>Bank Transfer</option>
                    </select>
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700">Reference / Check #</label>
                <input type="text" value={reference} onChange={e => setReference(e.target.value)} className="mt-1 w-full px-3 py-2 border rounded-lg" />
            </div>

            <h3 className="text-lg font-medium border-t pt-4">Allocate Payment to Invoices</h3>
            <div className="max-h-64 overflow-y-auto">
                {unpaidInvoices.map(invoice => (
                    <div key={invoice.invoice_id} className="grid grid-cols-3 gap-4 items-center mb-2">
                        <div className="text-sm">
                            <p>{invoice.invoice_number}</p>
                            <p className="text-xs text-gray-500">Due: ₱{parseFloat(invoice.balance_due).toFixed(2)}</p>
                        </div>
                        <div className="col-span-2">
                            <input
                                type="number"
                                step="0.01"
                                value={allocations[invoice.invoice_id] || ''}
                                onChange={e => handleAllocationChange(invoice.invoice_id, e.target.value)}
                                className="w-full px-3 py-2 border rounded-lg"
                                placeholder="0.00"
                            />
                        </div>
                    </div>
                ))}
            </div>

            <div className="flex justify-between items-center font-semibold border-t pt-4">
                <span>Total Allocated:</span>
                <span>₱{totalAllocated.toFixed(2)}</span>
            </div>
             <div className="flex justify-between items-center font-semibold">
                <span>Unallocated:</span>
                <span className={paymentAmount - totalAllocated < 0 ? 'text-red-500' : ''}>
                    ₱{(paymentAmount - totalAllocated).toFixed(2)}
                </span>
            </div>

            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Receive Payment</button>
            </div>
        </form>
    );
};

export default ReceivePaymentForm;
