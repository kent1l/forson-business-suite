import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import ReceivePaymentForm from '../components/forms/ReceivePaymentForm';

// Import extracted utilities and components
import { formatCurrency } from '../utils/currency';
import { exportToCSV } from '../utils/csv';
import KPICard from '../components/ui/KPICard';
import InvoiceAgingSummaryChart from '../components/accounts-receivable/InvoiceAgingSummaryChart';
import CustomerSummaryTable from '../components/accounts-receivable/CustomerSummaryTable';
import CustomerInvoiceDetailsModal from '../components/accounts-receivable/CustomerInvoiceDetailsModal';
import CustomerWalletModal from '../components/accounts-receivable/CustomerWalletModal';
import PaginationControls from '../components/ui/PaginationControls';

const AccountsReceivablePage = () => {
    const { hasPermission } = useAuth();
    
    // Active Navigation Tab
    const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'ledger_soa' | 'pdc_desk' | 'wallet'

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
    const [trends, setTrends] = useState({});
    const [loading, setLoading] = useState(true);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
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

    // Handle date range changes
    const handleDateRangeChange = useCallback((newDateRange) => {
        setDateRange(newDateRange);
    }, []);

    // Handle drill-down into aging buckets
    const handleAgingBucketClick = useCallback(async (bucketName) => {
        try {
            setDrillDownLoading(true);
            setSelectedAgingBucket(bucketName);
            
            const bucketMap = {
                'Current': 'current',
                '1-30 Days': '1-30',
                '31-60 Days': '31-60',
                '61-90 Days': '61-90',
                '90+ Days': '90-plus'
            };
            
            const bucketParam = bucketMap[bucketName];
            if (!bucketParam) return;
            
            const dateParams = {
                startDate: dateRange.startDate.toISOString(),
                endDate: dateRange.endDate.toISOString(),
                bucket: bucketParam,
                page: drillDownPage,
                pageSize: drillDownPageSize,
                paginated: 1
            };
            
            const response = await api.get('/ar/drill-down-invoices', { params: dateParams });
            setDrillDownInvoices(response.data?.data || []);
            setDrillDownTotal(response.data?.total || 0);
            
        } catch (error) {
            console.error('Failed to fetch drill-down invoices:', error);
            toast.error('Failed to load invoice details');
        } finally {
            setDrillDownLoading(false);
        }
    }, [dateRange, drillDownPage, drillDownPageSize]);

    // Fetch Overview Dashboard Data
    const fetchDashboardData = useCallback(async () => {
        try {
            setLoading(true);
            
            const dateParams = {
                startDate: dateRange.startDate.toISOString(),
                endDate: dateRange.endDate.toISOString()
            };
            
            const [customersRes, dashboardRes, agingRes, customerSummaryRes, trendsRes] = await Promise.all([
                api.get('/customers/with-balances', { params: { paginated: 1, page: 1, pageSize: 100 } }),
                api.get('/ar/dashboard-stats', { params: dateParams }).catch(() => ({ data: {} })),
                api.get('/ar/aging-summary').catch(() => ({ data: [] })),
                api.get('/ar/customer-summary', {
                    params: {
                        page: customerSummaryPage,
                        pageSize: customerSummaryPageSize,
                        paginated: 1,
                        search: customerSummarySearchTerm,
                        status: customerSummaryStatusFilter,
                        sortBy: customerSummarySortConfig.key,
                        sortDir: customerSummarySortConfig.direction
                    }
                }).catch(() => ({ data: { data: [], total: 0 } })),
                api.get('/ar/trends').catch(() => ({ data: {} }))
            ]);

            const customersWithBalances = customersRes.data?.data || customersRes.data || [];
            setCustomers(customersWithBalances);
            setTrends(trendsRes.data || {});

            if (dashboardRes.data && Object.keys(dashboardRes.data).length > 0) {
                setDashboardStats(dashboardRes.data);
            }

            if (agingRes.data && agingRes.data.length > 0) {
                setAgingData(agingRes.data);
            }

            setCustomerSummary(customerSummaryRes.data?.data || []);
            setCustomerSummaryTotal(customerSummaryRes.data?.total || 0);

        } catch (err) {
            console.error('Failed to fetch dashboard data:', err);
            toast.error('Failed to fetch accounts receivable data.');
        } finally {
            setLoading(false);
        }
    }, [dateRange, customerSummaryPage, customerSummaryPageSize, customerSummarySearchTerm, customerSummaryStatusFilter, customerSummarySortConfig]);

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
                    endDate: dateRange.endDate.toISOString()
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
    }, [soaCustomerId, dateRange, soaLedger]);

    // Fetch PDC Clearance Desk Items for Tab 3
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
                            if (activeTab === 'pdc_desk') fetchPdcItems();
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
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                        activeTab === 'overview'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                    Overview & Aging
                </button>
                <button
                    onClick={() => setActiveTab('ledger_soa')}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                        activeTab === 'ledger_soa'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                    Customer Ledger & SOA
                </button>
                <button
                    onClick={() => setActiveTab('wallet')}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all ${
                        activeTab === 'wallet'
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                >
                    Customer Wallet Management
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
                </div>
            </div>

            {/* TAB 1: OVERVIEW & AGING */}
            {activeTab === 'overview' && (
                <>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                        <KPICard iconName={ICONS.dollar} title="Total Receivables" value={kpiData.totalReceivables.value} trend={kpiData.totalReceivables.trend} trendColorClass={kpiData.totalReceivables.color} loading={loading} />
                        <KPICard iconName={ICONS.documents} title="Invoices Sent" value={kpiData.invoicesSent.value} trend={kpiData.invoicesSent.trend} trendColorClass={kpiData.invoicesSent.color} loading={loading} />
                        <KPICard iconName={ICONS.warning} title="Overdue Invoices" value={kpiData.overdueInvoices.value} trend={kpiData.overdueInvoices.trend} trendColorClass={kpiData.overdueInvoices.color} loading={loading} />
                        <KPICard iconName={ICONS.calendar} title="Avg. Collection Period" value={kpiData.avgCollectionPeriod.value} trend={kpiData.avgCollectionPeriod.trend} trendColorClass={kpiData.avgCollectionPeriod.color} loading={loading} />
                    </div>

                    <InvoiceAgingSummaryChart agingData={agingData} loading={loading} onBucketClick={handleAgingBucketClick} />

                    <CustomerSummaryTable 
                        customers={customerSummary}
                        onCustomerClick={handleCustomerClick}
                        onReceivePayment={handleReceivePaymentClick}
                        hasPaymentPermission={hasPermission('ar:receive_payment')}
                        loading={loading}
                        onExport={handleExportCustomerSummary}
                        searchTerm={customerSummarySearchTerm}
                        onSearchChange={(val) => { setCustomerSummarySearchTerm(val); setCustomerSummaryPage(1); }}
                        statusFilter={customerSummaryStatusFilter}
                        onStatusFilterChange={(val) => { setCustomerSummaryStatusFilter(val); setCustomerSummaryPage(1); }}
                        sortConfig={customerSummarySortConfig}
                        onSortChange={(cfg) => { setCustomerSummarySortConfig(cfg); setCustomerSummaryPage(1); }}
                    />
                    <PaginationControls
                        page={customerSummaryPage}
                        pageSize={customerSummaryPageSize}
                        total={customerSummaryTotal}
                        onPageChange={setCustomerSummaryPage}
                        onPageSizeChange={(value) => { setCustomerSummaryPageSize(value); setCustomerSummaryPage(1); }}
                    />
                </>
            )}

            {/* TAB 2: CUSTOMER LEDGER & SOA */}
            {activeTab === 'ledger_soa' && (
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                        <div className="w-full md:w-96 relative" ref={soaComboboxRef}>
                            <label className="block text-xs font-semibold uppercase text-gray-600 mb-1">Search Customer</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    value={soaSearchQuery}
                                    onChange={(e) => {
                                        setSoaSearchQuery(e.target.value);
                                        setSoaDropdownOpen(true);
                                        if (!e.target.value) {
                                            setSoaCustomerId('');
                                            setSoaLedger(null);
                                        }
                                    }}
                                    onFocus={() => setSoaDropdownOpen(true)}
                                    onKeyDown={handleSoaKeyDown}
                                    placeholder="Search customer name, company..."
                                    className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                {soaSearchQuery && (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSoaSearchQuery('');
                                            setSoaCustomerId('');
                                            setSoaLedger(null);
                                            setSoaDropdownOpen(false);
                                            setSoaHighlightedIndex(-1);
                                        }}
                                        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 focus:outline-none p-1 rounded-full hover:bg-gray-100 transition-colors"
                                        title="Clear search"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                        </svg>
                                    </button>
                                )}
                            </div>

                            {/* Search Dropdown Results */}
                            {soaDropdownOpen && (
                                <div className="absolute z-50 left-0 right-0 mt-1 max-h-60 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
                                    {filteredSoaCustomers.length === 0 ? (
                                        <div className="p-3 text-xs text-gray-500 text-center">No matching customer accounts found</div>
                                    ) : (
                                        filteredSoaCustomers.map((c, idx) => {
                                            const displayName = c.company_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
                                            const isSelected = String(c.customer_id) === String(soaCustomerId);
                                            const isHighlighted = idx === soaHighlightedIndex;
                                            return (
                                                <button
                                                    key={c.customer_id}
                                                    type="button"
                                                    ref={(el) => {
                                                        if (isHighlighted && el) {
                                                            el.scrollIntoView({ block: 'nearest' });
                                                        }
                                                    }}
                                                    onClick={() => selectSoaCustomer(c)}
                                                    onMouseEnter={() => setSoaHighlightedIndex(idx)}
                                                    className={`w-full text-left px-3 py-2 text-sm flex justify-between items-center transition-colors border-b border-gray-100 last:border-0 ${
                                                        isHighlighted
                                                            ? 'bg-blue-100 font-semibold text-blue-900 ring-1 ring-blue-300'
                                                            : isSelected
                                                            ? 'bg-blue-50 font-semibold text-blue-700'
                                                            : 'text-gray-700 hover:bg-blue-50'
                                                    }`}
                                                >
                                                    <span className="truncate">{displayName}</span>
                                                    <span className="font-mono text-xs text-gray-500 ml-2 whitespace-nowrap">
                                                        {formatCurrency(c.total_balance_due || c.balance_due || 0)}
                                                    </span>
                                                </button>
                                            );
                                        })
                                    )}
                                </div>
                            )}
                        </div>
                        {soaCustomerId && (
                            <button
                                onClick={handleExportSoaPdf}
                                disabled={soaDownloading}
                                className="px-5 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 text-sm font-semibold transition-colors flex items-center gap-2"
                            >
                                {soaDownloading ? 'Generating PDF...' : '📄 Export Statement of Account (PDF)'}
                            </button>
                        )}
                    </div>

                    {soaLoading ? (
                        <div className="bg-white p-12 rounded-xl text-center text-gray-500 border">Loading customer ledger history...</div>
                    ) : !soaLedger ? (
                        <div className="bg-white p-12 rounded-xl text-center text-gray-500 border">Please select a customer to view their statement of account and ledger history.</div>
                    ) : (
                        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                            <div className="p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                                <div>
                                    <h3 className="text-xl font-bold text-gray-800">{soaLedger.customer.name}</h3>
                                    <p className="text-xs text-gray-500">{soaLedger.customer.email} | {soaLedger.customer.phone}</p>
                                </div>
                                <div className="text-right">
                                    <div className="text-xs uppercase font-semibold text-gray-500">Closing Balance</div>
                                    <div className="text-2xl font-bold font-mono text-blue-700">{formatCurrency(soaLedger.closing_balance)}</div>
                                </div>
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-sm text-left text-gray-500">
                                    <thead className="text-xs text-gray-700 uppercase bg-gray-100 border-b">
                                        <tr>
                                            <th className="px-6 py-3">Date</th>
                                            <th className="px-6 py-3">Ref / Doc #</th>
                                            <th className="px-6 py-3">Description</th>
                                            <th className="px-6 py-3 text-right">Debit (+)</th>
                                            <th className="px-6 py-3 text-right">Credit (-)</th>
                                            <th className="px-6 py-3 text-right font-bold">Running Balance</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200">
                                        <tr className="bg-blue-50/50 font-semibold text-gray-700">
                                            <td className="px-6 py-3" colSpan="5">Opening Balance as of {dateRange.startDate.toLocaleDateString()}</td>
                                            <td className="px-6 py-3 text-right font-mono font-bold text-blue-900">{formatCurrency(soaLedger.opening_balance)}</td>
                                        </tr>
                                        {soaLedger.ledger_rows.map((row, idx) => (
                                            <tr key={row.ledger_id || idx} className="hover:bg-gray-50">
                                                <td className="px-6 py-3.5 whitespace-nowrap">{new Date(row.date).toLocaleDateString()}</td>
                                                <td className="px-6 py-3.5 font-mono text-xs font-semibold text-gray-800">{row.reference}</td>
                                                <td className="px-6 py-3.5">{row.description}</td>
                                                <td className="px-6 py-3.5 text-right font-mono text-gray-900">{row.debit_amount ? formatCurrency(row.debit_amount) : '-'}</td>
                                                <td className="px-6 py-3.5 text-right font-mono text-emerald-700">{row.credit_amount ? formatCurrency(row.credit_amount) : '-'}</td>
                                                <td className="px-6 py-3.5 text-right font-mono font-bold text-gray-900">{formatCurrency(row.running_balance)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* TAB 3: CUSTOMER WALLET MANAGEMENT */}
            {activeTab === 'wallet' && (
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm flex justify-between items-center">
                        <div>
                            <h2 className="text-xl font-bold text-gray-800">Customer Wallet & Store Credit Management</h2>
                            <p className="text-xs text-gray-500 mt-0.5">Manage customer deposit balances, overpayment credits, and store wallet adjustments</p>
                        </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left text-gray-500">
                                <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                                    <tr>
                                        <th className="px-6 py-3">Customer</th>
                                        <th className="px-6 py-3 text-right">Store Wallet Balance</th>
                                        <th className="px-6 py-3 text-right">Outstanding Receivables</th>
                                        <th className="px-6 py-3 text-right">Net Exposure</th>
                                        <th className="px-6 py-3 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200">
                                    {walletCustomers.map(w => {
                                        const walletBal = Number(w.wallet_balance || 0);
                                        const arBal = Number(w.receivable_balance || w.total_balance_due || 0);
                                        const netExp = arBal - walletBal;
                                        return (
                                            <tr key={w.customer_id} className="hover:bg-gray-50">
                                                <td className="px-6 py-4 font-semibold text-gray-900">{w.company_name || `${w.first_name || ''} ${w.last_name || ''}`}</td>
                                                <td className="px-6 py-4 text-right font-mono font-bold text-emerald-700">{formatCurrency(walletBal)}</td>
                                                <td className="px-6 py-4 text-right font-mono font-semibold text-gray-900">{formatCurrency(arBal)}</td>
                                                <td className="px-6 py-4 text-right font-mono font-bold" style={{ color: netExp > 0 ? '#DC2626' : '#059669' }}>
                                                    {formatCurrency(netExp)}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <button
                                                        onClick={() => {
                                                            setSelectedWalletCustomer(w);
                                                            setIsWalletModalOpen(true);
                                                        }}
                                                        className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
                                                    >
                                                        View / Adjust Wallet
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                    {walletCustomers.length === 0 && (
                                        <tr>
                                            <td colSpan="5" className="px-6 py-8 text-center text-gray-500">No customer wallet records found.</td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Customer Wallet Modal */}
                    {selectedWalletCustomer && (
                        <CustomerWalletModal
                            isOpen={isWalletModalOpen}
                            onClose={() => {
                                setIsWalletModalOpen(false);
                                setSelectedWalletCustomer(null);
                            }}
                            customer={selectedWalletCustomer}
                            onUpdated={() => {
                                fetchWalletCustomers();
                                fetchDashboardData();
                            }}
                        />
                    )}
                </div>
            )}

            {/* Receive Payment Modal */}
            <Modal 
                isOpen={isPaymentModalOpen} 
                onClose={() => setIsPaymentModalOpen(false)} 
                title={`Receive Payment from ${selectedCustomer?.company_name || `${selectedCustomer?.first_name || ''} ${selectedCustomer?.last_name || ''}`.trim()}`} 
                maxWidth="max-w-6xl"
            >
                {selectedCustomer && (
                    <ReceivePaymentForm 
                        customer={selectedCustomer} 
                        onSave={handlePaymentSaved} 
                        onCancel={() => setIsPaymentModalOpen(false)} 
                    />
                )}
            </Modal>

            {/* Drill-down Modal for Aging Bucket Details */}
            <Modal
                isOpen={selectedAgingBucket !== null}
                onClose={() => {
                    setSelectedAgingBucket(null);
                    setDrillDownInvoices([]);
                }}
                title={`Invoices - ${selectedAgingBucket}`}
                maxWidth="max-w-6xl"
            >
                <div className="space-y-4">
                    {drillDownLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <span className="ml-2 text-gray-600">Loading invoices...</span>
                        </div>
                    ) : drillDownInvoices.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            No invoices found for this aging bucket.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200">
                                    <tr>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Invoice #</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Customer</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Invoice Date</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Due Date</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-right">Amount</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-right">Balance</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {drillDownInvoices.map(invoice => (
                                        <tr key={invoice.invoice_id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                                            <td className="p-3 text-sm font-mono">{invoice.invoice_number}</td>
                                            <td className="p-3 text-sm">{invoice.company_name || `${invoice.first_name || ''} ${invoice.last_name || ''}`.trim()}</td>
                                            <td className="p-3 text-sm">{new Date(invoice.invoice_date).toLocaleDateString()}</td>
                                            <td className="p-3 text-sm">{new Date(invoice.due_date).toLocaleDateString()}</td>
                                            <td className="p-3 text-sm text-right font-mono">{formatCurrency(invoice.total_amount)}</td>
                                            <td className="p-3 text-sm text-right font-mono font-medium">{formatCurrency(invoice.balance_due)}</td>
                                            <td className="p-3 text-sm text-center">
                                                {hasPermission('ar:receive_payment') && Number(invoice.balance_due) > 0 && (
                                                    <button
                                                        onClick={() => {
                                                            setSelectedAgingBucket(null);
                                                            handleReceivePaymentClick(invoice);
                                                        }}
                                                        className="bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors"
                                                    >
                                                        Receive Payment
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </Modal>

            {/* Customer Invoice Details Modal */}
            <CustomerInvoiceDetailsModal
                isOpen={selectedCustomerForInvoices !== null}
                onClose={() => {
                    setSelectedCustomerForInvoices(null);
                    setCustomerInvoices([]);
                }}
                title={`Payable Invoices for ${selectedCustomerForInvoices?.company_name || `${selectedCustomerForInvoices?.first_name || ''} ${selectedCustomerForInvoices?.last_name || ''}`.trim()}`}
                invoices={customerInvoices}
                loading={customerInvoicesLoading}
                page={customerInvoicesPage}
                pageSize={customerInvoicesPageSize}
                total={customerInvoicesTotal}
                onPageChange={setCustomerInvoicesPage}
                onPageSizeChange={(size) => {
                    setCustomerInvoicesPageSize(size);
                    setCustomerInvoicesPage(1);
                }}
                onAfterDueDateUpdate={() => {
                    fetchDashboardData();
                }}
            />
        </div>
    );
};

export default AccountsReceivablePage;
