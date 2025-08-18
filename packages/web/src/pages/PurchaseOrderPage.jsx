import React, { useState, useEffect, useMemo } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/ui/Modal';
import PurchaseOrderForm from '../components/forms/PurchaseOrderForm';

const PurchaseOrderPage = () => {
    const { user, hasPermission } = useAuth();
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);

    const fetchPOs = async () => {
            if (hasPermission('purchase_orders:view')) {
                try {
                    setLoading(true);
                    const response = await api.get('/purchase-orders');
                    setPurchaseOrders(response.data);
                } catch (err) {
                    toast.error('Failed to fetch purchase orders.');
                } finally {
                    setLoading(false);
                }
            }
        };

    useEffect(() => {
        fetchPOs();
    }, [hasPermission]);

    const handleSave = (poData) => {
        const promise = api.post('/purchase-orders', poData);
        toast.promise(promise, {
            loading: 'Creating Purchase Order...',
            success: () => {
                setIsModalOpen(false);
                fetchPOs();
                return 'Purchase Order created successfully!';
            },
            error: (err) => err.response?.data?.message || 'Failed to create PO.'
        });
    };

    if (!hasPermission('purchase_orders:view')) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
                <p className="text-gray-600 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Purchase Orders</h1>
                {hasPermission('purchase_orders:edit') && (
                    <button onClick={() => setIsModalOpen(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                        New Purchase Order
                    </button>
                )}
            </div>

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading ? <p>Loading...</p> : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">PO Number</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Supplier</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Status</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Order Date</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                {purchaseOrders.map(po => (
                                    <tr key={po.po_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{po.po_number}</td>
                                        <td className="p-3 text-sm">{po.supplier_name}</td>
                                        <td className="p-3 text-sm">
                                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">
                                                {po.status}
                                            </span>
                                        </td>
                                        <td className="p-3 text-sm">{new Date(po.order_date).toLocaleDateString()}</td>
                                        <td className="p-3 text-sm text-right font-mono">₱{parseFloat(po.total_amount).toFixed(2)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="New Purchase Order" maxWidth="max-w-4xl">
                <PurchaseOrderForm user={user} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default PurchaseOrderPage;