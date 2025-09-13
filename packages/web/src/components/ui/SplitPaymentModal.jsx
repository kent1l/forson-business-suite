import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSettings } from '../../contexts/SettingsContext';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const SplitPaymentModal = ({ 
    isOpen, 
    onClose, 
    totalDue, 
    existingPayments = [],
    onConfirm,
    physicalReceiptNo = '',
    onPhysicalReceiptChange = () => {}
}) => {
    const { settings } = useSettings();
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(false);
    const initializedRef = useRef(false);

    // Check if split payments feature is enabled (memoized to prevent unnecessary re-renders)
    const splitPaymentsEnabled = useMemo(() => 
        settings?.ENABLE_SPLIT_PAYMENTS === 'true', 
        [settings?.ENABLE_SPLIT_PAYMENTS]
    );

    // Fetch payment methods from API if split payments enabled, otherwise use settings fallback
    const fetchPaymentMethods = useCallback(async () => {
        if (!splitPaymentsEnabled) {
            // Fallback to legacy PAYMENT_METHODS setting
            const methodsString = settings?.PAYMENT_METHODS || 'Cash';
            const legacyMethods = methodsString.split(',').map((method, index) => ({
                method_id: `legacy_${index}`,
                code: method.toLowerCase().replace(/\s+/g, '_'),
                name: method.trim(),
                type: method.toLowerCase().includes('cash') ? 'cash' : 'other',
                enabled: true,
                sort_order: index,
                config: {
                    requires_reference: method.toLowerCase().includes('card'),
                    reference_label: 'Reference',
                    requires_receipt_no: method.toLowerCase().includes('card'),
                    change_allowed: method.toLowerCase().includes('cash'),
                    settlement_type: 'instant'
                }
            }));
            setPaymentMethods(legacyMethods);
            return;
        }

        try {
            const response = await api.get('/payment-methods/enabled');
            setPaymentMethods(response.data);
        } catch (err) {
            console.error('Failed to fetch payment methods:', err);
            toast.error('Failed to load payment methods');
            // Fallback to legacy settings
            const methodsString = settings?.PAYMENT_METHODS || 'Cash';
            const legacyMethods = methodsString.split(',').map((method, index) => ({
                method_id: `legacy_${index}`,
                code: method.toLowerCase().replace(/\s+/g, '_'),
                name: method.trim(),
                type: method.toLowerCase().includes('cash') ? 'cash' : 'other',
                enabled: true,
                sort_order: index,
                config: {
                    requires_reference: method.toLowerCase().includes('card'),
                    reference_label: 'Reference',
                    requires_receipt_no: method.toLowerCase().includes('card'),
                    change_allowed: method.toLowerCase().includes('cash'),
                    settlement_type: 'instant'
                }
            }));
            setPaymentMethods(legacyMethods);
        }
    }, [splitPaymentsEnabled, settings?.PAYMENT_METHODS]); // Only depend on specific settings properties

    // Create a stable key for existingPayments to avoid unnecessary re-renders
    const existingPaymentsKey = useMemo(() => 
        JSON.stringify(existingPayments), 
        [existingPayments]
    );

    // Initialize payments when modal opens (prevent infinite loops)
    useEffect(() => {
        if (isOpen && !initializedRef.current) {
            initializedRef.current = true;
            fetchPaymentMethods();
            
            if (existingPayments.length > 0) {
                setPayments(existingPayments);
            } else {
                // Start with one empty payment
                setPayments([{
                    id: Date.now(),
                    method_id: '',
                    amount_paid: 0,
                    tendered_amount: '',
                    reference: '',
                    metadata: {}
                }]);
            }
        } else if (!isOpen) {
            // Reset when modal closes
            initializedRef.current = false;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, existingPaymentsKey, fetchPaymentMethods]); // Use stable key

    // Auto-focus first input when modal opens
    useEffect(() => {
        if (isOpen && paymentMethods.length > 0) {
            setTimeout(() => {
                const firstInput = document.querySelector('.split-payment-modal input, .split-payment-modal select');
                if (firstInput) firstInput.focus();
            }, 100);
        }
    }, [isOpen, paymentMethods]);

    const addPaymentLine = () => {
        const newPayment = {
            id: Date.now(),
            method_id: paymentMethods[0]?.method_id || '',
            amount_paid: 0,
            tendered_amount: '',
            reference: '',
            metadata: {}
        };
        setPayments(prev => [...prev, newPayment]);
    };

    const removePaymentLine = (id) => {
        if (payments.length > 1) {
            setPayments(prev => prev.filter(p => p.id !== id));
        }
    };

    const updatePayment = (id, field, value) => {
        setPayments(prev => prev.map(payment => 
            payment.id === id ? { ...payment, [field]: value } : payment
        ));
    };

    // Calculate totals and validation
    const { totalPayments, totalChange, remaining, canConfirm, validationErrors } = useMemo(() => {
        let totalPaid = 0;
        let totalChangeAmount = 0;
        const errors = [];

        for (const payment of payments) {
            const method = paymentMethods.find(m => m.method_id === payment.method_id);
            const amountPaid = parseFloat(payment.amount_paid) || 0;
            const tenderedAmount = parseFloat(payment.tendered_amount) || 0;

            totalPaid += amountPaid;

            // Calculate change for this payment
            if (method && method.config.change_allowed && tenderedAmount > amountPaid) {
                totalChangeAmount += (tenderedAmount - amountPaid);
            }

            // Validate this payment
            if (!payment.method_id) {
                errors.push(`Payment method is required`);
            }
            if (amountPaid <= 0) {
                errors.push(`Amount must be greater than 0`);
            }
            if (method) {
                if (method.config.requires_reference && !payment.reference.trim()) {
                    errors.push(`${method.config.reference_label || 'Reference'} is required for ${method.name}`);
                }
                if (method.config.requires_receipt_no && !physicalReceiptNo.trim()) {
                    errors.push(`Physical receipt number is required for ${method.name}`);
                }
                if (!method.config.change_allowed && tenderedAmount > amountPaid) {
                    errors.push(`Change not allowed for ${method.name}`);
                }
            }
        }

        const remainingDue = Math.max((totalDue || 0) - totalPaid, 0);
        const canConfirm = errors.length === 0 && remainingDue <= 0.01; // Allow small rounding differences

        return {
            totalPayments: totalPaid,
            totalChange: totalChangeAmount,
            remaining: remainingDue,
            canConfirm,
            validationErrors: errors
        };
    }, [payments, paymentMethods, totalDue, physicalReceiptNo]);

    // Auto-allocate remaining amount to selected payment method
    const autoAllocateRemaining = (paymentId) => {
        if (remaining > 0) {
            updatePayment(paymentId, 'amount_paid', remaining.toFixed(2));
        }
    };

    const handleConfirm = useCallback(async () => {
        if (!canConfirm) return;

        setLoading(true);
        try {
            // Format payments for API
            const formattedPayments = payments.map(payment => {
                const method = paymentMethods.find(m => m.method_id === payment.method_id);
                const amountPaid = parseFloat(payment.amount_paid);
                const tenderedAmount = parseFloat(payment.tendered_amount) || null;

                return {
                    method_id: payment.method_id,
                    amount_paid: amountPaid,
                    tendered_amount: tenderedAmount,
                    reference: payment.reference.trim() || null,
                    metadata: {
                        ...payment.metadata,
                        method_name: method?.name || 'Unknown'
                    }
                };
            });

            await onConfirm(formattedPayments, physicalReceiptNo);
            onClose();
        } catch (err) {
            console.error('Payment confirmation error:', err);
            toast.error('Failed to process payments');
        } finally {
            setLoading(false);
        }
    }, [canConfirm, payments, paymentMethods, onConfirm, physicalReceiptNo, onClose]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (!isOpen) return;

            if (e.key === 'Escape') {
                onClose();
            } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                if (canConfirm) handleConfirm();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, canConfirm, onClose, handleConfirm]);

    if (!isOpen) return null;

    const requiresPhysicalReceipt = payments.some(payment => {
        const method = paymentMethods.find(m => m.method_id === payment.method_id);
        return method && method.config.requires_receipt_no;
    });

    return (
        <div className="fixed inset-0 bg-neutral-800/50 flex items-center justify-center z-50 transition-opacity">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl max-h-[90vh] overflow-hidden transform transition-all">
                <div className="flex items-center justify-between p-4 border-b bg-gray-50 rounded-t-lg">
                    <h2 className="text-xl font-semibold text-gray-800">
                        {splitPaymentsEnabled ? 'Split Payment' : 'Process Payment'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-500 hover:text-gray-800 transition-colors"
                    >
                        <Icon path={ICONS.close} className="h-6 w-6" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)]">
                    {/* Summary */}
                    <div className="mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div>
                                <div className="text-sm font-medium text-slate-500">Total Due</div>
                                <div className="text-2xl font-bold text-slate-800">
                                    {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{(totalDue || 0).toFixed(2)}
                                </div>
                            </div>
                            <div>
                                <div className="text-sm font-medium text-slate-500">Total Payments</div>
                                <div className="text-2xl font-bold text-blue-600">
                                    {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{totalPayments.toFixed(2)}
                                </div>
                            </div>
                            <div>
                                <div className="text-sm font-medium text-slate-500">Remaining</div>
                                <div className={`text-2xl font-bold ${remaining > 0.01 ? 'text-red-600' : 'text-green-600'}`}>
                                    {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{remaining.toFixed(2)}
                                </div>
                            </div>
                            {totalChange > 0 && (
                                <div>
                                    <div className="text-sm font-medium text-slate-500">Change Due</div>
                                    <div className="text-2xl font-bold text-orange-500">
                                        {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{totalChange.toFixed(2)}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Physical Receipt Input */}
                    {requiresPhysicalReceipt && (
                        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Physical Receipt Number <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                value={physicalReceiptNo}
                                onChange={(e) => onPhysicalReceiptChange(e.target.value)}
                                className="w-full px-3 py-2 border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                placeholder={settings?.RECEIPT_NO_HELP_TEXT || 'Enter pre-printed receipt number'}
                                required
                            />
                            <p className="text-xs text-amber-800 mt-1">
                                This payment method requires a physical receipt number.
                            </p>
                        </div>
                    )}

                    {/* Payment Lines */}
                    <div className="space-y-4">
                        {payments.map((payment, index) => {
                            const method = paymentMethods.find(m => m.method_id === payment.method_id);
                            const showTendered = method && method.config.change_allowed;
                            const showReference = method && method.config.requires_reference;

                            return (
                                <div key={payment.id} className="p-4 border border-gray-200 rounded-lg bg-white shadow-sm">
                                    <div className="flex items-center justify-between mb-4">
                                        <h4 className="font-medium text-gray-800">Payment {index + 1}</h4>
                                        {payments.length > 1 && (
                                            <button
                                                onClick={() => removePaymentLine(payment.id)}
                                                className="text-red-500 hover:text-red-700 transition-colors"
                                            >
                                                <Icon path={ICONS.trash} className="h-5 w-5" />
                                            </button>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Payment Method <span className="text-red-500">*</span>
                                            </label>
                                            <select
                                                value={payment.method_id}
                                                onChange={(e) => updatePayment(payment.id, 'method_id', e.target.value)}
                                                className="w-full px-3 py-2 border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                                required
                                            >
                                                <option value="">Select method...</option>
                                                {paymentMethods.map(method => (
                                                    <option key={method.method_id} value={method.method_id}>
                                                        {method.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                Amount <span className="text-red-500">*</span>
                                            </label>
                                            <div className="flex">
                                                <input
                                                    type="number"
                                                    value={payment.amount_paid}
                                                    onChange={(e) => updatePayment(payment.id, 'amount_paid', e.target.value)}
                                                    onFocus={(e) => e.target.select()}
                                                    className="flex-1 px-3 py-2 border-gray-300 rounded-l-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                                    min="0"
                                                    step="0.01"
                                                    required
                                                />
                                                {remaining > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => autoAllocateRemaining(payment.id)}
                                                        className="px-3 py-2 bg-indigo-600 text-white rounded-r-lg hover:bg-indigo-700 text-xs font-semibold transition-colors"
                                                        title="Allocate remaining amount"
                                                    >
                                                        FILL
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {showTendered && (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 mb-1">
                                                    Tendered
                                                </label>
                                                <input
                                                    type="number"
                                                    value={payment.tendered_amount}
                                                    onChange={(e) => updatePayment(payment.id, 'tendered_amount', e.target.value)}
                                                    onFocus={(e) => e.target.select()}
                                                    className="w-full px-3 py-2 border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                                    min="0"
                                                    step="0.01"
                                                    placeholder="Optional for exact amount"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    {showReference && (
                                        <div className="mt-4">
                                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                                {method.config.reference_label || 'Reference'} <span className="text-red-500">*</span>
                                            </label>
                                            <input
                                                type="text"
                                                value={payment.reference}
                                                onChange={(e) => updatePayment(payment.id, 'reference', e.target.value)}
                                                className="w-full px-3 py-2 border-gray-300 rounded-lg shadow-sm focus:ring-indigo-500 focus:border-indigo-500"
                                                placeholder={`Enter ${method.config.reference_label || 'reference'}`}
                                                required
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Add Payment Button */}
                    {splitPaymentsEnabled && paymentMethods.length > 0 && (
                        <button
                            type="button"
                            onClick={addPaymentLine}
                            className="mt-4 w-full py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-indigo-400 hover:text-indigo-600 transition-colors flex items-center justify-center"
                        >
                            <Icon path={ICONS.plus} className="h-5 w-5 mr-2" />
                            Add Another Payment Method
                        </button>
                    )}

                    {/* Validation Errors */}
                    {validationErrors.length > 0 && (
                        <div className="mt-6 p-3 bg-red-50 border border-red-200 rounded-lg">
                            <h4 className="text-sm font-medium text-red-800 mb-2">Please fix the following errors:</h4>
                            <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
                                {validationErrors.map((error, index) => (
                                    <li key={index}>{error}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                <div className="flex justify-between items-center p-4 bg-gray-100 border-t rounded-b-lg">
                    <div className="text-sm text-gray-600">
                        <kbd className="px-2 py-1 bg-white border border-gray-300 rounded text-xs shadow-sm">Esc</kbd> to cancel •{' '}
                        <kbd className="px-2 py-1 bg-white border border-gray-300 rounded text-xs shadow-sm">Ctrl+Enter</kbd> to confirm
                    </div>
                    <div className="flex space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-white border border-gray-300 text-gray-800 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={!canConfirm || loading}
                            className="px-6 py-2 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                            {loading ? 'Processing...' : 'Confirm Payment'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SplitPaymentModal;
