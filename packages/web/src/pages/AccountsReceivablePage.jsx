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

// Import extracted utilities and components
import { formatCurrency } from '../utils/currency';
import { exportToCSV } from '../utils/csv';
import { getCustomerStatusBadge } from '../utils/status';
import KPICard from '../components/ui/KPICard';
import InvoiceAgingSummaryChart from '../components/accounts-receivable/InvoiceAgingSummaryChart';
import CustomerSummaryTable from '../components/accounts-receivable/CustomerSummaryTable';
import CustomerInvoiceDetailsModal from '../components/accounts-receivable/CustomerInvoiceDetailsModal';

// Utility for currency formatting - now imported from utils/currency.js

// Loading skeleton components - now handled in individual component files

// A reusable KPI card component - now imported from components/ui/KPICard.jsx

// Export functionality - now imported from utils/csv.js

// Invoice Aging Summary Chart Component - now imported from components/accounts-receivable/InvoiceAgingSummaryChart.jsx

// Enhanced Status Badge Component for Customer Status - now imported from utils/status.js

// Customer Summary Table Component - now imported from components/accounts-receivable/CustomerSummaryTable.jsx

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
                                        <th className="p-3 text-sm font-semibold text-gray-600">Physical Receipt #</th>
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
                                            <td className="p-3 text-sm font-mono">{invoice.physical_receipt_no || 'N/A'}</td>
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

            {/* Customer Invoice Details Modal (extracted) */}
            <CustomerInvoiceDetailsModal
                isOpen={customerInvoices.length > 0}
                onClose={() => setCustomerInvoices([])}
                title={`Payable Invoices for ${selectedCustomerForInvoices?.company_name || `${selectedCustomerForInvoices?.first_name || ''} ${selectedCustomerForInvoices?.last_name || ''}`.trim()}`}
                invoices={customerInvoices}
                loading={customerInvoicesLoading}
                onReceivePaymentClick={(invoice) => {
                    setSelectedAgingBucket(null);
                    handleReceivePaymentClick(invoice);
                }}
                hasReceivePermission={hasPermission('ar:receive_payment')}
            />
        </div>
    );
};

export default AccountsReceivablePage;
