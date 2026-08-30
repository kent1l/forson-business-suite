import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../api';
import { parsePaymentTermsDays } from '../utils/terms';
import { formatPhysicalReceiptNumber } from '../utils/receiptNumberFormatter';
import { computeTaxPreview } from '../utils/taxPreview';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';
import SearchBar from '../components/SearchBar';
import Modal from '../components/ui/Modal';
import Combobox from '../components/ui/Combobox';
import CustomerForm from '../components/forms/CustomerForm';
import PartForm from '../components/forms/PartForm';
import SplitPaymentModal from '../components/ui/SplitPaymentModal';
import MathExpressionInput from '../components/ui/MathExpressionInput';
import SavedSalesPanel from '../components/pos/SavedSalesPanel';
import { useSettings } from '../contexts/SettingsContext';
import { formatApplicationText } from '../helpers/applicationTextHelper';
import { enrichPartsArray } from '../helpers/applicationCache';
import useTypeahead from '../hooks/useTypeahead';
import useSavedSales from '../hooks/useSavedSales';

const InvoicingPage = ({ user, onNavigate, pageState }) => {
    const { settings } = useSettings();
    const [customers, setCustomers] = useState([]);
    const [lines, setLines] = useState([]);
    const [selectedCustomer, setSelectedCustomer] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('');
    const [physicalReceiptNo, setPhysicalReceiptNo] = useState('');
    const [isSplitPaymentModalOpen, setIsSplitPaymentModalOpen] = useState(false);
    const [terms, setTerms] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isCustomerModalOpen, setIsCustomerModalOpen] = useState(false);
    const [isNewPartModalOpen, setIsNewPartModalOpen] = useState(false);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [taxRates, setTaxRates] = useState([]);
    const [selectedTaxRate, setSelectedTaxRate] = useState(null);
    const [isDraftsModalOpen, setIsDraftsModalOpen] = useState(false);
    const [lastSavedDraftSignature, setLastSavedDraftSignature] = useState(null);
    const [receiptCheck, setReceiptCheck] = useState(null); // { taken, normalized } | null
    const searchInputRef = useRef(null);

    const paymentMethodsKey = settings?.PAYMENT_METHODS || '';
    const paymentMethods = paymentMethodsKey ? paymentMethodsKey.split(',') : [];
    const [fetchedTerms, setFetchedTerms] = useState(null);

    const commonTermsFromSettingsKey = settings?.COMMON_PAYMENT_TERMS || '';
    const commonTermsFromSettings = commonTermsFromSettingsKey ? commonTermsFromSettingsKey.split(',').map(t => {
        const m = String(t).match(/(\d{1,4})/);
        if (m) return String(parseInt(m[1], 10));
        if (/due|upon/i.test(t)) return '0';
        return String(t);
    }) : ['0', '7', '15', '30'];

    const commonTerms = fetchedTerms ? fetchedTerms.map(r => String(r.days_to_due)) : commonTermsFromSettings;

    const defaultPaymentTermsDays = useMemo(() => {
        const parsed = parsePaymentTermsDays(settings?.DEFAULT_PAYMENT_TERMS || '');
        return parsed !== null ? String(parsed) : (settings?.DEFAULT_PAYMENT_TERMS || '');
    }, [settings?.DEFAULT_PAYMENT_TERMS]);

    // Distinct from the general DEFAULT_PAYMENT_TERMS default above -- applied
    // inside SplitPaymentModal when the customer is being invoiced On Account.
    const onAccountDefaultTermsDays = useMemo(() => {
        const parsed = parsePaymentTermsDays(settings?.DEFAULT_ON_ACCOUNT_PAYMENT_TERMS || '');
        return parsed !== null ? String(parsed) : null;
    }, [settings?.DEFAULT_ON_ACCOUNT_PAYMENT_TERMS]);

    useEffect(() => {
        if (searchTerm.trim() === '') {
            setSearchResults([]);
            return;
        }

        const fetchSearchResults = async () => {
            try {
                const response = await api.get('/power-search/parts', {
                    params: { keyword: searchTerm }
                });
                const enriched = await enrichPartsArray(response.data || []);
                setSearchResults(enriched);
        } catch (error) {
            console.error('Search error', error);
            toast.error("Search failed.");
            }
        };

        const debounceTimer = setTimeout(fetchSearchResults, 300);
        return () => clearTimeout(debounceTimer);
    }, [searchTerm]);

    useEffect(() => {
        const fetchInitialData = async () => {
            try {
                setLoading(true);
                const [customersRes, brandsRes, groupsRes, taxRatesRes] = await Promise.all([
                    api.get('/customers'),
                    api.get('/brands'),
                    api.get('/groups'),
                    api.get('/tax-rates')
                ]);
                setCustomers(Array.isArray(customersRes.data) ? customersRes.data : []);
                setBrands(Array.isArray(brandsRes.data) ? brandsRes.data : []);
                setGroups(Array.isArray(groupsRes.data) ? groupsRes.data : []);
                setTaxRates(Array.isArray(taxRatesRes.data) ? taxRatesRes.data : []);
                
                // Set default tax rate if available and none is currently selected
                if (taxRatesRes.data.length > 0 && !selectedTaxRate) {
                    const defaultRate = taxRatesRes.data.find(r => r.is_default);
                    if (defaultRate) {
                        setSelectedTaxRate(defaultRate);
                    }
                }
        } catch (err) {
            console.error('Failed to load initial data', err);
            toast.error("Failed to load initial data.");
            } finally {
                setLoading(false);
            }
        };
        
        fetchInitialData();
    }, [selectedTaxRate]);

    useEffect(() => {
        if (pageState && pageState.lines) {
            const mappedLines = pageState.lines.map(item => ({
                part_id: item.part_id,
                quantity: item.quantity,
                sale_price: item.sale_price,
                discount_amount: item.discount_amount || 0,
                tax_rate_id: item.tax_rate_id || null,
                is_tax_inclusive_price: item.is_tax_inclusive_price || false,
                detail: item.detail,
                display_name: item.display_name || item.detail
            }));
            setLines(mappedLines);
            if (pageState.selectedCustomer) {
                setSelectedCustomer(String(pageState.selectedCustomer));
            }
        }
    }, [pageState]);

    useEffect(() => {
        if (settings) {
            setTerms(defaultPaymentTermsDays);

            if (paymentMethodsKey) {
                const methods = paymentMethodsKey.split(',');
                const creditCard = methods.find(m => m.toLowerCase().includes('credit'));
                if (creditCard) {
                    setPaymentMethod(creditCard);
                } else {
                    const first = methods[0];
                    if (first) setPaymentMethod(first);
                }
            }
        }
    }, [settings, paymentMethodsKey]);

    useEffect(() => {
        const fetchTerms = async () => {
            try {
                const res = await api.get('/payment-terms');
                setFetchedTerms(res.data || []);
            } catch (err) {
                // leave fetchedTerms as null to fallback to settings-based list
                console.error('Failed to fetch payment terms from API', err.message);
            }
        };
        fetchTerms();
    }, []);

    // Live duplicate check for the physical receipt number (advisory — the backend
    // auto-increments on a collision rather than rejecting, so this just sets expectations early).
    useEffect(() => {
        const normalized = formatPhysicalReceiptNumber(physicalReceiptNo);
        if (!normalized) {
            setReceiptCheck(null);
            return;
        }
        const debounceTimer = setTimeout(async () => {
            try {
                const res = await api.get(`/invoices/check-physical-receipt/${encodeURIComponent(normalized)}`);
                setReceiptCheck(res.data);
            } catch (err) {
                console.error('Failed to check physical receipt number', err);
            }
        }, 400);
        return () => clearTimeout(debounceTimer);
    }, [physicalReceiptNo]);

    const { saved: savedDrafts, count: savedDraftsCount, saveSale: saveDraft, remove: removeDraft, get: getDraft } = useSavedSales({
        userId: user?.employee_id,
        max: 10,
        storagePrefix: 'invoicing:savedDrafts:',
        labelPrefix: 'Draft'
    });

    const customerOptions = useMemo(() => customers.map(c => ({
        value: String(c.customer_id),
        label: `${c.first_name} ${c.last_name || ''}`.trim()
    })), [customers]);

    const fetchCustomers = async () => {
        const response = await api.get('/customers');
        setCustomers(response.data);
        return response.data;
    };

    const handleNewCustomerSave = async (customerData) => {
        const promise = api.post('/customers', customerData);
        toast.promise(promise, {
            loading: 'Saving customer...',
            success: (response) => {
                const newCustomer = response.data;
                fetchCustomers().then(() => {
                    setSelectedCustomer(String(newCustomer.customer_id));
                });
                setIsCustomerModalOpen(false);
                return 'Customer saved successfully!';
            },
            error: 'Failed to save customer.',
        });
    };

    const addPartToLines = (part) => {
        const existingLine = lines.find(line => line.part_id === part.part_id);
        if (existingLine) {
            setLines(lines.map(line =>
                line.part_id === part.part_id ? { ...line, quantity: line.quantity + 1 } : line
            ));
        } else {
            setLines([...lines, { ...part, part_id: part.part_id, quantity: 1, sale_price: part.last_sale_price || 0 }]);
        }
        setSearchTerm('');
    };

    const handleSaveNewPart = (partData) => {
        const payload = { ...partData, created_by: user.employee_id, tags: ['old_new'] };
        const promise = api.post('/parts', payload);

        toast.promise(promise, {
            loading: 'Saving new part...',
            success: (response) => {
                const newPart = response.data;
                setIsNewPartModalOpen(false);
                addPartToLines({ ...newPart, quantity: 1, sale_price: newPart.last_sale_price || 0 });
                
                return 'Part added and added to cart!';
            },
            error: 'Failed to save part.'
        });
    };

    // Exact-match barcode/SKU lookup, triggered by pressing Enter with no dropdown item highlighted —
    // lets a scanner or a known SKU add a line instantly without waiting on the fuzzy search debounce.
    const handleRapidScan = async (rawValue) => {
        const term = (rawValue ?? searchTerm).trim();
        if (!term) return;
        try {
            const response = await api.get(`/parts/barcode/${encodeURIComponent(term)}`);
            const enriched = await enrichPartsArray([response.data]);
            addPartToLines(enriched[0]);
        } catch (err) {
            if (err.response?.status === 404) {
                toast.error(`No item found for barcode "${term}".`);
            } else {
                console.error(err);
            }
        }
    };

    const { getInputProps: getSearchInputProps, getItemProps: getSearchItemProps } = useTypeahead({
        items: searchResults,
        onSelect: (item) => addPartToLines(item),
        onEnterUnselected: handleRapidScan,
        inputRef: searchInputRef,
        inputId: 'invoicing-search-input',
        listboxId: 'invoicing-search-results'
    });

    const handleLineChange = (partId, field, value) => {
        const raw = typeof value === 'number' ? value : parseFloat(value);
        const numericValue = Math.max(0, isNaN(raw) ? 0 : raw);
        setLines(lines.map(line =>
            line.part_id === partId ? { ...line, [field]: numericValue } : line
        ));
    };

    const handleLineTaxRateChange = (partId, value) => {
        const taxRateId = value ? parseInt(value, 10) : null;
        setLines(lines.map(line =>
            line.part_id === partId ? { ...line, tax_rate_id: taxRateId } : line
        ));
    };

    const handleLineInclusiveToggle = (partId, checked) => {
        setLines(lines.map(line =>
            line.part_id === partId ? { ...line, is_tax_inclusive_price: checked } : line
        ));
    };

    const removeLine = (partId) => {
        setLines(lines.filter(line => line.part_id !== partId));
    };

    // Preview totals only -- the server recomputes these authoritatively on save.
    const { subtotal, tax, total, grossSubtotal, hasInclusive, anomaly } = useMemo(
        () => computeTaxPreview(lines, taxRates, selectedTaxRate, 'INVOICING'),
        [lines, taxRates, selectedTaxRate]
    );

    // Stable signature of the in-progress invoice, used to avoid saving an identical draft twice in a row.
    const draftSignature = useMemo(() => {
        if (!lines.length) return null;
        const items = [...lines]
            .map(l => ({ id: l.part_id, q: l.quantity, p: l.sale_price, d: l.discount_amount || 0 }))
            .sort((a, b) => (a.id > b.id ? 1 : -1));
        return JSON.stringify({ items, c: selectedCustomer || null, t: selectedTaxRate?.tax_rate_id || null });
    }, [lines, selectedCustomer, selectedTaxRate]);

    const canSaveDraft = !!lines.length && draftSignature !== lastSavedDraftSignature;

    const handleSaveDraft = useCallback(() => {
        if (!lines.length) { toast.error('No items to save.'); return; }
        if (!canSaveDraft) { toast.error('Already saved. Make a change before saving again.'); return; }
        const cartSnapshot = {
            items: lines.map(l => ({
                part_id: l.part_id,
                display_name: l.display_name,
                quantity: l.quantity,
                sale_price: l.sale_price,
                discount_amount: l.discount_amount || 0,
                tax_rate_id: l.tax_rate_id || null,
                is_tax_inclusive_price: l.is_tax_inclusive_price || false
            })),
            customerId: selectedCustomer || null,
            taxRateId: selectedTaxRate?.tax_rate_id || null,
            terms,
            paymentMethod,
            physicalReceiptNo,
            totals: { subtotal, tax, grandTotal: total }
        };
        const entry = saveDraft(cartSnapshot);
        if (entry) {
            setLastSavedDraftSignature(draftSignature);
            toast.success('Draft saved.');
        }
    }, [canSaveDraft, lines, selectedCustomer, selectedTaxRate, terms, paymentMethod, physicalReceiptNo, subtotal, tax, total, saveDraft, draftSignature]);

    const handleRestoreDraft = (id) => {
        const entry = getDraft(id);
        if (!entry) return;
        if (lines.length && !window.confirm('Current invoice lines will be replaced. Continue?')) return;
        const { cart } = entry;
        const restoredLines = (cart.items || []).map(i => ({
            part_id: i.part_id,
            display_name: i.display_name,
            quantity: i.quantity,
            sale_price: i.sale_price,
            discount_amount: i.discount_amount || 0,
            tax_rate_id: i.tax_rate_id || null,
            is_tax_inclusive_price: i.is_tax_inclusive_price || false
        }));
        setLines(restoredLines);
        if (cart.customerId) setSelectedCustomer(String(cart.customerId));
        const taxRate = taxRates.find(r => r.tax_rate_id === cart.taxRateId);
        if (taxRate) setSelectedTaxRate(taxRate);
        if (cart.terms !== undefined) setTerms(cart.terms);
        if (cart.paymentMethod) setPaymentMethod(cart.paymentMethod);
        if (cart.physicalReceiptNo !== undefined) setPhysicalReceiptNo(cart.physicalReceiptNo);
        removeDraft(id);
        setIsDraftsModalOpen(false);
        toast.success('Draft restored.');
    };

    // Surface a way to jump to the invoice just posted instead of leaving the user stranded
    // on a blank form with no next step.
    const showViewInvoiceToast = useCallback((invoiceNumber) => {
        if (!invoiceNumber || !onNavigate) return;
        toast((t) => (
            <div className="flex items-center gap-3">
                <span>Invoice {invoiceNumber} posted.</span>
                <button
                    onClick={() => { toast.dismiss(t.id); onNavigate('sales_history'); }}
                    className="text-indigo-600 font-semibold underline whitespace-nowrap"
                >
                    View in Sales History
                </button>
            </div>
        ), { duration: 6000 });
    }, [onNavigate]);

    const handlePostInvoice = useCallback(async () => {
        if (!selectedCustomer || lines.length === 0) {
            toast.error('Please select a customer and add at least one item.');
            return;
        }

        const customer = customers.find(c => String(c.customer_id) === String(selectedCustomer));
        const customerName = customer ? `${customer.first_name} ${customer.last_name || ''}`.trim().toLowerCase() : '';
        const parsedTermsDays = parsePaymentTermsDays(terms);
        const isWalkIn = customerName.includes('walk-in') || customerName.includes('walk in');

        if (isWalkIn && parsedTermsDays > 0) {
            toast.error('Payment terms other than COD are not allowed for Walk-In customers.');
            return;
        }

        // Check if split payments are enabled
        const splitPaymentsEnabled = settings?.ENABLE_SPLIT_PAYMENTS === 'true';

        if (splitPaymentsEnabled) {
            // Use split payment modal for payment processing
            setIsSplitPaymentModalOpen(true);
            return;
        }

        // Legacy single payment method flow
        if (!paymentMethod) {
            toast.error('Please select a payment method.');
            return;
        }

        // Set amount_paid based on payment method  
        const amount_paid = paymentMethod.toLowerCase() === 'cash' ? total : 0;

        const payload = {
            customer_id: selectedCustomer,
            employee_id: user.employee_id,
            payment_method: paymentMethod,
            amount_paid: amount_paid,
            terms: terms,
            payment_terms_days: parsePaymentTermsDays(terms),
            physical_receipt_no: formatPhysicalReceiptNumber(physicalReceiptNo) || null,
            tax_rate_id: selectedTaxRate?.tax_rate_id || null,
            lines: lines.map(line => ({
                part_id: line.part_id,
                quantity: line.quantity,
                sale_price: line.sale_price,
                discount_amount: line.discount_amount || 0,
                tax_rate_id: line.tax_rate_id || null,
                is_tax_inclusive_price: line.is_tax_inclusive_price || false
            })),
        };

        const promise = api.post('/invoices', payload);

        toast.promise(promise, {
            loading: 'Posting invoice...',
            success: (response) => {
                setLines([]);
                setSelectedCustomer('');
                setTerms(defaultPaymentTermsDays);
                setLastSavedDraftSignature(null);
                showViewInvoiceToast(response.data?.invoice_number);
                return `Invoice ${response.data?.invoice_number || ''} created successfully!`;
            },
            error: (err) => {
                if (err?.response?.status === 409) {
                    return err.response.data?.message || 'Physical Receipt No already exists.';
                }
                return 'Failed to create invoice.';
            },
        });
    }, [selectedCustomer, lines, customers, terms, settings, defaultPaymentTermsDays, paymentMethod, physicalReceiptNo, selectedTaxRate, user, total, showViewInvoiceToast]);

    // Handle split payment confirmation for invoicing
    const handleConfirmSplitPayment = async (payments, physicalReceiptNo, { employeeId } = {}) => {
        try {
            // Create the invoice with payments (atomic single-step)
            const invoicePayload = {
                customer_id: selectedCustomer,
                employee_id: employeeId || user.employee_id,
                terms: terms,
                payment_terms_days: parsePaymentTermsDays(terms),
                physical_receipt_no: formatPhysicalReceiptNumber(physicalReceiptNo),
                tax_rate_id: selectedTaxRate?.tax_rate_id || null,
                lines: lines.map(line => ({
                    part_id: line.part_id,
                    quantity: line.quantity,
                    sale_price: line.sale_price,
                    discount_amount: line.discount_amount || 0,
                    tax_rate_id: line.tax_rate_id || null,
                    is_tax_inclusive_price: line.is_tax_inclusive_price || false
                })),
                payments: payments.map(p => ({
                    ...p,
                    reference: formatPhysicalReceiptNumber(physicalReceiptNo) || p.reference
                }))
            };

            const invoiceResponse = await api.post('/invoices', invoicePayload);
            const returnedPhysicalReceiptNo = invoiceResponse.data.physical_receipt_no;

            // Check if physical receipt number was auto-incremented
            if (returnedPhysicalReceiptNo && returnedPhysicalReceiptNo !== formatPhysicalReceiptNumber(physicalReceiptNo)) {
                toast.success(`Invoice created! Physical receipt number was auto-incremented to: ${returnedPhysicalReceiptNo}`);
            }

            // Success - reset form
            setLines([]);
            setSelectedCustomer('');
            setTerms(defaultPaymentTermsDays);
            setLastSavedDraftSignature(null);
            setIsSplitPaymentModalOpen(false);

            toast.success(`Invoice ${invoiceResponse.data.invoice_number} created successfully!`);
            showViewInvoiceToast(invoiceResponse.data.invoice_number);

        } catch (err) {
            console.error('Split payment error:', err);
            const backendMessage = err?.response?.data?.message || err?.response?.data?.error || err?.message;
            if (err?.response?.status === 409) {
                throw new Error(backendMessage || 'Physical Receipt No already exists.');
            }
            // Surface backend validation errors when present
            if (err?.response?.status === 400 && backendMessage) {
                toast.error(backendMessage);
                throw new Error(backendMessage);
            }
            throw new Error('Failed to create invoice.');
        }
    };

    // Keyboard shortcut (Ctrl+Enter / Cmd+Enter) to post the invoice
    useEffect(() => {
        const onKey = (e) => {
            const isMac = /Mac|iPod|iPhone|iPad/.test(navigator.platform);
            if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Enter') {
                e.preventDefault();
                if (selectedCustomer && lines.length > 0) {
                    handlePostInvoice();
                }
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [selectedCustomer, lines, handlePostInvoice]);

    if (loading) return <p className="text-gray-500 dark:text-slate-400">Loading data...</p>;

    return (
        <div className="space-y-6 max-w-7xl mx-auto">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100 tracking-tight">New Invoice</h1>
                <div className="flex items-center space-x-2">
                    <button onClick={() => setIsDraftsModalOpen(true)} title="Saved drafts" className="relative bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-600 px-4 py-2 rounded-lg font-semibold hover:bg-gray-50 dark:hover:bg-slate-700 transition flex items-center shadow-xs">
                        <Icon path={ICONS.bookmark} className="h-5 w-5 mr-2 text-gray-500 dark:text-slate-400" />
                        Drafts
                        {savedDraftsCount > 0 && (
                            <span className="ml-2 bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 rounded-full px-2 py-0.5 text-xs font-bold">{savedDraftsCount}</span>
                        )}
                    </button>
                    <button onClick={handleSaveDraft} disabled={!canSaveDraft} title="Save current invoice as a draft" className="bg-white dark:bg-slate-800 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-600 px-4 py-2 rounded-lg font-semibold hover:bg-gray-50 dark:hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center shadow-xs">
                        <Icon path={ICONS.bookmark} className="h-5 w-5 mr-2 text-gray-500 dark:text-slate-400" />
                        Save Draft
                    </button>
                    <button onClick={handlePostInvoice} title="Post Invoice (Ctrl+Enter)" className="bg-primary-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-primary-700 transition shadow-sm flex items-center">
                        <Icon path={ICONS.check} className="h-5 w-5 mr-2" />
                        Post Invoice
                    </button>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 sm:p-8 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card space-y-8">
                {/* Customer and Payment Section */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 pb-8 border-b border-gray-200 dark:border-slate-700">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-1">
                            Customer
                            <InfoTip label="Customer">
                                Walk-In customers can only be invoiced Due on Receipt — they cannot be given payment terms. If a customer's Outstanding Balance exceeds their Credit Limit, an Over Limit badge appears and you should check with a supervisor before posting.
                            </InfoTip>
                        </label>
                        <div className="flex items-center space-x-2">
                            <div className="flex-1">
                                <Combobox
                                    options={customerOptions}
                                    value={selectedCustomer}
                                    onChange={setSelectedCustomer}
                                    placeholder="Search for a customer..."
                                />
                            </div>
                            <button onClick={() => setIsCustomerModalOpen(true)} aria-label="Add new customer" title="Add new customer" className="p-2 bg-gray-100 dark:bg-slate-700 text-gray-600 dark:text-slate-300 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 transition">
                                <Icon path={ICONS.plus} className="h-5 w-5" />
                            </button>
                        </div>
                        {selectedCustomer && (() => {
                            const cust = customers.find(c => String(c.customer_id) === String(selectedCustomer));
                            if (!cust) return null;
                            const balance = parseFloat(cust.balance_due) || 0;
                            const limit = parseFloat(cust.credit_limit) || 0;
                            const isOverLimit = balance > limit;
                            return (
                                <div className={`mt-2 text-xs font-semibold ${isOverLimit ? 'text-danger-600 dark:text-danger-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                    Outstanding Balance: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{balance.toFixed(2)} / Credit Limit: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{limit.toFixed(2)}
                                    {isOverLimit && <span className="ml-2 bg-danger-100 dark:bg-danger-900/30 text-danger-800 dark:text-danger-400 px-1.5 py-0.5 rounded text-[10px]">Over Limit!</span>}
                                </div>
                            );
                        })()}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-1">
                            Tax Rate
                            <InfoTip label="Tax Rate">
                                Applies to invoice lines that don't specify their own rate. A tax-exclusive line adds tax on top of the entered price; a tax-inclusive line backs the tax out of a price that already includes it.
                            </InfoTip>
                        </label>
                        <select
                            value={selectedTaxRate?.tax_rate_id || ''} 
                            onChange={e => {
                                const taxRate = taxRates.find(rate => rate.tax_rate_id === parseInt(e.target.value));
                                setSelectedTaxRate(taxRate || null);
                            }} 
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg shadow-xs focus:ring-primary-500 focus:border-primary-500 text-sm"
                        >
                            <option value="">Select Tax Rate</option>
                            {taxRates.map(rate => (
                                <option key={rate.tax_rate_id} value={rate.tax_rate_id}>
                                    {rate.rate_name} ({((rate.rate_percentage > 1 ? rate.rate_percentage / 100 : rate.rate_percentage) * 100).toFixed(2)}%)
                                </option>
                            ))}
                        </select>
                    </div>
                    {settings?.ENABLE_SPLIT_PAYMENTS === 'true' ? (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Payment</label>
                            <p className="text-sm text-gray-600 dark:text-slate-400 pt-2">Payment details will be handled at checkout.</p>
                        </div>
                    ) : (
                        <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Payment Method</label>
                            <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg shadow-xs focus:ring-primary-500 focus:border-primary-500 text-sm">
                                {paymentMethods.map(method => <option key={method} value={method}>{method}</option>)}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-1">
                            Physical Receipt No.
                            <InfoTip label="Physical Receipt No.">
                                The number from your pre-printed paper receipt book, so the system record matches the paper copy the customer receives. It's normalized automatically (e.g. "si 4521" becomes "SI-4521") and must be unique.
                            </InfoTip>
                        </label>
                        <input
                            type="text"
                            value={physicalReceiptNo}
                            onChange={e => setPhysicalReceiptNo(e.target.value)}
                            className={`w-full px-3 py-2 rounded-lg shadow-xs bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:ring-primary-500 focus:border-primary-500 text-sm ${receiptCheck?.taken ? 'border-warning-500 dark:border-warning-600' : 'border-gray-300 dark:border-slate-600'}`}
                            placeholder={settings?.RECEIPT_NO_HELP_TEXT || 'Enter receipt number'}
                        />
                        {receiptCheck?.taken && (
                            <p className="mt-1 text-xs text-warning-700 dark:text-warning-400">
                                "{receiptCheck.normalized}" is already used on another invoice — it will be auto-assigned the next available number when posted.
                            </p>
                        )}
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2 flex items-center gap-1">
                            Payment Terms
                            <InfoTip label="Payment Terms">
                                Selling on terms lets the customer take the goods now and pay later within a set number of days. "Due on Receipt" means no credit is extended — Walk-In customers are restricted to this option.
                            </InfoTip>
                        </label>
                        <div className="flex items-center space-x-3">
                            <select
                                value={commonTerms.includes(terms) ? terms : 'custom'}
                                onChange={e => setTerms(e.target.value)}
                                className="px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg shadow-xs focus:ring-primary-500 focus:border-primary-500 text-sm"
                            >
                                {commonTerms.map(ct => <option key={ct} value={ct}>{ct === '0' ? 'Due on Receipt' : `${ct} Days`}</option>)}
                                <option value="custom">Custom...</option>
                            </select>
                            <input
                                type="text"
                                value={terms}
                                onChange={e => setTerms(e.target.value)}
                                onFocus={e => e.target.select()}
                                className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg shadow-xs focus:ring-primary-500 focus:border-primary-500 text-sm"
                                placeholder="e.g., 30"
                            />
                        </div>
                    </div>
                </div>
                
                {/* Add Part Section */}
                <div className="relative">
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Add Items</label>
                    <div className="flex items-center space-x-2">
                        <div className="relative flex-grow">
                            <SearchBar
                                {...getSearchInputProps()}
                                ref={searchInputRef}
                                value={searchTerm}
                                onChange={setSearchTerm}
                                onClear={() => setSearchTerm('')}
                                placeholder="Search by part name, SKU, or application... (Enter to scan barcode/SKU)"
                            />
                        </div>
                        <button onClick={() => setIsNewPartModalOpen(true)} className="bg-primary-50 dark:bg-primary-950/30 text-primary-700 dark:text-primary-300 border border-primary-200 dark:border-primary-800 px-4 py-2 rounded-lg font-semibold hover:bg-primary-100 dark:hover:bg-primary-900/40 transition whitespace-nowrap flex items-center text-sm shadow-xs">
                            <Icon path={ICONS.plus} className="h-5 w-5 mr-2" />
                            New Part
                        </button>
                    </div>
                    {searchResults.length > 0 && (
                        <ul id="invoicing-search-results" className="absolute z-10 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-lg mt-1 shadow-lg max-h-60 overflow-y-auto scrollbar-thin divide-y divide-gray-100 dark:divide-slate-700" role="listbox">
                            {searchResults.map((part, index) => {
                                const itemProps = getSearchItemProps(index);
                                return (
                                    <li key={part.part_id} {...itemProps} className={`px-4 py-3 cursor-pointer transition-colors ${itemProps['aria-selected'] ? 'bg-primary-100 dark:bg-primary-900/40' : 'hover:bg-primary-50 dark:hover:bg-slate-700/50'}`}>
                                        <div className="flex items-baseline justify-between">
                                            <div className="flex items-baseline space-x-2 flex-1 min-w-0">
                                                <div className="text-sm font-medium text-gray-900 dark:text-slate-100 truncate">{part.display_name}</div>
                                                {part.applications && <div className="text-xs text-gray-500 dark:text-slate-400 truncate">{formatApplicationText(part.applications, { style: 'searchSuggestion' })}</div>}
                                            </div>
                                            <div className="text-sm font-semibold text-gray-700 dark:text-slate-300 ml-4 font-mono">
                                                {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{part.last_sale_price ? Number(part.last_sale_price).toFixed(2) : '0.00'}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>

                {/* Invoice Lines Table */}
                <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-xl">
                    <table className="w-full text-left">
                        <thead className="bg-gray-50 dark:bg-slate-700/40 text-gray-700 dark:text-slate-300 border-b border-gray-200 dark:border-slate-700">
                            <tr>
                                <th className="p-4 text-sm font-semibold">Item</th>
                                <th className="p-4 text-sm font-semibold w-28 text-center">Quantity</th>
                                <th className="p-4 text-sm font-semibold w-36 text-right">Sale Price</th>
                                <th className="p-4 text-sm font-semibold w-32 text-right">Discount</th>
                                <th className="p-4 text-sm font-semibold w-40 text-center">Tax</th>
                                <th className="p-4 text-sm font-semibold w-36 text-right">Line Total</th>
                                <th className="p-4 text-sm font-semibold w-16 text-center"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                            {lines.length > 0 ? lines.map(line => (
                                <tr key={line.part_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40 text-gray-800 dark:text-slate-200 transition-colors">
                                    <td className="p-4 text-sm font-medium text-gray-900 dark:text-slate-100">{line.display_name}</td>
                                    <td className="p-4"><MathExpressionInput precision={2} min={0} value={line.quantity} onChange={val => handleLineChange(line.part_id, 'quantity', val)} aria-label={`Quantity for ${line.display_name}`} className="w-full p-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-center font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /></td>
                                    <td className="p-4"><MathExpressionInput precision={2} min={0} value={line.sale_price} onChange={val => handleLineChange(line.part_id, 'sale_price', val)} aria-label={`Sale price for ${line.display_name}`} className="w-full p-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /></td>
                                    <td className="p-4"><MathExpressionInput precision={2} min={0} max={(Number(line.quantity) || 0) * (Number(line.sale_price) || 0)} value={line.discount_amount || 0} onChange={val => handleLineChange(line.part_id, 'discount_amount', val)} aria-label={`Discount for ${line.display_name}`} className="w-full p-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-right font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" /></td>
                                    <td className="p-4">
                                        <select
                                            value={line.tax_rate_id || ''}
                                            onChange={e => handleLineTaxRateChange(line.part_id, e.target.value)}
                                            aria-label={`Tax rate for ${line.display_name}`}
                                            className="w-full p-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-primary-500"
                                        >
                                            <option value="">Default</option>
                                            {taxRates.map(rate => (
                                                <option key={rate.tax_rate_id} value={rate.tax_rate_id}>{rate.rate_name}</option>
                                            ))}
                                        </select>
                                        <label className="flex items-center justify-center gap-1 mt-1 text-[10px] text-gray-500 dark:text-slate-400">
                                            <input
                                                type="checkbox"
                                                checked={!!line.is_tax_inclusive_price}
                                                onChange={e => handleLineInclusiveToggle(line.part_id, e.target.checked)}
                                                aria-label={`Tax-inclusive price for ${line.display_name}`}
                                                className="rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                                            />
                                            Tax-incl.
                                        </label>
                                    </td>
                                    <td className="p-4 text-sm font-medium text-gray-900 dark:text-slate-100 text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{((line.quantity * line.sale_price) - (line.discount_amount || 0)).toFixed(2)}</td>
                                    <td className="p-4 text-center"><button onClick={() => removeLine(line.part_id)} aria-label={`Remove ${line.display_name}`} title="Remove line" className="text-gray-400 hover:text-danger-600 dark:hover:text-danger-400 transition-colors p-1 rounded"><Icon path={ICONS.trash} className="h-5 w-5"/></button></td>
                                </tr>
                            )) : (
                                <tr>
                                    <td colSpan="7" className="text-center py-12 text-gray-500 dark:text-slate-400">
                                        <Icon path={ICONS.inbox} className="h-12 w-12 mx-auto text-gray-300 dark:text-slate-600 mb-2" />
                                        No items added yet.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Totals Section */}
                <div className="flex justify-end items-center pt-6 border-t border-gray-200 dark:border-slate-700">
                    <div className="text-right space-y-2">
                        {anomaly && (
                            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 rounded-xl p-3 mb-4 text-left">
                                <div className="flex items-start">
                                    <div className="flex-shrink-0">
                                        <svg className="h-5 w-5 text-amber-400" viewBox="0 0 20 20" fill="currentColor">
                                            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                        </svg>
                                    </div>
                                    <div className="ml-3">
                                        <p className="text-sm font-medium text-amber-800 dark:text-amber-300">Tax Calculation Warning</p>
                                        <div className="text-xs text-amber-700 dark:text-amber-300/80 mt-1">
                                            {anomaly.type === 'HIGH_EFFECTIVE_RATE' && 
                                                `Effective tax rate unusually high: ${(anomaly.effectiveRate * 100).toFixed(2)}%`
                                            }
                                            {anomaly.type === 'RECOMPOSE_MISMATCH' && 
                                                `Tax Anomaly: Mismatch between entered and recomposed totals`
                                            }
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="min-w-[300px] bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-100 dark:border-slate-700">
                            {hasInclusive && (
                                <div className="flex justify-between items-center py-1">
                                    <span className="text-sm text-gray-500 dark:text-slate-400">Items Total (Entered):</span>
                                    <span className="text-sm font-medium text-gray-700 dark:text-slate-300 font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{grossSubtotal.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="flex justify-between items-center py-1">
                                <span className="text-sm text-gray-600 dark:text-slate-400" title={hasInclusive ? 'Net subtotal (exclusive of tax extracted from inclusive line prices)' : 'Sum of line totals before tax'}>
                                    {hasInclusive ? 'Net Subtotal (Ex Tax):' : 'Subtotal:'}
                                </span>
                                <span className="font-medium text-gray-900 dark:text-slate-100 font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{subtotal.toFixed(2)}</span>
                            </div>
                            {tax > 0 && (
                                <div className="flex justify-between items-center py-1">
                                    <span className="text-sm text-gray-600 dark:text-slate-400">Tax:</span>
                                    <span className="font-medium text-gray-900 dark:text-slate-100 font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{tax.toFixed(2)}</span>
                                </div>
                            )}
                            <div className="border-t border-gray-200 dark:border-slate-700 pt-2 mt-2">
                                <div className="flex justify-between items-center">
                                    <span className="text-lg font-semibold text-gray-800 dark:text-slate-100">Total:</span>
                                    <span className="text-xl font-bold text-gray-900 dark:text-slate-100 font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{total.toFixed(2)}</span>
                                </div>
                            </div>
                            {hasInclusive && (
                                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">* Some items have tax-inclusive pricing</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <Modal isOpen={isDraftsModalOpen} onClose={() => setIsDraftsModalOpen(false)} title="Saved Drafts">
                <SavedSalesPanel
                    saved={savedDrafts}
                    onRestore={handleRestoreDraft}
                    onDelete={removeDraft}
                    currency={settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}
                />
            </Modal>
            <Modal isOpen={isCustomerModalOpen} onClose={() => setIsCustomerModalOpen(false)} title="Add New Customer">
                <CustomerForm onSave={handleNewCustomerSave} onCancel={() => setIsCustomerModalOpen(false)} />
            </Modal>
            <Modal isOpen={isNewPartModalOpen} onClose={() => setIsNewPartModalOpen(false)} title="Add New Part">
                <PartForm
                    brands={brands}
                    groups={groups}
                    onSave={handleSaveNewPart}
                    onCancel={() => setIsNewPartModalOpen(false)}
                />
            </Modal>
            {settings?.ENABLE_SPLIT_PAYMENTS === 'true' && (
                <SplitPaymentModal
                    isOpen={isSplitPaymentModalOpen}
                    onClose={() => setIsSplitPaymentModalOpen(false)}
                    totalDue={total || 0}
                    onConfirm={handleConfirmSplitPayment}
                    physicalReceiptNo={physicalReceiptNo}
                    onPhysicalReceiptChange={setPhysicalReceiptNo}
                    requirePhysicalReceipt={true}
                    employeeId={user?.employee_id}
                    terms={terms}
                    onTermsChange={setTerms}
                    commonTerms={commonTerms}
                    generalDefaultTermsDays={defaultPaymentTermsDays}
                    onAccountDefaultTermsDays={onAccountDefaultTermsDays}
                    customerName={(() => {
                        const customer = customers.find(c => String(c.customer_id) === String(selectedCustomer));
                        return customer ? `${customer.first_name} ${customer.last_name || ''}`.trim() : '';
                    })()}
                />
            )}
        </div>
    );
};

export default InvoicingPage;