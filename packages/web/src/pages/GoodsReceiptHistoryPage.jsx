import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import SearchBar from '../components/SearchBar';
import SortableHeader from '../components/ui/SortableHeader';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import PaginationControls from '../components/ui/PaginationControls';
import { useAuth } from '../contexts/AuthContext';
import ChangeTransactionDateModal from '../components/common/ChangeTransactionDateModal';
import TransactionDateHistory from '../components/common/TransactionDateHistory';
import ReturnLineModal from '../components/goods-receipt/ReturnLineModal';
import { formatCurrency } from '../utils/currency';

const num = (value) => parseFloat(value) || 0;
const returnedQty = (line) => Math.max(0, num(line.return_quantity));
// What the receipt actually kept. Every figure on this page is derived from this rather
// than from the delivered quantity, because a line that went back is no longer stock
// and is no longer owed for.
const acceptedQty = (line) => Math.max(0, num(line.quantity) - returnedQty(line));

const GoodsReceiptHistoryPage = ({ user: _user }) => {
    const { hasPermission } = useAuth();
    const [grns, setGrns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const debounceRef = useRef(null);
    const [sortConfig, setSortConfig] = useState({ key: 'receipt_date', direction: 'DESC' });
    const [selectedGrn, setSelectedGrn] = useState(null);
    const [grnLines, setGrnLines] = useState([]);
    const [modalLoading, setModalLoading] = useState(false);
    const [isEditMode, setIsEditMode] = useState(false);
    const [editedLines, setEditedLines] = useState([]);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [showChangeDate, setShowChangeDate] = useState(false);
    const [returnTargetLine, setReturnTargetLine] = useState(null);

    const fetchGrns = useCallback(async () => {
        try {
            setLoading(true);
            const params = {
                q: debouncedQuery || undefined,
                sortBy: sortConfig.key,
                sortOrder: sortConfig.direction.toLowerCase(),
                page,
                pageSize,
                paginated: 1
            };
            const response = await api.get('/goods-receipts', { params });
            setGrns(response.data?.data || []);
            setTotal(response.data?.total || 0);
        } catch (error) {
            console.error('Error fetching GRNs:', error);
            toast.error('Failed to load goods receipt history');
        } finally {
            setLoading(false);
        }
    }, [debouncedQuery, sortConfig, page, pageSize]);

    useEffect(() => {
        fetchGrns();
    }, [fetchGrns]);

    // Debounce the search input
    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setDebouncedQuery(query.trim());
        }, 300);
        return () => debounceRef.current && clearTimeout(debounceRef.current);
    }, [query]);

    const handleSort = (key, direction) => {
        setSortConfig({ key, direction });
        setPage(1);
    };

    useEffect(() => {
        setPage(1);
    }, [debouncedQuery]);

    const handleRowClick = async (grn) => {
        setSelectedGrn(grn);
        setModalLoading(true);
        setIsEditMode(false);
        setShowChangeDate(false);
        setReturnTargetLine(null);
        try {
            console.log('Fetching GRN lines for:', grn.grn_id);
            const response = await api.get(`/goods-receipts/${grn.grn_id}/lines`);
            console.log('API Response:', response.data);
            
            // Add more detailed logging about each line
            const processedLines = response.data.map(line => {
                const processed = { ...line };
                console.log('Processing line in handleRowClick:', {
                    original: line,
                    processed,
                    part_id: processed.part_id
                });
                return processed;
            });
            
            setGrnLines(response.data);
            setEditedLines(processedLines);
        } catch (error) {
            console.error('Error fetching GRN lines:', error);
            toast.error('Failed to load GRN details');
        } finally {
            setModalLoading(false);
        }
    };

    const closeModal = () => {
        setSelectedGrn(null);
        setGrnLines([]);
        setIsEditMode(false);
        setEditedLines([]);
        setShowChangeDate(false);
        setReturnTargetLine(null);
    };

    const handleDateChanged = async (result) => {
        setSelectedGrn((prev) => (prev ? { ...prev, receipt_date: result.new_date } : prev));
        await fetchGrns();
    };

    const handleVoid = async () => {
        if (!selectedGrn) return;
        // Units already sent back were reversed when the return was recorded, so the void
        // only unwinds what is still accepted. Say so, or the reversal looks short.
        const alreadyReturned = grnLines.reduce((sum, line) => sum + returnedQty(line), 0);
        const returnNote = alreadyReturned > 0
            ? `\n\nNote: ${alreadyReturned} unit(s) on this receipt were already returned to the supplier and reversed at that time. Voiding will only reverse the ${grnLines.reduce((sum, line) => sum + acceptedQty(line), 0)} unit(s) still accepted.`
            : '';
        const reason = window.prompt(
            `Void GRN ${selectedGrn.grn_number}? This will reverse the stock it received, roll back any linked purchase order's received quantities, and reverse its effect on accounts payable. The record is kept for audit history and marked Voided.${returnNote}\n\nOptional: enter a reason for voiding.`
        );
        if (reason === null) return; // user cancelled the prompt
        try {
            await api.delete(`/goods-receipts/${selectedGrn.grn_id}`, { data: { reason: reason || null } });
            toast.success('Goods receipt voided');
            closeModal();
            await fetchGrns();
        } catch (error) {
            toast.error(error?.response?.data?.message || 'Failed to void goods receipt');
        }
    };

    const handleEditClick = async () => {
        if (!isEditMode) {
            // Enter edit mode
            setIsEditMode(true);
        } else {
            // Save changes
            await handleSaveChanges();
        }
    };

    const handleSaveChanges = async () => {
        try {
            console.log('Preparing payload for GRN update...');
            console.log('Current edited lines:', editedLines);
            console.log('Edited lines details:', editedLines.map((line, index) => ({
                index,
                sku: line.internal_sku,
                part_id: line.part_id,
                allProps: Object.keys(line)
            })));
            
            const payload = {
                received_by: _user.employee_id,
                lines: editedLines.map((line, index) => {
                    console.log(`Processing line ${index}:`, {
                        line,
                        part_id: line.part_id,
                        internal_sku: line.internal_sku,
                        prototype: Object.getPrototypeOf(line)
                    });
                    
                    // Add validation to ensure part_id exists
                    if (!line.part_id) {
                        console.error('Missing part_id in line:', line);
                        
                        // Try to get part_id from a lookup if we have the internal_sku
                        if (line.internal_sku) {
                            console.log('Attempting to resolve part_id from internal_sku:', line.internal_sku);
                            // For now, throw error - we'll add API call if needed
                            throw new Error(`Missing part_id for line with SKU: ${line.internal_sku}. Please close and reopen this GRN to refresh the data.`);
                        } else {
                            throw new Error(`Missing part_id and internal_sku for line ${index}`);
                        }
                    }
                    
                    // Editing the received quantity below what has already gone back to the
                    // supplier would leave the line with a negative accepted quantity, and the
                    // stock and payable reversals for those units have already happened.
                    const returned = returnedQty(line);
                    if (returned > 0 && parseFloat(line.quantity) < returned - 0.0001) {
                        throw new Error(
                            `${line.internal_sku || `Line ${index + 1}`}: the received quantity cannot be less than the ${returned} already returned to the supplier.`
                        );
                    }

                    const processedLine = {
                        part_id: line.part_id,
                        quantity: parseFloat(line.quantity),
                        cost_price: parseFloat(line.cost_price),
                        sale_price: line.sale_price ? parseFloat(line.sale_price) : null
                    };
                    
                    console.log(`Processed line ${index}:`, processedLine);
                    return processedLine;
                })
            };
            console.log('Final payload:', payload);

            await api.put(`/goods-receipts/${selectedGrn.grn_id}`, payload);
            toast.success('Goods receipt updated successfully');

            // Refresh the data
            await fetchGrns();
            const response = await api.get(`/goods-receipts/${selectedGrn.grn_id}/lines`);
            setGrnLines(response.data);
            setEditedLines(response.data.map(line => ({ ...line })));
            setIsEditMode(false);
        } catch (error) {
            console.error('Error saving changes:', error);
            toast.error(error?.response?.data?.message || error?.message || 'Failed to save changes');
        }
    };

    // Recording a return against a posted receipt reverses stock at the original landed
    // cost, replays the weighted average, rolls back the purchase order and credits the
    // supplier's bill — all server-side, in one transaction. Freight and the header
    // discount are shared across lines, so every line's landed cost moves: reload the
    // whole document rather than patching the one row.
    const handleReturnLine = async ({ return_quantity, rejection_reason, notes }) => {
        if (!selectedGrn || !returnTargetLine) return;
        await toast.promise(
            api.post(
                `/goods-receipts/${selectedGrn.grn_id}/lines/${returnTargetLine.grn_line_id}/return`,
                { return_quantity, rejection_reason, notes },
            ),
            {
                loading: 'Recording return...',
                success: (res) => res.data.message,
                error: (err) => err?.response?.data?.message || 'Could not record the return.',
            },
        );
        const response = await api.get(`/goods-receipts/${selectedGrn.grn_id}/lines`);
        setGrnLines(response.data);
        setEditedLines(response.data.map((line) => ({ ...line })));
        await fetchGrns();
    };

    const handleLineChange = (index, field, value) => {
        const updatedLines = [...editedLines];
        const currentLine = updatedLines[index];
        console.log('handleLineChange - Before update:', {
            index,
            field,
            value,
            currentLine,
            part_id: currentLine.part_id
        });
        
        updatedLines[index] = {
            ...currentLine,
            [field]: value
        };
        
        console.log('handleLineChange - After update:', {
            updatedLine: updatedLines[index],
            part_id: updatedLines[index].part_id
        });
        
        setEditedLines(updatedLines);
    };

    const hasEditPermission = hasPermission('goods_receipt:edit');
    const hasVoidPermission = hasPermission('goods_receipt:void');
    const hasReturnPermission = hasPermission('goods_receipt:return');
    const hasChangeDatePermission = hasPermission(['transaction:change_date', 'transaction:change_date_unrestricted']);
    const isVoided = selectedGrn?.status === 'Voided';
    const displayLines = isEditMode ? editedLines : grnLines;
    const totalQuantity = displayLines.reduce((sum, line) => sum + num(line.quantity), 0);
    const totalReturned = displayLines.reduce((sum, line) => sum + returnedQty(line), 0);
    const totalAccepted = displayLines.reduce((sum, line) => sum + acceptedQty(line), 0);
    const totalAmount = displayLines.reduce((sum, line) => sum + (acceptedQty(line) * num(line.cost_price)), 0);
    // A cancelled receipt is frozen; the return endpoint refuses it, so do not offer it.
    const canReturn = hasReturnPermission && !isVoided && !isEditMode
        && selectedGrn?.workflow_status !== 'Cancelled';

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Goods Receipt History</h1>
            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 space-y-6 shadow-card">
                <div className="flex items-center space-x-4">
                    <div className="flex-1 max-w-md">
                        <SearchBar
                            value={query}
                            onChange={setQuery}
                            onClear={() => setQuery('')}
                            placeholder="Search GRN #, supplier, or part details..."
                        />
                    </div>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                        <thead className="bg-gray-50 dark:bg-slate-700/40 border-b border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300">
                            <tr>
                                <SortableHeader column="grn_number" sortConfig={sortConfig} onSort={handleSort}>
                                    GRN #
                                </SortableHeader>
                                <SortableHeader column="receipt_date" sortConfig={sortConfig} onSort={handleSort}>
                                    Date
                                </SortableHeader>
                                <SortableHeader column="supplier_name" sortConfig={sortConfig} onSort={handleSort}>
                                    Supplier
                                </SortableHeader>
                                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300">Received By</th>
                                <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-gray-500 dark:text-slate-400">
                                        Loading...
                                    </td>
                                </tr>
                            ) : grns.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-gray-500 dark:text-slate-400">
                                        No goods receipts found
                                    </td>
                                </tr>
                            ) : (
                                grns.map((grn) => (
                                    <tr
                                        key={grn.grn_id}
                                        className={`hover:bg-gray-50 dark:hover:bg-slate-700/40 cursor-pointer transition-colors ${
                                            grn.status === 'Voided'
                                                ? 'text-gray-400 dark:text-slate-500'
                                                : 'text-gray-800 dark:text-slate-200'
                                        }`}
                                        onClick={() => handleRowClick(grn)}
                                    >
                                        <td className={`p-3 text-sm font-mono font-medium ${grn.status === 'Voided' ? 'line-through' : 'text-gray-900 dark:text-slate-100'}`}>{grn.grn_number}</td>
                                        <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                                            {new Date(grn.receipt_date).toLocaleDateString()}
                                        </td>
                                        <td className={`p-3 text-sm font-medium ${grn.status === 'Voided' ? '' : 'text-gray-900 dark:text-slate-100'}`}>{grn.supplier_name}</td>
                                        <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{grn.employee_name}</td>
                                        <td className="p-3 text-sm">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${
                                                grn.status === 'Voided'
                                                    ? 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-500'
                                                    : 'bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-400'
                                            }`}>
                                                {grn.status === 'Voided' ? 'Voided' : 'Active'}
                                            </span>
                                            {grn.is_backfill && (
                                                <span
                                                    className="ml-2 px-2 py-1 text-xs font-semibold rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-400"
                                                    title={grn.supplier_invoice_no ? `Supplier invoice ${grn.supplier_invoice_no}` : undefined}
                                                >
                                                    Backfill
                                                </span>
                                            )}
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
                <PaginationControls
                    page={page}
                    pageSize={pageSize}
                    total={total}
                    onPageChange={setPage}
                    onPageSizeChange={(value) => {
                        setPageSize(value);
                        setPage(1);
                    }}
                />
            </div>

            <Modal
                isOpen={!!selectedGrn}
                onClose={closeModal}
                title={`Details for ${selectedGrn?.grn_number || ''}`}
                maxWidth="max-w-7xl"
            >
                {modalLoading ? (
                    <div className="p-6 text-center text-gray-500 dark:text-slate-400">Loading details...</div>
                ) : (
                    <div className="space-y-4">
                        {selectedGrn && (
                            <div className="grid grid-cols-2 gap-4 text-sm bg-gray-50 dark:bg-slate-900/50 p-4 rounded-xl border border-gray-100 dark:border-slate-700 text-gray-900 dark:text-slate-100">
                                <div>
                                    <span className="text-gray-500 dark:text-slate-400">Supplier:</span> <span className="font-semibold">{selectedGrn.supplier_name}</span>
                                </div>
                                <div className="flex items-center flex-wrap gap-2">
                                    <div><span className="text-gray-500 dark:text-slate-400">Received Date:</span> <span className="font-semibold">{new Date(selectedGrn.receipt_date).toLocaleDateString()}</span></div>
                                    {isVoided && (
                                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-500">
                                            Voided
                                        </span>
                                    )}
                                    {!isVoided && hasChangeDatePermission && (
                                        <button
                                            onClick={() => setShowChangeDate(true)}
                                            className="px-3 py-1 text-xs font-semibold rounded-lg shadow-xs bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                                        >
                                            Change Date
                                        </button>
                                    )}
                                    {!isVoided && hasEditPermission && (
                                        <button
                                            onClick={handleEditClick}
                                            className={`px-3 py-1 text-xs font-semibold rounded-lg shadow-xs transition-colors ${
                                                isEditMode
                                                    ? 'bg-success-600 text-white hover:bg-success-700'
                                                    : 'bg-primary-600 text-white hover:bg-primary-700'
                                            }`}
                                        >
                                            <Icon path={isEditMode ? ICONS.check : ICONS.edit} className="inline h-3.5 w-3.5 mr-1" />
                                            {isEditMode ? 'Save' : 'Edit'}
                                        </button>
                                    )}
                                    {!isVoided && hasVoidPermission && (
                                        <button
                                            onClick={handleVoid}
                                            className="px-3 py-1 text-xs font-semibold rounded-lg shadow-xs bg-white dark:bg-slate-800 border border-danger-300 dark:border-danger-700 text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors"
                                        >
                                            Void
                                        </button>
                                    )}
                                </div>
                                <div>
                                    <span className="text-gray-500 dark:text-slate-400">Received By:</span> <span className="font-semibold">{selectedGrn.employee_name}</span>
                                </div>
                                <div>
                                    <span className="text-gray-500 dark:text-slate-400">Total Amount:</span>{' '}
                                    <span className="font-semibold font-mono text-gray-900 dark:text-slate-100">{formatCurrency(totalAmount)}</span>
                                </div>
                                {isVoided && (
                                    <div className="col-span-2">
                                        <span className="text-gray-500 dark:text-slate-400">Voided:</span>{' '}
                                        <span className="font-semibold">{selectedGrn.voided_at ? new Date(selectedGrn.voided_at).toLocaleString() : ''}</span>
                                        {selectedGrn.voided_by_name && (
                                            <span className="font-semibold"> by {selectedGrn.voided_by_name}</span>
                                        )}
                                        {selectedGrn.void_reason && (
                                            <span className="block text-xs text-gray-500 dark:text-slate-400 mt-0.5">Reason: {selectedGrn.void_reason}</span>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                                <thead className="bg-gray-50 dark:bg-slate-700/40 border-b border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300">
                                    <tr>
                                        <th className="p-3 text-sm font-semibold">Part SKU</th>
                                        <th className="p-3 text-sm font-semibold">Part Name</th>
                                        <th className="p-3 text-sm font-semibold text-center">Qty Received</th>
                                        <th className="p-3 text-sm font-semibold text-center">Returned</th>
                                        <th className="p-3 text-sm font-semibold text-center">Accepted</th>
                                        <th className="p-3 text-sm font-semibold text-right">Cost Price</th>
                                        <th className="p-3 text-sm font-semibold text-right">Sale Price</th>
                                        <th className="p-3 text-sm font-semibold text-right">Line Total</th>
                                        {canReturn && <th className="p-3 text-sm font-semibold text-right"><span className="sr-only">Actions</span></th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                                    {displayLines.map((line, index) => {
                                      const returned = returnedQty(line);
                                      const accepted = acceptedQty(line);
                                      const fullyReturned = returned > 0 && accepted <= 0;
                                      return (
                                        <tr key={index} className={`hover:bg-gray-50 dark:hover:bg-slate-700/40 text-gray-800 dark:text-slate-200 ${fullyReturned ? 'opacity-60' : ''}`}>
                                            <td className="p-3 text-sm font-mono text-gray-900 dark:text-slate-100">{line.internal_sku}</td>
                                            <td className="p-3 text-sm font-medium text-gray-900 dark:text-slate-100">{line.display_name}</td>
                                            <td className="p-3 text-sm text-center font-mono">
                                                {isEditMode ? (
                                                    <input
                                                        type="number"
                                                        value={line.quantity}
                                                        onChange={(e) => handleLineChange(index, 'quantity', e.target.value)}
                                                        onFocus={(e) => e.target.select()}
                                                        className="w-24 h-8 px-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md text-sm text-center font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                                                        step="0.01"
                                                    />
                                                ) : (
                                                    line.quantity
                                                )}
                                            </td>
                                            <td className="p-3 text-sm text-center font-mono">
                                                {returned > 0 ? (
                                                    <>
                                                        <span className="text-danger-600 dark:text-danger-400 font-medium">{returned}</span>
                                                        {line.rejection_reason && (
                                                            <span className="block text-xs text-gray-500 dark:text-slate-400">{line.rejection_reason}</span>
                                                        )}
                                                    </>
                                                ) : (
                                                    <span className="text-gray-400 dark:text-slate-500">-</span>
                                                )}
                                            </td>
                                            <td className={`p-3 text-sm text-center font-mono ${fullyReturned ? 'line-through text-gray-400 dark:text-slate-500' : 'font-medium text-gray-900 dark:text-slate-100'}`}>
                                                {accepted}
                                            </td>
                                            <td className="p-3 text-sm text-right font-mono text-gray-700 dark:text-slate-300">
                                                {isEditMode ? (
                                                    <input
                                                        type="number"
                                                        value={line.cost_price}
                                                        onChange={(e) => handleLineChange(index, 'cost_price', e.target.value)}
                                                        onFocus={(e) => e.target.select()}
                                                        className="w-24 h-8 px-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                                                        step="0.01"
                                                    />
                                                ) : (
                                                    formatCurrency(line.cost_price)
                                                )}
                                            </td>
                                            <td className="p-3 text-sm text-right font-mono text-gray-700 dark:text-slate-300">
                                                {isEditMode ? (
                                                    <input
                                                        type="number"
                                                        value={line.sale_price || ''}
                                                        onChange={(e) => handleLineChange(index, 'sale_price', e.target.value)}
                                                        onFocus={(e) => e.target.select()}
                                                        className="w-24 h-8 px-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-md text-sm text-right font-mono focus:outline-none focus:ring-2 focus:ring-primary-500"
                                                        step="0.01"
                                                        placeholder="Optional"
                                                    />
                                                ) : (
                                                    line.sale_price ? formatCurrency(line.sale_price) : '-'
                                                )}
                                            </td>
                                            <td className="p-3 text-sm text-right font-mono font-medium text-gray-900 dark:text-slate-100">
                                                {formatCurrency(accepted * num(line.cost_price))}
                                            </td>
                                            {canReturn && (
                                                <td className="p-3 text-sm text-right">
                                                    <button
                                                        onClick={() => setReturnTargetLine(line)}
                                                        disabled={accepted <= 0}
                                                        title={accepted <= 0 ? 'Every unit on this line has already gone back.' : 'Return these units to the supplier'}
                                                        className="px-3 py-1 text-xs font-semibold rounded-lg shadow-xs bg-white dark:bg-slate-800 border border-danger-300 dark:border-danger-700 text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-950/30 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                                    >
                                                        Return
                                                    </button>
                                                </td>
                                            )}
                                        </tr>
                                      );
                                    })}
                                </tbody>
                                {displayLines.length > 0 && (
                                    <tfoot className="bg-gray-50 dark:bg-slate-700/40 border-t border-gray-200 dark:border-slate-700 font-semibold text-gray-900 dark:text-slate-100">
                                        <tr>
                                            <td colSpan="2" className="p-3 text-sm text-right font-semibold text-gray-700 dark:text-slate-300">
                                                Total:
                                            </td>
                                            <td className="p-3 text-sm text-center font-mono">
                                                {totalQuantity}
                                            </td>
                                            <td className="p-3 text-sm text-center font-mono text-danger-600 dark:text-danger-400">
                                                {totalReturned > 0 ? totalReturned : '-'}
                                            </td>
                                            <td className="p-3 text-sm text-center font-mono">
                                                {totalAccepted}
                                            </td>
                                            <td colSpan="2"></td>
                                            <td className="p-3 text-sm text-right font-mono font-bold text-gray-900 dark:text-slate-100">
                                                {formatCurrency(totalAmount)}
                                            </td>
                                            {canReturn && <td></td>}
                                        </tr>
                                    </tfoot>
                                )}
                            </table>
                        </div>

                        {selectedGrn && <TransactionDateHistory kind="goods_receipt" id={selectedGrn.grn_id} />}
                    </div>
                )}
            </Modal>

            <ReturnLineModal
                isOpen={!!returnTargetLine}
                onClose={() => setReturnTargetLine(null)}
                line={returnTargetLine}
                isPosted
                onConfirm={handleReturnLine}
            />

            {selectedGrn && (
                <ChangeTransactionDateModal
                    isOpen={showChangeDate}
                    onClose={() => setShowChangeDate(false)}
                    kind="goods_receipt"
                    id={selectedGrn.grn_id}
                    currentDate={selectedGrn.receipt_date}
                    transactionLabel={`GRN ${selectedGrn.grn_number}`}
                    onApplied={handleDateChanged}
                />
            )}
        </div>
    );
};

export default GoodsReceiptHistoryPage;
