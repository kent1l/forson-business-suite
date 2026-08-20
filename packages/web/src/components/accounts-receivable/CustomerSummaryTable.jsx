/**
 * Customer Summary Table Component for the Forson Business Suite
 *
 * Enhanced with real-time text search, risk status filter, credit hold badges,
 * and store wallet credit balance display.
 */
import { formatCurrency } from '../../utils/currency';
import { getCustomerStatusBadge } from '../../utils/status';
import { useMemo, useState, useEffect } from 'react';
import SortableHeader from '../ui/SortableHeader';
import { sortData } from '../../utils/sortData';
import CustomerWalletBadge from './CustomerWalletBadge';

const _TableSkeleton = () => (
    <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden animate-pulse">
        <div className="p-6">
            <div className="h-6 bg-gray-200 dark:bg-slate-700 rounded w-48"></div>
        </div>
        <div className="border-t border-gray-200 dark:border-slate-700">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="px-6 py-4 border-b border-gray-200 dark:border-slate-700">
                    <div className="grid grid-cols-7 gap-4">
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded"></div>
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded"></div>
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded"></div>
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded"></div>
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded"></div>
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded"></div>
                        <div className="h-4 bg-gray-200 dark:bg-slate-700 rounded"></div>
                    </div>
                </div>
            ))}
        </div>
    </div>
);

const CustomerSummaryTable = ({
    customers = [],
    onCustomerClick,
    onReceivePayment,
    hasPaymentPermission,
    loading = false,
    onExport,
    searchTerm = '',
    onSearchChange,
    statusFilter = 'ALL',
    onStatusFilterChange,
    sortConfig = { key: 'invoice_count', direction: 'DESC' },
    onSortChange
}) => {
    const [localSearch, setLocalSearch] = useState(searchTerm);

    useEffect(() => {
        setLocalSearch(searchTerm);
    }, [searchTerm]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (localSearch !== searchTerm && onSearchChange) {
                onSearchChange(localSearch);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [localSearch, searchTerm, onSearchChange]);

    const handleClearSearch = () => {
        setLocalSearch('');
        if (onSearchChange) onSearchChange('');
    };

    const handleSort = (key, direction) => {
        if (onSortChange) {
            onSortChange({ key, direction });
        }
    };

    if (loading && customers.length === 0) return <_TableSkeleton />;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 overflow-hidden shadow-card">
            <div className="p-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 border-b border-gray-100 dark:border-slate-700">
                <div>
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-slate-100">Customer Accounts Receivable</h2>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Overview of balances, wallet credits, and risk statuses</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {/* Search Input with X Clear Button */}
                    <div className="relative w-48 sm:w-64">
                        <input
                            type="text"
                            placeholder="Search name, company, phone..."
                            value={localSearch}
                            onChange={(e) => setLocalSearch(e.target.value)}
                            className="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <svg className="w-4 h-4 text-gray-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                        {localSearch && (
                            <button
                                type="button"
                                onClick={handleClearSearch}
                                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 focus:outline-none p-1 rounded-full hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                                title="Clear search"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        )}
                    </div>

                    {/* Risk Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={(e) => onStatusFilterChange && onStatusFilterChange(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100"
                    >
                        <option value="ALL">All Statuses</option>
                        <option value="CURRENT">Current / Good Standing</option>
                        <option value="OVERDUE">Overdue Receivables</option>
                        <option value="CREDIT_HOLD">Credit Hold Only</option>
                    </select>

                    <button
                        onClick={onExport}
                        className="text-sm px-3 py-1.5 border border-gray-300 dark:border-slate-600 rounded-md text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors font-medium"
                    >
                        Export CSV
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500 dark:text-slate-400">
                    <thead className="text-xs text-gray-700 dark:text-slate-300 uppercase bg-gray-50 dark:bg-slate-700/40 border-b border-gray-200 dark:border-slate-700">
                        <tr>
                            <SortableHeader column="customer_name" sortConfig={sortConfig} onSort={handleSort}>Customer</SortableHeader>
                            <SortableHeader column="invoice_count" sortConfig={sortConfig} onSort={handleSort}>Invoice Count</SortableHeader>
                            <SortableHeader column="earliest_due_date" sortConfig={sortConfig} onSort={handleSort}>Next Due Date</SortableHeader>
                            <SortableHeader column="total_balance_due" sortConfig={sortConfig} onSort={handleSort}>Receivable Due</SortableHeader>
                            <SortableHeader column="wallet_balance" sortConfig={sortConfig} onSort={handleSort}>Store Wallet</SortableHeader>
                            <SortableHeader column="status" sortConfig={sortConfig} onSort={handleSort}>Status</SortableHeader>
                            {hasPaymentPermission && <th scope="col" className="px-6 py-3">Actions</th>}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                        {customers.map((customer, index) => {
                            const statusBadge = getCustomerStatusBadge(customer);
                            const walletBal = Number(customer.wallet_balance || 0);

                            return (
                                <tr
                                    key={customer.customer_id || index}
                                    className="hover:bg-gray-50 dark:hover:bg-slate-700/40 transition-colors text-gray-800 dark:text-slate-200"
                                >
                                    <td className="px-6 py-4 font-medium text-gray-900 dark:text-slate-100 whitespace-nowrap cursor-pointer hover:text-primary-600 dark:hover:text-primary-400"
                                        onClick={() => onCustomerClick(customer)}>
                                        <div className="flex items-center gap-2">
                                            <span>{customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim()}</span>
                                            {customer.credit_hold && (
                                                <span className="bg-danger-100 dark:bg-danger-900/30 text-danger-800 dark:text-danger-400 border border-danger-300 dark:border-danger-800 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                    CREDIT HOLD
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        {customer.invoice_count}
                                    </td>
                                    <td className="px-6 py-4 cursor-pointer text-gray-600 dark:text-slate-400"
                                        onClick={() => onCustomerClick(customer)}>
                                        {customer.earliest_due_date ? new Date(customer.earliest_due_date).toLocaleDateString() : 'N/A'}
                                    </td>
                                    <td className="px-6 py-4 font-mono font-medium text-gray-900 dark:text-slate-100 cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        {formatCurrency(customer.total_balance_due)}
                                    </td>
                                    <td className="px-6 py-4 font-mono cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        {walletBal > 0 ? (
                                            <CustomerWalletBadge balance={walletBal} onClick={(e) => { e.stopPropagation(); onCustomerClick(customer); }} />
                                        ) : (
                                            <span className="text-gray-400 dark:text-slate-500">₱0.00</span>
                                        )}
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
                                                    className="bg-success-600 hover:bg-success-700 text-white px-3 py-1 rounded-lg text-xs font-semibold transition-colors"
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
                                <td colSpan="7" className="px-6 py-8 text-center text-gray-500 dark:text-slate-400">
                                    No matching customer accounts found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default CustomerSummaryTable;
