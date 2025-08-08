import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useSettings } from '../../contexts/SettingsContext';

const PaymentModal = ({ isOpen, onClose, total, onConfirmPayment }) => {
    const { settings } = useSettings();
    const paymentMethods = useMemo(() => settings?.PAYMENT_METHODS ? settings.PAYMENT_METHODS.split(',') : ['Cash'], [settings]);
    
    const [selectedMethod, setSelectedMethod] = useState('');
    const [cashTendered, setCashTendered] = useState('');
    const cashInputRef = useRef(null);

    useEffect(() => {
        if (isOpen) {
            setCashTendered('');
            const defaultMethod = paymentMethods[0] || 'Cash';
            setSelectedMethod(defaultMethod);
            if (defaultMethod.toLowerCase() === 'cash') {
                setTimeout(() => cashInputRef.current?.focus(), 100);
            }
        }
    }, [isOpen, paymentMethods]);

    const changeDue = (parseFloat(cashTendered) || 0) - total;

    const handleConfirm = () => {
        onConfirmPayment(selectedMethod);
    };

    return (
        <div className={`fixed inset-0 bg-neutral-800/50 z-40 flex items-center justify-center p-4 ${isOpen ? '' : 'hidden'}`}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
                <div className="p-4 border-b">
                    <h2 className="text-lg font-semibold">Process Payment</h2>
                </div>
                <div className="p-6 space-y-4">
                    <div className="text-center mb-4">
                        <p className="text-gray-600">Total Due</p>
                        <p className="text-4xl font-bold">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{total.toFixed(2)}</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
                        <select value={selectedMethod} onChange={(e) => setSelectedMethod(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg">
                            {paymentMethods.map(method => <option key={method} value={method}>{method}</option>)}
                        </select>
                    </div>
                    {selectedMethod.toLowerCase() === 'cash' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Cash Tendered</label>
                            <input
                                ref={cashInputRef}
                                type="number"
                                value={cashTendered}
                                onChange={(e) => setCashTendered(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-lg"
                                placeholder="0.00"
                            />
                        </div>
                    )}
                    {selectedMethod.toLowerCase() === 'cash' && changeDue >= 0 && (
                        <div className="text-center p-2 bg-blue-50 rounded-lg">
                            <p className="text-gray-600">Change Due</p>
                            <p className="text-2xl font-bold text-blue-600">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{changeDue.toFixed(2)}</p>
                        </div>
                    )}
                </div>
                <div className="p-4 bg-gray-50 rounded-b-lg flex justify-end space-x-3">
                     <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                    <button onClick={handleConfirm} className="px-6 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700">
                        Confirm Payment
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentModal;
