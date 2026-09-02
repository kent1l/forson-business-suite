import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSettings } from '../../contexts/SettingsContext';
import Icon from '../ui/Icon';
import InfoTip from '../ui/InfoTip';
import MathExpressionInput from './MathExpressionInput';
import { ICONS } from '../../constants';

const SplitPaymentModal = ({
    isOpen,
    onClose,
    totalDue,
    existingPayments = [],
    onConfirm,
    physicalReceiptNo = '',
    onPhysicalReceiptChange = () => {},
    employeeId = null,
    customerName = '',
    terms = '',
    onTermsChange = () => {},
    commonTerms = ['0', '7', '15', '30'],
    generalDefaultTermsDays = '',
    onAccountDefaultTermsDays = null,
    // Withholding context. `customer` carries is_withholding_agent/customer_type;
    // `lines` and `taxRateId` are what the server needs to compute the expected
    // deduction from authoritative part and rate data.
    customer = null,
    lines = [],
    taxRateId = null
}) => {
    const { settings } = useSettings();
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showOnAccountConfirmation, setShowOnAccountConfirmation] = useState(false);
    const initializedRef = useRef(false);
    const appliedOnAccountDefaultRef = useRef(false);
    const [withholdingPreview, setWithholdingPreview] = useState(null);
    const appliedWithholdingRef = useRef(false);
    // Read by updatePayment, which is declared above the preview state it needs.
    const withholdingMethodIdRef = useRef(null);
    const withholdingExpectedRef = useRef(0);

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
            // Ensure method.config is an object (API may return it as JSON string in some cases)
            const normalized = response.data.map(m => ({
                ...m,
                config: typeof m.config === 'string' ? JSON.parse(m.config) : (m.config || {})
            }));
            setPaymentMethods(normalized);
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
            appliedOnAccountDefaultRef.current = false;
            appliedWithholdingRef.current = false;
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
        setPayments(prev => prev.map(payment => {
            if (payment.id !== id) return payment;
            const next = { ...payment, [field]: value };

            // Picking the withholding method fills in what the customer is expected
            // to deduct. The cashier is confirming a figure computed from the
            // VAT-exclusive base, not working it out at the counter -- that
            // calculation is the single thing most often got wrong, and a blank box
            // invites exactly the mistake the base exists to prevent.
            //
            // Still editable afterwards: what the customer actually withheld is
            // whatever their voucher says, and the certificate has to reconcile
            // against that, not against what we think it should have been.
            if (field === 'method_id' && withholdingMethodIdRef.current
                && String(value) === String(withholdingMethodIdRef.current)
                && !parseFloat(payment.amount_paid)) {
                next.amount_paid = withholdingExpectedRef.current || 0;
            }
            return next;
        }));
    };

    const hasOnAccountLine = useMemo(() => payments.some(payment => {
        const method = paymentMethods.find(m => String(m.method_id) === String(payment.method_id));
        return method?.settlement_type === 'on_account';
    }), [payments, paymentMethods]);

    // The first time this session an On Account line is picked, switch the
    // invoice's Payment Terms to the configured on-account default -- but
    // only if terms still match the general default, so an explicit choice
    // already made on the Invoicing page (e.g. for a specific customer)
    // isn't clobbered.
    useEffect(() => {
        if (hasOnAccountLine && !appliedOnAccountDefaultRef.current && onAccountDefaultTermsDays !== null) {
            appliedOnAccountDefaultRef.current = true;
            if (terms === generalDefaultTermsDays) {
                onTermsChange(onAccountDefaultTermsDays);
            }
        }
    }, [hasOnAccountLine, onAccountDefaultTermsDays, terms, generalDefaultTermsDays, onTermsChange]);

    // Ask the server what this customer is expected to withhold. The figure is not
    // computed here: it derives from the VAT-exclusive base, and a base assembled in
    // the browser is a base the browser can change -- this one reduces a receivable.
    useEffect(() => {
        if (!isOpen || !customer?.is_withholding_agent || !customer?.customer_id || lines.length === 0) {
            setWithholdingPreview(null);
            return;
        }
        let cancelled = false;
        api.post('/withholding/preview', {
            customer_id: customer.customer_id,
            tax_rate_id: taxRateId,
            lines: lines.map(l => ({
                part_id: l.part_id,
                quantity: l.quantity,
                sale_price: l.sale_price,
                discount_amount: l.discount_amount || 0,
                tax_rate_id: l.tax_rate_id,
            })),
        })
            .then(res => { if (!cancelled) setWithholdingPreview(res.data?.applicable ? res.data : null); })
            .catch(() => { if (!cancelled) setWithholdingPreview(null); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, customer?.customer_id, customer?.is_withholding_agent, taxRateId, JSON.stringify(lines)]);

    const withholdingMethod = useMemo(
        () => paymentMethods.find(m => m.code === 'withholding_tax'),
        [paymentMethods]
    );

    // Tax withheld at source settles a receivable with no cash received, so it is not
    // a method anyone should be able to reach for on an ordinary sale. It is offered
    // only where it is legally possible: to a customer BIR has designated.
    useEffect(() => {
        withholdingMethodIdRef.current = withholdingMethod?.method_id ?? null;
        withholdingExpectedRef.current = withholdingPreview?.total_withheld ?? 0;
    }, [withholdingMethod, withholdingPreview]);

    const selectableMethods = useMemo(
        () => paymentMethods.filter(m => m.code !== 'withholding_tax' || customer?.is_withholding_agent),
        [paymentMethods, customer?.is_withholding_agent]
    );

    // Pre-fill the deduction once the preview lands, so the cashier confirms a figure
    // rather than computing one. Only once per opening: after that the line is theirs
    // to correct, because what the customer actually withheld is often not what they
    // should have withheld.
    useEffect(() => {
        if (!withholdingPreview || !withholdingMethod || appliedWithholdingRef.current) return;
        appliedWithholdingRef.current = true;
        setPayments(prev => {
            if (prev.some(p => String(p.method_id) === String(withholdingMethod.method_id))) return prev;
            const withholdingLine = {
                id: Date.now() + 1,
                method_id: withholdingMethod.method_id,
                amount_paid: withholdingPreview.total_withheld,
                tendered_amount: '',
                reference: '',
                metadata: {},
            };
            // An untouched blank line is replaced rather than added to, so the cashier
            // sees the net cash due on the first line instead of a stray empty row.
            const blank = prev.filter(p => !p.method_id && !parseFloat(p.amount_paid));
            const kept = prev.filter(p => p.method_id || parseFloat(p.amount_paid));
            return blank.length > 0 && kept.length === 0
                ? [withholdingLine, { ...blank[0], amount_paid: withholdingPreview.net_due }]
                : [...prev, withholdingLine];
        });
    }, [withholdingPreview, withholdingMethod]);

    // Calculate totals and validation
    const { totalPayments, totalChange, remaining, canConfirm, validationErrors, onAccountSum, requiresOnAccountConfirmation } = useMemo(() => {
        let totalPaid = 0;
        let totalChangeAmount = 0;
        let onAccountTotal = 0;
        const errors = [];

        for (const payment of payments) {
            // Normalize comparison because method_id can be number (from API) or string (from select value)
            const method = paymentMethods.find(m => String(m.method_id) === String(payment.method_id));
            const amountPaid = parseFloat(payment.amount_paid) || 0;
            const tenderedAmount = parseFloat(payment.tendered_amount) || 0;

            // Count payments based on settlement type:
            // - instant: count immediately toward total
            // - delayed: count toward total (will be pending but shows intent)
            // - on_account: don't count toward paid, but track separately for on-account logic
            const settlementType = method?.settlement_type || 'instant';
            
            if (settlementType === 'on_account') {
                onAccountTotal += amountPaid;
            } else {
                totalPaid += amountPaid;
            }

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
                if (method.settlement_type === 'on_account' && (!customerName || customerName.trim().toLowerCase().includes('walk-in') || customerName.trim().toLowerCase().includes('walk in'))) {
                    errors.push(`On Account is not available for Walk-In customers`);
                }
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
        const coveredByOnAccount = onAccountTotal >= remainingDue;
        const requiresOnAccountConfirmation = onAccountTotal > 0 && remainingDue > 0.01 && coveredByOnAccount;
        const canConfirm = errors.length === 0 && (remainingDue <= 0.01 || coveredByOnAccount);

        return {
            totalPayments: totalPaid,
            totalChange: totalChangeAmount,
            remaining: remainingDue,
            canConfirm,
            validationErrors: errors,
            onAccountSum: onAccountTotal,
            requiresOnAccountConfirmation
        };
    }, [payments, paymentMethods, totalDue, physicalReceiptNo]);

    // Auto-allocate remaining amount to selected payment method
    // Compute remaining at click time to avoid stale closure values.
    const autoAllocateRemaining = (paymentId) => {
        setPayments(prev => {
            // Sum amounts excluding the target payment and pending payments
            const totalPaidExcluding = prev.reduce((sum, p) => {
                if (p.id === paymentId || (p.payment_status && p.payment_status !== 'settled')) return sum;
                const v = parseFloat(p.amount_paid) || 0;
                return sum + v;
            }, 0);

            const remainingNow = Math.max((totalDue || 0) - totalPaidExcluding, 0);

            return prev.map(p => p.id === paymentId ? { ...p, amount_paid: remainingNow.toFixed(2) } : p);
        });
    };

    // Mark a payment as settled
    const markPaymentSettled = async (paymentId) => {
        try {
            await api.post(`/payments/${paymentId}/settle`);
            setPayments(prev => prev.map(p => 
                p.id === paymentId ? { ...p, payment_status: 'settled', settled_at: new Date().toISOString() } : p
            ));
            toast.success('Payment marked as settled');
        } catch (err) {
            console.error('Failed to mark payment settled:', err);
            toast.error('Failed to mark payment as settled');
        }
    };

    const handleConfirm = useCallback(async () => {
        // Prevent submission when client-side validation errors exist
        if (validationErrors.length > 0) {
            toast.error(validationErrors[0] || 'Please fix validation errors before confirming');
            return;
        }

        if (!canConfirm) return;

        // Check if on-account confirmation is required
        if (requiresOnAccountConfirmation && !showOnAccountConfirmation) {
            setShowOnAccountConfirmation(true);
            return;
        }

        setLoading(true);
        try {
            // Format payments for API
            const formattedPayments = payments.map(payment => {
                const method = paymentMethods.find(m => String(m.method_id) === String(payment.method_id));
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

            await onConfirm(formattedPayments, physicalReceiptNo, { employeeId });
            onClose();
        } catch (err) {
            console.error('Payment confirmation error:', err);
            toast.error('Failed to process payments');
        } finally {
            setLoading(false);
        }
    }, [canConfirm, payments, paymentMethods, onConfirm, physicalReceiptNo, onClose, validationErrors, requiresOnAccountConfirmation, showOnAccountConfirmation, employeeId]);

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
        const method = paymentMethods.find(m => String(m.method_id) === String(payment.method_id));
        return method && method.config.requires_receipt_no;
    });

    return (
        <div className="fixed inset-0 bg-neutral-800/50 flex items-center justify-center z-50 transition-opacity split-payment-modal p-4">
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700 w-full max-w-4xl max-h-[90vh] overflow-hidden transform transition-all flex flex-col">
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-800/50 rounded-t-lg">
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-slate-100">
                        {splitPaymentsEnabled ? 'Split Payment' : 'Process Payment'}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-slate-200 transition-colors"
                    >
                        <Icon path={ICONS.close} className="h-6 w-6" />
                    </button>
                </div>

                <div className="p-6 overflow-y-auto max-h-[calc(90vh-140px)] flex-1">
                    {/* Summary */}
                    <div className="mb-6 p-4 bg-slate-50 dark:bg-slate-900/50 rounded-lg border border-slate-200 dark:border-slate-700">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-center">
                            <div>
                                <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Due</div>
                                <div className="text-2xl font-bold text-slate-800 dark:text-slate-50">
                                    {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{(totalDue || 0).toFixed(2)}
                                </div>
                            </div>
                            <div>
                                <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Total Payments</div>
                                <div className="text-2xl font-bold text-primary-600 dark:text-primary-400">
                                    {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{totalPayments.toFixed(2)}
                                </div>
                            </div>
                            <div>
                                <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Remaining</div>
                                <div className={`text-2xl font-bold ${remaining > 0.01 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                                    {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{remaining.toFixed(2)}
                                </div>
                            </div>
                            {totalChange > 0 && (
                                <div>
                                    <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Change Due</div>
                                    <div className="text-2xl font-bold text-warning-600 dark:text-warning-400">
                                        {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{totalChange.toFixed(2)}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Withholding disclosure. Shown as a breakdown rather than a single
                        number because the cashier has to reconcile it line by line against
                        the customer's own computation when the certificate arrives. */}
                    {withholdingPreview && (
                        <div className="mb-6 p-4 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-800/60 rounded-lg">
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h4 className="text-sm font-semibold text-sky-900 dark:text-sky-200 flex items-center gap-1">
                                        Tax withheld at source
                                        <InfoTip label="Tax withheld at source">
                                            This customer is a withholding agent, so they pay the invoice net of tax and remit the difference to BIR under our TIN. The invoice total does not change &mdash; the balance is settled by the BIR certificate they issue instead of by cash. Adjust the amount if they withheld something different; the certificate is what has to reconcile.
                                        </InfoTip>
                                    </h4>
                                    <p className="text-xs text-sky-800 dark:text-sky-300 mt-0.5">
                                        Computed on the VAT-exclusive base of {settings?.DEFAULT_CURRENCY_SYMBOL || '\u20B1'}
                                        {(withholdingPreview.base_goods + withholdingPreview.base_services).toFixed(2)}
                                        {', not on the invoice total.'}
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className="text-xs text-sky-700 dark:text-sky-400">Net cash due</div>
                                    <div className="text-lg font-bold text-sky-900 dark:text-sky-100 font-mono">
                                        {settings?.DEFAULT_CURRENCY_SYMBOL || '\u20B1'}{Number(withholdingPreview.net_due).toFixed(2)}
                                    </div>
                                </div>
                            </div>
                            <div className="mt-3 space-y-1">
                                {withholdingPreview.components.map(c => (
                                    <div key={c.withholding_type} className="flex justify-between text-xs text-sky-900 dark:text-sky-200">
                                        <span>
                                            {c.withholding_type === 'EWT_GOODS' && 'Expanded withholding tax, goods'}
                                            {c.withholding_type === 'EWT_SERVICES' && 'Expanded withholding tax, services'}
                                            {c.withholding_type === 'VAT_GOV' && 'Withholding VAT, government'}
                                            {' \u00B7 '}{c.atc_code}{' \u00B7 '}{(c.rate_snapshot * 100).toFixed(0)}% of {Number(c.tax_base).toFixed(2)}
                                            {' \u00B7 Form '}{c.certificate_type}
                                        </span>
                                        <span className="font-mono">{Number(c.expected_withheld).toFixed(2)}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Physical Receipt Input */}
                    {requiresPhysicalReceipt && (
                        <div className="mb-6 p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg">
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">
                                Physical Receipt Number <span className="text-danger-600">*</span>
                            </label>
                            <input
                                type="text"
                                value={physicalReceiptNo}
                                onChange={(e) => onPhysicalReceiptChange(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm focus:ring-primary-500 focus:border-primary-500"
                                placeholder={settings?.RECEIPT_NO_HELP_TEXT || 'Enter pre-printed receipt number'}
                                required
                            />
                            <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                                This payment method requires a physical receipt number.
                            </p>
                        </div>
                    )}

                    {/* Payment Terms -- surfaced here because On Account doesn't collect
                        payment now; the customer owes the balance under these terms. */}
                    {hasOnAccountLine && (
                        <div className="mb-6 p-4 bg-primary-50 dark:bg-primary-950/30 border border-primary-200 dark:border-primary-800/60 rounded-lg">
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-1">
                                Payment Terms
                                <InfoTip label="Payment Terms">
                                    How long the customer has to pay this On Account balance. Defaults to the on-account terms configured in Settings, but can be adjusted per sale.
                                </InfoTip>
                            </label>
                            <div className="flex items-center space-x-3">
                                <select
                                    value={commonTerms.includes(terms) ? terms : 'custom'}
                                    onChange={(e) => onTermsChange(e.target.value)}
                                    className="px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg shadow-sm focus:ring-primary-500 focus:border-primary-500 text-sm"
                                >
                                    {commonTerms.map(ct => <option key={ct} value={ct}>{ct === '0' ? 'Due on Receipt' : `${ct} Days`}</option>)}
                                    <option value="custom">Custom...</option>
                                </select>
                                <input
                                    type="text"
                                    value={terms}
                                    onChange={(e) => onTermsChange(e.target.value)}
                                    onFocus={(e) => e.target.select()}
                                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg shadow-sm focus:ring-primary-500 focus:border-primary-500 text-sm"
                                    placeholder="e.g., 30"
                                />
                            </div>
                        </div>
                    )}

                    {/* Payment Lines */}
                    <div className="space-y-4">
                        {payments.map((payment, index) => {
                            const method = paymentMethods.find(m => String(m.method_id) === String(payment.method_id));
                            const showTendered = method && method.config.change_allowed;
                            const showReference = method && method.config.requires_reference;

                            return (
                                <div key={payment.id} className="p-4 border border-gray-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 shadow-sm">
                                    <div className="flex items-center justify-between mb-4">
                                        <div className="flex items-center space-x-2">
                                            <h4 className="font-medium text-gray-800 dark:text-slate-100">Payment {index + 1}</h4>
                                            {payment.payment_status && (
                                                <span className={`px-2 py-1 text-xs font-medium rounded-full ${
                                                    payment.payment_status === 'settled' 
                                                        ? 'bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-400' 
                                                        : 'bg-warning-100 dark:bg-warning-900/30 text-warning-800 dark:text-warning-400'
                                                }`}>
                                                    {payment.payment_status === 'settled' ? 'Settled' : 'Pending'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center space-x-2">
                                            {payment.payment_status === 'pending' && (
                                                <button
                                                    onClick={() => markPaymentSettled(payment.id)}
                                                    className="px-3 py-1 bg-success-600 text-white text-xs rounded hover:bg-success-700 transition-colors"
                                                    title="Mark as settled"
                                                >
                                                    Mark Settled
                                                </button>
                                            )}
                                            {payments.length > 1 && (
                                                <button
                                                    onClick={() => removePaymentLine(payment.id)}
                                                    className="text-danger-500 hover:text-danger-700 transition-colors"
                                                >
                                                    <Icon path={ICONS.trash} className="h-5 w-5" />
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                                                Payment Method <span className="text-danger-600">*</span>
                                                <InfoTip label="Payment Method">
                                                    Instant methods count right away; delayed methods (e.g. Cheque) stay pending until settled; On Account isn't collected now — it invoices the customer and requires a real, registered customer (not Walk-in).
                                                </InfoTip>
                                            </label>
                                            <select
                                                value={payment.method_id}
                                                onChange={(e) => updatePayment(payment.id, 'method_id', e.target.value)}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm focus:ring-primary-500 focus:border-primary-500"
                                                required
                                            >
                                                <option value="">Select method...</option>
                                                {selectableMethods.map(method => (
                                                    <option key={method.method_id} value={method.method_id}>
                                                        {method.name} 
                                                        {method.settlement_type === 'instant' && ' (instant)'}
                                                        {method.settlement_type === 'delayed' && ' (pending until settled)'}
                                                        {method.settlement_type === 'on_account' && ' (on account)'}
                                                    </option>
                                                ))}
                                            </select>
                                            {method && method.settlement_type && (
                                                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                                    {method.settlement_type === 'instant' && '✓ Counted immediately toward invoice payment'}
                                                    {method.settlement_type === 'delayed' && '⏳ Will be pending until manually settled'}
                                                    {method.settlement_type === 'on_account' && '📋 No payment recorded - invoice remains due'}
                                                </p>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                                                Amount <span className="text-danger-600">*</span>
                                            </label>
                                            <div className="relative">
                                                <MathExpressionInput
                                                    precision={2}
                                                    value={payment.amount_paid}
                                                    onChange={(val) => updatePayment(payment.id, 'amount_paid', val)}
                                                    className="w-full pr-16 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm focus:ring-primary-500 focus:border-primary-500"
                                                    min={0}
                                                    required
                                                />
                                                {remaining > 0 && (
                                                    <button
                                                        type="button"
                                                        onClick={() => autoAllocateRemaining(payment.id)}
                                                        className="absolute inset-y-0 right-0 px-3 bg-primary-600 text-white rounded-r-lg hover:bg-primary-700 text-xs font-semibold transition-colors cursor-pointer select-none"
                                                        title="Allocate remaining amount"
                                                        aria-label="Fill remaining amount"
                                                    >
                                                        FILL
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {showTendered ? (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                                                    Tendered
                                                </label>
                                                <MathExpressionInput
                                                    precision={2}
                                                    value={payment.tendered_amount}
                                                    onChange={(val) => updatePayment(payment.id, 'tendered_amount', val)}
                                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm focus:ring-primary-500 focus:border-primary-500"
                                                    min={0}
                                                    placeholder="Optional for exact amount"
                                                />
                                            </div>
                                        ) : (
                                            <div />
                                        )}

                                        {/* Inline reference input when required by method config */}
                                        <div className="col-span-1 sm:col-span-1">
                                            {showReference ? (
                                                <>
                                                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                                                        {(method?.config?.reference_label || 'Reference')} <span className="text-danger-600">*</span>
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={payment.reference}
                                                        onChange={(e) => updatePayment(payment.id, 'reference', e.target.value)}
                                                        className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm focus:ring-primary-500 focus:border-primary-500"
                                                        placeholder={`Enter ${method?.config?.reference_label || 'reference'}`}
                                                        required
                                                    />
                                                </>
                                            ) : (
                                                <div />
                                            )}
                                        </div>

                                        {/* Payment Status */}
                                        <div className="col-span-1 sm:col-span-1">
                                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                                                Status
                                            </label>
                                            <div className="px-3 py-2 rounded-lg text-sm font-medium">
                                                {(() => {
                                                    if (!method) return <span className="text-gray-400 dark:text-slate-500">-</span>;
                                                    
                                                    const settlementType = method.settlement_type || 'instant';
                                                    
                                                    // For new payments (no payment_status yet), determine status by settlement type
                                                    let effectiveStatus;
                                                    if (payment.payment_status) {
                                                        effectiveStatus = payment.payment_status;
                                                    } else {
                                                        // New payment - determine status from settlement type
                                                        if (settlementType === 'delayed') {
                                                            effectiveStatus = 'pending';
                                                        } else if (settlementType === 'instant') {
                                                            effectiveStatus = 'settled';
                                                        } else {
                                                            effectiveStatus = 'on_account';
                                                        }
                                                    }
                                                    
                                                    if (settlementType === 'on_account') {
                                                        return <span className="text-primary-600 dark:text-primary-400 bg-primary-50 dark:bg-primary-900/30 px-2 py-1 rounded">On Account</span>;
                                                    } else if (effectiveStatus === 'pending') {
                                                        return <span className="text-warning-600 dark:text-warning-400 bg-warning-50 dark:bg-warning-900/30 px-2 py-1 rounded">Pending</span>;
                                                    } else {
                                                        return <span className="text-success-600 dark:text-success-400 bg-success-50 dark:bg-success-900/30 px-2 py-1 rounded">Paid</span>;
                                                    }
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    {/* Add Payment Button */}
                    {splitPaymentsEnabled && paymentMethods.length > 0 && (
                        <button
                            type="button"
                            onClick={addPaymentLine}
                            className="mt-4 w-full py-2 border-2 border-dashed border-gray-300 dark:border-slate-600 rounded-lg text-gray-600 dark:text-slate-300 hover:border-primary-400 hover:text-primary-600 dark:hover:border-primary-400 dark:hover:text-primary-400 transition-colors flex items-center justify-center"
                        >
                            <Icon path={ICONS.plus} className="h-5 w-5 mr-2" />
                            Add Another Payment Method
                        </button>
                    )}

                    {/* Validation Errors */}
                    {validationErrors.length > 0 && (
                        <div className="mt-6 p-3 bg-danger-50 dark:bg-danger-950/40 border border-danger-200 dark:border-danger-800/60 rounded-lg">
                            <h4 className="text-sm font-medium text-danger-800 dark:text-danger-300 mb-2">Please fix the following errors:</h4>
                            <ul className="text-sm text-danger-700 dark:text-danger-400 space-y-1 list-disc list-inside">
                                {validationErrors.map((error, index) => (
                                    <li key={index}>{error}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>

                <div className="flex justify-between items-center p-4 bg-gray-50 dark:bg-slate-900/50 border-t border-gray-200 dark:border-slate-700 rounded-b-lg">
                    <div className="text-sm text-gray-600 dark:text-slate-400">
                        <kbd className="px-2 py-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded text-xs shadow-sm">Esc</kbd> to cancel •{' '}
                        <kbd className="px-2 py-1 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 rounded text-xs shadow-sm">Ctrl+Enter</kbd> to confirm
                    </div>
                    <div className="flex space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors shadow-sm"
                            disabled={loading}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={!canConfirm || loading}
                            className="px-6 py-2 bg-success-600 text-white rounded-lg font-semibold hover:bg-success-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                        >
                            {loading ? 'Processing...' : 
                             requiresOnAccountConfirmation ? 'Confirm & Record On Account' : 'Confirm Payment'}
                        </button>
                    </div>
                </div>

                {/* On Account Confirmation Modal */}
                {showOnAccountConfirmation && (
                    <div className="fixed inset-0 bg-neutral-800/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-xl max-w-md w-full mx-4">
                            <div className="p-6">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">
                                    Record as On Account?
                                </h3>
                                <div className="mb-4">
                                    <p className="text-gray-700 dark:text-slate-300 mb-2">
                                        You're about to record <strong>{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{onAccountSum.toFixed(2)}</strong> to the customer's account.
                                    </p>
                                    <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg p-3">
                                        <div className="flex items-start">
                                            <div className="flex-shrink-0">
                                                <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                                </svg>
                                            </div>
                                            <div className="ml-3">
                                                <p className="text-sm text-amber-800 dark:text-amber-300">
                                                    • The invoice will remain <strong>unpaid</strong><br/>
                                                    • This creates an <strong>Accounts Receivable</strong> charge<br/>
                                                    • The transaction is auditable and reversible
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex justify-end space-x-3">
                                    <button
                                        onClick={() => setShowOnAccountConfirmation(false)}
                                        className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        onClick={() => {
                                            setShowOnAccountConfirmation(false);
                                            handleConfirm();
                                        }}
                                        className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
                                    >
                                        Record On Account
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SplitPaymentModal;
