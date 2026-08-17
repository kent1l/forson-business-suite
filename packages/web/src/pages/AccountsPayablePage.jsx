import { useCallback, useMemo, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import KPICard from '../components/ui/KPICard';
import PaginationControls from '../components/ui/PaginationControls';
import ErrorBoundary from '../components/ui/ErrorBoundary';
import BillAgingSummaryChart from '../components/accounts-payable/BillAgingSummaryChart';
import SupplierSummaryTable from '../components/accounts-payable/SupplierSummaryTable';
import SupplierDetailDrawer from '../components/suppliers/SupplierDetailDrawer';
import AddPayableModal from '../components/accounts-payable/AddPayableModal';
import useAPOverviewData from '../hooks/useAPOverviewData';

const OverviewTab = ({ overview, onOpenSupplier }) => {
    const kpi = overview.kpiData || {};
    return (
        <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KPICard icon="currency" title="Total Payables" value={kpi.totalPayables || 0} isMonetary color="blue" loading={overview.loading} />
                <KPICard icon="warning" title="Overdue" value={kpi.overdueAmount || 0} isMonetary subtitle={`${kpi.overdueCount || 0} bill(s)`} color="red" urgent={(kpi.overdueCount || 0) > 0} loading={overview.loading} />
                <KPICard icon="receipt" title="Due Next 7 Days" value={kpi.dueNext7Amount || 0} isMonetary subtitle={`${kpi.dueNext7Count || 0} bill(s)`} color="amber" loading={overview.loading} />
                <KPICard icon="package" title="Suppliers On Hold" value={kpi.suppliersOnHold || 0} color="purple" loading={overview.loading} />
            </div>

            <BillAgingSummaryChart agingData={overview.agingData} loading={overview.loading} onBucketClick={overview.onBucketClick} />

            <SupplierSummaryTable
                suppliers={overview.supplierSummary}
                onSupplierClick={onOpenSupplier}
                loading={overview.loading}
                searchTerm={overview.supplierSummarySearchTerm}
                onSearchChange={(val) => { overview.setSupplierSummarySearchTerm(val); overview.setSupplierSummaryPage(1); }}
                statusFilter={overview.supplierSummaryStatusFilter}
                onStatusFilterChange={(val) => { overview.setSupplierSummaryStatusFilter(val); overview.setSupplierSummaryPage(1); }}
                sortConfig={overview.supplierSummarySortConfig}
                onSortChange={(cfg) => { overview.setSupplierSummarySortConfig(cfg); overview.setSupplierSummaryPage(1); }}
            />
            <PaginationControls
                page={overview.supplierSummaryPage}
                pageSize={overview.supplierSummaryPageSize}
                total={overview.supplierSummaryTotal}
                onPageChange={overview.setSupplierSummaryPage}
                onPageSizeChange={(value) => { overview.setSupplierSummaryPageSize(value); overview.setSupplierSummaryPage(1); }}
            />
        </div>
    );
};

const AccountsPayablePage = ({ onNavigate }) => {
    const { hasPermission } = useAuth();
    const [activeTab, setActiveTab] = useState('overview');
    const [selectedSupplier, setSelectedSupplier] = useState(null);
    const [isAddPayableOpen, setIsAddPayableOpen] = useState(false);

    const overview = useAPOverviewData({ hasPermission });

    const handleOpenSupplier = useCallback((supplier) => setSelectedSupplier(supplier), []);
    const handleCloseSupplier = useCallback(() => setSelectedSupplier(null), []);
    const handleSupplierUpdated = useCallback((updated) => {
        setSelectedSupplier((prev) => prev ? { ...prev, ...updated } : prev);
        overview.fetchSupplierSummary();
    }, [overview]);

    const handleRefresh = useCallback(() => {
        overview.fetchDashboardData();
        overview.fetchSupplierSummary();
    }, [overview]);

    const tabs = useMemo(() => ([
        { key: 'overview', label: 'Overview & Aging' },
    ]), []);

    if (!hasPermission('ap:view')) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-danger-600 dark:text-danger-400">Access Denied</h1>
                <p className="text-gray-600 dark:text-slate-400 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-slate-100">Accounts Payable</h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                        Monitor supplier balances, bill aging, and upcoming due dates.
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1">
                        <button
                            onClick={() => onNavigate && onNavigate('cheques_treasury')}
                            className="px-4 py-2 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 rounded-md hover:bg-gray-50 dark:hover:bg-slate-700 text-sm transition-colors font-medium flex items-center gap-1.5"
                        >
                            Outbound Cheques &amp; Treasury <Icon path={ICONS.chevronDown} className="w-3.5 h-3.5 -rotate-90" />
                        </button>
                        <InfoTip label="Outbound Cheques & Treasury">
                            This is the only way to pay a supplier — there's no separate cash or bank-transfer payment form. Issuing and applying an outbound cheque to a supplier's bills happens here.
                        </InfoTip>
                    </span>
                    {hasPermission('ap:manage') && (
                        <button
                            onClick={() => setIsAddPayableOpen(true)}
                            className="px-4 py-2 bg-success-600 text-white rounded-md hover:bg-success-700 text-sm transition-colors font-medium flex items-center gap-1.5"
                        >
                            <Icon path={ICONS.plus} className="w-4 h-4" /> New Payable
                        </button>
                    )}
                    <button
                        onClick={handleRefresh}
                        disabled={overview.loading}
                        className="px-4 py-2 bg-primary-600 text-white rounded-md hover:bg-primary-700 disabled:opacity-50 text-sm transition-colors font-medium flex items-center gap-1.5"
                    >
                        <Icon path={ICONS.refresh} className="w-4 h-4" /> Refresh
                    </button>
                </div>
            </header>

            <div className="border-b border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 rounded-xl shadow-xs px-4 pt-2">
                <SegmentedTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
            </div>

            <ErrorBoundary title="Overview & Aging tab failed to load" description="Try refreshing the page.">
                {activeTab === 'overview' && (
                    <OverviewTab overview={overview} onOpenSupplier={handleOpenSupplier} />
                )}
            </ErrorBoundary>

            <SupplierDetailDrawer
                supplier={selectedSupplier}
                isOpen={!!selectedSupplier}
                onClose={handleCloseSupplier}
                onSupplierUpdated={handleSupplierUpdated}
                initialTab="bills"
            />

            <AddPayableModal
                isOpen={isAddPayableOpen}
                onClose={() => setIsAddPayableOpen(false)}
                onCreated={handleRefresh}
            />
        </div>
    );
};

export default AccountsPayablePage;
