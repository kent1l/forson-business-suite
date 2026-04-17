import { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import SearchBar from '../components/SearchBar';
import { enrichPartsArray } from '../helpers/applicationCache';
import Modal from '../components/ui/Modal';
import StockAdjustmentForm from '../components/forms/StockAdjustmentForm';
import TransactionHistoryModal from '../components/ui/TransactionHistoryModal';
import PaginationControls from '../components/ui/PaginationControls';
import SortableHeader from '../components/ui/SortableHeader';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';
import { sortData } from '../utils/sortData';

const InventoryPage = () => {
    const { user, hasPermission } = useAuth();
    const { settings } = useSettings();
    const [inventory, setInventory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [selectedPart, setSelectedPart] = useState(null);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [sortConfig, setSortConfig] = useState({ key: 'internal_sku', direction: 'ASC' });
    const [globalSortBy, setGlobalSortBy] = useState('name');
    const [globalSortDirection, setGlobalSortDirection] = useState('ASC');
    // No client-side sort: preserve backend / MeiliSearch ordering

    const fetchInventory = useCallback(async () => {
        try {
            setError('');
            setLoading(true);
            // If there's no search term, use the inventory endpoint (full list)
            if (!searchTerm || !searchTerm.trim()) {
                const response = await api.get('/inventory', { params: { page, pageSize, paginated: 1, sortBy: globalSortBy, sortDirection: globalSortDirection } });
                setInventory(response.data?.data || []);
                setTotal(response.data?.total || 0);
            } else {
                // Use MeiliSearch-backed endpoint for smart searching (same as POS/Invoicing)
                const response = await api.get('/inventory', { params: { search: searchTerm, page, pageSize, paginated: 1, sortBy: globalSortBy, sortDirection: globalSortDirection } });
                const enriched = await enrichPartsArray(response.data?.data || []);
                setInventory(enriched);
                setTotal(response.data?.total || 0);
            }
        } catch (error) {
            console.error('Failed to fetch inventory', error);
            setError('Failed to fetch inventory: ' + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
        }
    }, [searchTerm, page, pageSize, globalSortBy, globalSortDirection]);

    useEffect(() => {
        const debounceTimer = setTimeout(() => {
            fetchInventory();
        }, 300);

        return () => clearTimeout(debounceTimer);
    }, [fetchInventory]);

    useEffect(() => {
        setPage(1);
    }, [searchTerm, globalSortBy, globalSortDirection]);

    const handleOpenAdjustmentModal = (part) => {
        setSelectedPart(part);
        setIsModalOpen(true);
    };

    const handleOpenHistoryModal = (part) => {
        setSelectedPart(part);
        setIsHistoryModalOpen(true);
    };

    const handleAdjustmentSave = async (adjustmentData) => {
        const promise = api.post('/inventory/adjust', {
            ...adjustmentData,
            part_id: selectedPart.part_id,
            employee_id: user.employee_id,
        });

        toast.promise(promise, {
            loading: 'Processing adjustment...',
            success: () => {
                setIsModalOpen(false);
                fetchInventory();
                return 'Stock adjusted successfully!';
            },
            error: 'Failed to adjust stock.',
        });
    };
    
    const sortedInventory = sortData(inventory, sortConfig);
    const toSafeNumber = (value) => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
    };

    return (
        <div>
            <div className="mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Inventory Management</h1>
                <div className="mt-3 flex flex-wrap items-center gap-3">
                    <div className="relative w-full max-w-md">
                        <SearchBar
                            value={searchTerm}
                            onChange={setSearchTerm}
                            onClear={() => setSearchTerm('')}
                            placeholder="Search inventory..."
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="inventory-global-sort-by" className="text-sm text-gray-600 whitespace-nowrap">Sort all by</label>
                        <select
                            id="inventory-global-sort-by"
                            value={globalSortBy}
                            onChange={(e) => setGlobalSortBy(e.target.value)}
                            className="rounded-md border border-gray-300 px-2 py-2 text-sm"
                        >
                            <option value="sku">SKU</option>
                            <option value="name">Name</option>
                            <option value="stock_on_hand">Stock on Hand</option>
                            <option value="wac">WAC</option>
                            <option value="total_value">Total Value</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="inventory-global-sort-direction" className="text-sm text-gray-600 whitespace-nowrap">Order</label>
                        <select
                            id="inventory-global-sort-direction"
                            value={globalSortDirection}
                            onChange={(e) => setGlobalSortDirection(e.target.value)}
                            className="rounded-md border border-gray-300 px-2 py-2 text-sm"
                        >
                            <option value="ASC">Ascending</option>
                            <option value="DESC">Descending</option>
                        </select>
                    </div>
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading inventory...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b">
                                    <SortableHeader column="internal_sku" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>SKU</SortableHeader>
                                    <SortableHeader column="display_name" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Item Name</SortableHeader>
                                    <SortableHeader className="text-center" column="stock_on_hand" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Stock on Hand</SortableHeader>
                                    <SortableHeader className="text-right" column="wac_cost" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>WAC</SortableHeader>
                                    <SortableHeader className="text-right" column="total_value" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Total Value</SortableHeader>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedInventory.map(item => {
                                    const stockOnHand = toSafeNumber(item.stock_on_hand);
                                    const wacCost = toSafeNumber(item.wac_cost);
                                    const totalValue = Number.isFinite(Number(item.total_value))
                                        ? Number(item.total_value)
                                        : stockOnHand * wacCost;

                                    return (
                                    <tr key={item.part_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{item.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800">{item.display_name}</td>
                                        <td className="p-3 text-sm text-center font-semibold">{stockOnHand.toLocaleString()}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '$'}{wacCost.toFixed(2)}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '$'}{totalValue.toFixed(2)}</td>
                                        <td className="p-3 text-sm text-right">
                                            {hasPermission('inventory:adjust') && (
                                                <button onClick={() => handleOpenAdjustmentModal(item)} className="text-blue-600 hover:text-blue-800 mr-4" title="Adjust Stock">
                                                    <Icon path={ICONS.adjust} className="h-5 w-5"/>
                                                </button>
                                            )}
                                            <button onClick={() => handleOpenHistoryModal(item)} className="text-gray-600 hover:text-gray-800" title="View History">
                                                <Icon path={ICONS.history} className="h-5 w-5"/>
                                            </button>
                                        </td>
                                    </tr>
                                )})}
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
                    </>
                )}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={`Stock Adjustment - ${selectedPart?.display_name}`}>
                <StockAdjustmentForm 
                    part={selectedPart} 
                    onSave={handleAdjustmentSave} 
                    onCancel={() => setIsModalOpen(false)}
                    user={user}
                />
            </Modal>
            
            <TransactionHistoryModal 
                isOpen={isHistoryModalOpen} 
                onClose={() => setIsHistoryModalOpen(false)} 
                part={selectedPart}
            />
        </div>
    );
};

export default InventoryPage;
