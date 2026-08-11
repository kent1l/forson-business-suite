import { useState, useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

import AROverviewTab from '../components/accounts-receivable/tabs/AROverviewTab';
import ARLedgerSoaTab from '../components/accounts-receivable/tabs/ARLedgerSoaTab';
import ARWalletTab from '../components/accounts-receivable/tabs/ARWalletTab';
import ErrorBoundary from '../components/ui/ErrorBoundary';
import DateRangeShortcuts from '../components/ui/DateRangeShortcuts';

import useAROverviewData from '../hooks/useAROverviewData';
import useARLedgerSoa from '../hooks/useARLedgerSoa';
import useARWallet from '../hooks/useARWallet';

const AccountsReceivablePage = () => {
    const { hasPermission } = useAuth();

    const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'ledger_soa' | 'wallet'

    // Shared across tabs: the customer list (Overview fetches it, Ledger/SOA
    // reuses it for its search combobox) and the statement/report date range.
    const [customers, setCustomers] = useState([]);
    const [dateRange, setDateRange] = useState({
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
        endDate: new Date()
    });

    const handleDateRangeChange = useCallback((newDateRange) => {
        setDateRange(newDateRange);
    }, []);

    const handleDatePreset = useCallback((range) => {
        setDateRange({ startDate: new Date(range.startDate), endDate: new Date(range.endDate) });
    }, []);

    const overview = useAROverviewData({ dateRange, hasPermission, activeTab, setCustomers });
    const ledgerSoa = useARLedgerSoa({ dateRange, customers, setCustomers, activeTab });
    const wallet = useARWallet({ hasPermission, activeTab });

    // Cross-tab concerns the page still coordinates: a payment can move both
    // AR balance (Overview) and store-credit balance (Wallet), and a wallet
    // adjustment can move AR balance too.
    const handlePaymentSaved = useCallback(() => {
        overview.handlePaymentSaved();
        if (activeTab === 'wallet') wallet.fetchWalletCustomers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [overview.handlePaymentSaved, wallet.fetchWalletCustomers, activeTab]);

    const handleWalletUpdated = useCallback(() => {
        wallet.fetchWalletCustomers();
        overview.fetchDashboardData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [wallet.fetchWalletCustomers, overview.fetchDashboardData]);

    const handleRefresh = useCallback(() => {
        if (activeTab === 'overview') overview.fetchDashboardData();
        if (activeTab === 'ledger_soa') ledgerSoa.fetchCustomerLedger(ledgerSoa.soaCustomerId);
        if (activeTab === 'wallet') wallet.fetchWalletCustomers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeTab, overview.fetchDashboardData, ledgerSoa.fetchCustomerLedger, ledgerSoa.soaCustomerId, wallet.fetchWalletCustomers]);

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
                        onClick={handleRefresh}
                        disabled={overview.loading}
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
                    {activeTab === 'overview' && overview.loading && (
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
                    {activeTab === 'ledger_soa' && ledgerSoa.soaLoading && (
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
                    {activeTab === 'wallet' && wallet.walletLoading && (
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
                    <DateRangeShortcuts onSelect={handleDatePreset} />
                    <button
                        onClick={() => handleDateRangeChange({ startDate: new Date('1970-01-01'), endDate: new Date() })}
                        className="px-3 py-1.5 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded-md"
                    >
                        All Time
                    </button>
                </div>
            </div>

            <ErrorBoundary title="Overview & Aging tab failed to load" description="Try refreshing, or switch to another tab.">
                <AROverviewTab
                    isActive={activeTab === 'overview'}
                    loading={overview.loading}
                    error={overview.overviewError}
                    onRetry={overview.fetchDashboardData}
                    kpiData={overview.kpiData}
                    agingData={overview.agingData}
                    onBucketClick={overview.handleAgingBucketClick}
                    customerSummary={overview.customerSummary}
                    onCustomerClick={overview.handleCustomerClick}
                    onReceivePayment={overview.handleReceivePaymentClick}
                    hasPaymentPermission={hasPermission('ar:receive_payment')}
                    onExport={overview.handleExportCustomerSummary}
                    searchTerm={overview.customerSummarySearchTerm}
                    onSearchChange={(val) => { overview.setCustomerSummarySearchTerm(val); overview.setCustomerSummaryPage(1); }}
                    statusFilter={overview.customerSummaryStatusFilter}
                    onStatusFilterChange={(val) => { overview.setCustomerSummaryStatusFilter(val); overview.setCustomerSummaryPage(1); }}
                    sortConfig={overview.customerSummarySortConfig}
                    onSortChange={(cfg) => { overview.setCustomerSummarySortConfig(cfg); overview.setCustomerSummaryPage(1); }}
                    customerSummaryPage={overview.customerSummaryPage}
                    customerSummaryPageSize={overview.customerSummaryPageSize}
                    customerSummaryTotal={overview.customerSummaryTotal}
                    onCustomerSummaryPageChange={overview.setCustomerSummaryPage}
                    onCustomerSummaryPageSizeChange={(value) => { overview.setCustomerSummaryPageSize(value); overview.setCustomerSummaryPage(1); }}
                    selectedAgingBucket={overview.selectedAgingBucket}
                    onCloseDrillDown={overview.handleCloseDrillDown}
                    drillDownLoading={overview.drillDownLoading}
                    drillDownInvoices={overview.drillDownInvoices}
                    drillDownPage={overview.drillDownPage}
                    drillDownPageSize={overview.drillDownPageSize}
                    drillDownTotal={overview.drillDownTotal}
                    onDrillDownPageChange={overview.setDrillDownPage}
                    onDrillDownPageSizeChange={(value) => { overview.setDrillDownPageSize(value); overview.setDrillDownPage(1); }}
                    onReceivePaymentFromDrillDown={overview.handleReceivePaymentFromDrillDown}
                    hasPermission={hasPermission}
                    isPaymentModalOpen={overview.isPaymentModalOpen}
                    selectedCustomer={overview.selectedCustomer}
                    onClosePaymentModal={() => overview.setIsPaymentModalOpen(false)}
                    onPaymentSaved={handlePaymentSaved}
                    selectedCustomerForInvoices={overview.selectedCustomerForInvoices}
                    onCloseCustomerInvoices={overview.handleCloseCustomerInvoices}
                    customerInvoices={overview.customerInvoices}
                    customerInvoicesLoading={overview.customerInvoicesLoading}
                    customerInvoicesPage={overview.customerInvoicesPage}
                    customerInvoicesPageSize={overview.customerInvoicesPageSize}
                    customerInvoicesTotal={overview.customerInvoicesTotal}
                    onCustomerInvoicesPageChange={overview.setCustomerInvoicesPage}
                    onCustomerInvoicesPageSizeChange={(size) => { overview.setCustomerInvoicesPageSize(size); overview.setCustomerInvoicesPage(1); }}
                    onAfterDueDateUpdate={overview.fetchDashboardData}
                />
            </ErrorBoundary>

            {activeTab === 'ledger_soa' && (
                <ErrorBoundary title="Customer Ledger & SOA tab failed to load" description="Try refreshing, or switch to another tab.">
                    <ARLedgerSoaTab
                        soaComboboxRef={ledgerSoa.soaComboboxRef}
                        soaSearchQuery={ledgerSoa.soaSearchQuery}
                        onSoaSearchQueryChange={ledgerSoa.setSoaSearchQuery}
                        soaDropdownOpen={ledgerSoa.soaDropdownOpen}
                        setSoaDropdownOpen={ledgerSoa.setSoaDropdownOpen}
                        soaHighlightedIndex={ledgerSoa.soaHighlightedIndex}
                        setSoaHighlightedIndex={ledgerSoa.setSoaHighlightedIndex}
                        filteredSoaCustomers={ledgerSoa.filteredSoaCustomers}
                        soaCustomerId={ledgerSoa.soaCustomerId}
                        selectSoaCustomer={ledgerSoa.selectSoaCustomer}
                        onClearSoaCustomer={ledgerSoa.handleClearSoaCustomer}
                        handleSoaKeyDown={ledgerSoa.handleSoaKeyDown}
                        attachReceiptImages={ledgerSoa.attachReceiptImages}
                        setAttachReceiptImages={ledgerSoa.setAttachReceiptImages}
                        handleExportSoaPdf={ledgerSoa.handleExportSoaPdf}
                        soaDownloading={ledgerSoa.soaDownloading}
                        soaLoading={ledgerSoa.soaLoading}
                        soaLedger={ledgerSoa.soaLedger}
                        dateRange={dateRange}
                    />
                </ErrorBoundary>
            )}

            {activeTab === 'wallet' && (
                <ErrorBoundary title="Customer Wallet tab failed to load" description="Try refreshing, or switch to another tab.">
                    <ARWalletTab
                        walletLoading={wallet.walletLoading}
                        walletSearch={wallet.walletSearch}
                        onWalletSearchChange={wallet.setWalletSearch}
                        filteredWalletCustomers={wallet.filteredWalletCustomers}
                        paginatedWalletCustomers={wallet.paginatedWalletCustomers}
                        walletPage={wallet.walletPage}
                        walletPageSize={wallet.walletPageSize}
                        onWalletPageChange={wallet.setWalletPage}
                        onWalletPageSizeChange={(value) => { wallet.setWalletPageSize(value); wallet.setWalletPage(1); }}
                        selectedWalletCustomer={wallet.selectedWalletCustomer}
                        onSelectWalletCustomer={wallet.handleSelectWalletCustomer}
                        isWalletModalOpen={wallet.isWalletModalOpen}
                        onCloseWalletModal={wallet.handleCloseWalletModal}
                        onWalletUpdated={handleWalletUpdated}
                    />
                </ErrorBoundary>
            )}
        </div>
    );
};

export default AccountsReceivablePage;
