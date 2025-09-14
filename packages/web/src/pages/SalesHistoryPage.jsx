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
                netSales: 0,
                refunds: 0,
                invoicesIssued: 0,
                netActiveInvoices: 0,
                avgNetInvoice: 0,
                amountCollected: 0,
                collectionRate: 0,
                arOutstanding: 0,
                topCustomer: '-',
                topCustomerNet: 0,
                topCustomerShare: 0,
                refundRate: 0,
                cashCollectedNet: 0,
                nonCashCollected: 0,
                cashMix: 0,
                approxNetCashAfterRefunds: 0
            };
        }

        const currencySafeNumber = (v) => {
            const n = parseFloat(v);
            return Number.isFinite(n) ? n : 0;
        };

        // Exclude Cancelled invoices from revenue metrics if such status exists
        const active = invoices.filter(inv => inv.status !== 'Cancelled');

        let grossSales = 0;
        let refunds = 0;
        let netSales = 0;
        let amountCollected = 0;
        let arOutstanding = 0;

        const customerNetMap = {};
        let netActiveInvoices = 0;

        for (const inv of active) {
            const total = currencySafeNumber(inv.total_amount);
            const refundedAmt = currencySafeNumber(inv.refunded_amount);
            // net_amount provided by backend (already clamped) fallback compute if missing
            const net = currencySafeNumber(inv.net_amount !== undefined ? inv.net_amount : Math.max(total - refundedAmt, 0));
            const collected = Math.min(currencySafeNumber(inv.amount_paid), net); // cap collection at net
            // balance_due may be negative if overpaid; always clamp to >= 0
            const balanceRaw = inv.balance_due !== undefined
                ? currencySafeNumber(inv.balance_due)
                : (net - collected);
            const balance = Math.max(balanceRaw, 0);

            grossSales += total; // Formula: Sum of total_amount for all active invoices
            refunds += refundedAmt; // Formula: Sum of refunded_amount for all active invoices
            netSales += net; // Formula: Sum of net_amount (total - refunds, clamped >=0) for all active invoices
            amountCollected += collected; // Formula: Sum of min(amount_paid, net) to cap at net value
            arOutstanding += balance; // Formula: Sum of max(balance_due, 0) to prevent negative A/R
            if (net > 0) netActiveInvoices += 1; // Count invoices with positive net for averaging

            const customerName = `${inv.customer_first_name || ''} ${inv.customer_last_name || ''}`.trim() || 'Unknown';
            customerNetMap[customerName] = (customerNetMap[customerName] || 0) + net; // Track net sales per customer
        }

        const invoicesIssued = active.length; // Formula: Total count of active invoices
        const avgNetInvoice = netActiveInvoices > 0 ? netSales / netActiveInvoices : 0; // Formula: Net Sales / Net Active Invoices (average net per invoice)
        const collectionRate = netSales > 0 ? Math.min(amountCollected / netSales, 1) : 0; // Formula: Amount Collected / Net Sales (capped at 100%)
        const refundRate = grossSales > 0 ? Math.min(refunds / grossSales, 1) : 0; // Formula: Refunds / Gross Sales (capped at 100%)

        // Determine top customer by net contribution
        let topCustomer = '-';
        let topCustomerNet = 0;
        for (const [cust, val] of Object.entries(customerNetMap)) {
            if (val > topCustomerNet) { topCustomer = cust; topCustomerNet = val; }
        }
        const topCustomerShare = netSales > 0 ? topCustomerNet / netSales : 0; // Formula: Top Customer Net / Net Sales

        // Enhanced payment method categorization using configurable payment methods
        const getCashMethodNames = () => {
            if (settings?.ENABLE_SPLIT_PAYMENTS === 'true' && paymentMethods.length > 0) {
                // Use payment method configurations to determine cash methods
                return paymentMethods
                    .filter(pm => pm.is_active && pm.config?.is_cash === true)
                    .map(pm => pm.name.toLowerCase());
            } else {
                // Fallback to legacy hardcoded cash methods
                return ['cash'];
            }
        };

        const cashMethodNames = getCashMethodNames();

        // Treat deleted invoices as non-existent: skip payments that were created by an invoice that no longer exists.
        // Heuristic:
        // - Payments created during invoice posting use reference_number = invoice_number (e.g., INV000123)
        // - If a payment's reference_number looks like an invoice number and is NOT present in current invoices,
        //   we exclude it from cash/non-cash aggregates.
        const currentInvoiceNumbers = new Set(active.map(inv => inv.invoice_number));

        let cashCollected = 0; let nonCashCollected = 0; let changeReturned = 0;
        for (const p of payments) {
            const ref = (p.reference_number || '').toString().trim();
            const looksLikeInvoiceNo = /^INV/i.test(ref);
            if (looksLikeInvoiceNo && !currentInvoiceNumbers.has(ref)) {
                // This is likely the initial payment for a deleted invoice — ignore it.
                continue;
            }
            const amt = currencySafeNumber(p.amount);
            const tendered = currencySafeNumber(p.tendered_amount);
            const change = tendered > amt ? (tendered - amt) : 0; // Formula: Change = tendered - amount if tendered > amount
            const method = (p.payment_method || '').toString().trim().toLowerCase();
            if (cashMethodNames.includes(method)) {
                cashCollected += tendered; // Sum tendered amounts for cash payments
                changeReturned += change; // Sum change returned for cash
            } else {
                nonCashCollected += amt; // Sum non-cash payments
            }
        }
        const cashCollectedNet = Math.max(cashCollected - changeReturned, 0); // Formula: Cash Tendered - Change Returned (clamped >=0)
        const totalCollectedForMix = cashCollected + nonCashCollected; // Total collected for mix calculation
        const cashMix = totalCollectedForMix > 0 ? cashCollected / totalCollectedForMix : 0; // Formula: Cash Collected / Total Collected

        const approxNetCashAfterRefunds = Math.max(cashCollectedNet - refundsApprox, 0); // Formula: Cash Net - Approximate Refunds (clamped >=0)

        // Enhanced payment method breakdown for detailed analysis
        const paymentMethodBreakdown = {};
        for (const p of payments) {
            const ref = (p.reference_number || '').toString().trim();
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
            grossSales,
            netSales,
            refunds,
            invoicesIssued,
            netActiveInvoices,
            avgNetInvoice,
            amountCollected,
            collectionRate,
            arOutstanding,
            topCustomer,
            topCustomerNet,
            topCustomerShare,
            refundRate,
            cashCollectedNet,
            nonCashCollected,
            cashMix,
            approxNetCashAfterRefunds,
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
                    <div className="h-full p-2 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col justify-between" title="Net Sales = Gross - Refunds (excludes Cancelled)">
                        <div className="text-[11px] text-gray-500">Net Sales</div>
                        <div className="text-sm font-semibold text-gray-800 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.netSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="h-full p-2 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col justify-between" title="Amount Collected (capped at Net)">
                        <div className="text-[11px] text-gray-500">Collected</div>
                        <div className="text-sm font-semibold text-green-600 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.amountCollected.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="h-full p-2 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col justify-between" title="Approx Net Cash = Cash Net - Credit Notes (assumes all refunds were cash)">
                        <div className="text-[11px] text-gray-500">Approx Net Cash (After Refunds)</div>
                        <div className="text-sm font-semibold text-gray-800 truncate">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.approxNetCashAfterRefunds.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="h-full p-2 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col justify-between" title="Collection Rate = Collected / Net Sales">
                        <div className="text-[11px] text-gray-500">Collection Rate</div>
                        <div className="text-sm font-semibold text-gray-800">{(stats.collectionRate * 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%</div>
                    </div>
                    <div className="h-full p-2 bg-white rounded-lg border border-gray-100 shadow-sm flex flex-col justify-between" title="Outstanding A/R = Sum of balances due">
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
                                    key: 'revenueGroup',
                                    className: 'bg-gradient-to-br from-white to-gray-50 md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500 flex items-center justify-between">
                                                <span>Revenue</span>
                                                <span className="text-[10px] uppercase tracking-wide text-gray-400">Gross / Refunds / Net</span>
                                            </div>
                                            <div className="mt-2 grid grid-cols-3 gap-3 text-center">
                                                <div>
                                                    <div className="text-xs text-gray-500">Gross</div>
                                                    <div className="font-semibold text-gray-800 text-sm">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.grossSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-gray-500">Refunds</div>
                                                    <div className="font-semibold text-yellow-600 text-sm">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.refunds.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                                <div>
                                                    <div className="text-xs text-gray-500">Net</div>
                                                    <div className="font-semibold text-green-600 text-sm">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.netSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                            </div>
                                            <div className="text-[11px] text-gray-500 mt-2 flex justify-between">
                                                <span>Refund Rate {(stats.refundRate * 100).toLocaleString(undefined,{maximumFractionDigits:1})}%</span>
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
                                // Composite card: Top Customer | Collections | Net Active Invoices — aligned in one row
                                {
                                    key: 'top-collection-netactive',
                                    className: 'md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500">Overview</div>
                                            <div className="mt-2 grid grid-cols-3 gap-3">
                                                <div className="text-center">
                                                    <div className="text-xs text-gray-500">Top Customer</div>
                                                    <div className="mt-1 text-lg font-semibold text-gray-800 truncate">{stats.topCustomer}</div>
                                                    <div className="text-[11px] text-gray-500 mt-1">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.topCustomerNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ({(stats.topCustomerShare*100).toLocaleString(undefined,{maximumFractionDigits:1})}%)</div>
                                                </div>

                                                <div className="text-center">
                                                    <div className="text-xs text-gray-500">Collections</div>
                                                    <div className="mt-1 text-lg font-semibold text-green-600">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.amountCollected.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
                                                    <div className="text-[11px] text-gray-500 mt-1">A/R {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.arOutstanding.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})} • {(stats.collectionRate*100).toLocaleString(undefined,{maximumFractionDigits:1})}%</div>
                                                </div>

                                                <div className="text-center">
                                                    <div className="text-xs text-gray-500">Net Active Invoices</div>
                                                    <div className="mt-1 text-lg font-semibold text-gray-800">{stats.netActiveInvoices}</div>
                                                    <div className="text-[11px] text-gray-500 mt-1">Avg {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.avgNetInvoice.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
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