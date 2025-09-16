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

// Enhanced Loading Skeleton Components
// eslint-disable-next-line no-unused-vars
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

// eslint-disable-next-line no-unused-vars
const ChartSkeleton = () => (
    <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-48 mb-4"></div>
        <div className="w-full bg-gray-200 rounded-full h-8 mb-4"></div>
        <div className="flex justify-between">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="flex items-center gap-x-2">
                    <div className="w-3 h-3 rounded-full bg-gray-200"></div>
                    <div className="h-3 bg-gray-200 rounded w-16"></div>
                </div>
            ))}
        </div>
    </div>
);

// eslint-disable-next-line no-unused-vars
const TableSkeleton = () => (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
        <div className="p-6">
            <div className="h-6 bg-gray-200 rounded w-48"></div>
        </div>
        <div className="border-t border-gray-200">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="px-6 py-4 border-b border-gray-200">
                    <div className="grid grid-cols-6 gap-4">
                        <div className="h-4 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded"></div>
                        <div className="h-4 bg-gray-200 rounded"></div>
                    </div>
                </div>
            ))}
        </div>
    </div>
);

// A reusable KPI card component based on Dashboard.jsx styles
// eslint-disable-next-line no-unused-vars
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

// Export functionality
const exportToCSV = (data, filename) => {
    if (!data || data.length === 0) {
        toast.error('No data to export');
        return;
    }
    
    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => {
                const value = row[header];
                // Escape commas and quotes in CSV
                if (typeof value === 'string' && (value.includes(',') || value.includes('"'))) {
                    return `"${value.replace(/"/g, '""')}"`;
                }
                return value;
            }).join(',')
        )
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
};

// Invoice Aging Summary Chart Component
// eslint-disable-next-line no-unused-vars
const InvoiceAgingSummaryChart = ({ agingData, loading = false, onBucketClick }) => {
    if (loading) return <ChartSkeleton />;
    
    const total = agingData.reduce((sum, item) => sum + item.value, 0);

    // Use colors that match the existing design system (consistent with Dashboard.jsx)
    const colors = {
        'Current': 'bg-blue-500',
        '1-30 Days': 'bg-blue-400', 
        '31-60 Days': 'bg-yellow-400',
        '61-90 Days': 'bg-orange-400',
        '90+ Days': 'bg-red-500',
    };

    return (
        <div className="bg-white p-6 rounded-lg border border-gray-200 mb-6">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-semibold text-gray-800">Invoice Aging Summary</h2>
                <button 
                    onClick={() => exportToCSV(agingData, 'invoice-aging-summary.csv')}
                    className="text-sm px-3 py-1 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                >
                    Export
                </button>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-8 flex overflow-hidden">
                {agingData.map(item => (
                    <div
                        key={item.name}
                        className={`h-full ${colors[item.name]} transition-all duration-300 ease-in-out hover:opacity-80 cursor-pointer`}
                        style={{ width: `${total > 0 ? (item.value / total) * 100 : 0}%` }}
                        title={`${item.name}: ${formatCurrency(item.value)} (${total > 0 ? ((item.value / total) * 100).toFixed(1) : 0}%) - Click to view details`}
                        onClick={() => onBucketClick && onBucketClick(item.name)}
                    ></div>
                ))}
            </div>
            <div className="flex justify-between text-sm text-gray-600 mt-4 flex-wrap gap-2">
                {agingData.map(item => (
                    <div key={item.name} className="flex items-center gap-x-2">
                        <span className={`w-3 h-3 rounded-full ${colors[item.name]}`}></span>
                        <span className="whitespace-nowrap">{item.name}: {formatCurrency(item.value)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// Enhanced Status Badge Component for Customer Status with days calculation
const getCustomerStatusBadge = (customer) => {
    if (!customer.earliest_due_date) {
        return { text: 'No due date', color: 'bg-gray-100 text-gray-800' };
    }
    
    const dueDate = new Date(customer.earliest_due_date);
    const today = new Date();
    const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
    
    if (daysDiff < 0) {
        return { 
            text: `${Math.abs(daysDiff)} days overdue`, 
            color: 'bg-red-100 text-red-800' 
        };
    } else if (daysDiff === 0) {
        return { 
            text: 'Due today', 
            color: 'bg-orange-100 text-orange-800' 
        };
    } else if (daysDiff <= 7) {
        return { 
            text: `${daysDiff} days remaining`, 
            color: 'bg-yellow-100 text-yellow-800' 
        };
    } else {
        return { 
            text: `${daysDiff} days remaining`, 
            color: 'bg-green-100 text-green-800' 
        };
    }
};

// Customer Summary Table Component
const CustomerSummaryTable = ({ 
    customers, 
    onCustomerClick, 
    onReceivePayment, 
    hasPaymentPermission, 
    loading = false,
    onExport 
}) => {
    if (loading) return <TableSkeleton />;
    
    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-6 flex items-center justify-between">
                <h2 className="text-xl font-semibold text-gray-800">Customer Accounts Receivable</h2>
                <div className="flex gap-2">
                    <button 
                        onClick={onExport}
                        className="text-sm px-3 py-1 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        Export CSV
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                        <tr>
                            <th scope="col" className="px-6 py-3">Customer</th>
                            <th scope="col" className="px-6 py-3">Invoice Count</th>
                            <th scope="col" className="px-6 py-3">Next Due Date</th>
                            <th scope="col" className="px-6 py-3">Total Balance</th>
                            <th scope="col" className="px-6 py-3">Status</th>
                            {hasPaymentPermission && <th scope="col" className="px-6 py-3">Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {customers.map((customer, index) => {
                            const statusBadge = getCustomerStatusBadge(customer.status);
                            return (
                                <tr 
                                    key={customer.customer_id || index} 
                                    className="bg-white border-b hover:bg-gray-50 transition-colors"
                                >
                                    <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap cursor-pointer hover:text-blue-600"
                                        onClick={() => onCustomerClick(customer)}>
                                        {customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim()}
                                    </td>
                                    <td className="px-6 py-4 text-center cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        {customer.invoice_count}
                                    </td>
                                    <td className="px-6 py-4 cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        {customer.earliest_due_date ? new Date(customer.earliest_due_date).toLocaleDateString() : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 font-mono font-medium cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        {formatCurrency(customer.total_balance_due)}
                                    </td>
                                    <td className="px-6 py-4 cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        <span className={`text-xs font-medium px-3 py-1 rounded-full ${statusBadge.color}`}>
                                            {statusBadge.text}
                                        </span>
                                    </td>
                                    {hasPaymentPermission && (
                                        <td className="px-6 py-4">
                                            {Number(customer.total_balance_due) > 0 && (
                                                <button 
                                                    onClick={() => onReceivePayment(customer)}
                                                    className="bg-green-600 text-white px-3 py-1 rounded-lg text-xs font-semibold hover:bg-green-700 transition-colors"
                                                >
                                                    Receive Payment
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                        {customers.length === 0 && (
                            <tr>
                                <td colSpan="5" className="px-6 py-8 text-center text-gray-500">
                                    No customers with outstanding balances found
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
    
    // State management
    // eslint-disable-next-line no-unused-vars
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
    const [retryCount, setRetryCount] = useState(0);
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

    const MAX_RETRIES = 3;

    // Handle date range changes
    const handleDateRangeChange = useCallback((newDateRange) => {
        setDateRange(newDateRange);
    }, []);

    // Handle drill-down into aging buckets
    const handleAgingBucketClick = useCallback(async (bucketName) => {
        try {
            setDrillDownLoading(true);
            setSelectedAgingBucket(bucketName);
            
            // Map bucket names to API parameters
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
                bucket: bucketParam
            };
            
            const response = await api.get('/ar/drill-down-invoices', { params: dateParams });
            setDrillDownInvoices(response.data || []);
            
        } catch (error) {
            console.error('Failed to fetch drill-down invoices:', error);
            toast.error('Failed to load invoice details');
        } finally {
            setDrillDownLoading(false);
        }
    }, [dateRange]);

    // Enhanced data fetching with retry logic
    const fetchDashboardData = useCallback(async (isRetry = false) => {
        try {
            setLoading(true);
            
            const dateParams = {
                startDate: dateRange.startDate.toISOString(),
                endDate: dateRange.endDate.toISOString()
            };
            
            // Fetch all data in parallel with proper error handling
            const [customersRes, dashboardRes, agingRes, customerSummaryRes, trendsRes] = await Promise.all([
                api.get('/customers/with-balances'),
                api.get('/ar/dashboard-stats', { params: dateParams }).catch(() => ({ data: {} })),
                api.get('/ar/aging-summary').catch(() => ({ data: [] })),
                api.get('/ar/customer-summary').catch(() => ({ data: [] })),
                api.get('/ar/trends').catch(() => ({ data: {} }))
            ]);

            setCustomers(customersRes.data || []);
            setTrends(trendsRes.data || {});

            // Use API data if available, otherwise calculate from customers data
            if (dashboardRes.data && Object.keys(dashboardRes.data).length > 0) {
                setDashboardStats(dashboardRes.data);
            } else {
                // Fallback calculation from customers data
                const totalReceivables = customersRes.data.reduce((sum, customer) => sum + Number(customer.balance_due || 0), 0);
                const overdueCount = customerSummaryRes.data.length || customersRes.data.filter(c => Number(c.balance_due || 0) > 0).length;

                setDashboardStats({
                    totalReceivables: totalReceivables,
                    invoicesSent: 0, // Can't calculate without proper API
                    overdueInvoices: overdueCount,
                    avgCollectionPeriod: 30 // Default fallback
                });
            }

            // Set aging data
            if (agingRes.data && agingRes.data.length > 0) {
                setAgingData(agingRes.data);
            } else {
                // Calculate mock aging data based on total receivables
                const totalReceivables = dashboardStats.totalReceivables || customersRes.data.reduce((sum, customer) => sum + Number(customer.balance_due || 0), 0);
                const current = totalReceivables * 0.6;
                const days1to30 = totalReceivables * 0.2;
                const days31to60 = totalReceivables * 0.1;
                const days61to90 = totalReceivables * 0.05;
                const days90plus = totalReceivables * 0.05;
                
                setAgingData([
                    { name: 'Current', value: current },
                    { name: '1-30 Days', value: days1to30 },
                    { name: '31-60 Days', value: days31to60 },
                    { name: '61-90 Days', value: days61to90 },
                    { name: '90+ Days', value: days90plus },
                ]);
            }

            // Set customer summary data
            setCustomerSummary(customerSummaryRes.data || []);
            setRetryCount(0); // Reset retry count on success

        } catch (err) {
            console.error('Failed to fetch dashboard data:', err);
            
            if (retryCount < MAX_RETRIES && !isRetry) {
                setRetryCount(prev => prev + 1);
                toast.error(`Fetch failed, retrying... (${retryCount + 1}/${MAX_RETRIES})`);
                setTimeout(() => fetchDashboardData(true), 2000);
            } else {
                toast.error('Failed to fetch accounts receivable data.');
            }
        } finally {
            setLoading(false);
        }
    }, [dateRange, retryCount, dashboardStats.totalReceivables]);

    // Auto-refresh functionality
    useEffect(() => {
        if (!autoRefresh) return;
        
        const interval = setInterval(() => {
            fetchDashboardData();
        }, 30000); // 30 seconds
        
        return () => clearInterval(interval);
    }, [autoRefresh, fetchDashboardData]);

    // Initial data fetch
    useEffect(() => {
        if (hasPermission('ar:view')) {
            fetchDashboardData();
        }
    }, [hasPermission, fetchDashboardData]);

    // Handle customer click to show invoice details
    const handleCustomerClick = useCallback(async (customer) => {
        try {
            setCustomerInvoicesLoading(true);
            setSelectedCustomerForInvoices(customer);
            
            const response = await api.get(`/ar/customer-invoices/${customer.customer_id}`);
            // Filter only payable invoices (balance_due > 0)
            const payableInvoices = response.data.filter(invoice => Number(invoice.balance_due) > 0) || [];
            setCustomerInvoices(payableInvoices);
            
        } catch (error) {
            console.error('Failed to fetch customer invoices:', error);
            toast.error('Failed to load customer invoice details');
        } finally {
            setCustomerInvoicesLoading(false);
        }
    }, []);

    // Handle receive payment for individual invoices
    const handleReceivePaymentClick = useCallback((invoice) => {
        // Handle both customer objects and invoice objects
        if (invoice.invoice_id) {
            // This is an invoice, find/create customer object
            const customer = {
                customer_id: invoice.customer_id,
                company_name: invoice.company_name,
                first_name: invoice.first_name,
                last_name: invoice.last_name
            };
            setSelectedCustomer(customer);
        } else {
            // This is already a customer object
            setSelectedCustomer(invoice);
        }
        setIsPaymentModalOpen(true);
    }, []);

    const handlePaymentSaved = useCallback(() => {
        setIsPaymentModalOpen(false);
        fetchDashboardData(); // Refresh all data after a payment is made
        toast.success('Payment processed successfully!');
    }, [fetchDashboardData]);

    // Export handlers
    const handleExportCustomerSummary = useCallback(() => {
        const exportData = customerSummary.map(customer => ({
            'Customer': customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
            'Total Balance': customer.total_balance_due,
            'Next Due Date': customer.earliest_due_date ? new Date(customer.earliest_due_date).toLocaleDateString() : 'N/A',
            'Status': customer.status,
            'Invoice Count': customer.invoice_count
        }));
        exportToCSV(exportData, `customer-ar-summary-${new Date().toISOString().split('T')[0]}.csv`);
    }, [customerSummary]);


    const kpiData = useMemo(() => {
        const receivablesTrend = trends.receivables_change_percent !== undefined 
            ? { text: `${trends.receivables_change_percent > 0 ? '↑' : '↓'} ${Math.abs(trends.receivables_change_percent)}% from last month`, color: trends.receivables_change_percent > 0 ? 'text-red-500' : 'text-green-500' }
            : { text: '↑ 12.5% from last month', color: 'text-red-500' };

        const overdueTrend = trends.overdue_change_percent !== undefined
            ? { text: `${trends.overdue_change_percent > 0 ? '↑' : '↓'} ${Math.abs(trends.overdue_change_percent)}% from last month`, color: trends.overdue_change_percent > 0 ? 'text-red-500' : 'text-green-500' }
            : { text: '↓ 2.1% from last month', color: 'text-green-500' };

        return {
            totalReceivables: { 
                value: formatCurrency(dashboardStats.totalReceivables), 
                trend: receivablesTrend.text,
                color: receivablesTrend.color
            },
            invoicesSent: { 
                value: dashboardStats.invoicesSent.toLocaleString(), 
                trend: '↑ 5.2% from last month',
                color: 'text-green-500'
            },
            overdueInvoices: { 
                value: dashboardStats.overdueInvoices.toLocaleString(), 
                trend: overdueTrend.text,
                color: overdueTrend.color
            },
            avgCollectionPeriod: { 
                value: `${dashboardStats.avgCollectionPeriod} Days`, 
                trend: '↑ 1.8% from last month',
                color: 'text-orange-500'
            },
        };
    }, [dashboardStats, trends]);

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
            <header className="mb-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <h1 className="text-3xl font-bold text-gray-800">Accounts Receivable</h1>
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                    <button 
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        className={`px-3 py-2 text-sm rounded-md border transition-colors ${
                            autoRefresh 
                                ? 'bg-green-100 text-green-800 border-green-300' 
                                : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                    >
                        Auto-refresh: {autoRefresh ? 'ON' : 'OFF'}
                    </button>
                    <button 
                        onClick={() => fetchDashboardData()}
                        disabled={loading}
                        className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 text-sm transition-colors"
                    >
                        {loading ? 'Refreshing...' : 'Refresh'}
                    </button>
                </div>
            </header>

            {/* Date Range Picker */}
            <div className="bg-white p-4 rounded-lg border border-gray-200 mb-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="flex items-center gap-2">
                        <Icon path={ICONS.calendar} className="h-5 w-5 text-gray-500" />
                        <span className="text-sm font-medium text-gray-700">Date Range:</span>
                    </div>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 w-full sm:w-auto">
                        <div className="flex items-center gap-2">
                            <label htmlFor="startDate" className="text-sm text-gray-600">From:</label>
                            <input
                                id="startDate"
                                type="date"
                                value={dateRange.startDate.toISOString().split('T')[0]}
                                onChange={(e) => handleDateRangeChange({
                                    ...dateRange,
                                    startDate: new Date(e.target.value)
                                })}
                                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <div className="flex items-center gap-2">
                            <label htmlFor="endDate" className="text-sm text-gray-600">To:</label>
                            <input
                                id="endDate"
                                type="date"
                                value={dateRange.endDate.toISOString().split('T')[0]}
                                onChange={(e) => handleDateRangeChange({
                                    ...dateRange,
                                    endDate: new Date(e.target.value)
                                })}
                                className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                            />
                        </div>
                        <button
                            onClick={() => handleDateRangeChange({
                                startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
                                endDate: new Date()
                            })}
                            className="px-3 py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors"
                        >
                            Last 30 Days
                        </button>
                        <button
                            onClick={() => handleDateRangeChange({
                                startDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
                                endDate: new Date()
                            })}
                            className="px-3 py-2 text-sm text-blue-600 hover:text-blue-800 hover:bg-blue-50 rounded-md transition-colors"
                        >
                            Last 90 Days
                        </button>
                    </div>
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
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
            <InvoiceAgingSummaryChart 
                agingData={agingData} 
                loading={loading} 
                onBucketClick={handleAgingBucketClick}
            />

            {/* Customer Summary Table */}
            <CustomerSummaryTable 
                customers={customerSummary}
                onCustomerClick={handleCustomerClick}
                onReceivePayment={handleReceivePaymentClick}
                hasPaymentPermission={hasPermission('ar:receive_payment')}
                loading={loading}
                onExport={handleExportCustomerSummary}
            />

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
                                            <td className="p-3 text-sm">
                                                {invoice.company_name || `${invoice.first_name || ''} ${invoice.last_name || ''}`.trim()}
                                            </td>
                                            <td className="p-3 text-sm">
                                                {new Date(invoice.invoice_date).toLocaleDateString()}
                                            </td>
                                            <td className="p-3 text-sm">
                                                {new Date(invoice.due_date).toLocaleDateString()}
                                            </td>
                                            <td className="p-3 text-sm text-right font-mono">
                                                {formatCurrency(invoice.total_amount)}
                                            </td>
                                            <td className="p-3 text-sm text-right font-mono font-medium">
                                                {formatCurrency(invoice.balance_due)}
                                            </td>
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
            <Modal
                isOpen={customerInvoices.length > 0}
                onClose={() => setCustomerInvoices([])}
                title={`Payable Invoices for ${selectedCustomerForInvoices?.company_name || `${selectedCustomerForInvoices?.first_name || ''} ${selectedCustomerForInvoices?.last_name || ''}`.trim()}`}
                maxWidth="max-w-6xl"
            >
                <div className="space-y-4">
                    {customerInvoicesLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                            <span className="ml-2 text-gray-600">Loading customer invoices...</span>
                        </div>
                    ) : customerInvoices.length === 0 ? (
                        <div className="text-center py-8 text-gray-500">
                            No payable invoices found for this customer.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200">
                                    <tr>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Invoice #</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Invoice Date</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Due Date</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Amount</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-right">Balance Due</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 text-center">Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {customerInvoices.map(invoice => {
                                        const dueDate = new Date(invoice.due_date);
                                        const today = new Date();
                                        const daysDiff = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));
                                        
                                        let statusText, statusColor;
                                        if (daysDiff < 0) {
                                            statusText = `${Math.abs(daysDiff)} days overdue`;
                                            statusColor = 'bg-red-100 text-red-800';
                                        } else if (daysDiff === 0) {
                                            statusText = 'Due today';
                                            statusColor = 'bg-orange-100 text-orange-800';
                                        } else {
                                            statusText = `${daysDiff} days remaining`;
                                            statusColor = 'bg-green-100 text-green-800';
                                        }
                                        
                                        return (
                                            <tr key={invoice.invoice_id} className="border-b border-gray-200 hover:bg-gray-50 transition-colors">
                                                <td className="p-3 text-sm font-mono">{invoice.invoice_number}</td>
                                                <td className="p-3 text-sm">
                                                    {new Date(invoice.invoice_date).toLocaleDateString()}
                                                </td>
                                                <td className="p-3 text-sm">
                                                    {dueDate.toLocaleDateString()}
                                                </td>
                                                <td className="p-3 text-sm text-right font-mono">
                                                    {formatCurrency(invoice.total_amount)}
                                                </td>
                                                <td className="p-3 text-sm text-right font-mono font-medium">
                                                    {formatCurrency(invoice.balance_due)}
                                                </td>
                                                <td className="p-3 text-sm text-center">
                                                    <span className={`px-2 py-1 rounded-full text-xs font-medium ${statusColor}`}>
                                                        {statusText}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </Modal>
        </div>
    );
};

export default AccountsReceivablePage;
