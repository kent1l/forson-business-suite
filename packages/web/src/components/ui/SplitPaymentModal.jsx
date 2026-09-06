import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import { useSettings } from '../../contexts/SettingsContext';
import Icon from '../ui/Icon';
import InfoTip from '../ui/InfoTip';
import MathExpressionInput from './MathExpressionInput';
import { isChequeMethod } from '../../utils/chequeMethod';
import { ICONS } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import ManagerAuthorizationModal from './ManagerAuthorizationModal';

const MIN_NOTE_LENGTH = 10;

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
    // Withholding context. The expected deduction is computed once at the cart (see
    // useWithholdingPreview) and passed down, so the figure the cashier confirms here
    // is the same one already shown on the order summary.
    customer = null,
    withholdingPreview = null
}) => {
    const { settings } = useSettings();
    const { hasPermission } = useAuth();
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [payments, setPayments] = useState([]);
    const [loading, setLoading] = useState(false);
    const [showOnAccountConfirmation, setShowOnAccountConfirmation] = useState(false);

    // ── The counter concession ───────────────────────────────────────────────
    // Deliberately not a payment line. It is not in `payments`, so it cannot
    // appear in the method picker, cannot add to Total Payments, and cannot enter
    // the change calculation — a forgiven peso is not money in the drawer. What it
    // does do is reduce what is left to collect, which is why `remaining`
    // subtracts it.
    const canGrantDiscount = hasPermission('ar:discount_grant');
    const discountsEnabled = String(settings?.ENABLE_AR_ADJUSTMENTS ?? 'true') !== 'false';
    const [discountAmount, setDiscountAmount] = useState('');
    const [discountReasons, setDiscountReasons] = useState([]);
    const [discountReasonCode, setDiscountReasonCode] = useState('');
    const [discountNotes, setDiscountNotes] = useState('');
    const [discountAuthToken, setDiscountAuthToken] = useState(null);
    const [showDiscountAuthModal, setShowDiscountAuthModal] = useState(false);
    const [resumeAfterDiscountAuth, setResumeAfterDiscountAuth] = useState(false);
    const [discountClientRef, setDiscountClientRef] = useState(null);
    const initializedRef = useRef(false);
    const appliedOnAccountDefaultRef = useRef(false);
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
                    cheque_date: '',
                    metadata: {}
                }]);
            }
        } else if (!isOpen) {
            // Reset when modal closes
            initializedRef.current = false;
            appliedOnAccountDefaultRef.current = false;
            appliedWithholdingRef.current = false;
            // The concession, its authorization and its idempotency key all belong
            // to one sale. Carrying any of them into the next customer's would be
            // the worst kind of bug this feature could have.
            setDiscountAmount('');
            setDiscountNotes('');
            setDiscountAuthToken(null);
            setDiscountClientRef(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, existingPaymentsKey, fetchPaymentMethods]); // Use stable key

    // Reasons a concession granted at the counter may carry.
    useEffect(() => {
        if (!isOpen || !discountsEnabled) return;
        setDiscountClientRef(typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : null);
        api.get('/ar/adjustment-reasons', { params: { applies_to: 'SETTLEMENT' } })
            .then(res => {
                setDiscountReasons(res.data || []);
                setDiscountReasonCode(prev => prev || (res.data || [])[0]?.reason_code || '');
            })
            .catch(() => setDiscountReasons([]));
    }, [isOpen, discountsEnabled]);

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
            cheque_date: '',
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
                cheque_date: '',
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
    const { totalPayments, totalChange, remaining, concessionAmount, canConfirm, validationErrors, onAccountSum, requiresOnAccountConfirmation } = useMemo(() => {
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
                // A cheque without its maturity date lands in the PDC desk with no
                // idea when it can be banked, so it is required here rather than
                // chased up afterwards.
                if (isChequeMethod(method) && !payment.cheque_date) {
                    errors.push(`Date on cheque (maturity) is required for ${method.name}`);
                }
                if (method.config.requires_receipt_no && !physicalReceiptNo.trim()) {
                    errors.push(`Physical receipt number is required for ${method.name}`);
                }
                if (!method.config.change_allowed && tenderedAmount > amountPaid) {
                    errors.push(`Change not allowed for ${method.name}`);
                }
            }
        }

        // The concession closes the gap between what was tendered and what was
        // billed, so it belongs here and nowhere else in this calculation. It is
        // absent from totalPaid and from totalChangeAmount on purpose: it is not
        // money, so it can neither be counted as collected nor given back as change.
        const conceded = Math.round(((parseFloat(discountAmount) || 0) + Number.EPSILON) * 100) / 100;
        if (conceded > 0) {
            if (conceded > (totalDue || 0) - totalPaid + 0.01) {
                errors.push('The concession is more than the balance the tenders leave outstanding');
            }
            if (!discountReasonCode) {
                errors.push('Choose a reason for the concession');
            }
            const reason = discountReasons.find(r => r.reason_code === discountReasonCode);
            if (reason?.max_amount != null && conceded > Number(reason.max_amount) + 0.005) {
                errors.push(`${reason.label} is capped at ${settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}${Number(reason.max_amount).toFixed(2)}`);
            }
            if (reason?.requires_note && discountNotes.trim().length < MIN_NOTE_LENGTH) {
                errors.push(`${reason.label} needs a note of at least ${MIN_NOTE_LENGTH} characters`);
            }
        }

        const remainingDue = Math.max((totalDue || 0) - totalPaid - conceded, 0);
        const coveredByOnAccount = onAccountTotal >= remainingDue;
        const requiresOnAccountConfirmation = onAccountTotal > 0 && remainingDue > 0.01 && coveredByOnAccount;
        const canConfirm = errors.length === 0 && (remainingDue <= 0.01 || coveredByOnAccount);

        return {
            totalPayments: totalPaid,
            totalChange: totalChangeAmount,
            remaining: remainingDue,
            concessionAmount: conceded,
            canConfirm,
            validationErrors: errors,
            onAccountSum: onAccountTotal,
            requiresOnAccountConfirmation
        };
    }, [payments, paymentMethods, totalDue, physicalReceiptNo, discountAmount, discountReasonCode,
        discountReasons, discountNotes, settings?.DEFAULT_CURRENCY_SYMBOL]);

    // Auto-allocate remaining amount to selected payment method
    // Compute remaining at click time to avoid stale closure values.
    const autoAllocateRemaining = (paymentId) => {
        setPayments(prev => {
            const target = prev.find(p => p.id === paymentId);

            // On a withholding line, "the rest of the bill" is the wrong number by
            // definition -- that line can only ever hold the tax the customer deducts,
            // computed from the VAT-exclusive base. Filling it with the outstanding
            // balance would book the entire sale as tax withheld and collect nothing.
            const isWithholdingLine = withholdingMethodIdRef.current
                && String(target?.method_id) === String(withholdingMethodIdRef.current);
            if (isWithholdingLine) {
                const expected = withholdingExpectedRef.current || 0;
                return prev.map(p => p.id === paymentId ? { ...p, amount_paid: expected.toFixed(2) } : p);
            }

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

        // Asked on confirm, never while typing: the cashier keys the sale, and only
        // the act of committing it needs someone else standing there.
        if (concessionAmount > 0 && !canGrantDiscount && !discountAuthToken) {
            setShowDiscountAuthModal(true);
            return;
        }

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

                const chequeDate = isChequeMethod(method) ? (payment.cheque_date || null) : null;

                return {
                    method_id: payment.method_id,
                    amount_paid: amountPaid,
                    tendered_amount: tenderedAmount,
                    reference: payment.reference.trim() || null,
                    // Sent both ways on purpose: the API reads cheque_date to set the
                    // PDC lifecycle, and the Clearance Desk reads the maturity date
                    // back out of metadata for invoice-sourced cheques.
                    cheque_date: chequeDate,
                    metadata: {
                        ...payment.metadata,
                        method_name: method?.name || 'Unknown',
                        ...(chequeDate ? { cheque_date: chequeDate } : {})
                    }
                };
            });

            // Handed up as its own field, never inside `payments`. POST /invoices
            // writes it as an ar_adjustment against the new invoice — not as a
            // tender, and not as a line discount, because the sale really was for
            // the full amount and only its collectability changed.
            const concession = concessionAmount > 0 ? {
                amount: concessionAmount,
                reason_code: discountReasonCode,
                notes: discountNotes.trim() || null,
                client_ref: discountClientRef,
                authorization_token: canGrantDiscount ? undefined : discountAuthToken,
            } : undefined;

            await onConfirm(formattedPayments, physicalReceiptNo, { employeeId, discount: concession });
            onClose();
        } catch (err) {
            console.error('Payment confirmation error:', err);
            toast.error(err?.response?.data?.message || 'Failed to process payments');
            // A rejected or spent authorization has to be asked for again; keeping
            // the stale one would only fail a second time.
            setDiscountAuthToken(null);
        } finally {
            setLoading(false);
        }
    }, [canConfirm, payments, paymentMethods, onConfirm, physicalReceiptNo, onClose, validationErrors,
        requiresOnAccountConfirmation, showOnAccountConfirmation, employeeId, concessionAmount,
        canGrantDiscount, discountAuthToken, discountReasonCode, discountNotes, discountClientRef]);

    // The cashier already pressed Confirm. Making them press it again after the
    // manager walks away is one more chance to lose the approval.
    useEffect(() => {
        if (resumeAfterDiscountAuth && discountAuthToken) {
            setResumeAfterDiscountAuth(false);
            handleConfirm();
        }
    }, [resumeAfterDiscountAuth, discountAuthToken, handleConfirm]);

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

    // A cheque tender that has not been marked settled. The concession granted
    // alongside one waits at PENDING_CLEARANCE rather than posting now.
    const hasPendingChequeTender = payments.some(payment => {
        const method = paymentMethods.find(m => String(m.method_id) === String(payment.method_id));
        return isChequeMethod(method) && (method?.settlement_type || 'instant') !== 'instant';
    });

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
                            {concessionAmount > 0 && (
                                <div>
                                    {/* Its own tile, never folded into Total Payments:
                                        a cashier reading this screen has to be able to
                                        point at what came in and what was forgiven. */}
                                    <div className="text-sm font-medium text-slate-500 dark:text-slate-400">Concession</div>
                                    <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                                        {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{concessionAmount.toFixed(2)}
                                    </div>
                                </div>
                            )}
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
                            const isWithholdingLine = method?.code === 'withholding_tax';
                            const isCheque = isChequeMethod(method);

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
                                                {/* On a withholding line the button offers the computed
                                                    deduction, so it stays useful even once the balance is
                                                    covered -- that line is never about the remaining balance. */}
                                                {(remaining > 0 || isWithholdingLine) && (
                                                    <button
                                                        type="button"
                                                        onClick={() => autoAllocateRemaining(payment.id)}
                                                        className={`absolute inset-y-0 right-0 px-3 text-white rounded-r-lg text-xs font-semibold transition-colors cursor-pointer select-none ${
                                                            isWithholdingLine ? 'bg-sky-600 hover:bg-sky-700' : 'bg-primary-600 hover:bg-primary-700'
                                                        }`}
                                                        title={isWithholdingLine
                                                            ? `Fill the computed tax withheld (${(withholdingPreview?.total_withheld ?? 0).toFixed(2)})`
                                                            : 'Allocate remaining amount'}
                                                        aria-label={isWithholdingLine ? 'Fill computed tax withheld' : 'Fill remaining amount'}
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
                                        ) : isCheque ? (
                                            <div>
                                                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                                                    Date on Cheque <span className="text-danger-600">*</span>
                                                    <InfoTip label="Date on Cheque (Maturity)">
                                                        The date written on the cheque, not today's date. A post-dated cheque
                                                        cannot be banked until then — the PDC &amp; Clearance Desk uses this
                                                        date to work out when the cheque matures.
                                                    </InfoTip>
                                                </label>
                                                <input
                                                    type="date"
                                                    value={payment.cheque_date || ''}
                                                    onChange={(e) => updatePayment(payment.id, 'cheque_date', e.target.value)}
                                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm focus:ring-primary-500 focus:border-primary-500"
                                                    required
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

                    {/* ── Concession ────────────────────────────────────────────
                        Below the tender list and visibly outside it. It is not a
                        payment method, does not appear in the picker above, and
                        adds nothing to Total Payments or Change Due. */}
                    {discountsEnabled && (
                        <div className="mt-6 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-4">
                            <div className="flex items-start justify-between gap-4 flex-wrap">
                                <div>
                                    <h4 className="text-sm font-semibold text-amber-900 dark:text-amber-200 flex items-center gap-1">
                                        Concession (not a payment)
                                        <InfoTip label="Concession">
                                            Part of the sale forgiven so the customer can settle now. It is <strong>not money received</strong>:
                                            it adds nothing to the drawer, never becomes change, and is excluded from the day&rsquo;s collections.
                                            The BIR official receipt still shows only the cash actually handed over. Recorded as a numbered
                                            adjustment with your name on it.
                                        </InfoTip>
                                    </h4>
                                    <p className="text-xs text-amber-800 dark:text-amber-300/90 mt-0.5">
                                        Leave it at zero for an ordinary sale.
                                    </p>
                                </div>
                                <div className="w-40">
                                    <label className="block text-xs font-semibold text-amber-900 dark:text-amber-200 mb-1">Amount forgiven</label>
                                    <MathExpressionInput
                                        precision={2}
                                        value={discountAmount}
                                        onChange={(val) => setDiscountAmount(val)}
                                        placeholder="0.00"
                                        className="w-full px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-right font-mono font-bold text-amber-900 dark:text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                    />
                                </div>
                            </div>

                            {concessionAmount > 0 && (
                                <div className="mt-3 space-y-3">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-xs font-semibold text-amber-900 dark:text-amber-200 mb-1">Reason *</label>
                                            <select
                                                value={discountReasonCode}
                                                onChange={(e) => setDiscountReasonCode(e.target.value)}
                                                className="w-full px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-sm text-amber-950 dark:text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                            >
                                                {discountReasons.length === 0 && <option value="">No reasons configured</option>}
                                                {discountReasons.map(r => (
                                                    <option key={r.reason_code} value={r.reason_code}>{r.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-semibold text-amber-900 dark:text-amber-200 mb-1">
                                                Note {discountReasons.find(r => r.reason_code === discountReasonCode)?.requires_note && <span className="text-danger-600">*</span>}
                                            </label>
                                            <input
                                                type="text"
                                                value={discountNotes}
                                                onChange={(e) => setDiscountNotes(e.target.value)}
                                                placeholder="What was agreed, and with whom"
                                                className="w-full px-3 py-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 text-sm text-amber-950 dark:text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500"
                                            />
                                        </div>
                                    </div>

                                    {/* A cheque has not cleared, so the concession has
                                        not been earned. Said here rather than discovered
                                        later when the invoice fails to close. */}
                                    {hasPendingChequeTender && (
                                        <div className="text-xs text-amber-900 dark:text-amber-200 bg-amber-100/70 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 rounded-lg px-3 py-2">
                                            This sale is being settled by cheque, so the concession is held until the cheque clears.
                                            If it bounces, the concession is voided and the full balance stands.
                                        </div>
                                    )}

                                    {!canGrantDiscount && (
                                        <div className="text-xs text-amber-900 dark:text-amber-200 bg-amber-100/70 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-800 rounded-lg px-3 py-2">
                                            {discountAuthToken
                                                ? 'Authorized. The manager who approved it will be recorded alongside your name.'
                                                : 'Manager authorization required — you will be asked for it when you confirm.'}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
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

                <ManagerAuthorizationModal
                    isOpen={showDiscountAuthModal}
                    onClose={() => setShowDiscountAuthModal(false)}
                    permissionLabel="the discount permission"
                    actionLabel={`a ${settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}${concessionAmount.toFixed(2)} concession${customerName ? ` for ${customerName}` : ''}`}
                    amount={concessionAmount}
                    context={{ customer_id: customer?.customer_id, total_amount: concessionAmount, purpose: 'SETTLEMENT_DISCOUNT' }}
                    onAuthorized={(token) => { setDiscountAuthToken(token); setResumeAfterDiscountAuth(true); }}
                />

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
