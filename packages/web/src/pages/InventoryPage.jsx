import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import SearchBar from '../components/SearchBar';
import Modal from '../components/ui/Modal';
import StockAdjustmentForm from '../components/forms/StockAdjustmentForm';
import TransactionHistoryModal from '../components/ui/TransactionHistoryModal';
import { useAuth } from '../contexts/AuthContext';
import { useSettings } from '../contexts/SettingsContext';

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
    // No client-side sort: preserve backend / MeiliSearch ordering

    const fetchInventory = useCallback(async () => {
        try {
            setError('');
            setLoading(true);
            // --- UPDATED: Call the correct inventory endpoint ---
            const response = await api.get(`/inventory`, { params: { search: searchTerm } });
            setInventory(response.data);
        } catch (error) {
            console.error('Failed to fetch inventory', error);
            setError('Failed to fetch inventory: ' + (error.response?.data?.message || error.message));
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
    
    // Use inventory directly to preserve server-provided ranking (MeiliSearch)
    const sortedInventory = inventory;

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Inventory Management</h1>
                <div className="relative w-full max-w-xs">
                    <SearchBar
                        value={searchTerm}
                        onChange={setSearchTerm}
                        onClear={() => setSearchTerm('')}
                        placeholder="Search inventory..."
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
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">WAC</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Value</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedInventory.map(item => (
                                    <tr key={item.part_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{item.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800">{item.display_name}</td>
                                        <td className="p-3 text-sm text-center font-semibold">{Number(item.stock_on_hand).toLocaleString()}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '$'}{parseFloat(item.wac_cost).toFixed(2)}</td>
                                        <td className="p-3 text-sm text-right font-mono">{settings?.DEFAULT_CURRENCY_SYMBOL || '$'}{parseFloat(item.total_value).toFixed(2)}</td>
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