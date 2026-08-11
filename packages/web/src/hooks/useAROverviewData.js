import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import { formatCurrency } from '../utils/currency';
import { exportToCSV } from '../utils/csv';

// Owns all state/data-fetching for the AR "Overview & Aging" tab: dashboard KPIs,
// aging buckets + drill-down, customer summary table, and the receive-payment modal.
// `customers` is lifted to the page since the Ledger/SOA tab also reads it.
export default function useAROverviewData({ dateRange, hasPermission, activeTab, setCustomers }) {
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

            const params = { bucket: bucketParam, page, pageSize, paginated: 1 };

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
    }, [dateRange, fetchCustomerSummary, setCustomers]);

    useEffect(() => {
        if (hasPermission('ar:view') && activeTab === 'overview') {
            fetchDashboardData();
        }
    }, [activeTab, hasPermission, fetchDashboardData]);

    useEffect(() => {
        if (hasPermission('ar:view') && activeTab === 'overview') {
            fetchCustomerSummary();
        }
    }, [activeTab, hasPermission, fetchCustomerSummary]);

    const fetchCustomerInvoices = useCallback(async (customerId, page = customerInvoicesPage, pageSize = customerInvoicesPageSize) => {
        if (!customerId) return;
        try {
            setCustomerInvoicesLoading(true);
            const res = await api.get(`/ar/customer-invoices/${customerId}`, {
                params: { page, pageSize, paginated: 1 }
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

    // Base payment-saved handler: refreshes this tab's own data only. The page
    // composes this with the wallet tab's refresh (payments can affect wallet
    // balance too) since that's a genuine cross-tab concern.
    const handlePaymentSaved = useCallback(() => {
        setIsPaymentModalOpen(false);
        fetchDashboardData();
        toast.success('Payment processed successfully!');
    }, [fetchDashboardData]);

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

    const kpiData = useMemo(() => ({
        totalReceivables: { value: formatCurrency(dashboardStats.totalReceivables), trend: 'Authoritative Ledger Balance', color: 'text-blue-600' },
        invoicesSent: { value: (dashboardStats.invoicesSent || 0).toLocaleString(), trend: 'Active Receivables Count', color: 'text-green-500' },
        overdueInvoices: { value: (dashboardStats.overdueInvoices || 0).toLocaleString(), trend: 'Requires Attention', color: 'text-red-500' },
        avgCollectionPeriod: { value: `${dashboardStats.avgCollectionPeriod || 30} Days`, trend: 'Standard Payment Terms', color: 'text-amber-500' },
    }), [dashboardStats]);

    return {
        customerSummary, dashboardStats, agingData, loading, overviewError,
        selectedCustomer, isPaymentModalOpen, setIsPaymentModalOpen,
        selectedAgingBucket, drillDownInvoices, drillDownLoading,
        customerInvoices, customerInvoicesLoading, selectedCustomerForInvoices,
        customerInvoicesPage, customerInvoicesPageSize, customerInvoicesTotal,
        setCustomerInvoicesPage, setCustomerInvoicesPageSize,
        customerSummaryPage, customerSummaryPageSize, customerSummaryTotal,
        setCustomerSummaryPage, setCustomerSummaryPageSize,
        customerSummarySearchTerm, setCustomerSummarySearchTerm,
        customerSummaryStatusFilter, setCustomerSummaryStatusFilter,
        customerSummarySortConfig, setCustomerSummarySortConfig,
        drillDownPage, drillDownPageSize, drillDownTotal,
        setDrillDownPage, setDrillDownPageSize,
        kpiData,
        fetchDashboardData,
        handleAgingBucketClick, handleCloseDrillDown,
        handleCustomerClick, handleCloseCustomerInvoices,
        handleReceivePaymentClick, handleReceivePaymentFromDrillDown,
        handlePaymentSaved, handleExportCustomerSummary,
    };
}
