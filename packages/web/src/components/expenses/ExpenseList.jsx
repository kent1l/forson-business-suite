import React, { useState } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

export default function ExpenseList({
    expenses = [],
    categories = [],
    paymentMethods = [],
    pagination = {},
    filters = {},
    onFilterChange,
    onClearFilters,
    onPageChange,
    onSortChange,
    onEdit,
    onDuplicate,
    onVoid,
    loading = false
}) {
    const [voidModalExpense, setVoidModalExpense] = useState(null);
    const [voidReason, setVoidReason] = useState('');
    const [voidLoading, setVoidLoading] = useState(false);
    const [voidError, setVoidError] = useState('');

    const handleVoidSubmit = async (e) => {
        e.preventDefault();
        if (!voidReason || voidReason.trim().length < 5) {
            setVoidError('Reason for voiding must be at least 5 characters');
            return;
        }
        setVoidLoading(true);
        setVoidError('');
        try {
            await onVoid(voidModalExpense.expense_id, voidReason.trim());
            setVoidModalExpense(null);
            setVoidReason('');
        } catch (err) {
            setVoidError(err.response?.data?.message || 'Failed to void expense record');
        } finally {
            setVoidLoading(false);
        }
    };

    const formatCurrency = (amt) => {
        const val = parseFloat(amt) || 0;
        return `₱${val.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatDate = (dateVal) => {
        if (!dateVal) return '-';
        const str = typeof dateVal === 'string' ? dateVal.split('T')[0] : String(dateVal);
        const d = new Date(str + 'T00:00:00');
        if (isNaN(d.getTime())) return String(dateVal);
        return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    };

    // Only these map to whitelisted sort fields on the API.
    const SortableHeader = ({ field, label, align = 'left' }) => {
        const isActive = filters.sort_by === field;
        const arrow = !isActive ? '↕' : filters.sort_dir === 'asc' ? '↑' : '↓';
        return (
            <th className={`py-3 px-4 ${align === 'right' ? 'text-right' : 'text-left'}`}>
                <button
                    type="button"
                    onClick={() => onSortChange && onSortChange(field)}
                    className={`inline-flex items-center gap-1 uppercase tracking-wider font-semibold cursor-pointer hover:text-blue-600 transition-colors ${
                        isActive ? 'text-blue-600' : 'text-slate-600'
                    }`}
                    title={`Sort by ${label}`}
                >
                    <span>{label}</span>
                    <span className={isActive ? 'text-blue-500' : 'text-slate-300'}>{arrow}</span>
                </button>
            </th>
        );
    };

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
            {/* Filter Toolbar */}
            <div className="p-4 bg-slate-50 dark:bg-slate-900/50 border-b border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-2">
                        <Icon path={ICONS.search} className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                        <span>Filter & Search Expenses</span>
                    </h3>

                    {(filters.date_from || filters.date_to || filters.category_id || filters.payment_method_id || filters.payee || filters.show_void) && (
                        <button
                            onClick={onClearFilters}
                            className="text-xs font-medium text-primary-600 dark:text-primary-400 hover:underline cursor-pointer"
                        >
                            Clear All Filters
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
                    {/* Payee Search */}
                    <div>
                        <input
                            type="text"
                            placeholder="Search payee..."
                            value={filters.payee || ''}
                            onChange={(e) => onFilterChange('payee', e.target.value)}
                            className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-100 placeholder:text-gray-400 dark:placeholder:text-slate-500 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                        />
                    </div>

                    {/* Category Filter */}
                    <div>
                        <select
                            value={filters.category_id || ''}
                            onChange={(e) => onFilterChange('category_id', e.target.value)}
                            className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                            <option value="">All Categories</option>
                            {categories.map(cat => (
                                <option key={cat.category_id} value={cat.category_id}>
                                    {cat.category_name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Payment Method Filter */}
                    <div>
                        <select
                            value={filters.payment_method_id || ''}
                            onChange={(e) => onFilterChange('payment_method_id', e.target.value)}
                            className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                        >
                            <option value="">All Payment Methods</option>
                            {paymentMethods.map(pm => (
                                <option key={pm.method_id} value={pm.method_id}>
                                    {pm.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Date From */}
                    <div>
                        <input
                            type="date"
                            value={filters.date_from || ''}
                            onChange={(e) => onFilterChange('date_from', e.target.value)}
                            className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                            placeholder="From Date"
                        />
                    </div>

                    {/* Date To */}
                    <div>
                        <input
                            type="date"
                            value={filters.date_to || ''}
                            onChange={(e) => onFilterChange('date_to', e.target.value)}
                            className="w-full px-3 py-1.5 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-1 focus:ring-primary-500"
                            placeholder="To Date"
                        />
                    </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 pt-1">
                    <label className="flex items-center space-x-2 cursor-pointer select-none">
                        <input
                            type="checkbox"
                            checked={filters.show_void || false}
                            onChange={(e) => onFilterChange('show_void', e.target.checked)}
                            className="rounded text-primary-600 focus:ring-primary-500 h-3.5 w-3.5 border-slate-300 dark:border-slate-600"
                        />
                        <span>Show voided expense records</span>
                    </label>

                    <span>Showing {expenses.length} of {pagination.totalItems || 0} expenses</span>
                </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                    <thead>
                        <tr className="bg-slate-100/70 dark:bg-slate-700/40 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 uppercase tracking-wider font-semibold">
                            <SortableHeader field="expense_date" label="Date" />
                            <SortableHeader field="category_name" label="Category" />
                            <th className="py-3 px-4">Payee / Vendor</th>
                            <SortableHeader field="amount" label="Amount" align="right" />
                            <th className="py-3 px-4">Method</th>
                            <th className="py-3 px-4">Ref No.</th>
                            <th className="py-3 px-4">Notes</th>
                            <th className="py-3 px-4">Created By</th>
                            <th className="py-3 px-4 text-center">Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                        {loading ? (
                            <tr>
                                <td colSpan="9" className="py-12 text-center text-slate-400 dark:text-slate-500">
                                    <div className="flex items-center justify-center space-x-2">
                                        <svg className="animate-spin h-5 w-5 text-primary-600" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        <span>Loading expense records...</span>
                                    </div>
                                </td>
                            </tr>
                        ) : expenses.length === 0 ? (
                            <tr>
                                <td colSpan="9" className="py-12 text-center text-slate-400 dark:text-slate-500">
                                    <Icon path={ICONS.receipt} className="w-8 h-8 mx-auto mb-2 text-slate-300 dark:text-slate-600" />
                                    <p className="font-medium text-slate-600 dark:text-slate-300">No expense records found</p>
                                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Try adjusting your filters or record a new expense.</p>
                                </td>
                            </tr>
                        ) : (
                            expenses.map(item => {
                                const isVoid = item.is_void;
                                return (
                                    <tr
                                        key={item.expense_id}
                                        className={`hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors ${isVoid ? 'bg-danger-50/40 dark:bg-danger-900/10 text-slate-400 dark:text-slate-500 line-through' : 'text-slate-700 dark:text-slate-200'}`}
                                    >
                                        <td className="py-3 px-4 font-medium whitespace-nowrap">
                                            {formatDate(item.expense_date)}
                                        </td>
                                        <td className="py-3 px-4 whitespace-nowrap">
                                            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold ${
                                                isVoid ? 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-800 dark:text-slate-200'
                                            }`}>
                                                {item.category?.category_name || 'Uncategorized'}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 font-semibold whitespace-nowrap text-slate-900 dark:text-slate-100">
                                            {item.payee || <span className="text-slate-400 dark:text-slate-500 italic">None</span>}
                                        </td>
                                        <td className={`py-3 px-4 text-right font-bold whitespace-nowrap ${isVoid ? 'text-slate-400 dark:text-slate-500' : 'text-slate-900 dark:text-slate-100'}`}>
                                            {formatCurrency(item.amount)}
                                        </td>
                                        <td className="py-3 px-4 whitespace-nowrap">
                                            <span className="text-slate-600 dark:text-slate-400 font-medium">
                                                {item.payment_method?.name || item.payment_method_text || 'Cash'}
                                            </span>
                                        </td>
                                        <td className="py-3 px-4 whitespace-nowrap text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                                            {item.reference_no || '-'}
                                        </td>
                                        <td className="py-3 px-4 max-w-xs truncate text-slate-500 dark:text-slate-400">
                                            {item.notes || '-'}
                                        </td>
                                        <td className="py-3 px-4 whitespace-nowrap text-slate-500 dark:text-slate-400">
                                            {item.created_by ? `${item.created_by.first_name || ''} ${item.created_by.last_name || item.created_by.username || ''}`.trim() : '-'}
                                        </td>
                                        <td className="py-3 px-4 text-center whitespace-nowrap no-line-through">
                                            <div className="flex items-center justify-center space-x-1">
                                                {isVoid && (
                                                    <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold bg-danger-100 dark:bg-danger-900/30 text-danger-700 dark:text-danger-400 border border-danger-200 dark:border-danger-900/50">
                                                        VOIDED
                                                    </span>
                                                )}
                                                {onDuplicate && (
                                                    <button
                                                        onClick={() => onDuplicate(item)}
                                                        title="Record a new expense using this one as a starting point"
                                                        className="p-1 text-slate-500 dark:text-slate-400 hover:text-emerald-600 dark:hover:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 rounded transition-colors cursor-pointer"
                                                    >
                                                        <Icon path={ICONS.copy} className="w-4 h-4" />
                                                    </button>
                                                )}
                                                {!isVoid && (
                                                    <>
                                                        <button
                                                            onClick={() => onEdit(item)}
                                                            title="Edit expense"
                                                            className="p-1 text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 rounded transition-colors cursor-pointer"
                                                        >
                                                            <Icon path={ICONS.edit} className="w-4 h-4" />
                                                        </button>
                                                        <button
                                                            onClick={() => { setVoidModalExpense(item); setVoidReason(''); setVoidError(''); }}
                                                            title="Void expense"
                                                            className="p-1 text-slate-500 dark:text-slate-400 hover:text-danger-600 dark:hover:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-900/30 rounded transition-colors cursor-pointer"
                                                        >
                                                            <Icon path={ICONS.trash} className="w-4 h-4" />
                                                        </button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>

            {/* Pagination Controls */}
            {pagination.totalPages > 1 && (
                <div className="px-4 py-3 bg-slate-50 dark:bg-slate-900/50 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                    <div>
                        Page <span className="font-semibold text-slate-800 dark:text-slate-200">{pagination.page}</span> of <span className="font-semibold text-slate-800 dark:text-slate-200">{pagination.totalPages}</span>
                    </div>
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={() => onPageChange(pagination.page - 1)}
                            disabled={pagination.page <= 1 || loading}
                            className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 font-medium cursor-pointer transition-colors"
                        >
                            Previous
                        </button>
                        <button
                            onClick={() => onPageChange(pagination.page + 1)}
                            disabled={pagination.page >= pagination.totalPages || loading}
                            className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 rounded hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 font-medium cursor-pointer transition-colors"
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}

            {/* Void Confirmation Modal */}
            {voidModalExpense && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl border border-slate-200 dark:border-slate-700 w-full max-w-md overflow-hidden">
                        <div className="p-5 border-b border-slate-100 dark:border-slate-700 bg-danger-50/50 dark:bg-danger-900/20 flex items-center space-x-3">
                            <span className="p-2 bg-danger-100 dark:bg-danger-900/40 text-danger-600 dark:text-danger-400 rounded-lg">
                                <Icon path={ICONS.warning} className="w-5 h-5" />
                            </span>
                            <div>
                                <h3 className="text-base font-bold text-danger-900 dark:text-danger-300">Void Expense Record</h3>
                                <p className="text-xs text-danger-700 dark:text-danger-400">Expense #{voidModalExpense.expense_id} ({formatCurrency(voidModalExpense.amount)})</p>
                            </div>
                        </div>

                        <form onSubmit={handleVoidSubmit} className="p-5 space-y-4">
                            <p className="text-xs text-slate-600 dark:text-slate-300">
                                Voiding soft-deletes this expense record from financial summary totals. This action cannot be reversed.
                            </p>

                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                    Reason for Voiding <span className="text-danger-500">*</span>
                                </label>
                                <textarea
                                    rows="3"
                                    value={voidReason}
                                    onChange={(e) => setVoidReason(e.target.value)}
                                    placeholder="Minimum 5 characters describing why this expense is being voided..."
                                    className="w-full px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 text-gray-900 dark:text-slate-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-danger-500"
                                ></textarea>
                                {voidError && <p className="text-xs text-danger-500 mt-1">{voidError}</p>}
                            </div>

                            <div className="flex items-center justify-end space-x-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                                <button
                                    type="button"
                                    onClick={() => setVoidModalExpense(null)}
                                    disabled={voidLoading}
                                    className="px-3.5 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg cursor-pointer transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={voidLoading}
                                    className="px-4 py-1.5 text-xs font-medium text-white bg-danger-600 hover:bg-danger-700 rounded-lg shadow-sm cursor-pointer transition-colors"
                                >
                                    {voidLoading ? 'Voiding...' : 'Confirm Void'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
