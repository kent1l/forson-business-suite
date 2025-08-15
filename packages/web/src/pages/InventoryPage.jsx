import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import StockAdjustmentForm from '../components/forms/StockAdjustmentForm';
import TransactionHistoryModal from '../components/ui/TransactionHistoryModal';
import { useAuth } from '../contexts/AuthContext'; // <-- NEW: Import useAuth

const InventoryPage = () => {
    const { user, hasPermission } = useAuth(); // <-- NEW: Use the auth context
    const [inventory, setInventory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [selectedPart, setSelectedPart] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: 'display_name', direction: 'ascending' });

    const fetchInventory = useCallback(async () => {
        try {
            setError('');
            setLoading(true);
            const response = await api.get(`/inventory?search=${searchTerm}`);
            setInventory(response.data);
        } catch (err) {
            setError('Failed to fetch inventory.');
        } finally {
            setLoading(false);
        }
    }, [searchTerm]);

    useEffect(() => {
        const debounceTimer = setTimeout(() => {
            fetchInventory();
        }, 300);

        return () => clearTimeout(debounceTimer);
    }, [fetchInventory]);

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
    
    const sortedInventory = React.useMemo(() => {
        let sortableItems = [...inventory];
        if (sortConfig !== null) {
            sortableItems.sort((a, b) => {
                if (a[sortConfig.key] < b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? -1 : 1;
                }
                if (a[sortConfig.key] > b[sortConfig.key]) {
                    return sortConfig.direction === 'ascending' ? 1 : -1;
                }
                return 0;
            });
        }
        return sortableItems;
    }, [inventory, sortConfig]);

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Inventory Management</h1>
                <div className="relative w-full max-w-xs">
                    <Icon path={ICONS.search} className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Search inventory..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                    />
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading inventory...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr className="border-b">
                                    <th className="p-3 text-sm font-semibold text-gray-600">SKU</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Item Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Stock on Hand</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedInventory.map(item => (
                                    <tr key={item.part_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{item.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800">{item.display_name}</td>
                                        <td className="p-3 text-sm text-center font-semibold">{Number(item.stock_on_hand).toLocaleString()}</td>
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
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={`Adjust Stock for ${selectedPart?.display_name}`}>
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
