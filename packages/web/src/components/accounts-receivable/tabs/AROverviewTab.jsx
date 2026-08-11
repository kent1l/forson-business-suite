import Icon from '../../ui/Icon';
import { ICONS } from '../../../constants';
import Modal from '../../ui/Modal';
import ReceivePaymentForm from '../../forms/ReceivePaymentForm';
import { formatCurrency } from '../../../utils/currency';
import KPICard from '../../ui/KPICard';
import InvoiceAgingSummaryChart from '../InvoiceAgingSummaryChart';
import CustomerSummaryTable from '../CustomerSummaryTable';
import CustomerInvoiceDetailsModal from '../CustomerInvoiceDetailsModal';
import PaginationControls from '../../ui/PaginationControls';
import LoadingState from '../../ui/LoadingState';
import EmptyState from '../../ui/EmptyState';
import ErrorState from '../../ui/ErrorState';
import ErrorBoundary from '../../ui/ErrorBoundary';

// Overview & Aging tab: KPI summary, aging chart with drill-down, and the
// paginated customer AR summary table. Owns the receive-payment and
// customer-invoice-drilldown modals since both are only ever triggered from here.
// The modals render regardless of `isActive` so switching tabs mid-payment
// doesn't unmount them and silently discard in-progress input.
const AROverviewTab = ({
    isActive,
    loading,
    error,
    onRetry,
    kpiData,
    agingData,
    onBucketClick,
    customerSummary,
    onCustomerClick,
    onReceivePayment,
    hasPaymentPermission,
    onExport,
    searchTerm,
    onSearchChange,
    statusFilter,
    onStatusFilterChange,
    sortConfig,
    onSortChange,
    customerSummaryPage,
    customerSummaryPageSize,
    customerSummaryTotal,
    onCustomerSummaryPageChange,
    onCustomerSummaryPageSizeChange,

    // Aging drill-down modal
    selectedAgingBucket,
    onCloseDrillDown,
    drillDownLoading,
    drillDownInvoices,
    drillDownPage,
    drillDownPageSize,
    drillDownTotal,
    onDrillDownPageChange,
    onDrillDownPageSizeChange,
    onReceivePaymentFromDrillDown,
    hasPermission,

    // Receive payment modal
    isPaymentModalOpen,
    selectedCustomer,
    onClosePaymentModal,
    onPaymentSaved,

    // Customer invoice details modal
    selectedCustomerForInvoices,
    onCloseCustomerInvoices,
    customerInvoices,
    customerInvoicesLoading,
    customerInvoicesPage,
    customerInvoicesPageSize,
    customerInvoicesTotal,
    onCustomerInvoicesPageChange,
    onCustomerInvoicesPageSizeChange,
    onAfterDueDateUpdate,
}) => {
    return (
        <>
            {isActive && error && !loading && (
                <div className="bg-white rounded-xl border mb-6">
                    <ErrorState
                        title="Couldn't load Accounts Receivable data"
                        description="Something went wrong fetching the AR overview. Check your connection and try again."
                        onRetry={onRetry}
                    />
                </div>
            )}

            {isActive && !error && (
                <ErrorBoundary title="This section failed to load" description="The Overview & Aging tab hit an unexpected error. Try again, or switch tabs and come back.">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                        <KPICard iconName={ICONS.dollar} title="Total Receivables" value={kpiData.totalReceivables.value} trend={kpiData.totalReceivables.trend} trendColorClass={kpiData.totalReceivables.color} loading={loading} />
                        <KPICard iconName={ICONS.documents} title="Invoices Sent" value={kpiData.invoicesSent.value} trend={kpiData.invoicesSent.trend} trendColorClass={kpiData.invoicesSent.color} loading={loading} />
                        <KPICard iconName={ICONS.warning} title="Overdue Invoices" value={kpiData.overdueInvoices.value} trend={kpiData.overdueInvoices.trend} trendColorClass={kpiData.overdueInvoices.color} loading={loading} />
                        <KPICard iconName={ICONS.calendar} title="Avg. Collection Period" value={kpiData.avgCollectionPeriod.value} trend={kpiData.avgCollectionPeriod.trend} trendColorClass={kpiData.avgCollectionPeriod.color} loading={loading} />
                    </div>

                    <InvoiceAgingSummaryChart agingData={agingData} loading={loading} onBucketClick={onBucketClick} />

                    <CustomerSummaryTable
                        customers={customerSummary}
                        onCustomerClick={onCustomerClick}
                        onReceivePayment={onReceivePayment}
                        hasPaymentPermission={hasPaymentPermission}
                        loading={loading}
                        onExport={onExport}
                        searchTerm={searchTerm}
                        onSearchChange={onSearchChange}
                        statusFilter={statusFilter}
                        onStatusFilterChange={onStatusFilterChange}
                        sortConfig={sortConfig}
                        onSortChange={onSortChange}
                    />
                    <PaginationControls
                        page={customerSummaryPage}
                        pageSize={customerSummaryPageSize}
                        total={customerSummaryTotal}
                        onPageChange={onCustomerSummaryPageChange}
                        onPageSizeChange={onCustomerSummaryPageSizeChange}
                    />
                </ErrorBoundary>
            )}

            {/* Modals below render regardless of isActive so they survive a tab switch */}

            {/* Receive Payment Modal */}
            <Modal
                isOpen={isPaymentModalOpen}
                onClose={onClosePaymentModal}
                title={`Receive Payment from ${selectedCustomer?.company_name || `${selectedCustomer?.first_name || ''} ${selectedCustomer?.last_name || ''}`.trim()}`}
                maxWidth="max-w-6xl"
            >
                {selectedCustomer && (
                    <ErrorBoundary title="Payment form failed to load" description="Close this dialog and try again.">
                        <ReceivePaymentForm
                            customer={selectedCustomer}
                            onSave={onPaymentSaved}
                            onCancel={onClosePaymentModal}
                        />
                    </ErrorBoundary>
                )}
            </Modal>

            {/* Drill-down Modal for Aging Bucket Details */}
            <Modal
                isOpen={selectedAgingBucket !== null}
                onClose={onCloseDrillDown}
                title={`Invoices - ${selectedAgingBucket}`}
                maxWidth="max-w-6xl"
            >
                <ErrorBoundary title="Couldn't display these invoices" description="Close this dialog and try again.">
                <div className="space-y-4">
                    {drillDownLoading ? (
                        <LoadingState label="Loading invoices..." />
                    ) : drillDownInvoices.length === 0 ? (
                        <EmptyState
                            icon={ICONS.invoice}
                            title="No invoices found"
                            description="There are no invoices in this aging bucket."
                        />
                    ) : (
                        <>
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
                                                            onClick={() => onReceivePaymentFromDrillDown(invoice)}
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
                            <PaginationControls
                                page={drillDownPage}
                                pageSize={drillDownPageSize}
                                total={drillDownTotal}
                                onPageChange={onDrillDownPageChange}
                                onPageSizeChange={onDrillDownPageSizeChange}
                            />
                        </>
                    )}
                </div>
                </ErrorBoundary>
            </Modal>

            {/* Customer Invoice Details Modal */}
            <ErrorBoundary title="Couldn't display these invoices" description="Close this dialog and try again.">
                <CustomerInvoiceDetailsModal
                    isOpen={selectedCustomerForInvoices !== null}
                    onClose={onCloseCustomerInvoices}
                    title={`Payable Invoices for ${selectedCustomerForInvoices?.company_name || `${selectedCustomerForInvoices?.first_name || ''} ${selectedCustomerForInvoices?.last_name || ''}`.trim()}`}
                    invoices={customerInvoices}
                    loading={customerInvoicesLoading}
                    page={customerInvoicesPage}
                    pageSize={customerInvoicesPageSize}
                    total={customerInvoicesTotal}
                    onPageChange={onCustomerInvoicesPageChange}
                    onPageSizeChange={onCustomerInvoicesPageSizeChange}
                    onAfterDueDateUpdate={onAfterDueDateUpdate}
                />
            </ErrorBoundary>
        </>
    );
};

export default AROverviewTab;
