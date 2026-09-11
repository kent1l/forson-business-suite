import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import Icon from '../ui/Icon';
import InfoTip from '../ui/InfoTip';
import MathExpressionInput from '../ui/MathExpressionInput';
import useTypeahead from '../../hooks/useTypeahead';
import { ICONS } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import { useSettings } from '../../contexts/SettingsContext';
import { formatPhysicalReceiptNumber } from '../../utils/receiptNumberFormatter';
import { parsePaymentTermsDays } from '../../utils/terms';
import { computeTaxPreview } from '../../utils/taxPreview';

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

const isWalkInCustomerName = (first, last) => {
    const name = `${first || ''} ${last || ''}`.trim().toLowerCase();
    return name.includes('walk-in') || name.includes('walk in');
};

// Prorated net-paid credit for the lines the cashier has selected to return --
// mirrors the exact math in exchangeService.js so this preview matches what the
// server will actually book. The server always recomputes authoritatively on
// save; this is a display aid only.
const computeReturnCreditPreview = (selectedLines) => {
    let creditTotal = 0;
    for (const line of selectedLines) {
        const originalQuantity = Number(line.quantity) || 0;
        const originalDiscount = Number(line.discount_amount) || 0;
        const unitDiscount = originalQuantity > 0 ? originalDiscount / originalQuantity : 0;
        const returnQty = Number(line.returnQuantity) || 0;
        const lineTotal = (returnQty * Number(line.sale_price)) - (unitDiscount * returnQty);
        const rate = Math.min(Math.max(Number(line.tax_rate_snapshot) || 0, 0), 1);
        let taxBase, taxAmount;
        if (line.is_tax_inclusive) {
            taxBase = lineTotal / (1 + rate);
            taxAmount = lineTotal - taxBase;
        } else {
            taxBase = lineTotal;
            taxAmount = lineTotal * rate;
        }
        creditTotal += taxBase + taxAmount;
    }
    return round2(creditTotal);
};

const emptyPaymentLine = () => ({ method_id: '', amount_paid: '', tendered_amount: '', reference: '', cheque_date: '' });

/**
 * POS Item Exchange ("Change Item") modal -- docs/plans/2026-09-11_pos-item-exchange-module.md §6.2.
 *
 * Lets a cashier search an original invoice, pick lines to return (tagging
 * Re-sellable vs Defective), pick replacement parts, and settle only the net
 * difference in one screen. Submits to POST /api/invoices/exchange, which owns
 * the whole thing as a single DB transaction (see exchangeService.js).
 *
 * `initialInvoice` pre-populates from Sales History (InvoiceDetailsModal); when
 * omitted (opened from the POS grid) the cashier searches for the invoice here.
 */
const ExchangeModal = ({ isOpen, onClose, initialInvoice = null, onExchangeSuccess, zIndexClass = 'z-40' }) => {
    const { user, hasPermission } = useAuth();
    const { settings } = useSettings();
    const currency = settings?.DEFAULT_CURRENCY_SYMBOL || '₱';

    // ── Step 1: original invoice ───────────────────────────────────────────
    const [invoiceSearchTerm, setInvoiceSearchTerm] = useState('');
    const [invoiceSearchResults, setInvoiceSearchResults] = useState([]);
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [invoiceLines, setInvoiceLines] = useState([]);
    const [loadingLines, setLoadingLines] = useState(false);
    const invoiceSearchDebounceRef = useRef(null);

    // ── Step 2: return selection ────────────────────────────────────────────
    const [returnLines, setReturnLines] = useState({}); // invoice_line_id -> { ...line, returnQuantity, is_defective }

    // ── Step 3: replacement items ────────────────────────────────────────────
    const [partSearchTerm, setPartSearchTerm] = useState('');
    const [partSearchResults, setPartSearchResults] = useState([]);
    const [replacementLines, setReplacementLines] = useState([]);
    const partSearchDebounceRef = useRef(null);
    const partSearchInputRef = useRef(null);

    // ── Settlement ───────────────────────────────────────────────────────────
    const [chargeToAccount, setChargeToAccount] = useState(false);
    const [termsDays, setTermsDays] = useState('30');
    const [collectNow, setCollectNow] = useState(false);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [paymentLine, setPaymentLine] = useState(emptyPaymentLine());
    const [downgradeDisposition, setDowngradeDisposition] = useState('cash_payout');
    const [physicalReceiptNo, setPhysicalReceiptNo] = useState('');
    const [notes, setNotes] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const canExchange = hasPermission('invoicing:create');

    const resetState = useCallback(() => {
        setInvoiceSearchTerm('');
        setInvoiceSearchResults([]);
        setSelectedInvoice(null);
        setInvoiceLines([]);
        setReturnLines({});
        setPartSearchTerm('');
        setPartSearchResults([]);
        setReplacementLines([]);
        setChargeToAccount(false);
        setTermsDays(parsePaymentTermsDays(settings?.DEFAULT_ON_ACCOUNT_PAYMENT_TERMS || '') !== null
            ? String(parsePaymentTermsDays(settings?.DEFAULT_ON_ACCOUNT_PAYMENT_TERMS || ''))
            : '30');
        setCollectNow(false);
        setPaymentLine(emptyPaymentLine());
        setDowngradeDisposition('cash_payout');
        setPhysicalReceiptNo('');
        setNotes('');
    }, [settings?.DEFAULT_ON_ACCOUNT_PAYMENT_TERMS]);

    const fetchLinesForInvoice = useCallback(async (invoice) => {
        setLoadingLines(true);
        setReturnLines({});
        try {
            const res = await api.get(`/invoices/${invoice.invoice_id}/lines-with-refunds`);
            setInvoiceLines(res.data || []);
        } catch (err) {
            console.error('Failed to load invoice lines for exchange', err);
            toast.error('Failed to load items for this invoice.');
            setInvoiceLines([]);
        } finally {
            setLoadingLines(false);
        }
    }, []);

    // Reset (or seed from initialInvoice) whenever the modal opens.
    useEffect(() => {
        if (!isOpen) return;
        resetState();
        if (initialInvoice) {
            setSelectedInvoice(initialInvoice);
            fetchLinesForInvoice(initialInvoice);
            setChargeToAccount(Number(initialInvoice.payment_terms_days) > 0);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isOpen, initialInvoice]);

    // Payment methods, fetched once per opening.
    useEffect(() => {
        if (!isOpen) return;
        (async () => {
            try {
                const res = await api.get('/payment-methods/enabled');
                const normalized = (res.data || [])
                    .filter(m => m.code !== 'exchange_credit')
                    .map(m => ({ ...m, config: typeof m.config === 'string' ? JSON.parse(m.config) : (m.config || {}) }));
                setPaymentMethods(normalized);
            } catch (err) {
                console.error('Failed to load payment methods for exchange', err);
                setPaymentMethods([]);
            }
        })();
    }, [isOpen]);

    // Debounced invoice search (skipped once an invoice is selected).
    useEffect(() => {
        if (!isOpen || selectedInvoice) { setInvoiceSearchResults([]); return; }
        if (invoiceSearchTerm.trim() === '') { setInvoiceSearchResults([]); return; }

        if (invoiceSearchDebounceRef.current) clearTimeout(invoiceSearchDebounceRef.current);
        invoiceSearchDebounceRef.current = setTimeout(async () => {
            try {
                const res = await api.get('/invoices', {
                    params: {
                        startDate: '2000-01-01',
                        endDate: new Date().toISOString().slice(0, 10),
                        q: invoiceSearchTerm.trim(),
                        status: 'active',
                        page: 1,
                        pageSize: 8,
                    },
                });
                setInvoiceSearchResults(res.data?.rows || []);
            } catch (err) {
                console.error('Invoice search failed', err);
            }
        }, 300);
        return () => clearTimeout(invoiceSearchDebounceRef.current);
    }, [invoiceSearchTerm, isOpen, selectedInvoice]);

    const handleSelectInvoice = (invoice) => {
        setSelectedInvoice(invoice);
        setInvoiceSearchResults([]);
        setInvoiceSearchTerm('');
        setChargeToAccount(Number(invoice.payment_terms_days) > 0);
        fetchLinesForInvoice(invoice);
    };

    const invoiceTypeahead = useTypeahead({
        items: invoiceSearchResults,
        onSelect: handleSelectInvoice,
        onClose: () => setInvoiceSearchResults([]),
        inputId: 'exchange-invoice-search',
        listboxId: 'exchange-invoice-search-results',
    });

    const handleChangeInvoice = () => {
        setSelectedInvoice(null);
        setInvoiceLines([]);
        setReturnLines({});
    };

    // ── Return line selection ───────────────────────────────────────────────
    const handleToggleReturnLine = (line, checked) => {
        const maxQty = Number(line.quantity) - Number(line.quantity_refunded || 0);
        if (checked && maxQty <= 0) return;
        setReturnLines(prev => {
            const next = { ...prev };
            if (checked) {
                next[line.invoice_line_id] = { ...line, returnQuantity: maxQty, is_defective: false };
            } else {
                delete next[line.invoice_line_id];
            }
            return next;
        });
    };

    const handleReturnQuantityChange = (line, qty) => {
        const maxQty = Number(line.quantity) - Number(line.quantity_refunded || 0);
        const num = Math.max(0, Math.min(maxQty, Number(qty) || 0));
        setReturnLines(prev => ({ ...prev, [line.invoice_line_id]: { ...prev[line.invoice_line_id], returnQuantity: num } }));
    };

    const handleToggleDefective = (line, checked) => {
        setReturnLines(prev => ({ ...prev, [line.invoice_line_id]: { ...prev[line.invoice_line_id], is_defective: checked } }));
    };

    // ── Replacement line selection ──────────────────────────────────────────
    useEffect(() => {
        if (!isOpen) return;
        if (partSearchTerm.trim() === '') { setPartSearchResults([]); return; }
        if (partSearchDebounceRef.current) clearTimeout(partSearchDebounceRef.current);
        partSearchDebounceRef.current = setTimeout(async () => {
            try {
                const res = await api.get('/power-search/parts', { params: { keyword: partSearchTerm } });
                setPartSearchResults(res.data || []);
            } catch (err) {
                console.error('Part search failed', err);
            }
        }, 300);
        return () => clearTimeout(partSearchDebounceRef.current);
    }, [partSearchTerm, isOpen]);

    const handleAddReplacementPart = (part) => {
        setReplacementLines(prev => {
            const idx = prev.findIndex(l => l.part_id === part.part_id);
            if (idx >= 0) {
                const next = [...prev];
                next[idx] = { ...next[idx], quantity: Number(next[idx].quantity) + 1 };
                return next;
            }
            return [...prev, {
                key: `${part.part_id}-${Date.now()}`,
                part_id: part.part_id,
                display_name: part.display_name || part.detail || `Part #${part.part_id}`,
                part_numbers: part.part_numbers,
                quantity: 1,
                sale_price: Number(part.last_sale_price) || 0,
                discount_amount: 0,
                tax_rate_id: part.tax_rate_id,
                is_tax_inclusive_price: !!part.is_tax_inclusive_price,
            }];
        });
        setPartSearchTerm('');
        setPartSearchResults([]);
    };

    const partTypeahead = useTypeahead({
        items: partSearchResults,
        onSelect: handleAddReplacementPart,
        onClose: () => setPartSearchResults([]),
        inputRef: partSearchInputRef,
        inputId: 'exchange-part-search',
        listboxId: 'exchange-part-search-results',
    });

    const handleUpdateReplacementLine = (key, field, value) => {
        setReplacementLines(prev => prev.map(l => l.key === key ? { ...l, [field]: value } : l));
    };

    const handleRemoveReplacementLine = (key) => {
        setReplacementLines(prev => prev.filter(l => l.key !== key));
    };

    // ── Totals & settlement direction ───────────────────────────────────────
    const selectedReturnLines = useMemo(
        () => Object.values(returnLines).filter(l => Number(l.returnQuantity) > 0),
        [returnLines]
    );
    const returnCredit = useMemo(() => computeReturnCreditPreview(selectedReturnLines), [selectedReturnLines]);

    const validReplacementLines = useMemo(
        () => replacementLines.filter(l => Number(l.quantity) > 0 && Number(l.sale_price) >= 0),
        [replacementLines]
    );
    const replacementPreview = useMemo(
        () => computeTaxPreview(
            validReplacementLines.map(l => ({
                quantity: Number(l.quantity), sale_price: Number(l.sale_price), discount_amount: Number(l.discount_amount) || 0,
                tax_rate_id: l.tax_rate_id, is_tax_inclusive_price: l.is_tax_inclusive_price,
            })),
            [], // no store-wide tax rate list needed here: every line already carries its own part.tax_rate_id
            null,
            'EXCHANGE'
        ),
        [validReplacementLines]
    );
    const replacementTotal = replacementPreview.total;

    const netDiff = round2(replacementTotal - returnCredit);
    const amountDue = Math.max(netDiff, 0);
    const leftoverCredit = round2(Math.max(returnCredit - replacementTotal, 0));

    const isWalkIn = selectedInvoice ? isWalkInCustomerName(selectedInvoice.customer_first_name, selectedInvoice.customer_last_name) : false;
    const invoiceAgeDays = selectedInvoice ? Math.floor((Date.now() - new Date(selectedInvoice.invoice_date).getTime()) / 86400000) : 0;

    // Walk-in customers can never be charged to account (mirrors exchangeService.js).
    useEffect(() => {
        if (isWalkIn && chargeToAccount) setChargeToAccount(false);
    }, [isWalkIn, chargeToAccount]);

    const showTenderFields = amountDue > 0 && (!chargeToAccount || collectNow);
    const tenderRequired = amountDue > 0 && !chargeToAccount;
    const showDowngradeChoice = leftoverCredit > 0 && !chargeToAccount;

    const selectedPaymentMethod = paymentMethods.find(m => String(m.method_id) === String(paymentLine.method_id));
    const isChequeMethod = selectedPaymentMethod && (selectedPaymentMethod.code === 'cheque' || selectedPaymentMethod.code === 'pdc' || (selectedPaymentMethod.name || '').toLowerCase().includes('cheque'));

    const handleFillTenderAmount = () => {
        setPaymentLine(prev => ({ ...prev, amount_paid: amountDue.toFixed(2) }));
    };

    // ── Validation ───────────────────────────────────────────────────────────
    const validationError = useMemo(() => {
        if (!selectedInvoice) return 'Select the original invoice.';
        if (loadingLines) return 'Loading invoice items…';
        if (selectedReturnLines.length === 0) return 'Select at least one item to return.';
        if (validReplacementLines.length === 0) return 'Add at least one replacement item.';
        if (showTenderFields) {
            if (!paymentLine.method_id) return 'Select a payment method for the amount due.';
            const paid = round2(paymentLine.amount_paid);
            if (!(paid > 0)) return 'Enter a payment amount.';
            if (tenderRequired && Math.abs(paid - amountDue) > 0.01) {
                return `Tendered amount must equal ${currency}${amountDue.toFixed(2)}.`;
            }
            if (!tenderRequired && paid > amountDue + 0.01) {
                return `Payment cannot exceed the ${currency}${amountDue.toFixed(2)} due.`;
            }
            if (selectedPaymentMethod?.config?.requires_reference && !paymentLine.reference?.trim()) {
                return `Reference is required for ${selectedPaymentMethod.name}.`;
            }
            if (isChequeMethod && !paymentLine.cheque_date) {
                return 'Date on cheque is required.';
            }
        }
        if (showDowngradeChoice && !['wallet', 'cash_payout'].includes(downgradeDisposition)) {
            return 'Choose how the store returns the difference to the customer.';
        }
        if (chargeToAccount && !(parsePaymentTermsDays(termsDays) >= 0)) {
            return 'Enter valid payment terms (days).';
        }
        return null;
    }, [selectedInvoice, loadingLines, selectedReturnLines, validReplacementLines, showTenderFields, paymentLine,
        tenderRequired, amountDue, currency, selectedPaymentMethod, isChequeMethod, showDowngradeChoice,
        downgradeDisposition, chargeToAccount, termsDays]);

    const handleSubmit = async () => {
        if (validationError) { toast.error(validationError); return; }

        const payload = {
            original_invoice_id: selectedInvoice.invoice_id,
            employee_id: user.employee_id,
            returned_lines: selectedReturnLines.map(l => ({
                invoice_line_id: l.invoice_line_id,
                quantity: l.returnQuantity,
                is_defective: !!l.is_defective,
            })),
            replacement_lines: validReplacementLines.map(l => ({
                part_id: l.part_id,
                quantity: Number(l.quantity),
                sale_price: Number(l.sale_price),
                discount_amount: Number(l.discount_amount) || 0,
            })),
            terms: chargeToAccount ? String(parsePaymentTermsDays(termsDays)) : '0',
            payment_terms_days: chargeToAccount ? parsePaymentTermsDays(termsDays) : 0,
            physical_receipt_no: formatPhysicalReceiptNumber(physicalReceiptNo) || undefined,
            notes: notes.trim() || undefined,
        };
        if (showTenderFields) {
            payload.payments = [{
                method_id: paymentLine.method_id,
                amount_paid: round2(paymentLine.amount_paid),
                tendered_amount: paymentLine.tendered_amount ? Number(paymentLine.tendered_amount) : null,
                reference: paymentLine.reference?.trim() || null,
                cheque_date: isChequeMethod ? (paymentLine.cheque_date || null) : null,
                metadata: { method_name: selectedPaymentMethod?.name },
            }];
        }
        if (showDowngradeChoice) {
            payload.downgrade_disposition = downgradeDisposition;
        }

        setSubmitting(true);
        try {
            const res = await api.post('/invoices/exchange', payload);
            toast.success(res.data?.message || 'Exchange processed successfully.');
            if (res.data?.aging_warning) toast(res.data.aging_warning, { icon: '⚠️' });
            try { window.dispatchEvent(new CustomEvent('invoices:changed')); } catch { /* ignore */ }
            onExchangeSuccess && onExchangeSuccess(res.data);
            onClose();
        } catch (err) {
            console.error('Exchange failed', err);
            toast.error(err.response?.data?.message || 'Failed to process exchange.');
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    if (!canExchange) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title="Item Exchange" maxWidth="max-w-md" zIndexClass={zIndexClass}>
                <p className="text-sm text-gray-600 dark:text-slate-300">You do not have permission to process item exchanges.</p>
            </Modal>
        );
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Item Exchange" maxWidth="max-w-5xl" zIndexClass={zIndexClass}>
            <div className="space-y-5">
                {/* ── Original invoice ─────────────────────────────────────── */}
                {!selectedInvoice ? (
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 dark:text-slate-300 mb-1">
                            Find the original invoice or receipt
                        </label>
                        <div className="relative">
                            <input
                                {...invoiceTypeahead.getInputProps()}
                                type="text"
                                value={invoiceSearchTerm}
                                onChange={(e) => setInvoiceSearchTerm(e.target.value)}
                                placeholder="Invoice #, receipt #, or customer name"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 shadow-sm focus:ring-2 focus:ring-primary-500"
                                autoFocus
                            />
                            {invoiceSearchResults.length > 0 && (
                                <ul id={invoiceTypeahead.listboxId} className="absolute z-10 mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                                    {invoiceSearchResults.map((inv, idx) => (
                                        <li
                                            key={inv.invoice_id}
                                            {...invoiceTypeahead.getItemProps(idx)}
                                            className={`px-3 py-2 cursor-pointer text-sm ${idx === invoiceTypeahead.highlightedIndex ? 'bg-primary-50 dark:bg-primary-950/40' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'}`}
                                        >
                                            <div className="flex justify-between">
                                                <span className="font-mono font-semibold text-gray-900 dark:text-slate-100">{inv.invoice_number}</span>
                                                <span className="text-gray-500 dark:text-slate-400">{new Date(inv.invoice_date).toLocaleDateString()}</span>
                                            </div>
                                            <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400">
                                                <span>{inv.customer_first_name} {inv.customer_last_name}</span>
                                                <span>{currency}{parseFloat(inv.total_amount).toFixed(2)} · {inv.status}</span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </div>
                    </div>
                ) : (
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                        <div>
                            <div className="font-mono font-semibold text-gray-900 dark:text-slate-100">Invoice #{selectedInvoice.invoice_number}</div>
                            <div className="text-xs text-gray-500 dark:text-slate-400">
                                {selectedInvoice.customer_first_name} {selectedInvoice.customer_last_name} · {new Date(selectedInvoice.invoice_date).toLocaleDateString()} · {currency}{parseFloat(selectedInvoice.total_amount).toFixed(2)}
                            </div>
                        </div>
                        {!initialInvoice && (
                            <button onClick={handleChangeInvoice} className="text-sm text-primary-600 dark:text-primary-400 hover:underline">
                                Change
                            </button>
                        )}
                    </div>
                )}

                {invoiceAgeDays > 30 && selectedInvoice && (
                    <div className="p-3 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 rounded-lg text-sm text-amber-800 dark:text-amber-300">
                        This invoice is {invoiceAgeDays} days old (over the 30-day exchange guideline). The exchange will still be booked today's date.
                    </div>
                )}

                {selectedInvoice && (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        {/* ── Return selection ─────────────────────────────── */}
                        <div>
                            <h3 className="font-semibold text-gray-800 dark:text-slate-100 mb-2">Items to Return</h3>
                            {loadingLines ? (
                                <p className="text-sm text-gray-500 dark:text-slate-400">Loading…</p>
                            ) : (
                                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                                    {invoiceLines.map(line => {
                                        const available = Number(line.quantity) - Number(line.quantity_refunded || 0);
                                        const selected = returnLines[line.invoice_line_id];
                                        return (
                                            <div key={line.invoice_line_id} className="bg-gray-50 dark:bg-slate-900/50 p-2 rounded-lg border border-gray-200/60 dark:border-slate-700/60">
                                                <div className="flex items-center gap-3">
                                                    <input
                                                        type="checkbox"
                                                        checked={!!selected}
                                                        onChange={(e) => handleToggleReturnLine(line, e.target.checked)}
                                                        disabled={available <= 0}
                                                        className="h-4 w-4 rounded text-primary-600 dark:bg-slate-800 dark:border-slate-600 focus:ring-primary-500"
                                                    />
                                                    <div className="flex-grow min-w-0">
                                                        <p className={`text-sm font-medium truncate ${available <= 0 ? 'text-danger-500 dark:text-danger-400' : 'text-gray-900 dark:text-slate-100'}`}>{line.display_name}</p>
                                                        <p className="text-xs text-gray-500 dark:text-slate-400">Sold {line.quantity}, Returned {line.quantity_refunded || 0}, Available {available} · {currency}{parseFloat(line.sale_price).toFixed(2)}</p>
                                                    </div>
                                                    {selected && (
                                                        <MathExpressionInput
                                                            precision={2}
                                                            value={selected.returnQuantity}
                                                            onChange={(val) => handleReturnQuantityChange(line, val)}
                                                            className="w-16 px-2 py-1 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                                                            min={0}
                                                            max={available}
                                                        />
                                                    )}
                                                </div>
                                                {selected && (
                                                    <label className="flex items-center gap-2 mt-2 ml-7 text-xs text-gray-600 dark:text-slate-400">
                                                        <input
                                                            type="checkbox"
                                                            checked={!!selected.is_defective}
                                                            onChange={(e) => handleToggleDefective(line, e.target.checked)}
                                                            className="h-3.5 w-3.5 rounded text-danger-600 dark:bg-slate-800 dark:border-slate-600 focus:ring-danger-500"
                                                        />
                                                        Defective / Damaged (send to quarantine instead of restocking)
                                                    </label>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {invoiceLines.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No items on this invoice.</p>}
                                </div>
                            )}
                        </div>

                        {/* ── Replacement selection ────────────────────────── */}
                        <div>
                            <h3 className="font-semibold text-gray-800 dark:text-slate-100 mb-2">Replacement Items</h3>
                            <div className="relative mb-2">
                                <input
                                    {...partTypeahead.getInputProps()}
                                    ref={partSearchInputRef}
                                    type="text"
                                    value={partSearchTerm}
                                    onChange={(e) => setPartSearchTerm(e.target.value)}
                                    placeholder="Search replacement part…"
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 shadow-sm focus:ring-2 focus:ring-primary-500"
                                />
                                {partSearchResults.length > 0 && (
                                    <ul id={partTypeahead.listboxId} className="absolute z-10 mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg shadow-lg max-h-64 overflow-y-auto">
                                        {partSearchResults.map((part, idx) => (
                                            <li
                                                key={part.part_id}
                                                {...partTypeahead.getItemProps(idx)}
                                                className={`px-3 py-2 cursor-pointer text-sm ${idx === partTypeahead.highlightedIndex ? 'bg-primary-50 dark:bg-primary-950/40' : 'hover:bg-gray-50 dark:hover:bg-slate-700/50'}`}
                                            >
                                                <div className="font-medium text-gray-900 dark:text-slate-100 truncate">{part.display_name}</div>
                                                <div className="flex justify-between text-xs text-gray-500 dark:text-slate-400">
                                                    <span className="truncate">{part.part_numbers}</span>
                                                    <span>{currency}{Number(part.last_sale_price || 0).toFixed(2)}</span>
                                                </div>
                                            </li>
                                        ))}
                                    </ul>
                                )}
                            </div>
                            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                {replacementLines.map(line => (
                                    <div key={line.key} className="bg-gray-50 dark:bg-slate-900/50 p-2 rounded-lg border border-gray-200/60 dark:border-slate-700/60 flex items-center gap-2">
                                        <div className="flex-grow min-w-0">
                                            <p className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{line.display_name}</p>
                                            <p className="text-xs text-gray-500 dark:text-slate-400 truncate">{line.part_numbers}</p>
                                        </div>
                                        <MathExpressionInput
                                            precision={2}
                                            value={line.quantity}
                                            onChange={(val) => handleUpdateReplacementLine(line.key, 'quantity', Math.max(0, Number(val) || 0))}
                                            className="w-14 px-2 py-1 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                                            min={0}
                                        />
                                        <MathExpressionInput
                                            precision={2}
                                            value={line.sale_price}
                                            onChange={(val) => handleUpdateReplacementLine(line.key, 'sale_price', Math.max(0, Number(val) || 0))}
                                            className="w-24 px-2 py-1 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                                            min={0}
                                        />
                                        <button onClick={() => handleRemoveReplacementLine(line.key)} className="text-danger-500 hover:text-danger-700">
                                            <Icon path={ICONS.trash} className="h-4 w-4" />
                                        </button>
                                    </div>
                                ))}
                                {replacementLines.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">Search and add at least one replacement item.</p>}
                            </div>
                        </div>
                    </div>
                )}

                {/* ── Summary ─────────────────────────────────────────────── */}
                {selectedInvoice && (
                    <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
                        <div className="grid grid-cols-3 gap-4 text-center">
                            <div>
                                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Returned Value</div>
                                <div className="text-lg font-bold text-danger-600 dark:text-danger-400">-{currency}{returnCredit.toFixed(2)}</div>
                            </div>
                            <div>
                                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Replacement Value</div>
                                <div className="text-lg font-bold text-primary-600 dark:text-primary-400">{currency}{replacementTotal.toFixed(2)}</div>
                            </div>
                            <div>
                                <div className="text-xs font-medium text-slate-500 dark:text-slate-400">Net Difference</div>
                                <div className={`text-lg font-bold ${netDiff > 0 ? 'text-warning-600 dark:text-warning-400' : netDiff < 0 ? 'text-success-600 dark:text-success-400' : 'text-slate-700 dark:text-slate-200'}`}>
                                    {netDiff > 0 ? `+${currency}${netDiff.toFixed(2)} (Upgrade)` : netDiff < 0 ? `-${currency}${Math.abs(netDiff).toFixed(2)} (Downgrade)` : 'Even'}
                                </div>
                            </div>
                        </div>

                        {/* ── Settlement ────────────────────────────────────── */}
                        {(amountDue > 0 || leftoverCredit > 0) && (
                            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
                                {!isWalkIn && (
                                    <label className="flex items-center gap-2 text-sm font-medium text-gray-700 dark:text-slate-300">
                                        <input
                                            type="checkbox"
                                            checked={chargeToAccount}
                                            onChange={(e) => { setChargeToAccount(e.target.checked); setCollectNow(false); }}
                                            className="h-4 w-4 rounded text-primary-600 dark:bg-slate-800 dark:border-slate-600 focus:ring-primary-500"
                                        />
                                        Charge difference to customer's account
                                        <InfoTip label="Charge to Account">
                                            Upgrades post the difference as a balance on the new invoice instead of collecting cash now. Downgrades reduce the customer's outstanding balance instead of paying out the drawer or issuing store credit.
                                        </InfoTip>
                                    </label>
                                )}

                                {chargeToAccount && (
                                    <div className="flex items-center gap-3 ml-6">
                                        <label className="text-xs text-gray-600 dark:text-slate-400">Payment Terms (days)</label>
                                        <input
                                            type="text"
                                            value={termsDays}
                                            onChange={(e) => setTermsDays(e.target.value)}
                                            className="w-20 px-2 py-1 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                                        />
                                        {amountDue > 0 && (
                                            <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-400">
                                                <input
                                                    type="checkbox"
                                                    checked={collectNow}
                                                    onChange={(e) => setCollectNow(e.target.checked)}
                                                    className="h-3.5 w-3.5 rounded text-primary-600 dark:bg-slate-800 dark:border-slate-600 focus:ring-primary-500"
                                                />
                                                Customer is paying now instead
                                            </label>
                                        )}
                                    </div>
                                )}

                                {showTenderFields && (
                                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
                                        <div>
                                            <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Payment Method</label>
                                            <select
                                                value={paymentLine.method_id}
                                                onChange={(e) => setPaymentLine(prev => ({ ...prev, method_id: e.target.value }))}
                                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm"
                                            >
                                                <option value="">Select…</option>
                                                {paymentMethods.map(m => (
                                                    <option key={m.method_id} value={m.method_id}>{m.name}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Amount</label>
                                            <div className="relative">
                                                <MathExpressionInput
                                                    precision={2}
                                                    value={paymentLine.amount_paid}
                                                    onChange={(val) => setPaymentLine(prev => ({ ...prev, amount_paid: val }))}
                                                    className="w-full pr-14 px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm"
                                                    min={0}
                                                />
                                                <button type="button" onClick={handleFillTenderAmount} className="absolute inset-y-0 right-0 px-2 text-white bg-primary-600 hover:bg-primary-700 rounded-r-lg text-xs font-semibold">FILL</button>
                                            </div>
                                        </div>
                                        {selectedPaymentMethod?.config?.change_allowed ? (
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Tendered</label>
                                                <MathExpressionInput
                                                    precision={2}
                                                    value={paymentLine.tendered_amount}
                                                    onChange={(val) => setPaymentLine(prev => ({ ...prev, tendered_amount: val }))}
                                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm"
                                                    min={0}
                                                />
                                            </div>
                                        ) : isChequeMethod ? (
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">Date on Cheque</label>
                                                <input
                                                    type="date"
                                                    value={paymentLine.cheque_date}
                                                    onChange={(e) => setPaymentLine(prev => ({ ...prev, cheque_date: e.target.value }))}
                                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm"
                                                />
                                            </div>
                                        ) : <div />}
                                        {selectedPaymentMethod?.config?.requires_reference ? (
                                            <div>
                                                <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-1">{selectedPaymentMethod?.config?.reference_label || 'Reference'}</label>
                                                <input
                                                    type="text"
                                                    value={paymentLine.reference}
                                                    onChange={(e) => setPaymentLine(prev => ({ ...prev, reference: e.target.value }))}
                                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 shadow-sm"
                                                />
                                            </div>
                                        ) : <div />}
                                    </div>
                                )}

                                {showDowngradeChoice && (
                                    <div>
                                        <label className="block text-xs font-medium text-gray-700 dark:text-slate-300 mb-2">
                                            The store owes the customer {currency}{leftoverCredit.toFixed(2)} — how should it be returned?
                                        </label>
                                        <div className="flex gap-4">
                                            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                                                <input type="radio" name="downgrade_disposition" checked={downgradeDisposition === 'cash_payout'} onChange={() => setDowngradeDisposition('cash_payout')} />
                                                Cash Payout from Drawer
                                            </label>
                                            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                                                <input type="radio" name="downgrade_disposition" checked={downgradeDisposition === 'wallet'} onChange={() => setDowngradeDisposition('wallet')} />
                                                Store Credit (Wallet)
                                            </label>
                                        </div>
                                    </div>
                                )}

                                {chargeToAccount && amountDue > 0 && !collectNow && (
                                    <p className="text-xs text-gray-500 dark:text-slate-400">
                                        {currency}{amountDue.toFixed(2)} will be added as a balance due on the new invoice under {termsDays}-day terms.
                                    </p>
                                )}
                                {chargeToAccount && leftoverCredit > 0 && (
                                    <p className="text-xs text-gray-500 dark:text-slate-400">
                                        {currency}{leftoverCredit.toFixed(2)} will reduce the customer's outstanding A/R balance.
                                    </p>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* ── Receipt & notes ───────────────────────────────────────── */}
                {selectedInvoice && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">New Physical Receipt No.</label>
                            <input
                                type="text"
                                value={physicalReceiptNo}
                                onChange={(e) => setPhysicalReceiptNo(e.target.value)}
                                onBlur={(e) => setPhysicalReceiptNo(formatPhysicalReceiptNumber(e.target.value) || '')}
                                placeholder="e.g., SI-1235"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 shadow-sm font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Notes</label>
                            <input
                                type="text"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                placeholder="Optional"
                                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 shadow-sm"
                            />
                        </div>
                    </div>
                )}

                <div className="flex justify-between items-center pt-2 border-t border-gray-200 dark:border-slate-700">
                    <p className="text-xs text-danger-600 dark:text-danger-400">{validationError && selectedInvoice && !loadingLines ? validationError : ' '}</p>
                    <div className="flex gap-3">
                        <button onClick={onClose} className="px-4 py-2 bg-white dark:bg-slate-700 border border-gray-300 dark:border-slate-600 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-50 dark:hover:bg-slate-600 transition-colors">
                            Cancel
                        </button>
                        <button
                            onClick={handleSubmit}
                            disabled={!!validationError || submitting}
                            className="px-6 py-2 bg-primary-600 text-white font-semibold rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {submitting ? 'Processing…' : 'Process Exchange'}
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default ExchangeModal;
