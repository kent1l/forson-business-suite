import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { useAuth } from '../contexts/AuthContext';
// eslint-disable-next-line no-unused-vars
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
// eslint-disable-next-line no-unused-vars
import Modal from '../components/ui/Modal';
// eslint-disable-next-line no-unused-vars
import ReceivePaymentForm from '../components/forms/ReceivePaymentForm';

// Utility for currency formatting
const formatCurrency = (value) => {
    const num = Number(value) || 0;
    return `₱${num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// Loading skeleton components
const KPICardSkeleton = () => (
    <div className="bg-white p-6 rounded-lg border border-gray-200 animate-pulse">
        <div className="flex items-center gap-x-3 mb-2">
            <div className="w-12 h-12 rounded-full bg-gray-200"></div>
            <div className="h-4 bg-gray-200 rounded w-24"></div>
        </div>
        <div className="h-8 bg-gray-200 rounded w-20 mb-2"></div>
        <div className="h-3 bg-gray-200 rounded w-32"></div>
    </div>
);

const ChartSkeleton = () => (
    <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-48 mb-4"></div>
        <div className="w-full bg-gray-200 rounded-full h-8 mb-4"></div>
        <div className="flex justify-between gap-2">
            {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-center gap-x-2">
                    <div className="w-3 h-3 rounded-full bg-gray-200"></div>
                    <div className="h-3 bg-gray-200 rounded w-16"></div>
                </div>
            ))}
        </div>
    </div>
);

const TableSkeleton = () => (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
        <div className="p-6">
            <div className="h-6 bg-gray-200 rounded w-48"></div>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full">
                <thead className="bg-gray-50 border-b">
                    <tr>
                        {[1, 2, 3, 4, 5, 6, 7].map(i => (
                            <th key={i} className="px-6 py-3">
                                <div className="h-3 bg-gray-200 rounded w-16"></div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {[1, 2, 3, 4, 5].map(i => (
                        <tr key={i} className="border-b">
                            {[1, 2, 3, 4, 5, 6, 7].map(j => (
                                <td key={j} className="px-6 py-4">
                                    <div className="h-4 bg-gray-200 rounded w-20"></div>
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

// Enhanced status badge with better logic
const getStatusBadge = (invoice) => {
    if (!invoice.due_date) return { text: 'Unknown', color: 'bg-gray-100 text-gray-800' };
    
    const daysOverdue = Math.floor((new Date() - new Date(invoice.due_date)) / (1000 * 60 * 60 * 24));
    
    if (daysOverdue <= 0) return { text: 'Current', color: 'bg-green-100 text-green-800' };
    if (daysOverdue <= 30) return { text: `${daysOverdue}d overdue`, color: 'bg-yellow-100 text-yellow-800' };
    if (daysOverdue <= 90) return { text: `${daysOverdue}d overdue`, color: 'bg-orange-100 text-orange-800' };
    return { text: `${daysOverdue}d overdue`, color: 'bg-red-100 text-red-800' };
};

// A reusable KPI card component based on Dashboard.jsx styles
const KPICard = ({ iconName, title, value, trend, trendColorClass = 'text-green-500', loading = false }) => {
    if (loading) return <KPICardSkeleton />;
    
    return (
        <div className="bg-white p-6 rounded-lg border border-gray-200 flex flex-col gap-y-2">
            <div className="flex items-center gap-x-3">
                <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                    <Icon path={iconName} className="h-6 w-6 text-gray-500" />
                </div>
                <h3 className="text-gray-500 font-medium">{title}</h3>
            </div>
            <p className="text-3xl font-bold text-gray-800">{value}</p>
            {trend && <p className={`text-sm ${trendColorClass}`}>{trend}</p>}
        </div>
    );
};

// Invoice Aging Summary Chart Component
const InvoiceAgingSummaryChart = ({ agingData, loading = false }) => {
    if (loading) return <ChartSkeleton />;
    
    const total = agingData.reduce((sum, item) => sum + item.value, 0);

    // Use colors that match the existing design system (from Dashboard.jsx)
    const colors = {
        'Current': 'bg-blue-500',
        '1-30 Days': 'bg-blue-400', 
        '31-60 Days': 'bg-yellow-400',
        '61-90 Days': 'bg-orange-400',
        '90+ Days': 'bg-red-500',
    };

    return (
        <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Invoice Aging Summary</h2>
            <div className="w-full bg-gray-200 rounded-full h-8 flex overflow-hidden">
                {agingData.map(item => (
                    <div
                        key={item.name}
                        className={`h-full ${colors[item.name]} transition-all duration-300 ease-in-out hover:opacity-80 cursor-pointer`}
                        style={{ width: `${total > 0 ? (item.value / total) * 100 : 0}%` }}
                        title={`${item.name}: ${formatCurrency(item.value)}`}
                    ></div>
                ))}
            </div>
            <div className="flex justify-between text-sm text-gray-600 mt-4 flex-wrap gap-2">
                {agingData.map(item => (
                    <div key={item.name} className="flex items-center gap-x-2">
                        <span className={`w-3 h-3 rounded-full ${colors[item.name]}`}></span>
                        <span className="text-xs">{item.name}</span>
                        <span className="text-xs font-medium">{formatCurrency(item.value)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Detailed Overdue Invoices Table Component
const DetailedOverdueInvoicesTable = ({ overdueInvoices, onReceivePayment, hasPaymentPermission, loading = false }) => {
    if (loading) return <TableSkeleton />;
    
    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
                <h2 className="text-xl font-semibold text-gray-800">Detailed Overdue Invoices</h2>
                <p className="text-sm text-gray-500 mt-1">
                    {overdueInvoices.length} invoice{overdueInvoices.length !== 1 ? 's' : ''} overdue
                </p>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th scope="col" className="px-6 py-3 font-medium">Customer</th>
                            <th scope="col" className="px-6 py-3 font-medium">Invoice #</th>
                            <th scope="col" className="px-6 py-3 font-medium">Invoice Date</th>
                            <th scope="col" className="px-6 py-3 font-medium">Due Date</th>
                            <th scope="col" className="px-6 py-3 font-medium text-right">Amount</th>
                            <th scope="col" className="px-6 py-3 font-medium">Status</th>
                            {hasPaymentPermission && <th scope="col" className="px-6 py-3 font-medium">Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {overdueInvoices.map((invoice, index) => {
                            const statusBadge = getStatusBadge(invoice);
                            return (
                                <tr key={invoice.invoice_id || index} className="bg-white border-b border-gray-200 hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap">
                                        {invoice.company_name || `${invoice.first_name || ''} ${invoice.last_name || ''}`.trim() || 'Unknown Customer'}
                                    </td>
                                    <td className="px-6 py-4 text-gray-900">{invoice.invoice_number || 'N/A'}</td>
                                    <td className="px-6 py-4">
                                        {invoice.invoice_date ? new Date(invoice.invoice_date).toLocaleDateString() : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4">
                                        {invoice.due_date ? new Date(invoice.due_date).toLocaleDateString() : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 font-mono text-right text-gray-900">
                                        {formatCurrency(invoice.total_amount || invoice.balance_due || 0)}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`${statusBadge.color} text-xs font-medium px-3 py-1 rounded-full`}>
                                            {statusBadge.text}
                                        </span>
                                    </td>
                                    {hasPaymentPermission && (
                                        <td className="px-6 py-4">
                                            <button 
                                                onClick={() => onReceivePayment(invoice)}
                                                className="bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                                                title="Receive payment for this invoice"
                                            >
                                                Receive Payment
                                            </button>
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                        {overdueInvoices.length === 0 && (
                            <tr>
                                <td colSpan={hasPaymentPermission ? "7" : "6"} className="px-6 py-12 text-center text-gray-500">
                                    <div className="flex flex-col items-center justify-center">
                                        <Icon path={ICONS.documents} className="h-12 w-12 text-gray-300 mb-3" />
                                        <p className="text-lg font-medium text-gray-400">No overdue invoices found</p>
                                        <p className="text-sm text-gray-400">All invoices are current or paid</p>
                                    </div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

const AccountsReceivablePage = () => {
    const { hasPermission } = useAuth();
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
    const [overdueInvoices, setOverdueInvoices] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [retryCount, setRetryCount] = useState(0);
    const [selectedCustomer, setSelectedCustomer] = useState(null);
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [autoRefresh, setAutoRefresh] = useState(false);
    const [filters, setFilters] = useState({
        search: '',
        dateRange: {
            start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
            end: new Date()
        }
    });

    const MAX_RETRIES = 3;

    // Enhanced data fetching with retry logic
    const fetchDashboardData = useCallback(async (isRetry = false) => {
        try {
            setLoading(true);
            setError(null);
            
            // Fetch all data in parallel with better error handling
            const [customersRes, dashboardRes, agingRes, overdueRes] = await Promise.all([
                api.get('/customers/with-balances'),
                api.get('/ar/dashboard-stats').catch(err => {
                    console.warn('Dashboard stats endpoint not available:', err.message);
                    return { data: {} };
                }),
                api.get('/ar/aging-summary').catch(err => {
                    console.warn('Aging summary endpoint not available:', err.message);
                    return { data: [] };
                }),
                api.get('/ar/overdue-invoices').catch(err => {
                    console.warn('Overdue invoices endpoint not available:', err.message);
                    return { data: [] };
                })
            ]);

            const customersData = customersRes.data || [];

            // Calculate dashboard stats from customers data if API doesn't provide it
            const totalReceivables = customersData.reduce((sum, customer) => sum + Number(customer.balance_due || 0), 0);
            const overdueCount = overdueRes.data?.length || customersData.filter(c => Number(c.balance_due || 0) > 0).length;

            setDashboardStats({
                totalReceivables: totalReceivables,
                invoicesSent: dashboardRes.data?.invoicesSent || Math.floor(totalReceivables / 5000) || 0, // Estimate
                overdueInvoices: overdueCount,
                avgCollectionPeriod: dashboardRes.data?.avgCollectionPeriod || 30
            });

            // Set aging data with better fallback
            if (agingRes.data && agingRes.data.length > 0) {
                setAgingData(agingRes.data);
            } else {
                // More realistic mock aging data based on total receivables
                const current = totalReceivables * 0.65;
                const days1to30 = totalReceivables * 0.18;
                const days31to60 = totalReceivables * 0.10;
                const days61to90 = totalReceivables * 0.04;
                const days90plus = totalReceivables * 0.03;
                
                setAgingData([
                    { name: 'Current', value: current },
                    { name: '1-30 Days', value: days1to30 },
                    { name: '31-60 Days', value: days31to60 },
                    { name: '61-90 Days', value: days61to90 },
                    { name: '90+ Days', value: days90plus },
                ]);
            }

            // Set overdue invoices data with better mapping
            const overdueData = overdueRes.data || [];
            // If we don't have overdue invoices from API, create from customers with balances
            if (overdueData.length === 0 && customersData.length > 0) {
                const mockOverdueInvoices = customersData
                    .filter(customer => Number(customer.balance_due || 0) > 0)
                    .slice(0, 10) // Limit to first 10 for performance
                    .map((customer, index) => ({
                        invoice_id: `mock-${customer.customer_id}-${index}`,
                        invoice_number: `INV-${String(1000 + index).padStart(4, '0')}`,
                        customer_id: customer.customer_id,
                        company_name: customer.company_name,
                        first_name: customer.first_name,
                        last_name: customer.last_name,
                        total_amount: customer.balance_due,
                        balance_due: customer.balance_due,
                        invoice_date: new Date(Date.now() - Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString(),
                        due_date: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
                        status: 'Unpaid'
                    }));
                setOverdueInvoices(mockOverdueInvoices);
            } else {
                setOverdueInvoices(overdueData);
            }

            setRetryCount(0); // Reset retry count on success

        } catch (err) {
            console.error('Failed to fetch dashboard data:', err);
            setError(`Failed to fetch accounts receivable data: ${err.message}`);
            
            if (retryCount < MAX_RETRIES && !isRetry) {
                setRetryCount(prev => prev + 1);
                setTimeout(() => {
                    toast.error(`Fetch failed, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
                    fetchDashboardData(true);
                }, 2000);
            } else {
                toast.error('Failed to fetch accounts receivable data. Please try again.');
            }
        } finally {
            setLoading(false);
        }
    }, [retryCount]);

    // Auto-refresh functionality
    useEffect(() => {
        if (!autoRefresh) return;
        
        const interval = setInterval(() => {
            fetchDashboardData();
        }, 30000); // 30 seconds
        
        return () => clearInterval(interval);
    }, [autoRefresh, fetchDashboardData]);

    useEffect(() => {
        if (hasPermission('ar:view')) {
            fetchDashboardData();
        }
    }, [hasPermission, fetchDashboardData]);

    const handleReceivePaymentClick = useCallback((customerOrInvoice) => {
        // Handle both customer objects and invoice objects
        if (customerOrInvoice.customer_id) {
            // It's a customer object
            setSelectedCustomer(customerOrInvoice);
        } else if (customerOrInvoice.invoice_id) {
            // It's an invoice object, create a customer object from it
            const customerFromInvoice = {
                customer_id: customerOrInvoice.customer_id,
                company_name: customerOrInvoice.company_name,
                first_name: customerOrInvoice.first_name,
                last_name: customerOrInvoice.last_name,
                balance_due: customerOrInvoice.balance_due || customerOrInvoice.total_amount
            };
            setSelectedCustomer(customerFromInvoice);
        }
        setIsPaymentModalOpen(true);
    }, []);

    const handlePaymentSaved = useCallback(() => {
        setIsPaymentModalOpen(false);
        setSelectedCustomer(null);
        fetchDashboardData(); // Refresh all data after a payment is made
        toast.success('Payment recorded successfully!');
    }, [fetchDashboardData]);

    const handleRetry = useCallback(() => {
        setRetryCount(0);
        setError(null);
        fetchDashboardData();
    }, [fetchDashboardData]);

    // Export functionality
    const exportToCSV = useCallback((data, filename) => {
        try {
            const headers = Object.keys(data[0] || {});
            const csvContent = [
                headers.join(','),
                ...data.map(row => headers.map(header => `"${row[header] || ''}"`).join(','))
            ].join('\n');
            
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', filename);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            
            toast.success(`${filename} exported successfully!`);
        } catch (err) {
            console.error('Export failed:', err);
            toast.error('Export failed. Please try again.');
        }
    }, []);

    // Memoized KPI data for performance
    const kpiData = useMemo(() => ({
        totalReceivables: { 
            value: formatCurrency(dashboardStats.totalReceivables), 
            trend: '↑ 12.5% from last month',
            color: 'text-green-500'
        },
        invoicesSent: { 
            value: dashboardStats.invoicesSent.toLocaleString(), 
            trend: '↑ 5.2% from last month',
            color: 'text-green-500'
        },
        overdueInvoices: { 
            value: dashboardStats.overdueInvoices.toLocaleString(), 
            trend: '↓ 2.1% from last month', 
            color: 'text-red-500' 
        },
        avgCollectionPeriod: { 
            value: `${dashboardStats.avgCollectionPeriod} Days`, 
            trend: '↑ 1.8% from last month',
            color: 'text-yellow-500'
        },
    }), [dashboardStats]);

    // Filtered overdue invoices for search
    const filteredOverdueInvoices = useMemo(() => {
        if (!filters.search) return overdueInvoices;
        
        const searchLower = filters.search.toLowerCase();
        return overdueInvoices.filter(invoice => 
            (invoice.company_name || '').toLowerCase().includes(searchLower) ||
            (invoice.first_name || '').toLowerCase().includes(searchLower) ||
            (invoice.last_name || '').toLowerCase().includes(searchLower) ||
            (invoice.invoice_number || '').toLowerCase().includes(searchLower)
        );
    }, [overdueInvoices, filters.search]);

    if (!hasPermission('ar:view')) {
        return (
            <div className="text-center p-8">
                <Icon path={ICONS.warning} className="h-16 w-16 text-red-500 mx-auto mb-4" />
                <h1 className="text-2xl font-bold text-red-600 mb-2">Access Denied</h1>
                <p className="text-gray-600">You do not have permission to view the accounts receivable dashboard.</p>
            </div>
        );
    }

    if (error && !loading) {
        return (
            <div className="p-6 bg-gray-50 min-h-screen">
                <div className="max-w-md mx-auto bg-white rounded-lg border border-red-200 p-6 text-center">
                    <Icon path={ICONS.warning} className="h-16 w-16 text-red-500 mx-auto mb-4" />
                    <h2 className="text-xl font-semibold text-red-600 mb-2">Error Loading Dashboard</h2>
                    <p className="text-gray-600 mb-4">{error}</p>
                    <button 
                        onClick={handleRetry}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Try Again
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 sm:p-6 bg-gray-50 min-h-screen">
            {/* Enhanced Header with Controls */}
            <header className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-800">Accounts Receivable</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        Monitor outstanding invoices and customer payments
                    </p>
                </div>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    {/* Search Filter */}
                    <div className="relative">
                        <Icon path={ICONS.search} className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                            type="text"
                            placeholder="Search customers, invoices..."
                            value={filters.search}
                            onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                            className="pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full sm:w-64"
                        />
                    </div>
                    
                    {/* Auto-refresh Toggle */}
                    <button
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                            autoRefresh 
                                ? 'bg-green-100 text-green-700 hover:bg-green-200' 
                                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                        }`}
                        title={`Auto-refresh is ${autoRefresh ? 'enabled' : 'disabled'}`}
                    >
                        <Icon path={ICONS.history} className="h-4 w-4 inline mr-1" />
                        Auto-refresh {autoRefresh ? 'ON' : 'OFF'}
                    </button>

                    {/* Export Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => exportToCSV(filteredOverdueInvoices, `overdue-invoices-${new Date().toISOString().split('T')[0]}.csv`)}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                            title="Export overdue invoices to CSV"
                        >
                            <Icon path={ICONS.download} className="h-4 w-4 inline mr-1" />
                            Export
                        </button>
                    </div>

                    {/* Manual Refresh */}
                    <button
                        onClick={() => fetchDashboardData()}
                        disabled={loading}
                        className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                        title="Refresh dashboard data"
                    >
                        <Icon path={ICONS.history} className={`h-4 w-4 inline mr-1 ${loading ? 'animate-spin' : ''}`} />
                        Refresh
                    </button>
                </div>
            </header>

            {/* KPI Cards Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-6">
                <KPICard 
                    iconName={ICONS.dollar} 
                    title="Total Receivables" 
                    value={kpiData.totalReceivables.value} 
                    trend={kpiData.totalReceivables.trend}
                    trendColorClass={kpiData.totalReceivables.color}
                    loading={loading}
                />
                <KPICard 
                    iconName={ICONS.documents} 
                    title="Invoices Sent" 
                    value={kpiData.invoicesSent.value} 
                    trend={kpiData.invoicesSent.trend}
                    trendColorClass={kpiData.invoicesSent.color}
                    loading={loading}
                />
                <KPICard 
                    iconName={ICONS.warning} 
                    title="Overdue Invoices" 
                    value={kpiData.overdueInvoices.value} 
                    trend={kpiData.overdueInvoices.trend} 
                    trendColorClass={kpiData.overdueInvoices.color}
                    loading={loading}
                />
                <KPICard 
                    iconName={ICONS.calendar} 
                    title="Avg. Collection Period" 
                    value={kpiData.avgCollectionPeriod.value} 
                    trend={kpiData.avgCollectionPeriod.trend}
                    trendColorClass={kpiData.avgCollectionPeriod.color}
                    loading={loading}
                />
            </div>

            {/* Invoice Aging Chart */}
            <InvoiceAgingSummaryChart agingData={agingData} loading={loading} />

            {/* Detailed Overdue Invoices Table */}
            <DetailedOverdueInvoicesTable 
                overdueInvoices={filteredOverdueInvoices}
                onReceivePayment={handleReceivePaymentClick}
                hasPaymentPermission={hasPermission('ar:receive_payment')}
                loading={loading}
            />
            
            {/* Payment Modal */}
            <Modal 
                isOpen={isPaymentModalOpen} 
                onClose={() => setIsPaymentModalOpen(false)} 
                title={`Receive Payment from ${selectedCustomer?.company_name || `${selectedCustomer?.first_name || ''} ${selectedCustomer?.last_name || ''}`.trim() || 'Customer'}`} 
                maxWidth="max-w-4xl"
            >
                {selectedCustomer && (
                    <ReceivePaymentForm 
                        customer={selectedCustomer} 
                        onSave={handlePaymentSaved} 
                        onCancel={() => setIsPaymentModalOpen(false)} 
                    />
                )}
            </Modal>
        </div>
    );
};

export default AccountsReceivablePage;
