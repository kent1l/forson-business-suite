import { useState, useCallback, useEffect } from 'react';
import api from '../api';
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
import useDeepLink from '../hooks/useDeepLink';

const AccountsReceivablePage = ({ pageState, onNavigate }) => {
    const { hasPermission } = useAuth();

    const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'ledger_soa' | 'wallet'
    const [linkedPayment, setLinkedPayment] = useState(null);
    const [linkedPaymentError, setLinkedPaymentError] = useState('');
    useEffect(() => {
        if (!pageState?.customer_payment_id) { setLinkedPayment(null); setLinkedPaymentError(''); return; }
        let live = true;
        api.get(`/ar/payments/${pageState.customer_payment_id}`).then(response => {
            if (live) { setLinkedPayment(response.data.data); setLinkedPaymentError(''); }
        }).catch(error => {
            if (live) setLinkedPaymentError(error.response?.status === 403
                ? 'You do not have permission to view this A/R payment.' : 'This A/R payment is unavailable.');
        });
        return () => { live = false; };
    }, [pageState]);
    // Lets a notification land on the tab where the alert is actionable.
    useDeepLink(pageState, ({ tab }) => { if (tab) setActiveTab(tab); });

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

    const overview = useAROverviewData({ dateRange, hasPermission, activeTab });
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
        <div className="space-y-6">
            {pageState?.cashBoxReturn && <button type="button" className="min-h-11 rounded border border-slate-300 px-3 text-sm dark:border-slate-700" onClick={() => onNavigate?.('cash_drawer', pageState.cashBoxReturn)}>Back to Cash Box</button>}
            {linkedPaymentError && <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{linkedPaymentError}</p>}
            {linkedPayment && <div className="rounded-lg border border-slate-300 bg-white p-4 text-sm dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"><h2 className="font-semibold">A/R payment #{linkedPayment.payment_id}</h2><p>{linkedPayment.customer_name} · ₱{Number(linkedPayment.amount).toFixed(2)} · {new Date(linkedPayment.payment_date).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p><p>{linkedPayment.method_name || 'Payment method unavailable'} · reference {linkedPayment.physical_receipt_no || linkedPayment.reference_number || '—'}</p><p>This source record is displayed read only here.</p></div>}
            {/* Page Header & Navigation Bar */}
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100 tracking-tight">Accounts Receivable</h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Authoritative A/R Ledger, SOA Reports, PDC Desk & Customer Wallet</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleRefresh}
                        disabled={overview.loading}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg disabled:opacity-50 text-sm transition-colors font-medium flex items-center gap-1.5 shadow-sm"
                    >
                        <Icon path={ICONS.refresh} className="w-4 h-4" /> Refresh
                    </button>
                </div>
            </header>

            {/* Navigation Tabs */}
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 p-1.5 flex flex-wrap gap-1 shadow-card">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={`px-4 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 ${
                        activeTab === 'overview'
                            ? 'bg-primary-600 text-white shadow-sm'
                            : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-700/50'
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
                            ? 'bg-primary-600 text-white shadow-sm'
                            : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-700/50'
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
                            ? 'bg-primary-600 text-white shadow-sm'
                            : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-slate-100 hover:bg-gray-100 dark:hover:bg-slate-700/50'
                    }`}
                >
                    Customer Wallet Management
                    {activeTab === 'wallet' && wallet.walletLoading && (
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                    )}
                </button>
            </div>

            {/* Date Range Picker (shared) */}
            <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                    <Icon path={ICONS.calendar} className="h-5 w-5 text-gray-500 dark:text-slate-400" />
                    <span className="text-sm font-medium text-gray-700 dark:text-slate-200">Statement / Date Range:</span>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-600 dark:text-slate-400">From:</label>
                        <input
                            type="date"
                            value={dateRange.startDate.toISOString().split('T')[0]}
                            onChange={(e) => handleDateRangeChange({ ...dateRange, startDate: new Date(e.target.value) })}
                            className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label className="text-xs text-gray-600 dark:text-slate-400">To:</label>
                        <input
                            type="date"
                            value={dateRange.endDate.toISOString().split('T')[0]}
                            onChange={(e) => handleDateRangeChange({ ...dateRange, endDate: new Date(e.target.value) })}
                            className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-sm bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                    </div>
                    <DateRangeShortcuts onSelect={handleDatePreset} />
                    <button
                        onClick={() => handleDateRangeChange({ startDate: new Date('1970-01-01'), endDate: new Date() })}
                        className="px-3 py-1.5 text-xs font-semibold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-950/30 rounded-md transition-colors"
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
                    balanceScope={overview.customerSummaryBalanceScope}
                    onBalanceScopeChange={(val) => { overview.setCustomerSummaryBalanceScope(val); overview.setCustomerSummaryPage(1); }}
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
                        onAfterDateChange={() => ledgerSoa.fetchCustomerLedger(ledgerSoa.soaCustomerId)}
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
