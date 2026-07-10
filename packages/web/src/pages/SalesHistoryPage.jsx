import { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useSettings } from '../contexts/SettingsContext';
import DateRangeShortcuts from '../components/ui/DateRangeShortcuts';
import InvoiceDetailsModal from '../components/refunds/InvoiceDetailsModal';
import SortableHeader from '../components/ui/SortableHeader';

// Some static analyzers occasionally report unused JSX imports; reference them here harmlessly
// to avoid false-positive lint errors.
void DateRangeShortcuts;
void InvoiceDetailsModal;
void SortableHeader;
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// Helper function to get badge styles based on status
const getStatusBadge = (status) => {
    switch (status) {
        case 'Paid':
            return 'bg-green-100 text-green-800';
        case 'Partially Refunded':
            return 'bg-yellow-100 text-yellow-800';
        case 'Fully Refunded':
            return 'bg-red-100 text-red-800';
        case 'Unpaid':
            return 'bg-gray-100 text-gray-800';
        case 'Partially Paid':
            return 'bg-blue-100 text-blue-800';
        default:
            return 'bg-gray-100 text-gray-800';
    }
};


const SalesHistoryPage = () => {
    const { settings } = useSettings();
    const [invoices, setInvoices] = useState([]);
    const [payments, setPayments] = useState([]); // Phase 1 payments for cash metrics
    const [paymentMethods, setPaymentMethods] = useState([]); // Configurable payment methods
    const [refundsApprox, setRefundsApprox] = useState(0); // TEMP approximate refunds treated as cash out
    const [loading, setLoading] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'invoice_date', direction: 'DESC' });
    const [dates, setDates] = useState(() => {
        const now = toZonedTime(new Date(), 'Asia/Manila');
        const dateStr = format(now, 'yyyy-MM-dd');
        return {
            startDate: dateStr,
            endDate: dateStr,
        };
    });
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const debounceRef = useRef(null);
    
    const [selectedInvoice, setSelectedInvoice] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    // Persisted collapsed state (default: hidden)
    const [summaryCollapsed, setSummaryCollapsed] = useState(() => {
        try {
            const v = localStorage.getItem('salesSummaryCollapsed');
            return v === null ? true : v === 'true';
        } catch {
            return true;
        }
    });
    const summaryRef = useRef(null);
    const [maxHeight, setMaxHeight] = useState('0px');

    // Pure computation of enhanced stats leveraging refunded_amount, net_amount, balance_due + Phase 1 cash metrics
    const stats = useMemo(() => {
        if (!Array.isArray(invoices) || invoices.length === 0) {
            return {
                grossSales: 0,
                refunds: 0,
                netSales: 0,
                vatCollected: 0,
                arOutstanding: 0,
                invoicesIssued: 0,
                netActiveInvoices: 0,
                avgNetInvoice: 0,
                topCustomer: '-',
                topCustomerNet: 0,
                topCustomerShare: 0,
                refundRate: 0,
                cashCollectedNet: 0,
                nonCashCollected: 0,
                expectedNetCashDrawer: 0,
                cashMix: 0,
                cashInflow: 0,
                changeReturned: 0,
                refundsApprox: 0,
                totalCollections: 0,
                amountCollected: 0,
                collectionRate: 0,
                paymentMethodBreakdown: {}
            };
        }

        const currencySafeNumber = (v) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : 0;
        };

        const active = invoices.filter(inv => inv.status !== 'Cancelled');

        let grossSalesExclTax = 0;
        let taxTotal = 0;
        let refundsExclTax = 0;
        let refundTaxTotal = 0;
        let arOutstanding = 0;
        let amountCollected = 0;

        const customerNetMap = {};
        let netActiveInvoices = 0;

        for (const inv of active) {
            // Financials (Tax Exclusive)
            const grossLine = currencySafeNumber(inv.subtotal_ex_tax !== undefined ? inv.subtotal_ex_tax : inv.total_amount);
            const vatLine = currencySafeNumber(inv.tax_total || 0);
            const refundLine = currencySafeNumber(inv.refunded_amount_ex_tax !== undefined ? inv.refunded_amount_ex_tax : inv.refunded_amount);
            const refundVatLine = currencySafeNumber(inv.refunded_tax_total || 0);

            const net = Math.max(grossLine - refundLine, 0);

            grossSalesExclTax += grossLine;
            taxTotal += vatLine;
            refundsExclTax += refundLine;
            refundTaxTotal += refundVatLine;

            // Receivables (Tax Inclusive)
            const netInclusive = currencySafeNumber(inv.net_amount !== undefined ? inv.net_amount : Math.max(currencySafeNumber(inv.total_amount) - currencySafeNumber(inv.refunded_amount), 0));
            const collected = Math.min(currencySafeNumber(inv.amount_paid), netInclusive);
            const balanceRaw = inv.balance_due !== undefined ? currencySafeNumber(inv.balance_due) : (netInclusive - collected);
            
            arOutstanding += Math.max(balanceRaw, 0);
            amountCollected += collected;

            if (net > 0) netActiveInvoices += 1;

            const customerName = `${inv.customer_first_name || ''} ${inv.customer_last_name || ''}`.trim() || 'Unknown';
            customerNetMap[customerName] = (customerNetMap[customerName] || 0) + net;
        }

        const invoicesIssued = active.length;
        const avgNetInvoice = netActiveInvoices > 0 ? (grossSalesExclTax - refundsExclTax) / netActiveInvoices : 0;
        const refundRate = grossSalesExclTax > 0 ? Math.min(refundsExclTax / grossSalesExclTax, 1) : 0;

        let topCustomer = '-';
        let topCustomerNet = 0;
        for (const [cust, val] of Object.entries(customerNetMap)) {
            if (val > topCustomerNet) { topCustomer = cust; topCustomerNet = val; }
        }
        const topCustomerShare = (grossSalesExclTax - refundsExclTax) > 0 ? topCustomerNet / (grossSalesExclTax - refundsExclTax) : 0;

        const getCashMethodNames = () => {
            if (settings?.ENABLE_SPLIT_PAYMENTS === 'true' && paymentMethods.length > 0) {
                return paymentMethods
                    .filter(pm => pm.enabled && pm.type === 'cash')
                    .map(pm => pm.name.toLowerCase());
            } else {
                return ['cash'];
            }
        };

        const cashMethodNames = getCashMethodNames();
        const currentInvoiceNumbers = new Set(active.map(inv => inv.invoice_number));

        let cashCollected = 0; let nonCashCollected = 0; let changeReturned = 0;
        for (const p of payments) {
            if (p.payment_status && p.payment_status !== 'settled') {
                continue;
            }
            const ref = (p.reference || '').toString().trim();
            const looksLikeInvoiceNo = /^INV/i.test(ref);
            if (looksLikeInvoiceNo && !currentInvoiceNumbers.has(ref)) {
                continue;
            }
            const amt = currencySafeNumber(p.amount);
            const tendered = currencySafeNumber(p.tendered_amount) || amt;
            const change = tendered > amt ? (tendered - amt) : 0;
            const method = (p.payment_method || '').toString().trim().toLowerCase();
            if (cashMethodNames.includes(method)) {
                cashCollected += tendered;
                changeReturned += change;
            } else {
                nonCashCollected += amt;
            }
        }

        const cashCollectedNet = Math.max(cashCollected - changeReturned, 0);
        const totalCollectedNet = cashCollectedNet + nonCashCollected;
        const cashMix = totalCollectedNet > 0 ? cashCollectedNet / totalCollectedNet : 0;

        const expectedNetCashDrawer = Math.max(cashCollectedNet - refundsApprox, 0);

        const paymentMethodBreakdown = {};
        for (const p of payments) {
            if (p.payment_status && p.payment_status !== 'settled') {
                continue;
            }
            const ref = (p.reference || '').toString().trim();
            const looksLikeInvoiceNo = /^INV/i.test(ref);
            if (looksLikeInvoiceNo && !currentInvoiceNumbers.has(ref)) {
                continue;
            }
            const method = (p.payment_method || '').toString().trim();
            const amt = currencySafeNumber(p.amount);
            
            if (!paymentMethodBreakdown[method]) {
                paymentMethodBreakdown[method] = {
                    amount: 0,
                    count: 0,
                    methodName: method
                };
            }
            paymentMethodBreakdown[method].amount += amt;
            paymentMethodBreakdown[method].count += 1;
        }

        return {
            grossSales: grossSalesExclTax,
            refunds: refundsExclTax,
            netSales: grossSalesExclTax - refundsExclTax,
            vatCollected: Math.max(taxTotal - refundTaxTotal, 0),
            arOutstanding,
            invoicesIssued,
            netActiveInvoices,
            avgNetInvoice,
            topCustomer,
            topCustomerNet,
            topCustomerShare,
            refundRate,
            cashCollectedNet,
            nonCashCollected,
            expectedNetCashDrawer,
            cashMix,
            cashInflow: cashCollected,
            changeReturned,
            refundsApprox,
            totalCollections: totalCollectedNet,
            amountCollected,
            collectionRate: (grossSalesExclTax - refundsExclTax) > 0 ? Math.min(amountCollected / (grossSalesExclTax - refundsExclTax + taxTotal - refundTaxTotal), 1) : 0,
            paymentMethodBreakdown
        };
    }, [invoices, payments, refundsApprox, paymentMethods, settings?.ENABLE_SPLIT_PAYMENTS]);

    // Keep maxHeight in sync to animate expand/collapse
    useEffect(() => {
        if (!summaryRef.current) return;
        const el = summaryRef.current;

        // Ensure we have a sensible transition defined
        el.style.transition = 'max-height 300ms ease, opacity 200ms ease';

        if (summaryCollapsed) {
            // COLLAPSING: make sure the element has a measured max-height first,
            // force a reflow, then set max-height to 0 and fade out opacity.
            try {
                // If the element was left with 'none', measure its scrollHeight
                const startHeight = el.scrollHeight || el.offsetHeight || 0;
                el.style.maxHeight = `${startHeight}px`;
                el.style.opacity = '1';
                // Force reflow so the browser registers the starting height
                el.offsetHeight;
                // Now animate to collapsed
                el.style.opacity = '0';
                el.style.maxHeight = '0px';
                setMaxHeight('0px');
            } catch {
                el.style.maxHeight = '0px';
                el.style.opacity = '0';
                setMaxHeight('0px');
            }
        } else {
            // EXPANDING: set opacity to 1 and animate max-height to measured value
            try {
                const target = `${el.scrollHeight}px`;
                el.style.opacity = '0';
                // ensure starting point is 0 so the transition plays
                el.style.maxHeight = '0px';
                // force reflow
                el.offsetHeight;
                el.style.opacity = '1';
                el.style.maxHeight = target;
                setMaxHeight(target);
            } catch {
                el.style.maxHeight = 'none';
                el.style.opacity = '1';
                setMaxHeight('none');
            }
        }
        // update when stats change so expanded height adapts
    }, [summaryCollapsed, stats]);

    // After expand animation completes, set maxHeight to 'none' so content can grow naturally
    useEffect(() => {
        const el = summaryRef.current;
        if (!el) return;
        const onTransitionEnd = (e) => {
            if (e.propertyName !== 'max-height') return;
            if (!summaryCollapsed) {
                // expansion finished
                setMaxHeight('none');
            }
        };
        el.addEventListener('transitionend', onTransitionEnd);
        return () => el.removeEventListener('transitionend', onTransitionEnd);
    }, [summaryCollapsed]);


    const fetchInvoices = useMemo(() => {
        return async () => {
            setLoading(true);
            try {
                const response = await api.get('/invoices', { params: { ...dates, q: debouncedQuery || undefined } });
                setInvoices(response.data);
            } catch {
                toast.error('Failed to fetch sales history.');
            } finally {
                setLoading(false);
            }
        };
    }, [dates, debouncedQuery]);

    const fetchPayments = useMemo(() => {
        return async () => {
            try {
                const resp = await api.get('/payments', { params: { ...dates } });
                setPayments(resp.data);
            } catch {
                // optional toast suppressed
            }
        };
    }, [dates]);

    const fetchRefundsApprox = useMemo(() => {
        return async () => {
            try {
                const resp = await api.get('/payments/refunds-approx', { params: { ...dates } });
                setRefundsApprox(parseFloat(resp.data.total_refunds) || 0);
            } catch {
                setRefundsApprox(0);
            }
        };
    }, [dates]);

    const fetchPaymentMethods = useMemo(() => {
        return async () => {
            try {
                // Only fetch if split payments are enabled
                if (settings?.ENABLE_SPLIT_PAYMENTS === 'true') {
                    const resp = await api.get('/payment-methods');
                    setPaymentMethods(resp.data || []);
                } else {
                    setPaymentMethods([]);
                }
            } catch {
                setPaymentMethods([]);
            }
        };
    }, [settings?.ENABLE_SPLIT_PAYMENTS]);

    // A convenience full refresh used after actions that affect multiple datasets
    const fullRefresh = useMemo(() => {
        return async () => {
            // run the refreshes in parallel where sensible
            await Promise.allSettled([fetchInvoices(), fetchPayments(), fetchRefundsApprox(), fetchPaymentMethods()]);
        };
    }, [fetchInvoices, fetchPayments, fetchRefundsApprox, fetchPaymentMethods]);

    // Listen for external invoice changes so this page can react (e.g., deletions from other pages)
    useEffect(() => {
        const handler = () => {
            // avoid double fetching if we're already mid-refresh
            if (loading) return;
            fullRefresh().catch(() => {});
        };
        window.addEventListener('invoices:changed', handler);
        return () => window.removeEventListener('invoices:changed', handler);
    }, [fullRefresh, loading]);

    useEffect(() => {
        fetchInvoices();
        fetchPayments();
        fetchRefundsApprox();
        fetchPaymentMethods();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dates, debouncedQuery]);

    // Fetch payment methods when settings change
    useEffect(() => {
        fetchPaymentMethods();
    }, [fetchPaymentMethods]);

    // Debounce the search input
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedQuery(query.trim());
        }, 300);
        return () => debounceRef.current && clearTimeout(debounceRef.current);
    }, [query]);

    const handleDateChange = (e) => {
        setDates(prev => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleRowClick = (invoice) => {
        setSelectedInvoice(invoice);
        setIsModalOpen(true);
    };

    const handleSort = (key, direction) => setSortConfig({ key, direction });

    const sortedInvoices = useMemo(() => {
        const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
        const data = [...invoices];
        const { key, direction } = sortConfig;
        const factor = direction === 'ASC' ? 1 : -1;

        const asCustomer = (inv) => `${inv.customer_first_name || ''} ${inv.customer_last_name || ''}`.trim();

        data.sort((a, b) => {
            let av; let bv;
            switch (key) {
                case 'invoice_number':
                    av = a.invoice_number; bv = b.invoice_number; break;
                case 'physical_receipt_no':
                    av = a.physical_receipt_no; bv = b.physical_receipt_no; break;
                case 'invoice_date':
                    av = parseISO(a.invoice_date).getTime();
                    bv = parseISO(b.invoice_date).getTime();
                    return factor * ((av || 0) - (bv || 0));
                case 'customer':
                    av = asCustomer(a); bv = asCustomer(b); break;
                case 'status':
                    av = a.status; bv = b.status; break;
                case 'total_amount':
                    av = parseFloat(a.total_amount) || 0;
                    bv = parseFloat(b.total_amount) || 0;
                    return factor * (av - bv);
                default:
                    av = ''; bv = '';
            }
            return factor * collator.compare(String(av || ''), String(bv || ''));
        });
        return data;
    }, [invoices, sortConfig]);

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Sales History</h1>

            <div className="bg-white p-6 rounded-xl border border-gray-200 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                        <input type="date" name="startDate" value={dates.startDate} onChange={handleDateChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
                        <input type="date" name="endDate" value={dates.endDate} onChange={handleDateChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search invoice #, physical receipt no., customer, or item..."
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                    </div>
                    <div className="md:col-span-3">
                       <DateRangeShortcuts onSelect={setDates} />
                    </div>
                </div>
            </div>

            {/* Sales statistics for selected date range */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 mb-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-gray-700">Summary</h2>
                    <button
                        type="button"
                        onClick={() => {
                            setSummaryCollapsed(s => {
                                const next = !s;
                                try { localStorage.setItem('salesSummaryCollapsed', String(next)); } catch { /* ignore localStorage errors */ }
                                return next;
                            });
                        }}
                        className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-800"
                        aria-expanded={!summaryCollapsed}
                    >
                        <span>{summaryCollapsed ? 'Show' : 'Hide'}</span>
                        <svg className={`w-5 h-5 transform transition-transform ${summaryCollapsed ? '' : 'rotate-180'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path>
                        </svg>
                    </button>
                </div>
                {/* Compact view shows when collapsed */}
                <div className={`mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 items-stretch ${summaryCollapsed ? '' : 'hidden'}`}>
                    <div className="h-full p-2 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col justify-between" title="Net Sales = Gross - Refunds (excluding VAT, excludes Cancelled)">
                        <div className="text-[11px] text-gray-500">Net Sales (Excl. VAT)</div>
                        <div className="text-sm font-semibold text-gray-800 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.netSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="h-full p-2 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col justify-between" title="Amount Collected (including VAT, capped at net invoice amount)">
                        <div className="text-[11px] text-gray-500">Collected (Incl. VAT)</div>
                        <div className="text-sm font-semibold text-green-600 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.amountCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="h-full p-2 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col justify-between" title="Expected Register Cash = Cash Net (Tendered - Change) - Cash Refunds (Approx.)">
                        <div className="text-[11px] text-gray-500">Expected Net Cash (Drawer)</div>
                        <div className="text-sm font-semibold text-gray-800 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.expectedNetCashDrawer.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="h-full p-2 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col justify-between" title="Collection Rate = Collected / Total Net Invoiced (including VAT)">
                        <div className="text-[11px] text-gray-500">Collection Rate</div>
                        <div className="text-sm font-semibold text-gray-800">{(stats.collectionRate * 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%</div>
                    </div>
                    <div className="h-full p-2 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col justify-between" title="Outstanding A/R = Sum of unpaid balances due (including VAT)">
                        <div className="text-[11px] text-gray-500">A/R Outstanding</div>
                        <div className="text-sm font-semibold text-red-600 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.arOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                </div>

                {/* Expanded view (animated) */}
                <div
                    ref={summaryRef}
                    className="mt-4 overflow-hidden"
                    style={{ maxHeight, transition: 'max-height 300ms ease' }}
                    aria-hidden={summaryCollapsed}
                >
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-stretch">
                        {
                            // Build an array of card descriptors so we can stagger animations
                            [
                                {
                                    key: 'operationalReconciliation',
                                    className: 'bg-gradient-to-br from-white to-blue-50/30 md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500 flex items-center justify-between">
                                                <span className="font-medium text-blue-700 text-xs uppercase tracking-wider">Operational Cash Flow (Tax-Inclusive)</span>
                                                <span className="text-[10px] uppercase tracking-wide text-gray-400">Drawer Count</span>
                                            </div>
                                            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                                                <div>
                                                    <div className="text-xs text-gray-500">Expected Net Cash (Drawer)</div>
                                                    <div className="font-semibold text-gray-800 text-base">
                                                        {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.expectedNetCashDrawer.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-gray-500">Non-Cash Collections</div>
                                                    <div className="font-semibold text-gray-800 text-base">
                                                        {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.nonCashCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] text-gray-400">Tendered: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.cashInflow.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                                    <div className="text-[11px] text-gray-400">Change: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.changeReturned.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] text-gray-400">Refunds Out: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.refundsApprox.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                                    <div className="text-[11px] text-gray-400">Cash Mix: {(stats.cashMix * 100).toFixed(1)}%</div>
                                                </div>
                                            </div>
                                            <div className="text-[10px] text-gray-400 mt-2">
                                                Reconcile Expected Net Cash (Drawer) with physical till count.
                                            </div>
                                        </>
                                    )
                                },
                                {
                                    key: 'financialRevenue',
                                    className: 'bg-gradient-to-br from-white to-green-50/20 md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500 flex items-center justify-between">
                                                <span className="font-medium text-green-700 text-xs uppercase tracking-wider">Accrual & Revenue Statistics (Excl. VAT)</span>
                                                <span className="text-[10px] uppercase tracking-wide text-gray-400">Financial Reporting</span>
                                            </div>
                                            <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                                                <div>
                                                    <div className="text-xs text-gray-500">Gross Sales</div>
                                                    <div className="font-semibold text-gray-800 text-sm">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.grossSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-gray-500">Refunds</div>
                                                    <div className="font-semibold text-yellow-600 text-sm">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.refunds.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-gray-500">Net Sales</div>
                                                    <div className="font-semibold text-green-600 text-sm">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.netSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                            </div>
                                            <div className="text-[11px] text-gray-500 mt-2 flex justify-between">
                                                <span>Net VAT Collected: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.vatCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                <span>Range {dates.startDate} → {dates.endDate}</span>
                                            </div>
                                        </>
                                    )
                                },
                                {
                                    key: 'invoices',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500">Invoices Issued</div>
                                            <div className="mt-2 text-2xl font-semibold text-gray-800">{stats.invoicesIssued}</div>
                                            <div className="text-xs text-gray-500 mt-1">Excludes Cancelled</div>
                                        </>
                                    )
                                },
                                {
                                    key: 'avg',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500">Avg Net Invoice</div>
                                            <div className="mt-2 text-2xl font-semibold text-gray-800">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.avgNetInvoice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                            <div className="text-xs text-gray-500 mt-1">Net Sales / Net Active</div>
                                        </>
                                    )
                                },
                                {
                                    key: 'top-customer-outstanding',
                                    className: 'md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500">Overview</div>
                                            <div className="mt-2 grid grid-cols-3 gap-3">
                                                <div className="text-center">
                                                    <div className="text-xs text-gray-500">Top Customer</div>
                                                    <div className="mt-1 text-sm font-semibold text-gray-800 truncate" title={stats.topCustomer}>{stats.topCustomer}</div>
                                                    <div className="text-[10px] text-gray-500 mt-0.5">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.topCustomerNet.toLocaleString(undefined, { maximumFractionDigits: 2 })} ({(stats.topCustomerShare*100).toLocaleString(undefined,{maximumFractionDigits:1})}%)</div>
                                                </div>

                                                <div className="text-center">
                                                    <div className="text-xs text-gray-500">Total Collections</div>
                                                    <div className="mt-1 text-sm font-semibold text-green-600">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.totalCollections.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                                                    <div className="text-[10px] text-gray-500 mt-0.5">Rate: {(stats.collectionRate*100).toLocaleString(undefined,{maximumFractionDigits:1})}%</div>
                                                </div>

                                                <div className="text-center">
                                                    <div className="text-xs text-gray-500">Outstanding A/R</div>
                                                    <div className="mt-1 text-sm font-semibold text-red-600">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.arOutstanding.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                                                    <div className="text-[10px] text-gray-500 mt-0.5">Active Invoices: {stats.netActiveInvoices}</div>
                                                </div>
                                            </div>
                                        </>
                                    )
                                },
                                // Payment Methods breakdown card (only show if split payments enabled or payment breakdown exists)
                                ...(settings?.ENABLE_SPLIT_PAYMENTS === 'true' || Object.keys(stats.paymentMethodBreakdown || {}).length > 0 ? [{
                                    key: 'payment-methods',
                                    className: 'md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500 flex items-center justify-between">
                                                <span>Payment Methods</span>
                                                <span className="text-[10px] uppercase tracking-wide text-gray-400">Breakdown</span>
                                            </div>
                                            <div className="mt-2">
                                                {Object.keys(stats.paymentMethodBreakdown || {}).length === 0 ? (
                                                    <div className="text-center text-gray-500 text-sm py-4">No payment data for this period</div>
                                                ) : (
                                                    <div className="space-y-2 max-h-32 overflow-y-auto">
                                                        {Object.values(stats.paymentMethodBreakdown || {})
                                                            .sort((a, b) => b.amount - a.amount)
                                                            .map(method => {
                                                                const totalPayments = Object.values(stats.paymentMethodBreakdown || {}).reduce((sum, m) => sum + m.amount, 0);
                                                                const percentage = totalPayments > 0 ? (method.amount / totalPayments) * 100 : 0;
                                                                return (
                                                                    <div key={method.methodName} className="flex items-center justify-between">
                                                                        <div className="flex items-center space-x-2">
                                                                            <span className="text-sm font-medium text-gray-700">{method.methodName}</span>
                                                                            <span className="text-xs text-gray-500">({method.count} txns)</span>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <div className="text-sm font-semibold text-gray-800">
                                                                                {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{method.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                            </div>
                                                                            <div className="text-xs text-gray-500">{percentage.toFixed(1)}%</div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-gray-500 mt-2 flex justify-between">
                                                <span>Cash Mix: {(stats.cashMix * 100).toFixed(1)}%</span>
                                                <span>Non-Cash: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.nonCashCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                            </div>
                                        </>
                                    )
                                }] : [])
                            ].map((card, idx) => {
                                // stagger only on expand
                                const delayMs = summaryCollapsed ? 0 : idx * 60;
                                const transformCollapsed = 'translateY(6px) scale(0.995)';
                                const transformExpanded = 'translateY(0) scale(1)';
                                const style = {
                                    transform: summaryCollapsed ? transformCollapsed : transformExpanded,
                                    opacity: summaryCollapsed ? 0 : 1,
                                    transition: 'transform 320ms cubic-bezier(.2,.9,.2,1), opacity 240ms ease',
                                    transitionDelay: `${delayMs}ms`
                                };

                                // If a card descriptor includes an md:col-span-2 class name, preserve it on the wrapper
                                const wrapperColSpan = card.className && card.className.includes('md:col-span-2') ? 'md:col-span-2' : '';
                                // Remove layout helpers from the inner card classes so they are only applied to the wrapper
                                const innerCardClass = (card.className || 'bg-white').replace('md:col-span-2', '').trim();

                                return (
                                    <div key={card.key} className={`${wrapperColSpan} h-full`} style={style}>
                                        <div className={`p-4 ${innerCardClass || 'bg-white'} rounded-lg border border-gray-100 shadow-sm h-full flex flex-col justify-between`}>
                                            {card.content}
                                        </div>
                                    </div>
                                );
                            })
                        }
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading ? <p>Loading...</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <SortableHeader column="invoice_number" sortConfig={sortConfig} onSort={handleSort}>Invoice #</SortableHeader>
                                    <SortableHeader column="physical_receipt_no" sortConfig={sortConfig} onSort={handleSort}>Physical Receipt No.</SortableHeader>
                                    <SortableHeader column="invoice_date" sortConfig={sortConfig} onSort={handleSort}>Date</SortableHeader>
                                    <SortableHeader column="customer" sortConfig={sortConfig} onSort={handleSort}>Customer</SortableHeader>
                                    <SortableHeader column="status" sortConfig={sortConfig} onSort={handleSort}>Status</SortableHeader>
                                    <SortableHeader column="total_amount" sortConfig={sortConfig} onSort={handleSort}>
                                        <div className="w-full text-right">Total</div>
                                    </SortableHeader>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedInvoices.map(invoice => (
                                    <tr 
                                        key={invoice.invoice_id} 
                                        className="border-b hover:bg-blue-50 cursor-pointer"
                                        onClick={() => handleRowClick(invoice)}
                                    >
                                        <td className="p-3 text-sm font-mono">{invoice.invoice_number}</td>
                                        <td className="p-3 text-sm font-mono text-gray-700">{invoice.physical_receipt_no || '-'}</td>
                                        <td className="p-3 text-sm">{format(toZonedTime(parseISO(invoice.invoice_date), 'Asia/Manila'), 'MM/dd/yyyy')}</td>
                                        <td className="p-3 text-sm">{invoice.customer_first_name} {invoice.customer_last_name}</td>
                                        <td className="p-3 text-sm">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(invoice.status)}`}>
                                                {invoice.status}
                                            </span>
                                        </td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(invoice.total_amount).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            
            <InvoiceDetailsModal 
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                invoice={selectedInvoice}
                onActionSuccess={fullRefresh}
            />
        </div>
    );
};

export default SalesHistoryPage;