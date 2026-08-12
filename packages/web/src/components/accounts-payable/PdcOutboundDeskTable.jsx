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

const PURPOSE_LABELS = {
    SUPPLIER_PAYMENT: 'Supplier Bill',
    LOAN_PAYMENT: 'Loan Payment',
    RENT: 'Rent',
    OTHER_EXPENSE: 'Other Expense',
};

const PdcOutboundDeskTable = ({
    items = [],
    loading = false,
    pdcStatusFilter = 'ALL',
    onStatusFilterChange,
    maturityFilter = 'ALL',
    onMaturityFilterChange,
    onVerifyClearance,
    onMarkBounced,
    onRedepositCheque,
    onVoidCheque,
    onReplaceCheque,
    onViewHistory,
    onPrintCheque,
}) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);

    useEffect(() => {
        setPage(1);
    }, [searchTerm, pdcStatusFilter, maturityFilter]);

    const statusCounts = useMemo(() => {
        const counts = {
            ALL: items.length,
            ISSUED: 0, HELD_FOR_RELEASE: 0, DEPOSITED: 0, CLEARED: 0, BOUNCED: 0, VOID: 0, REPLACED: 0,
        };
        items.forEach(item => {
            const st = item.pdc_status || 'ISSUED';
            if (counts[st] !== undefined) counts[st] += 1;
        });
        return counts;
    }, [items]);

    const filteredItems = useMemo(() => {
        return items.filter(item => {
            const searchLower = searchTerm.trim().toLowerCase();
            if (searchLower) {
                const payee = (item.company_name || item.payee || '').toLowerCase();
                const chequeNo = (item.cheque_number || '').toLowerCase();
                const bank = (item.bank_account_name || '').toLowerCase();
                const amount = String(item.amount || '');
                const matchesSearch =
                    payee.includes(searchLower) || chequeNo.includes(searchLower) ||
                    bank.includes(searchLower) || amount.includes(searchLower);
                if (!matchesSearch) return false;
            }
            if (maturityFilter && maturityFilter !== 'ALL' && item.maturity_status !== maturityFilter) return false;
            if (pdcStatusFilter && pdcStatusFilter !== 'ALL' && item.pdc_status !== pdcStatusFilter) return false;
            return true;
        });
    }, [items, searchTerm, maturityFilter, pdcStatusFilter]);

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

    if (loading) return <TableSkeleton />;

    return (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-gray-100 pb-4">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">Outbound Cheque Register</h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Supplier, loan, rent, and other cheques issued by the business — issue, verify clearance, void, or replace
                        </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="px-2.5 py-1 bg-gray-100 text-gray-700 rounded-md font-medium border border-gray-200">
                            Total: <strong className="text-gray-900 font-bold">{items.length}</strong>
                        </span>
                        <span className="px-2.5 py-1 bg-amber-50 text-amber-700 rounded-md font-medium border border-amber-200">
                            Pending: <strong className="text-amber-900 font-bold">{(statusCounts.ISSUED + statusCounts.HELD_FOR_RELEASE + statusCounts.DEPOSITED)}</strong>
                        </span>
                        <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 rounded-md font-medium border border-emerald-200">
                            Cleared: <strong className="text-emerald-900 font-bold">{statusCounts.CLEARED}</strong>
                        </span>
                        <span className="px-2.5 py-1 bg-rose-50 text-rose-700 rounded-md font-medium border border-rose-200">
                            Bounced: <strong className="text-rose-900 font-bold">{statusCounts.BOUNCED}</strong>
                        </span>
                    </div>
                </div>

                <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-3 flex-1">
                        <div className="relative min-w-[240px] flex-1 sm:flex-initial">
                            <input
                                type="text"
                                placeholder="Search payee, cheque #, bank..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-9 pr-8 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                            />
                            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</div>
                            {searchTerm && (
                                <button onClick={() => setSearchTerm('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-xs p-1">✕</button>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="text-xs font-semibold text-gray-600 uppercase whitespace-nowrap">Maturity:</label>
                            <select
                                value={maturityFilter}
                                onChange={(e) => onMaturityFilterChange && onMaturityFilterChange(e.target.value)}
                                className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-700"
                            >
                                <option value="ALL">All Maturity Statuses</option>
                                <option value="DUE_TODAY">Due Today / Mature</option>
                                <option value="FUTURE_PDC">Future PDC</option>
                                <option value="STALE_CHEQUE">Stale Cheques (&gt;6 mos)</option>
                            </select>
                        </div>
                        {isFiltered && (
                            <button onClick={handleClearFilters} className="px-3 py-2 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors flex items-center gap-1">
                                <span>✕</span> Reset Filters
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 lg:pb-0">
                        {['ALL', 'ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'VOID', 'REPLACED'].map(st => {
                            const isActive = pdcStatusFilter === st;
                            const count = statusCounts[st] || 0;
                            return (
                                <button
                                    key={st}
                                    type="button"
                                    onClick={() => onStatusFilterChange && onStatusFilterChange(st)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all flex items-center gap-1.5 whitespace-nowrap cursor-pointer ${
                                        isActive ? 'bg-gray-900 text-white shadow-xs' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                    }`}
                                >
                                    <span>{st.replace(/_/g, ' ')}</span>
                                    <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${isActive ? 'bg-gray-700 text-white' : 'bg-gray-200 text-gray-700'}`}>{count}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left text-gray-500">
                        <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b border-gray-200">
                            <tr>
                                <th className="px-4 py-3.5">Bank Account</th>
                                <th className="px-4 py-3.5">Cheque #</th>
                                <th className="px-4 py-3.5">Payee / Supplier</th>
                                <th className="px-4 py-3.5">Purpose</th>
                                <th className="px-4 py-3.5">Cheque Date (Maturity)</th>
                                <th className="px-4 py-3.5 text-right">Amount</th>
                                <th className="px-4 py-3.5">Maturity Status</th>
                                <th className="px-4 py-3.5">PDC Status</th>
                                <th className="px-4 py-3.5 text-center">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                            {paginatedItems.map(item => (
                                <tr key={item.cheque_record_id} className="hover:bg-gray-50 transition-colors">
                                    <td className="px-4 py-4 text-xs text-gray-600">{item.bank_account_name || '—'}</td>
                                    <td className="px-4 py-4 font-mono font-medium text-gray-800">{item.cheque_number || `#${item.cheque_record_id}`}</td>
                                    <td className="px-4 py-4 font-semibold text-gray-900">{item.company_name || item.payee}</td>
                                    <td className="px-4 py-4 text-xs">
                                        <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-md border border-gray-200">
                                            {PURPOSE_LABELS[item.purpose_type] || item.purpose_type}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4 font-semibold text-xs text-blue-900">
                                        {item.cheque_date ? new Date(item.cheque_date).toLocaleDateString() : '—'}
                                    </td>
                                    <td className="px-4 py-4 font-mono text-right font-bold text-gray-900">{formatCurrency(item.amount)}</td>
                                    <td className="px-4 py-4">
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                                            item.maturity_status === 'FUTURE_PDC' ? 'bg-blue-100 text-blue-800 border border-blue-200' :
                                            item.maturity_status === 'STALE_CHEQUE' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                                            'bg-amber-100 text-amber-800 border border-amber-200'
                                        }`}>
                                            {item.maturity_label || 'Due for Clearance'}
                                        </span>
                                    </td>
                                    <td className="px-4 py-4">
                                        <div className="flex flex-col items-start gap-1">
                                            <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase ${
                                                item.pdc_status === 'CLEARED' ? 'bg-emerald-100 text-emerald-800' :
                                                item.pdc_status === 'BOUNCED' ? 'bg-red-100 text-red-800' :
                                                item.pdc_status === 'DEPOSITED' ? 'bg-indigo-100 text-indigo-800' :
                                                item.pdc_status === 'VOID' ? 'bg-gray-200 text-gray-600' :
                                                item.pdc_status === 'REPLACED' ? 'bg-slate-200 text-slate-600' :
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
                                    <td className="px-4 py-4 text-center whitespace-nowrap">
                                        <div className="flex justify-center items-center gap-1.5 flex-wrap">
                                            {['ISSUED', 'HELD_FOR_RELEASE', 'DEPOSITED'].includes(item.pdc_status) && (
                                                <>
                                                    <button type="button" onClick={() => onVerifyClearance && onVerifyClearance(item)}
                                                        className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer">
                                                        ✓ Clear
                                                    </button>
                                                    <button type="button" onClick={() => onMarkBounced && onMarkBounced(item)}
                                                        className="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer">
                                                        ⚠️ Bounce
                                                    </button>
                                                </>
                                            )}
                                            {['ISSUED', 'HELD_FOR_RELEASE'].includes(item.pdc_status) && (
                                                <button type="button" onClick={() => onVoidCheque && onVoidCheque(item)}
                                                    className="px-2.5 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-xs font-bold cursor-pointer"
                                                    title="Void this cheque — written incorrectly, never handed over">
                                                    ✕ Void
                                                </button>
                                            )}
                                            {item.pdc_status === 'BOUNCED' && (
                                                <>
                                                    <button type="button" onClick={() => onRedepositCheque && onRedepositCheque(item)}
                                                        className="px-2.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer">
                                                        🔄 Re-deposit
                                                    </button>
                                                    <button type="button" onClick={() => onReplaceCheque && onReplaceCheque(item)}
                                                        className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer"
                                                        title="Issue a replacement cheque for the same obligation">
                                                        ⟳ Replace
                                                    </button>
                                                </>
                                            )}
                                            {item.maturity_status === 'STALE_CHEQUE' && !['CLEARED', 'VOID', 'REPLACED'].includes(item.pdc_status) && (
                                                <button type="button" onClick={() => onReplaceCheque && onReplaceCheque(item)}
                                                    className="px-2.5 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer">
                                                    ⟳ Replace (Stale)
                                                </button>
                                            )}
                                            {onPrintCheque && ['ISSUED', 'HELD_FOR_RELEASE'].includes(item.pdc_status) && (
                                                <button type="button" onClick={() => onPrintCheque(item)}
                                                    className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold border border-gray-200 cursor-pointer">
                                                    🖨️ Print
                                                </button>
                                            )}
                                            {onViewHistory && (
                                                <button type="button" onClick={() => onViewHistory(item)}
                                                    className="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold border border-gray-200 cursor-pointer">
                                                    📜 History
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {filteredItems.length === 0 && (
                                <tr>
                                    <td colSpan={9} className="px-6 py-12 text-center text-gray-500">
                                        <div className="flex flex-col items-center justify-center gap-2">
                                            <span className="text-2xl">📤</span>
                                            <p className="font-semibold text-gray-700">No outbound cheques found</p>
                                            <p className="text-xs text-gray-400">Issue a cheque, or adjust your search/status/maturity filters.</p>
                                            {isFiltered && (
                                                <button onClick={handleClearFilters} className="mt-2 text-xs text-blue-600 font-semibold hover:underline">Reset all filters</button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {filteredItems.length > 0 && (
                    <div className="p-4 border-t border-gray-100">
                        <PaginationControls
                            page={page}
                            pageSize={pageSize}
                            total={filteredItems.length}
                            onPageChange={setPage}
                            onPageSizeChange={(newSize) => { setPageSize(newSize); setPage(1); }}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};

export default PdcOutboundDeskTable;
