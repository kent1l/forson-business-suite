import { useState, useEffect, useRef } from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import InfoTip from './InfoTip';

const PaymentModal = ({ isOpen, onClose, total, onConfirmPayment, physicalReceipt = '', paymentMethods = [], initialMethod = '' }) => {
    const { settings } = useSettings();
    
    const [selectedMethod, setSelectedMethod] = useState('');
    const [cashTendered, setCashTendered] = useState('');
    const [reference, setReference] = useState('');
    const cashInputRef = useRef(null);

    const selectedMethodObj = paymentMethods.find(m => 
        (typeof m === 'object' ? m.name : m) === selectedMethod
    );

    useEffect(() => {
        if (isOpen) {
            setCashTendered('');
            setReference('');
            const availablePaymentMethods = paymentMethods.length > 0 ? paymentMethods : 
                (settings?.PAYMENT_METHODS ? settings.PAYMENT_METHODS.split(',') : ['Cash']);
            
            let defaultMethod = availablePaymentMethods[0] || 'Cash';
            if (initialMethod) {
                const found = availablePaymentMethods.find(m => {
                    const name = typeof m === 'object' ? m.name : m;
                    const type = typeof m === 'object' ? m.type : '';
                    return name.toLowerCase() === initialMethod.toLowerCase() || type.toLowerCase() === initialMethod.toLowerCase();
                });
                if (found) defaultMethod = found;
            }
            const methodName = typeof defaultMethod === 'object' ? defaultMethod.name : defaultMethod;
            setSelectedMethod(methodName);
            if (methodName.toLowerCase() === 'cash') {
                setTimeout(() => cashInputRef.current?.focus(), 100);
            }
        }
    }, [isOpen, paymentMethods, settings?.PAYMENT_METHODS, initialMethod]);

    const changeDue = (parseFloat(cashTendered) || 0) - total;

    const requirePRN = String(settings?.REQUIRE_PHYSICAL_RECEIPT_NO || '').toLowerCase() === 'true';

    const handleConfirm = () => {
        const normalizedPRN = (physicalReceipt || '').trim();
        if (requirePRN && normalizedPRN.length === 0) return; // do nothing if required and empty
        
        if (selectedMethodObj?.config?.requires_reference && !reference.trim()) {
            alert(`${selectedMethodObj.config.reference_label || 'Reference'} is required.`);
            return;
        }

        console.log('PaymentModal handleConfirm:', { selectedMethod, paymentMethods });
        
        // Treat empty or zero cash tender as exact cash when confirming
        if (selectedMethod.toLowerCase() === 'cash') {
            const tender = parseFloat(cashTendered) || 0;
            const amountPaid = tender <= 0 ? total : tender;
            
            const methodId = selectedMethodObj && typeof selectedMethodObj === 'object' ? selectedMethodObj.method_id : selectedMethod;
            onConfirmPayment(methodId, amountPaid, tender, normalizedPRN, reference);
        } else {
            // Non-cash methods always pay the exact total
            const methodId = selectedMethodObj && typeof selectedMethodObj === 'object' ? selectedMethodObj.method_id : selectedMethod;
            onConfirmPayment(methodId, total, total, normalizedPRN, reference);
        }
    };

    return (
        <div className={`fixed inset-0 bg-neutral-800/50 z-40 flex items-center justify-center p-4 ${isOpen ? '' : 'hidden'}`}>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700 w-full max-w-sm">
                <div className="p-4 border-b border-gray-200 dark:border-slate-700 flex justify-between items-center">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Process Payment</h2>
                    <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 011.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>
                <div className="p-6 space-y-4">
                    <div className="text-center mb-4">
                        <p className="text-gray-600 dark:text-slate-400 text-sm">Total Due</p>
                        <p className="text-4xl font-bold text-gray-900 dark:text-slate-50">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{total.toFixed(2)}</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Payment Method</label>
                        <select
                            value={selectedMethod}
                            onChange={(e) => setSelectedMethod(e.target.value)}
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                            {(paymentMethods.length > 0 ? paymentMethods : 
                                (settings?.PAYMENT_METHODS ? settings.PAYMENT_METHODS.split(',') : ['Cash'])
                            ).map(method => {
                                const methodName = typeof method === 'object' ? method.name : method;
                                return <option key={methodName} value={methodName}>{methodName}</option>;
                            })}
                        </select>
                    </div>
                    {selectedMethod.toLowerCase() === 'cash' && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                                Cash Tendered
                                <InfoTip label="Cash Tendered">
                                    Leaving this blank or at 0 and confirming treats it as exact change — no change due will be shown.
                                </InfoTip>
                            </label>
                            <input
                                ref={cashInputRef}
                                type="number"
                                value={cashTendered}
                                onChange={(e) => setCashTendered(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        e.preventDefault();
                                        // If user pressed Enter with empty/zero tender, treat as exact cash
                                        const tender = parseFloat(cashTendered) || 0;
                                        const amountPaid = tender <= 0 ? total : tender;
                                        const normalizedPRN = (physicalReceipt || '').trim();
                                        if (requirePRN && normalizedPRN.length === 0) return;
                                        
                                        const methodId = selectedMethodObj && typeof selectedMethodObj === 'object' ? selectedMethodObj.method_id : selectedMethod;
                                        
                                        onConfirmPayment(methodId, amountPaid, tender, normalizedPRN, reference);
                                    }
                                }}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 text-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
                                placeholder="0.00"
                            />
                            {/* Quick Cash Suggestions */}
                            <div className="flex gap-2 mt-2 overflow-x-auto py-1">
                                {(() => {
                                    if (total <= 0) return null;
                                    const suggestions = new Set();
                                    suggestions.add(total);
                                    suggestions.add(Math.ceil(total / 10) * 10);
                                    suggestions.add(Math.ceil(total / 50) * 50);
                                    suggestions.add(Math.ceil(total / 100) * 100);
                                    if (total > 100) suggestions.add(Math.ceil(total / 500) * 500);
                                    if (total > 500) suggestions.add(Math.ceil(total / 1000) * 1000);
                                    
                                    const list = Array.from(suggestions)
                                        .map(val => parseFloat(val.toFixed(2)))
                                        .filter(val => val >= total)
                                        .sort((a, b) => a - b)
                                        .slice(0, 4);

                                    return list.map(suggested => (
                                        <button
                                            key={suggested}
                                            type="button"
                                            onClick={() => setCashTendered(String(suggested))}
                                            className="px-2 py-1 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-xs font-semibold text-slate-700 dark:text-slate-200 rounded-md border border-slate-200 dark:border-slate-600 whitespace-nowrap transition-colors"
                                        >
                                            {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{suggested.toFixed(2)}
                                        </button>
                                    ));
                                })()}
                            </div>
                        </div>
                    )}
                    {selectedMethodObj?.config?.requires_reference && (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                                {selectedMethodObj.config.reference_label || 'Reference'}
                            </label>
                            <input
                                type="text"
                                value={reference}
                                onChange={(e) => setReference(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                placeholder={`Enter ${selectedMethodObj.config.reference_label || 'reference'}...`}
                            />
                        </div>
                    )}
                    {/* Physical receipt input moved outside modal and is provided via `physicalReceipt` prop */}
                    {selectedMethod.toLowerCase() === 'cash' && changeDue >= 0 && (
                        <div className="text-center p-2 bg-primary-50 dark:bg-primary-900/30 border border-primary-100 dark:border-primary-800/40 rounded-lg">
                            <p className="text-gray-600 dark:text-slate-400 text-xs">Change Due</p>
                            <p className="text-2xl font-bold text-primary-600 dark:text-primary-400">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{changeDue.toFixed(2)}</p>
                        </div>
                    )}
                </div>
                <div className="p-4 bg-gray-50 dark:bg-slate-900/50 border-t border-gray-200 dark:border-slate-700 rounded-b-lg flex justify-end space-x-3">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 transition">Cancel</button>
                    <button onClick={handleConfirm} disabled={requirePRN && (physicalReceipt || '').trim().length === 0} className="px-6 py-2 bg-primary-600 disabled:opacity-50 text-white rounded-lg font-semibold hover:bg-primary-700 transition">
                        Confirm Payment
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PaymentModal;
