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
    };

    const handleDateChanged = async (result) => {
        setSelectedGrn((prev) => (prev ? { ...prev, receipt_date: result.new_date } : prev));
        await fetchGrns();
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
            toast.error('Failed to save changes');
        }
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
    const hasChangeDatePermission = hasPermission(['transaction:change_date', 'transaction:change_date_unrestricted']);

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
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                            {loading ? (
                                <tr>
                                    <td colSpan="4" className="p-8 text-center text-gray-500 dark:text-slate-400">
                                        Loading...
                                    </td>
                                </tr>
                            ) : grns.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="p-8 text-center text-gray-500 dark:text-slate-400">
                                        No goods receipts found
                                    </td>
                                </tr>
                            ) : (
                                grns.map((grn) => (
                                    <tr
                                        key={grn.grn_id}
                                        className="hover:bg-gray-50 dark:hover:bg-slate-700/40 cursor-pointer text-gray-800 dark:text-slate-200 transition-colors"
                                        onClick={() => handleRowClick(grn)}
                                    >
                                        <td className="p-3 text-sm font-mono font-medium text-gray-900 dark:text-slate-100">{grn.grn_number}</td>
                                        <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                                            {new Date(grn.receipt_date).toLocaleDateString()}
                                        </td>
                                        <td className="p-3 text-sm text-gray-900 dark:text-slate-100 font-medium">{grn.supplier_name}</td>
                                        <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{grn.employee_name}</td>
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
                                <div className="flex items-center">
                                    <div><span className="text-gray-500 dark:text-slate-400">Received Date:</span> <span className="font-semibold">{new Date(selectedGrn.receipt_date).toLocaleDateString()}</span></div>
                                    {hasChangeDatePermission && (
                                        <button
                                            onClick={() => setShowChangeDate(true)}
                                            className="ml-4 px-3 py-1 text-xs font-semibold rounded-lg shadow-xs bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                                        >
                                            Change Date
                                        </button>
                                    )}
                                    {hasEditPermission && (
                                        <button
                                            onClick={handleEditClick}
                                            className={`ml-2 px-3 py-1 text-xs font-semibold rounded-lg shadow-xs transition-colors ${
                                                isEditMode
                                                    ? 'bg-success-600 text-white hover:bg-success-700'
                                                    : 'bg-primary-600 text-white hover:bg-primary-700'
                                            }`}
                                        >
                                            <Icon path={isEditMode ? ICONS.check : ICONS.edit} className="inline h-3.5 w-3.5 mr-1" />
                                            {isEditMode ? 'Save' : 'Edit'}
                                        </button>
                                    )}
                                </div>
                                <div>
                                    <span className="text-gray-500 dark:text-slate-400">Received By:</span> <span className="font-semibold">{selectedGrn.employee_name}</span>
                                </div>
                            </div>
                        )}

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border border-gray-200 dark:border-slate-700 rounded-xl overflow-hidden">
                                <thead className="bg-gray-50 dark:bg-slate-700/40 border-b border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300">
                                    <tr>
                                        <th className="p-3 text-sm font-semibold">Part SKU</th>
                                        <th className="p-3 text-sm font-semibold">Part Name</th>
                                        <th className="p-3 text-sm font-semibold text-center">Qty Received</th>
                                        <th className="p-3 text-sm font-semibold text-right">Cost Price</th>
                                        <th className="p-3 text-sm font-semibold text-right">Sale Price</th>
                                        <th className="p-3 text-sm font-semibold text-right">Line Total</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                                    {(isEditMode ? editedLines : grnLines).map((line, index) => (
                                        <tr key={index} className="hover:bg-gray-50 dark:hover:bg-slate-700/40 text-gray-800 dark:text-slate-200">
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
                                                    `₱${parseFloat(line.cost_price).toFixed(2)}`
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
                                                    line.sale_price ? `₱${parseFloat(line.sale_price).toFixed(2)}` : '-'
                                                )}
                                            </td>
                                            <td className="p-3 text-sm text-right font-mono font-medium text-gray-900 dark:text-slate-100">
                                                ₱{(parseFloat(line.quantity) * parseFloat(line.cost_price)).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {selectedGrn && <TransactionDateHistory kind="goods_receipt" id={selectedGrn.grn_id} />}
                    </div>
                )}
            </Modal>

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
