import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/ui/Modal';
import PurchaseOrderForm from '../components/forms/PurchaseOrderForm';
import FilterBar from '../components/ui/FilterBar';
import { downloadFile } from '../utils/downloadFile';

const PurchaseOrderLines = ({ poId }) => {
    const [lines, setLines] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchLines = async () => {
            try {
                const response = await api.get(`/purchase-orders/${poId}/lines`);
                setLines(response.data);
            } catch {
                toast.error("Could not fetch PO lines.");
            } finally {
                setLoading(false);
            }
        };
        fetchLines();
    }, [poId]);

    if (loading) {
        return <div className="p-4 bg-gray-50 text-center">Loading lines...</div>;
    }

    return (
        <div className="p-4 bg-gray-100">
            <h4 className="font-semibold text-sm text-gray-700 mb-2">Order Lines</h4>
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b">
                        <th className="text-left font-medium p-2">SKU</th>
                        <th className="text-left font-medium p-2">Details</th>
                        <th className="text-right font-medium p-2">Qty</th>
                        <th className="text-right font-medium p-2">Cost</th>
                        <th className="text-right font-medium p-2">Subtotal</th>
                    </tr>
                </thead>
                <tbody>
                    {lines.map(line => (
                        <tr key={line.po_line_id} className="border-b border-gray-200">
                            <td className="p-2 font-mono">{line.internal_sku}</td>
                            <td className="p-2">{line.display_name}</td>
                            <td className="p-2 text-right">{line.quantity}</td>
                            <td className="p-2 text-right font-mono">₱{parseFloat(line.cost_price).toFixed(2)}</td>
                            <td className="p-2 text-right font-mono">₱{(line.quantity * line.cost_price).toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};


const PurchaseOrderPage = () => {
    const { user, hasPermission } = useAuth();
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentPO, setCurrentPO] = useState(null);
    const [statusFilter, setStatusFilter] = useState('Pending');
    const [expandedRows, setExpandedRows] = useState(new Set());

    const filterTabs = [
        { key: 'Pending', label: 'Pending' },
        { key: 'Ordered', label: 'Ordered' },
        { key: 'Partially Received', label: 'Partially Received' },
        { key: 'Received', label: 'Received' },
        { key: 'Cancelled', label: 'Cancelled' },
        { key: 'All', label: 'All' },
    ];

    const fetchPOs = useCallback(async () => {
        if (hasPermission('purchase_orders:view')) {
            try {
                setLoading(true);
                const response = await api.get('/purchase-orders', { params: { status: statusFilter } });
                setPurchaseOrders(response.data);
            } catch {
                toast.error('Failed to fetch purchase orders.');
            } finally {
                setLoading(false);
            }
        }
    }, [hasPermission, statusFilter]);

    useEffect(() => {
        fetchPOs();
    }, [fetchPOs]);
    
    const showActionsColumn = useMemo(() => {
        return hasPermission('purchase_orders:edit') && purchaseOrders.some(po => po.status === 'Pending');
    }, [purchaseOrders, hasPermission]);


    const handleSave = (poData) => {
        const promise = currentPO
            ? api.put(`/purchase-orders/${currentPO.po_id}`, poData)
            : api.post('/purchase-orders', poData);

        toast.promise(promise, {
            loading: currentPO ? 'Updating Purchase Order...' : 'Creating Purchase Order...',
            success: () => {
                setIsModalOpen(false);
                setCurrentPO(null);
                fetchPOs();
                return `Purchase Order ${currentPO ? 'updated' : 'created'} successfully!`;
            },
            error: (err) => err.response?.data?.message || `Failed to ${currentPO ? 'update' : 'create'} PO.`
        });
        
        return promise;
    };

    const handleDelete = (poId) => {
        toast((t) => (
            <div className="text-center">
                <p className="font-semibold">Are you sure?</p>
                <p className="text-sm my-2">This will permanently delete the PO.</p>
                <div className="flex justify-center space-x-2 mt-4">
                    <button onClick={() => { toast.dismiss(t.id); confirmDelete(poId); }} className="px-4 py-2 bg-red-600 text-white rounded-lg">Delete</button>
                    <button onClick={() => toast.dismiss(t.id)} className="px-4 py-2 bg-gray-200 rounded-lg">Cancel</button>
                </div>
            </div>
        ));
    };

    const confirmDelete = (poId) => {
        const promise = api.delete(`/purchase-orders/${poId}`);
        toast.promise(promise, {
            loading: 'Deleting PO...',
            success: () => {
                fetchPOs();
                return 'Purchase Order deleted!';
            },
            error: (err) => err.response?.data?.message || 'Failed to delete PO.'
        });
    };
    
    const handleUpdateStatus = (poId, newStatus) => {
        const promise = api.put(`/purchase-orders/${poId}/status`, { status: newStatus });

        toast.promise(promise, {
            loading: `Updating status to ${newStatus}...`,
            success: () => {
                fetchPOs();
                return 'Status updated successfully!';
            },
            error: (err) => err.response?.data?.message || 'Failed to update status.'
        });
    };

    const handleAddNew = () => {
        setCurrentPO(null);
        setIsModalOpen(true);
    };

    const handleEdit = (po) => {
        setCurrentPO(po);
        setIsModalOpen(true);
    };

    const toggleRowExpansion = (poId) => {
        const newExpandedRows = new Set(expandedRows);
        if (newExpandedRows.has(poId)) {
            newExpandedRows.delete(poId);
        } else {
            newExpandedRows.add(poId);
        }
        setExpandedRows(newExpandedRows);
    };

    // --- NEW: Download handler using the utility ---
    const handleDownloadPDF = (po) => {
        downloadFile(`/purchase-orders/${po.po_id}/pdf`, `PO-${po.po_number}.pdf`);
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
                    <button onClick={handleAddNew} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                        New Purchase Order
                    </button>
                )}
            </div>

            <FilterBar
                tabs={filterTabs}
                activeTab={statusFilter}
                onTabClick={setStatusFilter}
            />

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
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Details</th>
                                    {/* --- NEW: Download Column Header --- */}
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Download</th>
                                    {showActionsColumn && <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {purchaseOrders.map(po => (
                                    <React.Fragment key={po.po_id}>
                                        <tr className="border-b hover:bg-gray-50">
                                            <td className="p-3 text-sm font-mono">{po.po_number}</td>
                                            <td className="p-3 text-sm">{po.supplier_name}</td>
                                            <td className="p-3 text-sm">
                                                <span className={`px-2 py-1 text-xs font-semibold rounded-full 
                                                    ${po.status === 'Received' ? 'bg-green-100 text-green-800' : ''}
                                                    ${po.status === 'Pending' ? 'bg-yellow-100 text-yellow-800' : ''}
                                                    ${po.status === 'Ordered' ? 'bg-blue-100 text-blue-800' : ''}
                                                    ${po.status === 'Partially Received' ? 'bg-purple-100 text-purple-800' : ''}
                                                    ${po.status === 'Cancelled' ? 'bg-gray-100 text-gray-800' : ''}
                                                `}>
                                                    {po.status}
                                                </span>
                                            </td>
                                            <td className="p-3 text-sm">{new Date(po.order_date).toLocaleDateString()}</td>
                                            <td className="p-3 text-sm text-right font-mono">₱{parseFloat(po.total_amount).toFixed(2)}</td>
                                            <td className="p-3 text-sm text-center">
                                                <button onClick={() => toggleRowExpansion(po.po_id)} className="text-gray-500 hover:text-gray-800">
                                                    <Icon path={expandedRows.has(po.po_id) ? ICONS.chevronUp : ICONS.chevronDown} className="h-5 w-5" />
                                                </button>
                                            </td>
                                            {/* --- NEW: Download Button Cell --- */}
                                            <td className="p-3 text-sm text-center">
                                                <button onClick={() => handleDownloadPDF(po)} title="Download PDF" className="text-gray-500 hover:text-gray-800">
                                                    <Icon path={ICONS.download} className="h-5 w-5" />
                                                </button>
                                            </td>
                                            {showActionsColumn && (
                                                <td className="p-3 text-sm text-right">
                                                    <div className="flex justify-end items-center space-x-4 h-full">
                                                        {po.status === 'Pending' ? (
                                                            <>
                                                                <button onClick={() => handleUpdateStatus(po.po_id, 'Ordered')} title="Mark as Ordered" className="text-green-600 hover:text-green-800"><Icon path={ICONS.send} className="h-5 w-5" /></button>
                                                                <button onClick={() => handleEdit(po)} title="Edit" className="text-blue-600 hover:text-blue-800"><Icon path={ICONS.edit} className="h-5 w-5" /></button>
                                                                <button onClick={() => handleUpdateStatus(po.po_id, 'Cancelled')} title="Cancel PO" className="text-yellow-600 hover:text-yellow-800"><Icon path={ICONS.cancel} className="h-5 w-5" /></button>
                                                                <button onClick={() => handleDelete(po.po_id)} title="Delete PO" className="text-red-600 hover:text-red-800"><Icon path={ICONS.trash} className="h-5 w-5" /></button>
                                                            </>
                                                        ) : (
                                                            <span>-</span> 
                                                        )}
                                                    </div>
                                                </td>
                                            )}
                                        </tr>
                    {expandedRows.has(po.po_id) && (
                                            <tr key={`${po.po_id}-details`}>
                        {/* --- UPDATE: ColSpan value to account for new column --- */}
                        <td colSpan={showActionsColumn ? 9 : 8}>
                                                    <PurchaseOrderLines poId={po.po_id} />
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentPO ? 'Edit Purchase Order' : 'New Purchase Order'} maxWidth="max-w-4xl">
                <PurchaseOrderForm user={user} onSave={handleSave} onCancel={() => setIsModalOpen(false)} existingPO={currentPO} />
            </Modal>
        </div>
    );
};

export default PurchaseOrderPage;