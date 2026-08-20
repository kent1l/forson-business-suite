import Icon from '../../ui/Icon';
import { ICONS } from '../../../constants';
import { formatCurrency } from '../../../utils/currency';
import PaginationControls from '../../ui/PaginationControls';
import LoadingState from '../../ui/LoadingState';
import EmptyState from '../../ui/EmptyState';
import CustomerWalletModal from '../CustomerWalletModal';
import ErrorBoundary from '../../ui/ErrorBoundary';

// Customer Wallet Management tab: searchable/paginated store-credit ledger
// per customer, with a modal to view/adjust individual wallet balances.
const ARWalletTab = ({
    walletLoading,
    walletSearch,
    onWalletSearchChange,
    filteredWalletCustomers,
    paginatedWalletCustomers,
    walletPage,
    walletPageSize,
    onWalletPageChange,
    onWalletPageSizeChange,
    selectedWalletCustomer,
    onSelectWalletCustomer,
    isWalletModalOpen,
    onCloseWalletModal,
    onWalletUpdated,
}) => {
    return (
        <div className="space-y-6">
        <ErrorBoundary title="Wallet management failed to load" description="The Customer Wallet tab hit an unexpected error. Try again, or switch tabs and come back.">
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-xl font-bold text-gray-800 dark:text-slate-100">Customer Wallet & Store Credit Management</h2>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-0.5">Manage customer deposit balances, overpayment credits, and store wallet adjustments</p>
                </div>
                <div className="relative w-48 sm:w-64">
                    <input
                        type="text"
                        placeholder="Search customer..."
                        value={walletSearch}
                        onChange={(e) => onWalletSearchChange(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    <Icon path={ICONS.search} className="w-4 h-4 text-gray-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                </div>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden shadow-card">
                {walletLoading ? (
                    <LoadingState label="Loading wallet accounts..." />
                ) : filteredWalletCustomers.length === 0 ? (
                    <EmptyState
                        icon={ICONS.ar}
                        title="No customer wallet records found"
                        description={walletSearch ? 'No customers match your search.' : 'Wallet balances will appear here once customers have store credit.'}
                    />
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-sm text-left text-gray-500 dark:text-slate-400">
                                <thead className="text-xs text-gray-700 dark:text-slate-300 uppercase bg-gray-50 dark:bg-slate-700/40 border-b border-gray-200 dark:border-slate-700">
                                    <tr>
                                        <th className="px-6 py-3">Customer</th>
                                        <th className="px-6 py-3 text-right">Store Wallet Balance</th>
                                        <th className="px-6 py-3 text-right">Outstanding Receivables</th>
                                        <th className="px-6 py-3 text-right">Net Exposure</th>
                                        <th className="px-6 py-3 text-center">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-slate-700/60">
                                    {paginatedWalletCustomers.map(w => {
                                        const walletBal = Number(w.wallet_balance || 0);
                                        const arBal = Number(w.receivable_balance || w.total_balance_due || 0);
                                        const netExp = arBal - walletBal;
                                        return (
                                            <tr key={w.customer_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40 text-gray-800 dark:text-slate-200 transition-colors">
                                                <td className="px-6 py-4 font-semibold text-gray-900 dark:text-slate-100">{w.company_name || `${w.first_name || ''} ${w.last_name || ''}`}</td>
                                                <td className="px-6 py-4 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{formatCurrency(walletBal)}</td>
                                                <td className="px-6 py-4 text-right font-mono font-semibold text-gray-900 dark:text-slate-100">{formatCurrency(arBal)}</td>
                                                <td className={`px-6 py-4 text-right font-mono font-bold ${netExp > 0 ? 'text-danger-600 dark:text-danger-400' : 'text-success-600 dark:text-success-400'}`}>
                                                    {formatCurrency(netExp)}
                                                </td>
                                                <td className="px-6 py-4 text-center">
                                                    <button
                                                        onClick={() => onSelectWalletCustomer(w)}
                                                        className="px-3 py-1 bg-primary-600 hover:bg-primary-700 text-white rounded text-xs font-semibold transition-colors"
                                                    >
                                                        View / Adjust Wallet
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="px-6 pb-4">
                            <PaginationControls
                                page={walletPage}
                                pageSize={walletPageSize}
                                total={filteredWalletCustomers.length}
                                onPageChange={onWalletPageChange}
                                onPageSizeChange={onWalletPageSizeChange}
                            />
                        </div>
                    </>
                )}
            </div>
        </ErrorBoundary>

            {/* Customer Wallet Modal */}
            {selectedWalletCustomer && (
                <ErrorBoundary title="Wallet dialog failed to load" description="Close this dialog and try again.">
                    <CustomerWalletModal
                        isOpen={isWalletModalOpen}
                        onClose={onCloseWalletModal}
                        customer={selectedWalletCustomer}
                        onUpdated={onWalletUpdated}
                    />
                </ErrorBoundary>
            )}
        </div>
    );
};

export default ARWalletTab;
