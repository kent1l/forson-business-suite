import { useEffect, useState } from 'react';
import { formatCurrency } from '../../utils/currency';
import SortableHeader from '../ui/SortableHeader';
import StatusBadge from '../ui/StatusBadge';

const STATUS_TONE = {
    'Current': 'success',
    '1-30 Days': 'info',
    '31-60 Days': 'warning',
    '61-90 Days': 'warning',
    '90+ Days': 'danger',
};

const SupplierSummaryTable = ({
    suppliers = [],
    onSupplierClick,
    loading = false,
    searchTerm = '',
    onSearchChange,
    statusFilter = 'ALL',
    onStatusFilterChange,
    sortConfig = { key: 'bill_count', direction: 'DESC' },
    onSortChange,
}) => {
    const [localSearch, setLocalSearch] = useState(searchTerm);

    useEffect(() => { setLocalSearch(searchTerm); }, [searchTerm]);
    useEffect(() => {
        const timer = setTimeout(() => {
            if (localSearch !== searchTerm && onSearchChange) onSearchChange(localSearch);
        }, 300);
        return () => clearTimeout(timer);
    }, [localSearch, searchTerm, onSearchChange]);

    const handleSort = (key, direction) => onSortChange && onSortChange({ key, direction });

    return (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-gray-200 dark:border-slate-700 overflow-hidden">
            <div className="p-6 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 border-b border-gray-100 dark:border-slate-700">
                <div>
                    <h2 className="text-xl font-semibold text-gray-800 dark:text-slate-100">Supplier Accounts Payable</h2>
                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Balances, next due date, and payment-hold status per supplier</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative w-48 sm:w-64">
                        <input
                            type="text"
                            placeholder="Search name, contact, phone..."
                            value={localSearch}
                            onChange={(e) => setLocalSearch(e.target.value)}
                            className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md focus:outline-none focus:ring-2 focus:ring-primary-500"
                        />
                        <svg className="w-4 h-4 text-gray-400 dark:text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    </div>
                    <select
                        value={statusFilter}
                        onChange={(e) => onStatusFilterChange && onStatusFilterChange(e.target.value)}
                        className="px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    >
                        <option value="ALL">All Statuses</option>
                        <option value="CURRENT">Current / Good Standing</option>
                        <option value="OVERDUE">Overdue Payables</option>
                        <option value="PAYMENT_HOLD">Payment Hold Only</option>
                    </select>
                </div>
            </div>

            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left text-gray-500 dark:text-slate-400">
                    <thead className="text-xs text-gray-700 dark:text-slate-300 uppercase bg-gray-50 dark:bg-slate-900/60 border-b border-gray-200 dark:border-slate-700">
                        <tr>
                            <SortableHeader column="supplier_name" sortConfig={sortConfig} onSort={handleSort}>Supplier</SortableHeader>
                            <SortableHeader column="bill_count" sortConfig={sortConfig} onSort={handleSort}>Open Bills</SortableHeader>
                            <SortableHeader column="earliest_due_date" sortConfig={sortConfig} onSort={handleSort}>Next Due Date</SortableHeader>
                            <SortableHeader column="total_balance_due" sortConfig={sortConfig} onSort={handleSort}>Payable Due</SortableHeader>
                            <SortableHeader column="status" sortConfig={sortConfig} onSort={handleSort}>Status</SortableHeader>
                        </tr>
                    </thead>
                    <tbody>
                        {suppliers.map((supplier, index) => (
                            <tr
                                key={supplier.supplier_id || index}
                                onClick={() => onSupplierClick(supplier)}
                                className="bg-white dark:bg-slate-800 border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50 transition-colors cursor-pointer"
                            >
                                <td className="px-6 py-4 font-medium text-gray-900 dark:text-slate-100 whitespace-nowrap">
                                    <div className="flex items-center gap-2">
                                        <span>{supplier.supplier_name}</span>
                                        {supplier.payment_hold && <StatusBadge tone="danger" label="ON HOLD" />}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-center">{supplier.bill_count}</td>
                                <td className="px-6 py-4">
                                    {supplier.earliest_due_date ? new Date(supplier.earliest_due_date).toLocaleDateString() : 'N/A'}
                                </td>
                                <td className="px-6 py-4 font-mono font-medium text-gray-900 dark:text-slate-100">
                                    {formatCurrency(supplier.total_balance_due)}
                                </td>
                                <td className="px-6 py-4">
                                    <StatusBadge tone={STATUS_TONE[supplier.status] || 'neutral'} label={supplier.status} />
                                </td>
                            </tr>
                        ))}
                        {!loading && suppliers.length === 0 && (
                            <tr>
                                <td colSpan="5" className="px-6 py-8 text-center text-gray-500 dark:text-slate-400">
                                    No matching supplier accounts found
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default SupplierSummaryTable;
