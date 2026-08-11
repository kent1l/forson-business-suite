import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

// Import extracted utilities and components
import { formatCurrency } from '../utils/currency';
import { exportToCSV } from '../utils/csv';
import AROverviewTab from '../components/accounts-receivable/tabs/AROverviewTab';
import ARLedgerSoaTab from '../components/accounts-receivable/tabs/ARLedgerSoaTab';
import ARWalletTab from '../components/accounts-receivable/tabs/ARWalletTab';

const AccountsReceivablePage = () => {
    const { hasPermission } = useAuth();

    // Active Navigation Tab
    const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'ledger_soa' | 'wallet'

    // State management for Overview & Aging Tab
    const [customers, setCustomers] = useState([]);
    const [customerSummary, setCustomerSummary] = useState([]);
    const [dashboardStats, setDashboardStats] = useState({
        totalReceivables: 0,
        invoicesSent: 0,
        overdueInvoices: 0,
        avgCollectionPeriod: 0
    });
    const [agingData, setAgingData] = useState([
        { name: 'Current', value: 0 },
        { name: '1-30 Days', value: 0 },
        { name: '31-60 Days', value: 0 },
        { name: '61-90 Days', value: 0 },
        { name: '90+ Days', value: 0 },
    ]);
    const [loading, setLoading] = useState(true);
    const [overviewError, setOverviewError] = useState(null);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [dateRange, setDateRange] = useState({
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        endDate: new Date()
    });
    const [selectedAgingBucket, setSelectedAgingBucket] = useState(null);
    const [drillDownInvoices, setDrillDownInvoices] = useState([]);
    const [drillDownLoading, setDrillDownLoading] = useState(false);
    const [customerInvoices, setCustomerInvoices] = useState([]);
    const [customerInvoicesLoading, setCustomerInvoicesLoading] = useState(false);
    const [selectedCustomerForInvoices, setSelectedCustomerForInvoices] = useState(null);
    const [customerInvoicesPage, setCustomerInvoicesPage] = useState(1);
    const [customerInvoicesPageSize, setCustomerInvoicesPageSize] = useState(25);
    const [customerInvoicesTotal, setCustomerInvoicesTotal] = useState(0);
    const [customerSummaryPage, setCustomerSummaryPage] = useState(1);
    const [customerSummaryPageSize, setCustomerSummaryPageSize] = useState(25);
    const [customerSummaryTotal, setCustomerSummaryTotal] = useState(0);
    const [customerSummarySearchTerm, setCustomerSummarySearchTerm] = useState('');
    const [customerSummaryStatusFilter, setCustomerSummaryStatusFilter] = useState('ALL');
    const [customerSummarySortConfig, setCustomerSummarySortConfig] = useState({ key: 'invoice_count', direction: 'DESC' });
    const [drillDownPage, setDrillDownPage] = useState(1);
    const [drillDownPageSize, setDrillDownPageSize] = useState(25);
    const [drillDownTotal, setDrillDownTotal] = useState(0);

    // State for Tab 2: Customer Ledger & SOA
    const [soaCustomerId, setSoaCustomerId] = useState('');
    const [soaLedger, setSoaLedger] = useState(null);
    const [soaLoading, setSoaLoading] = useState(false);
    const [soaDownloading, setSoaDownloading] = useState(false);
    const [attachReceiptImages, setAttachReceiptImages] = useState(true);
    const [soaSearchQuery, setSoaSearchQuery] = useState('');
    const [soaDropdownOpen, setSoaDropdownOpen] = useState(false);
    const [soaHighlightedIndex, setSoaHighlightedIndex] = useState(-1);
    const soaComboboxRef = useRef(null);

    // Close SOA customer dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (soaComboboxRef.current && !soaComboboxRef.current.contains(event.target)) {
                setSoaDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Filter customers for SOA search box
    const filteredSoaCustomers = useMemo(() => {
        if (!soaSearchQuery.trim()) return customers;
        const q = soaSearchQuery.toLowerCase();
        return customers.filter(c => {
            const name = (c.company_name || `${c.first_name || ''} ${c.last_name || ''}`).toLowerCase();
            const phone = (c.phone || '').toLowerCase();
            return name.includes(q) || phone.includes(q);
        });
    }, [customers, soaSearchQuery]);

    // Reset highlighted index when search query or filtered list changes
    useEffect(() => {
        setSoaHighlightedIndex(filteredSoaCustomers.length > 0 ? 0 : -1);
    }, [soaSearchQuery, filteredSoaCustomers]);

    // Select customer helper for click / key press
    const selectSoaCustomer = useCallback((customer) => {
        if (!customer) return;
        const displayName = customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim();
        setSoaCustomerId(customer.customer_id);
        setSoaSearchQuery(displayName);
        setSoaDropdownOpen(false);
        setSoaHighlightedIndex(-1);
    }, []);

    const handleClearSoaCustomer = useCallback(() => {
        setSoaCustomerId('');
        setSoaLedger(null);
    }, []);

    // Keyboard navigation handler for search box (Arrows, Tab, Enter, Escape)
    const handleSoaKeyDown = (e) => {
        if (!soaDropdownOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
            setSoaDropdownOpen(true);
            return;
        }

        if (!soaDropdownOpen || filteredSoaCustomers.length === 0) {
            if (e.key === 'Escape') setSoaDropdownOpen(false);
            return;
        }

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSoaHighlightedIndex(prev => (prev < filteredSoaCustomers.length - 1 ? prev + 1 : 0));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSoaHighlightedIndex(prev => (prev > 0 ? prev - 1 : filteredSoaCustomers.length - 1));
        } else if (e.key === 'Enter') {
            if (soaHighlightedIndex >= 0 && soaHighlightedIndex < filteredSoaCustomers.length) {
                e.preventDefault();
                selectSoaCustomer(filteredSoaCustomers[soaHighlightedIndex]);
            }
        } else if (e.key === 'Tab') {
            if (soaHighlightedIndex >= 0 && soaHighlightedIndex < filteredSoaCustomers.length) {
                selectSoaCustomer(filteredSoaCustomers[soaHighlightedIndex]);
            }
        } else if (e.key === 'Escape') {
            setSoaDropdownOpen(false);
        }
    };

    // State for Tab 3: Wallet Management
    const [walletCustomers, setWalletCustomers] = useState([]);
    const [walletLoading, setWalletLoading] = useState(false);
    const [selectedWalletCustomer, setSelectedWalletCustomer] = useState(null);
    const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
    const [walletSearch, setWalletSearch] = useState('');
    const [walletPage, setWalletPage] = useState(1);
    const [walletPageSize, setWalletPageSize] = useState(25);

    // Handle date range changes
    const handleDateRangeChange = useCallback((newDateRange) => {
        setDateRange(newDateRange);
    }, []);

    // Fetch drill-down invoices for an aging bucket
    const fetchDrillDownInvoices = useCallback(async (bucketName, page = drillDownPage, pageSize = drillDownPageSize) => {
        if (!bucketName) return;
        try {
            setDrillDownLoading(true);

            const bucketMap = {
                'Current': 'current',
                '1-30 Days': '1-30',
                '31-60 Days': '31-60',
                '61-90 Days': '61-90',
                '90+ Days': '90-plus'
            };

            const bucketParam = bucketMap[bucketName];
            if (!bucketParam) return;

            const params = {
                bucket: bucketParam,
                page,
                pageSize,
                paginated: 1
            };

            const response = await api.get('/ar/drill-down-invoices', { params });
            setDrillDownInvoices(response.data?.data || response.data || []);
            setDrillDownTotal(response.data?.total || 0);

        } catch (error) {
            console.error('Failed to fetch drill-down invoices:', error);
            toast.error('Failed to load invoice details');
            setDrillDownInvoices([]);
            setDrillDownTotal(0);
        } finally {
            setDrillDownLoading(false);
        }
    }, [drillDownPage, drillDownPageSize]);

    useEffect(() => {
        if (selectedAgingBucket) {
            fetchDrillDownInvoices(selectedAgingBucket, drillDownPage, drillDownPageSize);
        }
    }, [selectedAgingBucket, drillDownPage, drillDownPageSize, fetchDrillDownInvoices]);

    // Handle drill-down into aging buckets
    const handleAgingBucketClick = useCallback((bucketName) => {
        setSelectedAgingBucket(bucketName);
        setDrillDownPage(1);
    }, []);

    const handleCloseDrillDown = useCallback(() => {
        setSelectedAgingBucket(null);
        setDrillDownInvoices([]);
        setDrillDownTotal(0);
        setDrillDownPage(1);
    }, []);

    // Fetch Customer Summary Table (isolated from full dashboard page loading)
    const fetchCustomerSummary = useCallback(async () => {
        try {
            const res = await api.get('/ar/customer-summary', {
                params: {
                    page: customerSummaryPage,
                    pageSize: customerSummaryPageSize,
                    paginated: 1,
                    search: customerSummarySearchTerm,
                    status: customerSummaryStatusFilter,
                    sortBy: customerSummarySortConfig.key,
                    sortDir: customerSummarySortConfig.direction
                }
            });
            setCustomerSummary(res.data?.data || []);
            setCustomerSummaryTotal(res.data?.total || 0);
        } catch (err) {
            console.error('Failed to fetch customer summary:', err);
        }
    }, [customerSummaryPage, customerSummaryPageSize, customerSummarySearchTerm, customerSummaryStatusFilter, customerSummarySortConfig]);

    // Fetch Overview Dashboard Data (KPIs, Aging)
    const fetchDashboardData = useCallback(async () => {
        try {
            setLoading(true);
            setOverviewError(null);

            const dateParams = {
                startDate: dateRange.startDate.toISOString(),
                endDate: dateRange.endDate.toISOString()
            };

            const [customersRes, dashboardRes, agingRes] = await Promise.all([
                api.get('/customers/with-balances', { params: { paginated: 1, page: 1, pageSize: 100 } }),
                api.get('/ar/dashboard-stats', { params: dateParams }).catch(() => ({ data: {} })),
                api.get('/ar/aging-summary').catch(() => ({ data: [] })),
            ]);

            const customersWithBalances = customersRes.data?.data || customersRes.data || [];
            setCustomers(customersWithBalances);

            if (dashboardRes.data && Object.keys(dashboardRes.data).length > 0) {
                setDashboardStats(dashboardRes.data);
            }

            if (agingRes.data && agingRes.data.length > 0) {
                setAgingData(agingRes.data);
            }

            await fetchCustomerSummary();

        } catch (err) {
            console.error('Failed to fetch dashboard data:', err);
            toast.error('Failed to fetch accounts receivable data.');
            setOverviewError(err);
        } finally {
            setLoading(false);
        }
    }, [dateRange, fetchCustomerSummary]);

    // Fetch Customer Ledger for Tab 2
    const fetchCustomerLedger = useCallback(async (customerId) => {
        if (!customerId) return;
        try {
            setSoaLoading(true);
            const res = await api.get(`/ar/customers/${customerId}/ledger`, {
                params: {
                    startDate: dateRange.startDate.toISOString(),
                    endDate: dateRange.endDate.toISOString()
                }
            });
            setSoaLedger(res.data);
        } catch (err) {
            console.error('Failed to load customer ledger:', err);
            toast.error('Failed to load customer ledger history.');
        } finally {
            setSoaLoading(false);
        }
    }, [dateRange]);

    // Handle Export SOA PDF
    const handleExportSoaPdf = useCallback(async () => {
        if (!soaCustomerId) {
            toast.error('Please select a customer first');
            return;
        }
        try {
            setSoaDownloading(true);
            const response = await api.get(`/ar/customers/${soaCustomerId}/soa/pdf`, {
                params: {
                    startDate: dateRange.startDate.toISOString(),
                    endDate: dateRange.endDate.toISOString(),
                    include_receipts: attachReceiptImages ? 'true' : 'false',
                },
                responseType: 'blob'
            });

            const blob = new Blob([response.data], { type: 'application/pdf' });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            const safeName = (soaLedger?.customer?.name || 'Customer').replace(/[^A-Za-z0-9_-]/g, '_');
            link.setAttribute('download', `Statement_of_Account_${safeName}.pdf`);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            toast.success('SOA PDF generated successfully!');
        } catch (err) {
            console.error('Failed to export SOA PDF:', err);
            toast.error('Failed to generate SOA PDF.');
        } finally {
            setSoaDownloading(false);
        }
    }, [soaCustomerId, dateRange, soaLedger, attachReceiptImages]);

    // Fetch Wallet Overview for Tab 3
    const fetchWalletCustomers = useCallback(async () => {
        try {
            setWalletLoading(true);
            const res = await api.get('/ar/customer-liabilities');
            setWalletCustomers(res.data?.data || res.data || []);
        } catch (err) {
            console.error('Failed to fetch wallet overview:', err);
            toast.error('Failed to load wallet management data.');
        } finally {
            setWalletLoading(false);
        }
    }, []);

    // Initial load per tab
    useEffect(() => {
        if (hasPermission('ar:view')) {
            if (activeTab === 'overview') fetchDashboardData();
            if (activeTab === 'ledger_soa' && customers.length === 0) {
                api.get('/customers/with-balances', { params: { paginated: 1, page: 1, pageSize: 500 } })
                    .then(res => setCustomers(res.data?.data || res.data || []))
                    .catch(err => console.error('Failed to load customers for SOA:', err));
            }
            if (activeTab === 'wallet') fetchWalletCustomers();
        }
    }, [activeTab, hasPermission, fetchDashboardData, fetchWalletCustomers, customers.length]);

    useEffect(() => {
        if (soaCustomerId) {
            fetchCustomerLedger(soaCustomerId);
        }
    }, [soaCustomerId, fetchCustomerLedger]);

    // Re-fetch customer summary when search/filter/sort/pagination changes
    useEffect(() => {
        if (hasPermission('ar:view') && activeTab === 'overview') {
            fetchCustomerSummary();
        }
    }, [activeTab, hasPermission, fetchCustomerSummary]);

    // Fetch customer payable invoices for drill-down modal
    const fetchCustomerInvoices = useCallback(async (customerId, page = customerInvoicesPage, pageSize = customerInvoicesPageSize) => {
        if (!customerId) return;
        try {
            setCustomerInvoicesLoading(true);
            const res = await api.get(`/ar/customer-invoices/${customerId}`, {
                params: {
                    page,
                    pageSize,
                    paginated: 1
                }
            });
            const data = res.data?.data || res.data || [];
            const total = res.data?.total || data.length || 0;
            setCustomerInvoices(data);
            setCustomerInvoicesTotal(total);
        } catch (err) {
            console.error('Failed to fetch customer invoices:', err);
            toast.error('Failed to load customer invoices');
            setCustomerInvoices([]);
        } finally {
            setCustomerInvoicesLoading(false);
        }
    }, [customerInvoicesPage, customerInvoicesPageSize]);

    useEffect(() => {
        if (selectedCustomerForInvoices?.customer_id) {
            fetchCustomerInvoices(selectedCustomerForInvoices.customer_id, customerInvoicesPage, customerInvoicesPageSize);
        } else {
            setCustomerInvoices([]);
            setCustomerInvoicesTotal(0);
        }
    }, [selectedCustomerForInvoices, customerInvoicesPage, customerInvoicesPageSize, fetchCustomerInvoices]);

    const handleCustomerClick = useCallback((customer) => {
        setSelectedCustomerForInvoices(customer);
        setCustomerInvoicesPage(1);
    }, []);

    const handleCloseCustomerInvoices = useCallback(() => {
        setSelectedCustomerForInvoices(null);
        setCustomerInvoices([]);
    }, []);

    const handleReceivePaymentClick = useCallback((invoice) => {
        if (invoice.invoice_id) {
            const customer = {
                customer_id: invoice.customer_id,
                company_name: invoice.company_name,
                first_name: invoice.first_name,
                last_name: invoice.last_name
            };
            setSelectedCustomer(customer);
        } else {
            setSelectedCustomer(invoice);
        }
        setIsPaymentModalOpen(true);
    }, []);

    const handleReceivePaymentFromDrillDown = useCallback((invoice) => {
        setSelectedAgingBucket(null);
        handleReceivePaymentClick(invoice);
    }, [handleReceivePaymentClick]);

    const handlePaymentSaved = useCallback(() => {
        setIsPaymentModalOpen(false);
        fetchDashboardData();
        if (activeTab === 'wallet') fetchWalletCustomers();
        toast.success('Payment processed successfully!');
    }, [fetchDashboardData, fetchWalletCustomers, activeTab]);

    const handleExportCustomerSummary = useCallback(() => {
        const exportData = customerSummary.map(customer => ({
            'Customer': customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
            'Total Balance': customer.total_balance_due,
            'Wallet Credit': customer.wallet_balance || 0,
            'Next Due Date': customer.earliest_due_date ? new Date(customer.earliest_due_date).toLocaleDateString() : 'N/A',
            'Credit Hold': customer.credit_hold ? 'YES' : 'NO',
            'Status': customer.status
        }));
        exportToCSV(exportData, `customer-ar-summary-${new Date().toISOString().split('T')[0]}.csv`);
    }, [customerSummary]);

    // Reset to page 1 whenever the wallet search term changes
    useEffect(() => {
        setWalletPage(1);
    }, [walletSearch]);

    const filteredWalletCustomers = useMemo(() => {
        if (!walletSearch.trim()) return walletCustomers;
        const q = walletSearch.toLowerCase();
        return walletCustomers.filter(w => {
            const name = (w.company_name || `${w.first_name || ''} ${w.last_name || ''}`).toLowerCase();
            return name.includes(q);
        });
    }, [walletCustomers, walletSearch]);

    const paginatedWalletCustomers = useMemo(() => {
        const start = (walletPage - 1) * walletPageSize;
        return filteredWalletCustomers.slice(start, start + walletPageSize);
    }, [filteredWalletCustomers, walletPage, walletPageSize]);

    const handleSelectWalletCustomer = useCallback((customer) => {
        setSelectedWalletCustomer(customer);
        setIsWalletModalOpen(true);
    }, []);

    const handleCloseWalletModal = useCallback(() => {
        setIsWalletModalOpen(false);
        setSelectedWalletCustomer(null);
    }, []);

    const handleWalletUpdated = useCallback(() => {
        fetchWalletCustomers();
        fetchDashboardData();
    }, [fetchWalletCustomers, fetchDashboardData]);

    const kpiData = useMemo(() => {
        return {
            totalReceivables: { value: formatCurrency(dashboardStats.totalReceivables), trend: 'Authoritative Ledger Balance', color: 'text-blue-600' },
            invoicesSent: { value: (dashboardStats.invoicesSent || 0).toLocaleString(), trend: 'Active Receivables Count', color: 'text-green-500' },
            overdueInvoices: { value: (dashboardStats.overdueInvoices || 0).toLocaleString(), trend: 'Requires Attention', color: 'text-red-500' },
            avgCollectionPeriod: { value: `${dashboardStats.avgCollectionPeriod || 30} Days`, trend: 'Standard Payment Terms', color: 'text-amber-500' },
        };
    }, [dashboardStats]);

    if (!hasPermission('ar:view')) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
                <p className="text-gray-600 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            {/* Page Header & Navigation Bar */}
            <header className="mb-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800">Accounts Receivable</h1>
                    <p className="text-sm text-gray-500 mt-1">Authoritative A/R Ledger, SOA Reports, PDC Desk & Customer Wallet</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => {
                            if (activeTab === 'overview') fetchDashboardData();
                            if (activeTab === 'ledger_soa') fetchCustomerLedger(soaCustomerId);
                            if (activeTab === 'wallet') fetchWalletCustomers();
                        }}
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm transition-colors font-medium flex items-center gap-1.5"
                    >
                        <Icon path={ICONS.refresh} className="w-4 h-4" /> Refresh
                    </button>
                </div>
            </header>

            {/* Navigation Tabs */}
            <div className="bg-white rounded-xl border border-gray-200 p-1.5 mb-6 flex flex-wrap gap-1 shadow-sm">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                        activeTab === 'overview'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                    Overview & Aging
                    {activeTab === 'overview' && loading && (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('ledger_soa')}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                        activeTab === 'ledger_soa'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                    Customer Ledger & SOA
                    {activeTab === 'ledger_soa' && soaLoading && (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    )}
                </button>
                <button
                    onClick={() => setActiveTab('wallet')}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                        activeTab === 'wallet'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                    Customer Wallet Management
                    {activeTab === 'wallet' && walletLoading && (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    )}
                </button>
            </div>

            {/* Date Range Picker (shared) */}
            <div className="bg-white p-4 rounded-xl border border-gray-200 mb-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Icon path={ICONS.calendar} className="h-5 w-5 text-gray-500" />
                    <span className="text-sm font-medium text-gray-700">Statement / Date Range:</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-600">From:</label>
                        <input
                            type="date"
                            value={dateRange.startDate.toISOString().split('T')[0]}
                            onChange={(e) => handleDateRangeChange({ ...dateRange, startDate: new Date(e.target.value) })}
                            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-600">To:</label>
                        <input
                            type="date"
                            value={dateRange.endDate.toISOString().split('T')[0]}
                            onChange={(e) => handleDateRangeChange({ ...dateRange, endDate: new Date(e.target.value) })}
                            className="px-3 py-1.5 border border-gray-300 rounded-md text-sm"
                        />
                    </div>
                    <button
                        onClick={() => handleDateRangeChange({ startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), endDate: new Date() })}
                        className="px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded-md"
                    >
                        Last 30 Days
                    </button>
                    <button
                        onClick={() => handleDateRangeChange({ startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), endDate: new Date() })}
                        className="px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded-md"
                    >
                        Last 90 Days
                    </button>
                    <button
                        onClick={() => handleDateRangeChange({ startDate: new Date('1970-01-01'), endDate: new Date() })}
                        className="px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded-md"
                    >
                        All Time
                    </button>
                </div>
            </div>

            <AROverviewTab
                isActive={activeTab === 'overview'}
                loading={loading}
                error={overviewError}
                onRetry={fetchDashboardData}
                kpiData={kpiData}
                agingData={agingData}
                onBucketClick={handleAgingBucketClick}
                customerSummary={customerSummary}
                onCustomerClick={handleCustomerClick}
                onReceivePayment={handleReceivePaymentClick}
                hasPaymentPermission={hasPermission('ar:receive_payment')}
                onExport={handleExportCustomerSummary}
                searchTerm={customerSummarySearchTerm}
                onSearchChange={(val) => { setCustomerSummarySearchTerm(val); setCustomerSummaryPage(1); }}
                statusFilter={customerSummaryStatusFilter}
                onStatusFilterChange={(val) => { setCustomerSummaryStatusFilter(val); setCustomerSummaryPage(1); }}
                sortConfig={customerSummarySortConfig}
                onSortChange={(cfg) => { setCustomerSummarySortConfig(cfg); setCustomerSummaryPage(1); }}
                customerSummaryPage={customerSummaryPage}
                customerSummaryPageSize={customerSummaryPageSize}
                customerSummaryTotal={customerSummaryTotal}
                onCustomerSummaryPageChange={setCustomerSummaryPage}
                onCustomerSummaryPageSizeChange={(value) => { setCustomerSummaryPageSize(value); setCustomerSummaryPage(1); }}
                selectedAgingBucket={selectedAgingBucket}
                onCloseDrillDown={handleCloseDrillDown}
                drillDownLoading={drillDownLoading}
                drillDownInvoices={drillDownInvoices}
                drillDownPage={drillDownPage}
                drillDownPageSize={drillDownPageSize}
                drillDownTotal={drillDownTotal}
                onDrillDownPageChange={setDrillDownPage}
                onDrillDownPageSizeChange={(value) => { setDrillDownPageSize(value); setDrillDownPage(1); }}
                onReceivePaymentFromDrillDown={handleReceivePaymentFromDrillDown}
                hasPermission={hasPermission}
                isPaymentModalOpen={isPaymentModalOpen}
                selectedCustomer={selectedCustomer}
                onClosePaymentModal={() => setIsPaymentModalOpen(false)}
                onPaymentSaved={handlePaymentSaved}
                selectedCustomerForInvoices={selectedCustomerForInvoices}
                onCloseCustomerInvoices={handleCloseCustomerInvoices}
                customerInvoices={customerInvoices}
                customerInvoicesLoading={customerInvoicesLoading}
                customerInvoicesPage={customerInvoicesPage}
                customerInvoicesPageSize={customerInvoicesPageSize}
                customerInvoicesTotal={customerInvoicesTotal}
                onCustomerInvoicesPageChange={setCustomerInvoicesPage}
                onCustomerInvoicesPageSizeChange={(size) => { setCustomerInvoicesPageSize(size); setCustomerInvoicesPage(1); }}
                onAfterDueDateUpdate={fetchDashboardData}
            />

            {activeTab === 'ledger_soa' && (
                <ARLedgerSoaTab
                    soaComboboxRef={soaComboboxRef}
                    soaSearchQuery={soaSearchQuery}
                    onSoaSearchQueryChange={setSoaSearchQuery}
                    soaDropdownOpen={soaDropdownOpen}
                    setSoaDropdownOpen={setSoaDropdownOpen}
                    soaHighlightedIndex={soaHighlightedIndex}
                    setSoaHighlightedIndex={setSoaHighlightedIndex}
                    filteredSoaCustomers={filteredSoaCustomers}
                    soaCustomerId={soaCustomerId}
                    selectSoaCustomer={selectSoaCustomer}
                    onClearSoaCustomer={handleClearSoaCustomer}
                    handleSoaKeyDown={handleSoaKeyDown}
                    attachReceiptImages={attachReceiptImages}
                    setAttachReceiptImages={setAttachReceiptImages}
                    handleExportSoaPdf={handleExportSoaPdf}
                    soaDownloading={soaDownloading}
                    soaLoading={soaLoading}
                    soaLedger={soaLedger}
                    dateRange={dateRange}
                />
            )}

            {activeTab === 'wallet' && (
                <ARWalletTab
                    walletLoading={walletLoading}
                    walletSearch={walletSearch}
                    onWalletSearchChange={setWalletSearch}
                    filteredWalletCustomers={filteredWalletCustomers}
                    paginatedWalletCustomers={paginatedWalletCustomers}
                    walletPage={walletPage}
                    walletPageSize={walletPageSize}
                    onWalletPageChange={setWalletPage}
                    onWalletPageSizeChange={(value) => { setWalletPageSize(value); setWalletPage(1); }}
                    selectedWalletCustomer={selectedWalletCustomer}
                    onSelectWalletCustomer={handleSelectWalletCustomer}
                    isWalletModalOpen={isWalletModalOpen}
                    onCloseWalletModal={handleCloseWalletModal}
                    onWalletUpdated={handleWalletUpdated}
                />
            )}
        </div>
    );
};

export default AccountsReceivablePage;
