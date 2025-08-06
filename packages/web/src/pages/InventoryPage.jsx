import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import StockAdjustmentForm from '../components/forms/StockAdjustmentForm';
import TransactionHistoryModal from '../components/ui/TransactionHistoryModal';

const InventoryPage = ({ user }) => {
    const [inventory, setInventory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [currentItem, setCurrentItem] = useState(null);
    const [isAdjustModalOpen, setIsAdjustModalOpen] = useState(false);
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);

    const fetchInventory = useCallback(async () => {
        try {
            setError('');
            const response = await axios.get(`http://localhost:3001/api/inventory?search=${searchTerm}`);
            setInventory(response.data);
        } catch (err) {
            setError('Failed to fetch inventory data.');
            toast.error('Failed to fetch inventory data.');
        } finally {
            setLoading(false);
        }
    }, [searchTerm]);

    useEffect(() => {
        setLoading(true);
        const debounceTimer = setTimeout(() => {
            fetchInventory();
        }, 300);
        return () => clearTimeout(debounceTimer);
    }, [searchTerm, fetchInventory]);

    const getStatusIndicator = (item) => {
        const stock = Number(item.stock_on_hand);
        const reorderPoint = Number(item.reorder_point);

        if (stock <= 0) {
            return <span className="inline-block w-3 h-3 bg-blue-500 rounded-full" title="Out of Stock"></span>;
        }
        if (stock > 0 && stock <= reorderPoint) {
            return <span className="inline-block w-3 h-3 bg-yellow-500 rounded-full" title="Low Stock"></span>;
        }
        return <span className="inline-block w-3 h-3 bg-green-500 rounded-full" title="In Stock"></span>;
    };
    
    const handleViewHistory = (item) => {
        setCurrentItem(item);
        setIsHistoryModalOpen(true);
    };

    const handleAdjustStock = (item) => {
        setCurrentItem(item);
        setIsAdjustModalOpen(true);
    };

    const handleSaveAdjustment = (payload) => {
        const promise = axios.post('http://localhost:3001/api/inventory/adjust', payload);
        toast.promise(promise, {
            loading: 'Adjusting stock...',
            success: () => {
                setIsAdjustModalOpen(false);
                fetchInventory(); // Directly call fetchInventory to refresh data
                return 'Stock adjusted successfully!';
            },
            error: 'Failed to adjust stock.'
        });
    };

    return (
        <div>
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
                <h1 className="text-2xl font-semibold text-gray-800">Inventory Management</h1>
                <div className="relative w-full sm:w-64">
                     <Icon path={ICONS.search} className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                     <input 
                        type="text"
                        placeholder="Search inventory..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
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
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600 w-12">Status</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">SKU</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Item</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Stock on Hand</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total Value</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {inventory.map(item => (
                                    <tr key={item.part_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-center">{getStatusIndicator(item)}</td>
                                        <td className="p-3 text-sm font-mono">{item.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800">{item.display_name}</td>
                                        <td className="p-3 text-sm text-center font-semibold">{Number(item.stock_on_hand).toLocaleString()}</td>
                                        <td className="p-3 text-sm text-right font-mono">
                                            ₱{(Number(item.stock_on_hand) * Number(item.last_cost)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </td>
                                        <td className="p-3 text-center space-x-4">
                                            <button onClick={() => handleAdjustStock(item)} className="text-gray-500 hover:text-blue-600" title="Adjust Stock">
                                                <Icon path={ICONS.edit} className="h-5 w-5" />
                                            </button>
                                            <button onClick={() => handleViewHistory(item)} className="text-gray-500 hover:text-blue-600" title="View Transaction History">
                                                <Icon path={ICONS.receipt} className="h-5 w-5" />
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <Modal isOpen={isAdjustModalOpen} onClose={() => setIsAdjustModalOpen(false)} title={`Adjust Stock for ${currentItem?.detail}`}>
                <StockAdjustmentForm part={currentItem} user={user} onSave={handleSaveAdjustment} onCancel={() => setIsAdjustModalOpen(false)} />
            </Modal>
            <TransactionHistoryModal part={currentItem} isOpen={isHistoryModalOpen} onClose={() => setIsHistoryModalOpen(false)} />
        </div>
    );
};

export default InventoryPage;
