import { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useSettings } from '../contexts/SettingsContext';
import DateRangeShortcuts from '../components/ui/DateRangeShortcuts';
import InvoiceDetailsModal from '../components/refunds/InvoiceDetailsModal';
import SortableHeader from '../components/ui/SortableHeader';
import InfoTip from '../components/ui/InfoTip';
import StatusMultiSelect, { ALL_STATUSES, DEFAULT_STATUSES } from '../components/ui/StatusMultiSelect';

// Some static analyzers occasionally report unused JSX imports; reference them here harmlessly
// to avoid false-positive lint errors.
void DateRangeShortcuts;
void InvoiceDetailsModal;
void SortableHeader;
void InfoTip;
void StatusMultiSelect;
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';

// Helper function to get badge styles based on status
const getStatusBadge = (status) => {
    switch (status) {
        case 'Paid':
            return 'bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-400';
        case 'Partially Refunded':
            return 'bg-warning-100 dark:bg-warning-900/30 text-warning-800 dark:text-warning-400';
        case 'Fully Refunded':
            return 'bg-danger-100 dark:bg-danger-900/30 text-danger-800 dark:text-danger-400';
        case 'Unpaid':
            return 'bg-neutral-100 dark:bg-slate-700 text-neutral-800 dark:text-slate-300';
        case 'Partially Paid':
            return 'bg-primary-100 dark:bg-primary-900/30 text-primary-800 dark:text-primary-400';
        case 'Cancelled':
            return 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-500 line-through';
        default:
            return 'bg-neutral-100 dark:bg-slate-700 text-neutral-800 dark:text-slate-300';
    }
};


const SalesHistoryPage = () => {
    const { settings } = useSettings();
    const [invoices, setInvoices] = useState([]);
    const [financialSummary, setFinancialSummary] = useState(null); // Backend-aggregated stats for the full filtered range
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
    const [statusFilter, setStatusFilter] = useState(DEFAULT_STATUSES);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const [pageSize] = useState(100);
    const [exporting, setExporting] = useState(false);

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

    // Combines the backend-aggregated financial summary (accurate over the FULL filtered date range,
    // independent of table pagination) with client-side cash/payment metrics computed from the
    // (unpaginated) payments list for the same range.
    const stats = useMemo(() => {
        const currencySafeNumber = (v) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : 0;
        };

        const grossSalesExclTax = currencySafeNumber(financialSummary?.gross_sales);
        const taxTotal = currencySafeNumber(financialSummary?.vat_total);
        const refundsExclTax = currencySafeNumber(financialSummary?.refunds);
        const refundTaxTotal = currencySafeNumber(financialSummary?.refund_vat_total);
        const arOutstanding = currencySafeNumber(financialSummary?.ar_outstanding);
        const amountCollected = currencySafeNumber(financialSummary?.amount_collected);
        const invoicesIssued = parseInt(financialSummary?.invoices_issued, 10) || 0;
        const netActiveInvoices = parseInt(financialSummary?.net_active_invoices, 10) || 0;
        const topCustomer = financialSummary?.top_customer || '-';
        const topCustomerNet = currencySafeNumber(financialSummary?.top_customer_net);

        const avgNetInvoice = netActiveInvoices > 0 ? (grossSalesExclTax - refundsExclTax) / netActiveInvoices : 0;
        const refundRate = grossSalesExclTax > 0 ? Math.min(refundsExclTax / grossSalesExclTax, 1) : 0;
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
        const currentInvoiceNumbers = new Set(financialSummary?.active_invoice_numbers || []);

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
    }, [financialSummary, payments, refundsApprox, paymentMethods, settings?.ENABLE_SPLIT_PAYMENTS]);

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


    // undefined = no status filter (all); a comma-joined list = filter to that IN-set.
    // An empty selection is handled separately (short-circuited before hitting the network).
    const statusParam = statusFilter.length > 0 && statusFilter.length < ALL_STATUSES.length
        ? statusFilter.join(',')
        : undefined;

    const fetchInvoices = useMemo(() => {
        return async () => {
            if (statusFilter.length === 0) {
                setInvoices([]);
                setTotal(0);
                return;
            }
            setLoading(true);
            try {
                const response = await api.get('/invoices', {
                    params: { ...dates, q: debouncedQuery || undefined, status: statusParam, page, pageSize }
                });
                setInvoices(response.data.rows || []);
                setTotal(response.data.total || 0);
            } catch {
                toast.error('Failed to fetch sales history.');
            } finally {
                setLoading(false);
            }
        };
    }, [dates, debouncedQuery, statusFilter, statusParam, page, pageSize]);

    const fetchSummary = useMemo(() => {
        return async () => {
            try {
                const response = await api.get('/invoices/summary', {
                    params: { ...dates, q: debouncedQuery || undefined }
                });
                setFinancialSummary(response.data);
            } catch {
                setFinancialSummary(null);
            }
        };
    }, [dates, debouncedQuery]);

    const handleExport = async () => {
        if (statusFilter.length === 0) {
            toast.error('Select at least one status to export.');
            return;
        }
        setExporting(true);
        try {
            const response = await api.get('/invoices/export', {
                params: { ...dates, q: debouncedQuery || undefined, status: statusParam },
                responseType: 'blob'
            });
            const blob = new Blob([response.data], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', `sales-history-${dates.startDate}-to-${dates.endDate}.csv`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
        } catch {
            toast.error('Failed to export sales history.');
        } finally {
            setExporting(false);
        }
    };

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
            await Promise.allSettled([fetchInvoices(), fetchSummary(), fetchPayments(), fetchRefundsApprox(), fetchPaymentMethods()]);
        };
    }, [fetchInvoices, fetchSummary, fetchPayments, fetchRefundsApprox, fetchPaymentMethods]);

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

    // Reset to page 1 whenever the filters (other than page itself) change
    useEffect(() => {
        setPage(1);
    }, [dates, debouncedQuery, statusFilter]);

    useEffect(() => {
        fetchInvoices();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dates, debouncedQuery, statusFilter, page, pageSize]);

    useEffect(() => {
        fetchSummary();
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
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100 mb-6">Sales History</h1>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card mb-6">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Start Date</label>
                        <input type="date" name="startDate" value={dates.startDate} onChange={handleDateChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">End Date</label>
                        <input type="date" name="endDate" value={dates.endDate} onChange={handleDateChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Status</label>
                        <StatusMultiSelect selected={statusFilter} onChange={setStatusFilter} />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Search</label>
                        <input
                            type="text"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Invoice #, receipt #, customer, or item..."
                            className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                    </div>
                    <div className="md:col-span-3">
                       <DateRangeShortcuts onSelect={setDates} />
                    </div>
                    <div className="flex justify-end">
                        <button
                            type="button"
                            onClick={handleExport}
                            disabled={exporting}
                            className="w-full md:w-auto px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            {exporting ? 'Exporting…' : 'Export CSV'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Sales statistics for selected date range */}
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card mb-6">
                <div className="flex items-center justify-between">
                    <h2 className="text-lg font-medium text-gray-700 dark:text-slate-200">Summary</h2>
                    <button
                        type="button"
                        onClick={() => {
                            setSummaryCollapsed(s => {
                                const next = !s;
                                try { localStorage.setItem('salesSummaryCollapsed', String(next)); } catch { /* ignore localStorage errors */ }
                                return next;
                            });
                        }}
                        className="flex items-center space-x-2 text-sm text-gray-600 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200 transition-colors"
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
                    <div className="h-full p-2 bg-white dark:bg-slate-900/50 rounded-lg border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between" title="Net Sales = Gross - Refunds (excluding VAT, excludes Cancelled)">
                        <div className="text-[11px] text-gray-500 dark:text-slate-400">Net Sales (Excl. VAT)</div>
                        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.netSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="h-full p-2 bg-white dark:bg-slate-900/50 rounded-lg border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between" title="Amount Collected (including VAT, capped at net invoice amount)">
                        <div className="text-[11px] text-gray-500 dark:text-slate-400">Collected (Incl. VAT)</div>
                        <div className="text-sm font-semibold text-success-600 dark:text-success-400 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.amountCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="h-full p-2 bg-white dark:bg-slate-900/50 rounded-lg border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between" title="Expected Register Cash = Cash Net (Tendered - Change) - Cash Refunds (Approx.)">
                        <div className="text-[11px] text-gray-500 dark:text-slate-400">Expected Net Cash (Drawer)</div>
                        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.expectedNetCashDrawer.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="h-full p-2 bg-white dark:bg-slate-900/50 rounded-lg border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between" title="Collection Rate = Collected / Total Net Invoiced (including VAT)">
                        <div className="text-[11px] text-gray-500 dark:text-slate-400">Collection Rate</div>
                        <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">{(stats.collectionRate * 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%</div>
                    </div>
                    <div className="h-full p-2 bg-white dark:bg-slate-900/50 rounded-lg border border-gray-100 dark:border-slate-700 shadow-sm flex flex-col justify-between" title="Outstanding A/R = Sum of unpaid balances due (including VAT)">
                        <div className="text-[11px] text-gray-500 dark:text-slate-400">A/R Outstanding</div>
                        <div className="text-sm font-semibold text-danger-600 dark:text-danger-400 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.arOutstanding.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
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
                            [
                                {
                                    key: 'operationalReconciliation',
                                    className: 'bg-gradient-to-br from-white to-blue-50/30 dark:from-slate-800 dark:to-slate-900/60 md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500 dark:text-slate-400 flex items-center justify-between">
                                                <span className="font-medium text-primary-700 dark:text-primary-300 text-xs uppercase tracking-wider">Operational Cash Flow (Tax-Inclusive)</span>
                                                <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">Drawer Count</span>
                                            </div>
                                            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-3">
                                                <div>
                                                    <div className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1">
                                                        Expected Net Cash (Drawer)
                                                        <InfoTip label="Expected Net Cash (Drawer)">
                                                            (Cash Tendered − Change Returned) − Cash Refunds Paid. The amount of
                                                            physical cash that should be in the register after subtracting change
                                                            and any cash refunds paid out.
                                                        </InfoTip>
                                                    </div>
                                                    <div className="font-semibold text-gray-800 dark:text-slate-100 text-base">
                                                        {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.expectedNetCashDrawer.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-gray-500 dark:text-slate-400">Non-Cash Collections</div>
                                                    <div className="font-semibold text-gray-800 dark:text-slate-100 text-base">
                                                        {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.nonCashCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    </div>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] text-gray-400 dark:text-slate-500">Tendered: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.cashInflow.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                                    <div className="text-[11px] text-gray-400 dark:text-slate-500">Change: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.changeReturned.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                                </div>
                                                <div>
                                                    <div className="text-[11px] text-gray-400 dark:text-slate-500">Refunds Out: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.refundsApprox.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                                                    <div className="text-[11px] text-gray-400 dark:text-slate-500 flex items-center gap-1">
                                                        <span>Cash Mix: {(stats.cashMix * 100).toFixed(1)}%</span>
                                                        <InfoTip label="Cash Mix">
                                                            Cash Collected (Net of Change) ÷ (Cash Collected (Net of Change) +
                                                            Non-Cash Collections) — the share of collections that came in as cash,
                                                            calculated before refunds are subtracted.
                                                        </InfoTip>
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="text-[10px] text-gray-400 dark:text-slate-500 mt-2">
                                                Reconcile Expected Net Cash (Drawer) with physical till count.
                                            </div>
                                        </>
                                    )
                                },
                                {
                                    key: 'financialRevenue',
                                    className: 'bg-gradient-to-br from-white to-green-50/20 dark:from-slate-800 dark:to-slate-900/60 md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500 dark:text-slate-400 flex items-center justify-between">
                                                <span className="font-medium text-success-700 dark:text-success-400 text-xs uppercase tracking-wider">Accrual & Revenue Statistics (Excl. VAT)</span>
                                                <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">Financial Reporting</span>
                                            </div>
                                            <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                                                <div>
                                                    <div className="text-xs text-gray-500 dark:text-slate-400">Gross Sales</div>
                                                    <div className="font-semibold text-gray-800 dark:text-slate-100 text-sm">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.grossSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-gray-500 dark:text-slate-400">Refunds</div>
                                                    <div className="font-semibold text-warning-600 dark:text-warning-400 text-sm">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.refunds.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-gray-500 dark:text-slate-400 flex items-center justify-center gap-1">
                                                        Net Sales
                                                        <InfoTip label="Net Sales (Excl. VAT)">
                                                            Gross Sales minus Refunds (excluding VAT) — the number accounting
                                                            reports as actual revenue for the period.
                                                        </InfoTip>
                                                    </div>
                                                    <div className="font-semibold text-success-600 dark:text-success-400 text-sm">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.netSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                            </div>
                                            <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-2 flex justify-between">
                                                <span className="flex items-center gap-1">
                                                    Net VAT Collected: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.vatCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                    <InfoTip label="Net VAT Collected">
                                                        VAT charged on sales minus VAT given back on refunds — the tax liability
                                                        owed to the tax authority for the period.
                                                    </InfoTip>
                                                </span>
                                                <span>Range {dates.startDate} → {dates.endDate}</span>
                                            </div>
                                        </>
                                    )
                                },
                                {
                                    key: 'invoices',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500 dark:text-slate-400">Invoices Issued</div>
                                            <div className="mt-2 text-2xl font-semibold text-gray-800 dark:text-slate-100">{stats.invoicesIssued}</div>
                                            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">Excludes Cancelled</div>
                                        </>
                                    )
                                },
                                {
                                    key: 'avg',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500 dark:text-slate-400">Avg Net Invoice</div>
                                            <div className="mt-2 text-2xl font-semibold text-gray-800 dark:text-slate-100">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.avgNetInvoice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                            <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">Net Sales / Net Active</div>
                                        </>
                                    )
                                },
                                {
                                    key: 'top-customer-outstanding',
                                    className: 'md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500 dark:text-slate-400">Overview</div>
                                            <div className="mt-2 grid grid-cols-3 gap-3">
                                                <div className="text-center">
                                                    <div className="text-xs text-gray-500 dark:text-slate-400">Top Customer</div>
                                                    <div className="mt-1 text-sm font-semibold text-gray-800 dark:text-slate-100 truncate" title={stats.topCustomer}>{stats.topCustomer}</div>
                                                    <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.topCustomerNet.toLocaleString(undefined, { maximumFractionDigits: 2 })} ({(stats.topCustomerShare*100).toLocaleString(undefined,{maximumFractionDigits:1})}%)</div>
                                                </div>

                                                <div className="text-center">
                                                    <div className="text-xs text-gray-500 dark:text-slate-400">Total Collections</div>
                                                    <div className="mt-1 text-sm font-semibold text-success-600 dark:text-success-400">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.totalCollections.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                                                    <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5 flex items-center justify-center gap-1">
                                                        <span>Rate: {(stats.collectionRate*100).toLocaleString(undefined,{maximumFractionDigits:1})}%</span>
                                                        <InfoTip label="Collection Rate">
                                                            Amount Collected (incl. VAT) ÷ Net Sales (incl. VAT) — how much of
                                                             what was billed has actually been collected.
                                                        </InfoTip>
                                                    </div>
                                                </div>

                                                <div className="text-center">
                                                    <div className="text-xs text-gray-500 dark:text-slate-400 flex items-center justify-center gap-1">
                                                        Outstanding A/R
                                                        <InfoTip label="Outstanding A/R" align="right">
                                                            Sum of each invoice's (Total − Refunded) minus Amount Paid, floored at
                                                            ₱0.00 — the total unpaid balance still owed by customers, VAT included.
                                                        </InfoTip>
                                                    </div>
                                                    <div className="mt-1 text-sm font-semibold text-danger-600 dark:text-danger-400">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.arOutstanding.toLocaleString(undefined,{maximumFractionDigits:2})}</div>
                                                    <div className="text-[10px] text-gray-500 dark:text-slate-400 mt-0.5">Active Invoices: {stats.netActiveInvoices}</div>
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
                                            <div className="text-sm text-gray-500 dark:text-slate-400 flex items-center justify-between">
                                                <span>Payment Methods</span>
                                                <span className="text-[10px] uppercase tracking-wide text-gray-400 dark:text-slate-500">Breakdown</span>
                                            </div>
                                            <div className="mt-2">
                                                {Object.keys(stats.paymentMethodBreakdown || {}).length === 0 ? (
                                                    <div className="text-center text-gray-500 dark:text-slate-400 text-sm py-4">No payment data for this period</div>
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
                                                                            <span className="text-sm font-medium text-gray-700 dark:text-slate-200">{method.methodName}</span>
                                                                            <span className="text-xs text-gray-500 dark:text-slate-400">({method.count} txns)</span>
                                                                        </div>
                                                                        <div className="text-right">
                                                                            <div className="text-sm font-semibold text-gray-800 dark:text-slate-100">
                                                                                {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{method.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                                            </div>
                                                                            <div className="text-xs text-gray-500 dark:text-slate-400">{percentage.toFixed(1)}%</div>
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="text-[11px] text-gray-500 dark:text-slate-400 mt-2 flex justify-between">
                                                <span>Cash Mix: {(stats.cashMix * 100).toFixed(1)}%</span>
                                                <span>Non-Cash: {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.nonCashCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                            </div>
                                        </>
                                    )
                                }] : [])
                            ].map((card, idx) => {
                                const delayMs = summaryCollapsed ? 0 : idx * 60;
                                const transformCollapsed = 'translateY(6px) scale(0.995)';
                                const transformExpanded = 'translateY(0) scale(1)';
                                const style = {
                                    transform: summaryCollapsed ? transformCollapsed : transformExpanded,
                                    opacity: summaryCollapsed ? 0 : 1,
                                    transition: 'transform 320ms cubic-bezier(.2,.9,.2,1), opacity 240ms ease',
                                    transitionDelay: `${delayMs}ms`
                                };

                                const wrapperColSpan = card.className && card.className.includes('md:col-span-2') ? 'md:col-span-2' : '';
                                const innerCardClass = (card.className || 'bg-white').replace('md:col-span-2', '').trim();

                                return (
                                    <div key={card.key} className={`${wrapperColSpan} h-full`} style={style}>
                                        <div className={`p-4 ${innerCardClass || 'bg-white dark:bg-slate-900/50'} rounded-lg border border-gray-100 dark:border-slate-700 shadow-sm h-full flex flex-col justify-between`}>
                                            {card.content}
                                        </div>
                                    </div>
                                );
                            })
                        }
                    </div>
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card">
                {loading ? <p className="text-gray-500 dark:text-slate-400 py-6 text-center">Loading...</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300">
                                <tr>
                                    <SortableHeader column="invoice_number" sortConfig={sortConfig} onSort={handleSort}>Invoice #</SortableHeader>
                                    <SortableHeader column="physical_receipt_no" sortConfig={sortConfig} onSort={handleSort}>Physical Receipt No.</SortableHeader>
                                    <SortableHeader column="invoice_date" sortConfig={sortConfig} onSort={handleSort}>Date</SortableHeader>
                                    <th className="p-3 text-sm font-semibold text-gray-700 dark:text-slate-300">Issuer</th>
                                    <th className="p-3 text-sm font-semibold text-gray-700 dark:text-slate-300">Approved By</th>
                                    <SortableHeader column="customer" sortConfig={sortConfig} onSort={handleSort}>Customer</SortableHeader>
                                    <SortableHeader column="status" sortConfig={sortConfig} onSort={handleSort}>Status</SortableHeader>
                                    <SortableHeader column="total_amount" sortConfig={sortConfig} onSort={handleSort}>
                                        <div className="w-full text-right">Total</div>
                                    </SortableHeader>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                                {sortedInvoices.map(invoice => (
                                    <tr 
                                        key={invoice.invoice_id} 
                                        className="hover:bg-gray-50 dark:hover:bg-slate-700/40 cursor-pointer text-gray-800 dark:text-slate-200 transition-colors"
                                        onClick={() => handleRowClick(invoice)}
                                    >
                                        <td className="p-3 text-sm font-mono text-gray-900 dark:text-slate-100">{invoice.invoice_number}</td>
                                        <td className="p-3 text-sm font-mono text-gray-700 dark:text-slate-300">{invoice.physical_receipt_no || '-'}</td>
                                        <td className="p-3 text-sm text-gray-600 dark:text-slate-400">{format(toZonedTime(parseISO(invoice.invoice_date), 'Asia/Manila'), 'MM/dd/yyyy')}</td>
                                        <td className="p-3 text-sm text-gray-700 dark:text-slate-300">{invoice.employee_first_name} {invoice.employee_last_name}</td>
                                        <td className="p-3 text-sm text-gray-600 dark:text-slate-400">{invoice.approved_by_name || 'System Auto-Approved'}</td>
                                        <td className="p-3 text-sm text-gray-800 dark:text-slate-100 font-medium">{invoice.customer_first_name} {invoice.customer_last_name}</td>
                                        <td className="p-3 text-sm">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(invoice.status)}`}>
                                                {invoice.status}
                                            </span>
                                        </td>
                                        <td className="p-3 text-sm text-right font-mono font-semibold text-gray-900 dark:text-slate-100">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{parseFloat(invoice.total_amount).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
                {!loading && total > 0 && (
                    <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-100 dark:border-slate-700">
                        <div className="text-sm text-gray-500 dark:text-slate-400">
                            Showing {(page - 1) * pageSize + 1}-{Math.min(page * pageSize, total)} of {total}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setPage(p => Math.max(p - 1, 1))}
                                disabled={page <= 1}
                                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Previous
                            </button>
                            <span className="text-sm text-gray-500 dark:text-slate-400">Page {page} of {Math.max(Math.ceil(total / pageSize), 1)}</span>
                            <button
                                type="button"
                                onClick={() => setPage(p => (p * pageSize < total ? p + 1 : p))}
                                disabled={page * pageSize >= total}
                                className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 bg-white dark:bg-slate-900 hover:bg-gray-50 dark:hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            >
                                Next
                            </button>
                        </div>
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