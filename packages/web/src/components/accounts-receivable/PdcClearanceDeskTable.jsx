import { useState, useMemo, useEffect } from 'react';
import { formatCurrency } from '../../utils/currency';
import PaginationControls from '../ui/PaginationControls';

const TableSkeleton = () => (
    <div className="animate-pulse space-y-4 p-6 bg-white rounded-xl border border-gray-200">
        <div className="h-6 bg-gray-200 rounded w-1/4 mb-4"></div>
        <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 bg-gray-100 rounded w-full"></div>
            ))}
        </div>
    </div>
);

const PdcClearanceDeskTable = ({
    items = [],
    loading = false,
    pdcStatusFilter = 'ALL',
    onStatusFilterChange,
    maturityFilter = 'ALL',
    onMaturityFilterChange,
    onVerifyClearance,
    onMarkBounced,
    onRedepositCheque,
    onViewHistory
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    // Reset to page 1 whenever filters change
    useEffect(() => {
        setPage(1);
    }, [searchTerm, pdcStatusFilter, maturityFilter]);

    // Compute status counts for count badges
    const statusCounts = useMemo(() => {
        const counts = {
            ALL: items.length,
            RECEIVED: 0,
            HELD_IN_SAFE: 0,
            DEPOSITED: 0,
            CLEARED: 0,
            BOUNCED: 0
        };
        items.forEach(item => {
            const st = item.pdc_status || 'CLEARED';
            if (counts[st] !== undefined) {
                counts[st] += 1;
            }
        });
        return counts;
    }, [items]);

    // Client-side filtering for search & maturity status
    const filteredItems = useMemo(() => {
        return items.filter(item => {
            // Text Search Filter
            const searchLower = searchTerm.trim().toLowerCase();
            if (searchLower) {
                const customerName = (item.company_name || `${item.first_name || ''} ${item.last_name || ''}`).toLowerCase();
                const invoiceNo = (item.invoice_number || '').toLowerCase();
                const refNo = (item.reference_number || '').toLowerCase();
                const paymentId = String(item.payment_id || '');
                const amount = String(item.amount || '');

                const matchesSearch =
                    customerName.includes(searchLower) ||
                    invoiceNo.includes(searchLower) ||
                    refNo.includes(searchLower) ||
                    paymentId.includes(searchLower) ||
                    amount.includes(searchLower);

                if (!matchesSearch) return false;
            }

            // Maturity Filter
            if (maturityFilter && maturityFilter !== 'ALL') {
                if (item.maturity_status !== maturityFilter) return false;
            }

            // PDC Status Filter
            if (pdcStatusFilter && pdcStatusFilter !== 'ALL') {
                if (item.pdc_status !== pdcStatusFilter) return false;
            }

            return true;
        });
    }, [items, searchTerm, maturityFilter, pdcStatusFilter]);

    // Paginated slice of items
    const paginatedItems = useMemo(() => {
        const start = (page - 1) * pageSize;
        return filteredItems.slice(start, start + pageSize);
    }, [filteredItems, page, pageSize]);

    const isFiltered = searchTerm || pdcStatusFilter !== 'ALL' || maturityFilter !== 'ALL';

    const handleClearFilters = () => {
        setSearchTerm('');
        if (onStatusFilterChange) onStatusFilterChange('ALL');
        if (onMaturityFilterChange) onMaturityFilterChange('ALL');
        setPage(1);
    };

    if (loading) {
        return <TableSkeleton />;
    }

    return (
        <div className="space-y-6">
            {/* Header & Filter Toolbar */}
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">PDC &amp; Collections Clearance Desk</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Verify pending cheque clearances, monitor maturity status, or process bounced cheque reversals
                        </p>
                    </div>
                    {/* Quick Stats Chips */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-md font-medium border border-gray-200">
                            Total: <strong className="text-gray-900 font-bold">{items.length}</strong>
                        </span>
                        <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-md font-medium border border-amber-200">
                            Pending: <strong className="text-amber-900 font-bold">{(statusCounts.RECEIVED + statusCounts.HELD_IN_SAFE + statusCounts.DEPOSITED)}</strong>
                        </span>
                        <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-md font-medium border border-emerald-200">
                            Cleared: <strong className="text-emerald-900 font-bold">{statusCounts.CLEARED}</strong>
                        </span>
                        <span className="px-2.5 py-1 bg-rose-50 text-rose-700 rounded-md font-medium border border-rose-200">
                            Bounced: <strong className="text-rose-900 font-bold">{statusCounts.BOUNCED}</strong>
                        </span>
                    </div>
                </div>

                {/* Filter Controls Row */}
                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
                    {/* Search Bar & Maturity Filter */}
                    <div className="flex flex-wrap items-center gap-3 flex-1">
                        {/* Search Input */}
                        <div className="relative min-w-[240px] flex-1 sm:flex-initial">
                            <input
                                type="text"
                                placeholder="Search customer, invoice #, ref..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                            />
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                                🔍
                            </div>
                            {searchTerm && (
                                <button
                                    onClick={() => setSearchTerm('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs p-1"
                                >
                                    ✕
                                </button>
                            )}
                        </div>

                        {/* Maturity Filter Select */}
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">Maturity:</label>
                            <select
                                value={maturityFilter}
                                onChange={(e) => onMaturityFilterChange && onMaturityFilterChange(e.target.value)}
                                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
                            >
                                <option value="ALL">All Maturity Statuses</option>
                                <option value="DUE_TODAY">Due Today / Mature</option>
                                <option value="FUTURE_PDC">Post-Dated Cheques</option>
                                <option value="STALE_CHEQUE">Stale Cheques (&gt;6 mos)</option>
                            </select>
                        </div>

                        {/* Clear Filters Button */}
                        {isFiltered && (
                            <button
                                onClick={handleClearFilters}
                                className="px-3 py-2 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-1"
                            >
                                <span>✕</span> Reset Filters
                            </button>
                        )}
                    </div>

                    {/* PDC Status Pills */}
                    <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                        {['ALL', 'RECEIVED', 'HELD_IN_SAFE', 'DEPOSITED', 'CLEARED', 'BOUNCED'].map(st => {
                            const isActive = pdcStatusFilter === st;
                            const count = statusCounts[st] || 0;
                            return (
                                <button
                                    key={st}
                                    type="button"
                                    onClick={() => onStatusFilterChange && onStatusFilterChange(st)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                                        isActive
                                            ? 'bg-gray-900 text-white shadow-xs'
                                            : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    <span>{st.replace(/_/g, ' ')}</span>
                                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                                        isActive ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-700'
                                    }`}>
                                        {count}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* Table Section */}
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-6 py-3.5">Customer</th>
                                <th className="px-6 py-3.5">Received Date</th>
                                <th className="px-6 py-3.5">Date on Cheque (Maturity)</th>
                                <th className="px-6 py-3.5">Cheque / Ref #</th>
                                <th className="px-6 py-3.5 text-right">Amount</th>
                                <th className="px-6 py-3.5">Maturity Status</th>
                                <th className="px-6 py-3.5">PDC Status</th>
                                <th className="px-6 py-3.5 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {paginatedItems.map(item => (
                                <tr key={item.payment_id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-6 py-4 font-semibold text-gray-900">
                                        {item.company_name || `${item.first_name || ''} ${item.last_name || ''}`.trim() || 'Walk-in Customer'}
                                        {item.invoice_number && (
                                            <div className="text-xs font-normal text-gray-400">
                                                {item.invoice_count > 1
                                                    ? <span className="inline-flex items-center gap-1"><span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded font-bold">{item.invoice_count} invoices</span> {item.invoice_number}</span>
                                                    : `Inv: #${item.invoice_number}`
                                                }
                                            </div>
                                        )}
                                    </td>
                                    <td className="px-6 py-4 text-xs text-gray-600">
                                        {new Date(item.payment_date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 font-semibold text-xs text-blue-900">
                                        {item.cheque_date ? new Date(item.cheque_date).toLocaleDateString() : new Date(item.payment_date).toLocaleDateString()}
                                    </td>
                                    <td className="px-6 py-4 font-mono font-medium text-gray-800">
                                        {item.reference_number || `#${item.payment_id}`}
                                    </td>
                                    <td className="px-6 py-4 font-mono text-right font-bold text-gray-900">
                                        {formatCurrency(item.amount)}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                            item.maturity_status === 'FUTURE_PDC' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                                            item.maturity_status === 'STALE_CHEQUE' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                                            'bg-amber-100 text-amber-800 border border-amber-200'
                                        }`}>
                                            {item.maturity_label || 'Due for Clearance'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col items-start gap-1">
                                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${
                                                item.pdc_status === 'CLEARED' ? 'bg-emerald-100 text-emerald-800' :
                                                item.pdc_status === 'BOUNCED' ? 'bg-red-100 text-red-800' :
                                                item.pdc_status === 'DEPOSITED' ? 'bg-indigo-100 text-indigo-800' :
                                                item.pdc_status === 'HELD_IN_SAFE' ? 'bg-purple-100 text-purple-800' :
                                                'bg-amber-100 text-amber-800'
                                            }`}>
                                                {item.pdc_status}
                                            </span>
                                            {item.bounce_count > 0 && (
                                                <span className="text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
                                                    ⚠️ {item.bounce_count} {item.bounce_count === 1 ? 'Bounce' : 'Bounces'}
                                                </span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center whitespace-nowrap">
                                        <div className="flex justify-center items-center gap-2">
                                            {item.pdc_status !== 'CLEARED' && item.pdc_status !== 'BOUNCED' ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        onClick={() => onVerifyClearance && onVerifyClearance({ ...item, action: 'clear' })}
                                                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer"
                                                    >
                                                        <span>✓</span> Verify Clearance
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => onMarkBounced && onMarkBounced({ ...item, action: 'bounce' })}
                                                        className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer"
                                                    >
                                                        <span>⚠️</span> Mark Bounced
                                                    </button>
                                                </>
                                            ) : item.pdc_status === 'CLEARED' ? (
                                                <>
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                                        <span>✓</span> Cleared
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => onMarkBounced && onMarkBounced({ ...item, action: 'bounce' })}
                                                        className="text-[11px] font-semibold text-rose-600 hover:text-rose-800 hover:underline cursor-pointer"
                                                        title="Report retroactive cheque bounce"
                                                    >
                                                        Report Bounce
                                                    </button>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-red-50 text-red-700 border border-red-200">
                                                        <span>⚠️</span> Bounced
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => (onRedepositCheque || onVerifyClearance) && (onRedepositCheque ? onRedepositCheque({ ...item, action: 'redeposit' }) : onVerifyClearance({ ...item, action: 'redeposit' }))}
                                                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer"
                                                        title="Re-deposit bounced cheque for bank clearing process"
                                                    >
                                                        <span>🔄</span> Re-deposit
                                                    </button>
                                                </>
                                            )}
                                            {onViewHistory && (
                                                <button
                                                    type="button"
                                                    onClick={() => onViewHistory(item)}
                                                    className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition-all border border-gray-200 cursor-pointer"
                                                    title="View complete clearance & bounce history timeline"
                                                >
                                                    📜 History
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredItems.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="px-6 py-12 text-center text-gray-500">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <span className="text-2xl">📋</span>
                                            <p className="font-semibold text-gray-700">No cheque / PDC items found</p>
                                            <p className="text-xs text-gray-400">Try adjusting your search criteria, PDC status filter, or maturity filter.</p>
                                            {isFiltered && (
                                                <button
                                                    onClick={handleClearFilters}
                                                    className="mt-2 text-xs text-blue-600 font-semibold hover:underline"
                                                >
                                                    Reset all filters
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Controls */}
                {filteredItems.length > 0 && (
                    <div className="p-4 border-t border-gray-100">
                        <PaginationControls
                            page={page}
                            pageSize={pageSize}
                            total={filteredItems.length}
                            onPageChange={setPage}
                            onPageSizeChange={(newSize) => {
                                setPageSize(newSize);
                                setPage(1);
                            }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default PdcClearanceDeskTable;
