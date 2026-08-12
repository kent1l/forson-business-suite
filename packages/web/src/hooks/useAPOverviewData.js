import { useCallback, useEffect, useState } from 'react';
import api from '../api';

/**
 * Data + handlers for the AP page's Overview & Aging tab: KPI stats, the aging
 * bucket chart, and the paginated/searchable/sortable supplier summary table.
 * Structural mirror of useAROverviewData.js, pointed at the /ap/* endpoints.
 */
const useAPOverviewData = ({ hasPermission }) => {
    const [loading, setLoading] = useState(true);
    const [overviewError, setOverviewError] = useState('');
    const [kpiData, setKpiData] = useState(null);
    const [agingData, setAgingData] = useState([]);

    const [supplierSummary, setSupplierSummary] = useState([]);
    const [supplierSummarySearchTerm, setSupplierSummarySearchTerm] = useState('');
    const [supplierSummaryStatusFilter, setSupplierSummaryStatusFilter] = useState('ALL');
    const [supplierSummarySortConfig, setSupplierSummarySortConfig] = useState({ key: 'bill_count', direction: 'DESC' });
    const [supplierSummaryPage, setSupplierSummaryPage] = useState(1);
    const [supplierSummaryPageSize, setSupplierSummaryPageSize] = useState(25);
    const [supplierSummaryTotal, setSupplierSummaryTotal] = useState(0);

    const [selectedAgingBucket, setSelectedAgingBucket] = useState(null);
    const [selectedSupplierId, setSelectedSupplierId] = useState(null);

    const fetchDashboardData = useCallback(async () => {
        if (!hasPermission('ap:view')) return;
        setLoading(true);
        setOverviewError('');
        try {
            const [statsRes, agingRes] = await Promise.all([
                api.get('/ap/summary-stats'),
                api.get('/ap/aging-summary'),
            ]);
            setKpiData(statsRes.data);
            setAgingData(agingRes.data || []);
        } catch {
            setOverviewError('Failed to load AP overview data.');
        } finally {
            setLoading(false);
        }
    }, [hasPermission]);

    const fetchSupplierSummary = useCallback(async () => {
        if (!hasPermission('ap:view')) return;
        try {
            const response = await api.get('/ap/supplier-summary', {
                params: {
                    paginated: 1,
                    page: supplierSummaryPage,
                    pageSize: supplierSummaryPageSize,
                    search: supplierSummarySearchTerm,
                    status: supplierSummaryStatusFilter === 'ALL' ? undefined : supplierSummaryStatusFilter,
                    sortBy: supplierSummarySortConfig.key,
                    sortDir: supplierSummarySortConfig.direction,
                }
            });
            setSupplierSummary(response.data?.data || []);
            setSupplierSummaryTotal(response.data?.total || 0);
        } catch {
            setOverviewError('Failed to load supplier summary.');
        }
    }, [hasPermission, supplierSummaryPage, supplierSummaryPageSize, supplierSummarySearchTerm, supplierSummaryStatusFilter, supplierSummarySortConfig]);

    useEffect(() => { fetchDashboardData(); }, [fetchDashboardData]);
    useEffect(() => { fetchSupplierSummary(); }, [fetchSupplierSummary]);

    const handleAgingBucketClick = useCallback((bucketName) => {
        setSelectedAgingBucket(bucketName);
    }, []);

    const handleCloseDrillDown = useCallback(() => setSelectedAgingBucket(null), []);

    const handleSupplierClick = useCallback((supplier) => {
        setSelectedSupplierId(supplier.supplier_id);
    }, []);

    const handleCloseSupplierDrawer = useCallback(() => setSelectedSupplierId(null), []);

    return {
        loading,
        overviewError,
        kpiData,
        agingData,
        onBucketClick: handleAgingBucketClick,
        selectedAgingBucket,
        onCloseDrillDown: handleCloseDrillDown,
        supplierSummary,
        supplierSummarySearchTerm,
        setSupplierSummarySearchTerm,
        supplierSummaryStatusFilter,
        setSupplierSummaryStatusFilter,
        supplierSummarySortConfig,
        setSupplierSummarySortConfig,
        supplierSummaryPage,
        setSupplierSummaryPage,
        supplierSummaryPageSize,
        setSupplierSummaryPageSize,
        supplierSummaryTotal,
        selectedSupplierId,
        onSupplierClick: handleSupplierClick,
        onCloseSupplierDrawer: handleCloseSupplierDrawer,
        fetchDashboardData,
        fetchSupplierSummary,
    };
};

export default useAPOverviewData;
