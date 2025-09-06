import { useState, useEffect, useMemo, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useSettings } from '../contexts/SettingsContext';
import DateRangeShortcuts from '../components/ui/DateRangeShortcuts';
import InvoiceDetailsModal from '../components/refunds/InvoiceDetailsModal';
import SortableHeader from '../components/ui/SortableHeader';

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
    const [loading, setLoading] = useState(false);
    const [sortConfig, setSortConfig] = useState({ key: 'invoice_date', direction: 'DESC' });
    const [dates, setDates] = useState({
        startDate: new Date().toISOString().split('T')[0],
        endDate: new Date().toISOString().split('T')[0],
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

    // Derived sales statistics for the selected date range
    const stats = useMemo(() => {
        const totalSales = invoices.reduce((s, inv) => s + (parseFloat(inv.total_amount) || 0), 0);
        const count = invoices.length;
        const avg = count ? totalSales / count : 0;

        const totalsByStatus = invoices.reduce((acc, inv) => {
            const amt = parseFloat(inv.total_amount) || 0;
            const st = inv.status || 'Unknown';
            acc[st] = (acc[st] || 0) + amt;
            return acc;
        }, {});

        // Best customer by total
        const byCustomer = invoices.reduce((acc, inv) => {
            const name = `${inv.customer_first_name || ''} ${inv.customer_last_name || ''}`.trim() || 'Unknown';
            acc[name] = (acc[name] || 0) + (parseFloat(inv.total_amount) || 0);
            return acc;
        }, {});
        let topCustomer = null;
        let topCustomerTotal = 0;
        Object.entries(byCustomer).forEach(([name, tot]) => {
            if (tot > topCustomerTotal) {
                topCustomer = name; topCustomerTotal = tot;
            }
        });

        const paid = (totalsByStatus['Paid'] || 0) + (totalsByStatus['Partially Paid'] || 0);
        const unpaid = totalsByStatus['Unpaid'] || 0;
        const refunded = (totalsByStatus['Partially Refunded'] || 0) + (totalsByStatus['Fully Refunded'] || 0) || 0;

        return {
            totalSales,
            count,
            avg,
            paid,
            unpaid,
            refunded,
            topCustomer: topCustomer || '-',
            topCustomerTotal
        };
    }, [invoices]);

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


    const fetchInvoices = async () => {
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

    useEffect(() => {
        fetchInvoices();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dates, debouncedQuery]);

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
                    av = new Date(a.invoice_date).getTime();
                    bv = new Date(b.invoice_date).getTime();
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
                <div className={`mt-3 flex items-center space-x-4 ${summaryCollapsed ? '' : 'hidden'}`}>
                    <div className="flex-1 p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                        <div className="text-xs text-gray-500">Total Sales</div>
                        <div className="text-sm font-semibold text-gray-800">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div className="flex-1 p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                        <div className="text-xs text-gray-500">Invoices</div>
                        <div className="text-sm font-semibold text-gray-800">{stats.count}</div>
                    </div>
                    <div className="flex-1 p-2 bg-white rounded-lg border border-gray-100 shadow-sm">
                        <div className="text-xs text-gray-500">Avg</div>
                        <div className="text-sm font-semibold text-gray-800">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.avg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                </div>

                {/* Expanded view (animated) */}
                <div
                    ref={summaryRef}
                    className="mt-4 overflow-hidden"
                    style={{ maxHeight, transition: 'max-height 300ms ease' }}
                    aria-hidden={summaryCollapsed}
                >
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
                        {
                            // Build an array of card descriptors so we can stagger animations
                            [
                                {
                                    key: 'totalSales',
                                    className: 'bg-gradient-to-br from-white to-gray-50',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500">Total Sales</div>
                                            <div className="mt-2 flex items-baseline justify-between">
                                                <div className="text-2xl font-semibold text-gray-800">
                                                    {settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.totalSales.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                                </div>
                                                <svg className="w-6 h-6 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 17l6-6 4 4 8-8"></path></svg>
                                            </div>
                                            <div className="text-xs text-gray-500 mt-1">From {dates.startDate} to {dates.endDate}</div>
                                        </>
                                    )
                                },
                                {
                                    key: 'invoices',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500">Invoices</div>
                                            <div className="mt-2 text-2xl font-semibold text-gray-800">{stats.count}</div>
                                            <div className="text-xs text-gray-500 mt-1">Total number of invoices in range</div>
                                        </>
                                    )
                                },
                                {
                                    key: 'avg',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500">Average Sale</div>
                                            <div className="mt-2 text-2xl font-semibold text-gray-800">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.avg.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                            <div className="text-xs text-gray-500 mt-1">Average invoice value</div>
                                        </>
                                    )
                                },
                                {
                                    key: 'topCustomer',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500">Top Customer</div>
                                            <div className="mt-2 text-lg font-semibold text-gray-800">{stats.topCustomer}</div>
                                            <div className="text-xs text-gray-500 mt-1">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.topCustomerTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                        </>
                                    )
                                },
                                {
                                    key: 'paidUnpaid',
                                    className: 'md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500">Paid / Unpaid</div>
                                            <div className="mt-2 flex items-center space-x-4">
                                                <div className="flex-1">
                                                    <div className="text-xs text-gray-500">Paid</div>
                                                    <div className="text-lg font-semibold text-green-600">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.paid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                                <div className="flex-1">
                                                    <div className="text-xs text-gray-500">Unpaid</div>
                                                    <div className="text-lg font-semibold text-red-600">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.unpaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                                </div>
                                            </div>
                                        </>
                                    )
                                },
                                {
                                    key: 'refunds',
                                    className: 'md:col-span-2',
                                    content: (
                                        <>
                                            <div className="text-sm text-gray-500">Refunds</div>
                                            <div className="mt-2 text-lg font-semibold text-yellow-600">{settings?.DEFAULT_CURRENCY_SYMBOL || '₱'}{stats.refunded.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                                            <div className="text-xs text-gray-500 mt-1">Estimated refunded amount (based on statuses)</div>
                                        </>
                                    )
                                }
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

                                return (
                                    <div key={card.key} className={wrapperColSpan} style={style}>
                                        <div className={`p-4 ${card.className || 'bg-white'} rounded-lg border border-gray-100 shadow-sm`}>
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
                                        <td className="p-3 text-sm">{new Date(invoice.invoice_date).toLocaleDateString()}</td>
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
                onActionSuccess={fetchInvoices}
            />
        </div>
    );
};

export default SalesHistoryPage;