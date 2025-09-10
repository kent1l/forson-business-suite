import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import SearchBar from '../components/SearchBar';
import SortableHeader from '../components/ui/SortableHeader';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import { useAuth } from '../contexts/AuthContext';

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
    const [suppliers, setSuppliers] = useState([]);
    const [selectedSupplier, setSelectedSupplier] = useState('');

    const fetchGrns = useCallback(async () => {
        try {
            setLoading(true);
            const params = {
                q: debouncedQuery || undefined,
                sortBy: sortConfig.key,
                sortOrder: sortConfig.direction.toLowerCase()
            };
            const response = await api.get('/goods-receipts', { params });
            setGrns(response.data);
        } catch (error) {
            console.error('Error fetching GRNs:', error);
            toast.error('Failed to load goods receipt history');
        } finally {
            setLoading(false);
        }
    }, [debouncedQuery, sortConfig]);

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
    };

    const handleRowClick = async (grn) => {
        setSelectedGrn(grn);
        setModalLoading(true);
        setIsEditMode(false);
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
            setSelectedSupplier(grn.supplier_id);
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
    };

    const handleEditClick = async () => {
        if (!isEditMode) {
            // Enter edit mode - fetch suppliers if not already loaded
            if (suppliers.length === 0) {
                try {
                    const response = await api.get('/suppliers');
                    setSuppliers(response.data);
                } catch (error) {
                    console.error('Error fetching suppliers:', error);
                    toast.error('Failed to load suppliers for editing');
                    return;
                }
            }
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
                supplier_id: selectedSupplier,
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

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Goods Receipt History</h1>
            <div className="bg-white p-6 rounded-xl border border-gray-200 space-y-6">
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
                    <table className="w-full text-left border border-gray-200 rounded-lg">
                        <thead className="bg-gray-50">
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
                                <th className="p-3 text-sm font-semibold text-gray-600">Received By</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan="4" className="p-4 text-center text-gray-500">
                                        Loading...
                                    </td>
                                </tr>
                            ) : grns.length === 0 ? (
                                <tr>
                                    <td colSpan="4" className="p-4 text-center text-gray-500">
                                        No goods receipts found
                                    </td>
                                </tr>
                            ) : (
                                grns.map((grn) => (
                                    <tr
                                        key={grn.grn_id}
                                        className="border-b hover:bg-gray-50 cursor-pointer"
                                        onClick={() => handleRowClick(grn)}
                                    >
                                        <td className="p-3 text-sm font-medium text-gray-800">{grn.grn_number}</td>
                                        <td className="p-3 text-sm text-gray-600">
                                            {new Date(grn.receipt_date).toLocaleDateString()}
                                        </td>
                                        <td className="p-3 text-sm text-gray-600">{grn.supplier_name}</td>
                                        <td className="p-3 text-sm text-gray-600">{grn.employee_name}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            <Modal
                isOpen={!!selectedGrn}
                onClose={closeModal}
                title={`Details for ${selectedGrn?.grn_number || ''}`}
                maxWidth="max-w-7xl"
            >
                {modalLoading ? (
                    <div className="p-4 text-center">Loading details...</div>
                ) : (
                    <div className="space-y-4">
                        {selectedGrn && (
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <strong>Supplier:</strong>
                                    {isEditMode ? (
                                        <select
                                            value={selectedSupplier}
                                            onChange={(e) => setSelectedSupplier(e.target.value)}
                                            className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
                                        >
                                            {suppliers.map(supplier => (
                                                <option key={supplier.supplier_id} value={supplier.supplier_id}>
                                                    {supplier.supplier_name}
                                                </option>
                                            ))}
                                        </select>
                                    ) : (
                                        ` ${selectedGrn.supplier_name}`
                                    )}
                                </div>
                                <div>
                                    <strong>Received Date:</strong> {new Date(selectedGrn.receipt_date).toLocaleDateString()}
                                    {hasEditPermission && (
                                        <button
                                            onClick={handleEditClick}
                                            className={`ml-4 px-3 py-1 text-sm font-medium rounded-md ${
                                                isEditMode
                                                    ? 'bg-green-600 text-white hover:bg-green-700'
                                                    : 'bg-blue-600 text-white hover:bg-blue-700'
                                            }`}
                                        >
                                            <Icon path={isEditMode ? ICONS.check : ICONS.edit} className="inline h-4 w-4 mr-1" />
                                            {isEditMode ? 'Save' : 'Edit'}
                                        </button>
                                    )}
                                </div>
                                <div>
                                    <strong>Received By:</strong> {selectedGrn.employee_name}
                                </div>
                            </div>
                        )}

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border border-gray-200 rounded-lg">
                                <thead className="bg-gray-50">
                                    <tr>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Part SKU</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Part Name</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Qty Received</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Cost Price</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Sale Price</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600">Line Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(isEditMode ? editedLines : grnLines).map((line, index) => (
                                        <tr key={index} className="border-b">
                                            <td className="p-3 text-sm text-gray-800">{line.internal_sku}</td>
                                            <td className="p-3 text-sm text-gray-800">{line.display_name}</td>
                                            <td className="p-3 text-sm text-gray-600">
                                                {isEditMode ? (
                                                    <input
                                                        type="number"
                                                        value={line.quantity}
                                                        onChange={(e) => handleLineChange(index, 'quantity', e.target.value)}
                                                        onFocus={(e) => e.target.select()}
                                                        className="w-full h-8 px-2 border rounded-md text-sm"
                                                        step="0.01"
                                                    />
                                                ) : (
                                                    line.quantity
                                                )}
                                            </td>
                                            <td className="p-3 text-sm text-gray-600">
                                                {isEditMode ? (
                                                    <input
                                                        type="number"
                                                        value={line.cost_price}
                                                        onChange={(e) => handleLineChange(index, 'cost_price', e.target.value)}
                                                        onFocus={(e) => e.target.select()}
                                                        className="w-full h-8 px-2 border rounded-md text-sm"
                                                        step="0.01"
                                                    />
                                                ) : (
                                                    `₱${parseFloat(line.cost_price).toFixed(2)}`
                                                )}
                                            </td>
                                            <td className="p-3 text-sm text-gray-600">
                                                {isEditMode ? (
                                                    <input
                                                        type="number"
                                                        value={line.sale_price || ''}
                                                        onChange={(e) => handleLineChange(index, 'sale_price', e.target.value)}
                                                        onFocus={(e) => e.target.select()}
                                                        className="w-full h-8 px-2 border rounded-md text-sm"
                                                        step="0.01"
                                                        placeholder="Optional"
                                                    />
                                                ) : (
                                                    line.sale_price ? `₱${parseFloat(line.sale_price).toFixed(2)}` : '-'
                                                )}
                                            </td>
                                            <td className="p-3 text-sm text-gray-600">
                                                ₱{(parseFloat(line.quantity) * parseFloat(line.cost_price)).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    );
};

export default GoodsReceiptHistoryPage;
