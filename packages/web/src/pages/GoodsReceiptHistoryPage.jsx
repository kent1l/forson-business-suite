import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import SearchBar from '../components/SearchBar';
import SortableHeader from '../components/ui/SortableHeader';
import Modal from '../components/ui/Modal';

const GoodsReceiptHistoryPage = ({ user: _user }) => {
    const [grns, setGrns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [query, setQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const debounceRef = useRef(null);
    const [sortConfig, setSortConfig] = useState({ key: 'receipt_date', direction: 'DESC' });
    const [selectedGrn, setSelectedGrn] = useState(null);
    const [grnLines, setGrnLines] = useState([]);
    const [modalLoading, setModalLoading] = useState(false);

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
        try {
            const response = await api.get(`/goods-receipts/${grn.grn_id}/lines`);
            setGrnLines(response.data);
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
    };

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
                maxWidth="max-w-4xl"
            >
                {modalLoading ? (
                    <div className="p-4 text-center">Loading details...</div>
                ) : (
                    <div className="space-y-4">
                        {selectedGrn && (
                            <div className="grid grid-cols-2 gap-4 text-sm">
                                <div>
                                    <strong>Supplier:</strong> {selectedGrn.supplier_name}
                                </div>
                                <div>
                                    <strong>Received Date:</strong> {new Date(selectedGrn.receipt_date).toLocaleDateString()}
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
                                    {grnLines.map((line, index) => (
                                        <tr key={index} className="border-b">
                                            <td className="p-3 text-sm text-gray-800">{line.internal_sku}</td>
                                            <td className="p-3 text-sm text-gray-800">{line.display_name}</td>
                                            <td className="p-3 text-sm text-gray-600">{line.quantity}</td>
                                            <td className="p-3 text-sm text-gray-600">₱{parseFloat(line.cost_price).toFixed(2)}</td>
                                            <td className="p-3 text-sm text-gray-600">
                                                {line.sale_price ? `₱${parseFloat(line.sale_price).toFixed(2)}` : '-'}
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
