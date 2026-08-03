/**
 * Customer Summary Table Component for the Forson Business Suite
 *
 * Enhanced with real-time text search, risk status filter, credit hold badges,
 * and store wallet credit balance display.
 */
import { formatCurrency } from '../../utils/currency';
import { getCustomerStatusBadge } from '../../utils/status';
import { useMemo, useState } from 'react';
import SortableHeader from '../ui/SortableHeader';
import { sortData } from '../../utils/sortData';
import CustomerWalletBadge from './CustomerWalletBadge';

const _TableSkeleton = () => (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden animate-pulse">
        <div className="p-6">
            <div className="h-6 bg-gray-200 rounded w-48"></div>
        </div>
        <div className="border-t border-gray-200">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="px-6 py-4 border-b border-gray-200">
                    <div className="grid grid-cols-7 gap-4">
                        <div className="h-4 bg-gray-200 rounded"></div>
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
    const handleSort = (key, direction) => {
        if (onSortChange) {
            onSortChange({ key, direction });
        }
    };

    if (loading) return <_TableSkeleton />;

    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="p-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 border-b border-gray-100">
                <div>
                    <h2 className="text-xl font-semibold text-gray-800">Customer Accounts Receivable</h2>
                    <p className="text-xs text-gray-500 mt-1">Overview of balances, wallet credits, and risk statuses</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {/* Search Input */}
                    <input
                        type="text"
                        placeholder="Search name, company, phone..."
                        value={searchTerm}
                        onChange={(e) => onSearchChange && onSearchChange(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 w-48 sm:w-64"
                    />

                    {/* Risk Status Filter */}
                    <select
                        value={statusFilter}
                        onChange={(e) => onStatusFilterChange && onStatusFilterChange(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                        <option value="ALL">All Statuses</option>
                        <option value="CURRENT">Current / Good Standing</option>
                        <option value="OVERDUE">Overdue Receivables</option>
                        <option value="CREDIT_HOLD">Credit Hold Only</option>
                    </select>

                    <button
                        onClick={onExport}
                        className="text-sm px-3 py-1.5 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50 transition-colors font-medium"
                    >
                        Export CSV
                    </button>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500">
                    <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
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
                    <tbody>
                        {customers.map((customer, index) => {
                            const statusBadge = getCustomerStatusBadge(customer);
                            const walletBal = Number(customer.wallet_balance || 0);

                            return (
                                <tr
                                    key={customer.customer_id || index}
                                    className="bg-white border-b hover:bg-gray-50 transition-colors"
                                >
                                    <td className="px-6 py-4 font-medium text-gray-900 whitespace-nowrap cursor-pointer hover:text-blue-600"
                                        onClick={() => onCustomerClick(customer)}>
                                        <div className="flex items-center gap-2">
                                            <span>{customer.company_name || `${customer.first_name || ''} ${customer.last_name || ''}`.trim()}</span>
                                            {customer.credit_hold && (
                                                <span className="bg-red-100 text-red-800 border border-red-300 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                    CREDIT HOLD
                                                </span>
                                            )}
                                        </div>
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
                                    <td className="px-6 py-4 font-mono cursor-pointer"
                                        onClick={() => onCustomerClick(customer)}>
                                        {walletBal > 0 ? (
                                            <CustomerWalletBadge balance={walletBal} onClick={(e) => { e.stopPropagation(); onCustomerClick(customer); }} />
                                        ) : (
                                            <span className="text-gray-400">₱0.00</span>
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
                                <td colSpan="7" className="px-6 py-8 text-center text-gray-500">
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
