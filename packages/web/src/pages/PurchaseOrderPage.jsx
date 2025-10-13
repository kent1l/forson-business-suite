import React, { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import { useAuth } from '../contexts/AuthContext';
import FilterBar from '../components/ui/FilterBar';
import { downloadFile } from '../utils/downloadFile';
import { format, parseISO } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import PurchaseOrderEditorPage from './PurchaseOrderEditorPage';

// Avoid linter warnings for React import (needed for JSX transformation)
void React;

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


const statusBadgeStyles = {
    Received: 'bg-green-100 text-green-800 border border-green-200',
    Pending: 'bg-amber-100 text-amber-800 border border-amber-200',
    Ordered: 'bg-blue-100 text-blue-800 border border-blue-200',
    'Partially Received': 'bg-purple-100 text-purple-800 border border-purple-200',
    Cancelled: 'bg-gray-100 text-gray-700 border border-gray-200'
};

const PurchaseOrderPage = () => {
    const { user, hasPermission } = useAuth();
    const [purchaseOrders, setPurchaseOrders] = useState([]);
    const [loading, setLoading] = useState(true);
    // full-page editor state
    const [editingPO, setEditingPO] = useState(null); // null = create new when in edit mode
    const [isEditing, setIsEditing] = useState(false);
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


    const exitEditor = useCallback(() => {
        setIsEditing(false);
        setEditingPO(null);
        fetchPOs();
    }, [fetchPOs]);

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
        setEditingPO(null);
        setIsEditing(true);
    };

    const handleEdit = (po) => {
        setEditingPO(po);
        setIsEditing(true);
    };

    const toggleRowExpansion = (poId) => {
        setExpandedRows((prevExpanded) => {
            const updated = new Set(prevExpanded);
            if (updated.has(poId)) {
                updated.delete(poId);
            } else {
                updated.add(poId);
            }
            return updated;
        });
    };

    // --- NEW: Download handler using the utility ---
    const handleDownloadPDF = (po) => {
        downloadFile(`/purchase-orders/${po.po_id}/pdf`, `PO-${po.po_number}.pdf`);
    };

    const renderStatusBadge = (status) => (
        <span
            className={`inline-flex items-center gap-2 px-3 py-1 text-xs font-semibold uppercase tracking-wide rounded-full shadow-sm ${statusBadgeStyles[status] || 'bg-slate-100 text-slate-700 border border-slate-200'}`}
        >
            <span className="inline-block h-2 w-2 rounded-full bg-current" />
            {status}
        </span>
    );

    if (!hasPermission('purchase_orders:view')) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
                <p className="text-gray-600 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    if (isEditing) {
        return (
            <PurchaseOrderEditorPage
                user={user}
                existingPO={editingPO}
                onDone={exitEditor}
            />
        );
    }

    return (
        <div key="po-list" className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <h1 className="text-3xl font-semibold text-gray-900 tracking-tight">Purchase Orders</h1>
                    <p className="text-sm text-gray-500">Monitor vendor commitments, download PDFs, and keep your purchasing pipeline on track.</p>
                </div>
                {hasPermission('purchase_orders:edit') && (
                    <button
                        onClick={handleAddNew}
                        className="inline-flex items-center justify-center rounded-full bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-blue-600/30 transition hover:-translate-y-0.5 hover:bg-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                    >
                        <Icon path={ICONS.plus} className="mr-2 h-5 w-5" />
                        New Purchase Order
                    </button>
                )}
            </div>

            <FilterBar
                tabs={filterTabs}
                activeTab={statusFilter}
                onTabClick={setStatusFilter}
            />

            <div className="rounded-3xl border border-gray-100 bg-white shadow-xl shadow-gray-900/5">
                {loading ? (
                    <div className="flex items-center justify-center px-6 py-16">
                        <div className="flex items-center gap-3 text-sm font-medium text-gray-500">
                            <span className="h-2 w-2 animate-ping rounded-full bg-blue-500" />
                            Loading purchase orders...
                        </div>
                    </div>
                ) : (
                    <div className="p-4 sm:p-6">
                        {purchaseOrders.length === 0 ? (
                            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 bg-gradient-to-b from-white to-gray-50 px-4 py-16 text-center">
                                <Icon path={ICONS.documents} className="h-10 w-10 text-gray-300" />
                                <div className="space-y-1">
                                    <p className="text-base font-semibold text-gray-700">No purchase orders found</p>
                                    <p className="text-sm text-gray-500">Try adjusting your filters or create a new purchase order to get started.</p>
                                </div>
                                {hasPermission('purchase_orders:edit') && (
                                    <button
                                        onClick={handleAddNew}
                                        className="inline-flex items-center justify-center rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:border-blue-300 hover:bg-blue-100"
                                    >
                                        <Icon path={ICONS.plus} className="mr-2 h-4 w-4" />
                                        Create Purchase Order
                                    </button>
                                )}
                            </div>
                        ) : (
                            <>
                                <div className="space-y-4 lg:hidden">
                                    {purchaseOrders.map((po) => {
                                        const isExpanded = expandedRows.has(po.po_id);
                                        const isPending = po.status === 'Pending';
                                        return (
                                            <div
                                                key={po.po_id}
                                                className="group rounded-2xl border border-gray-100 bg-white p-4 shadow-md shadow-gray-900/5 transition hover:border-blue-100 hover:shadow-lg"
                                            >
                                                <div className="flex items-start justify-between gap-3">
                                                    <div>
                                                        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-400">
                                                            <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-500">PO</span>
                                                            {po.po_number}
                                                        </div>
                                                        <p className="mt-2 text-base font-semibold text-gray-900">{po.supplier_name}</p>
                                                    </div>
                                                    {renderStatusBadge(po.status)}
                                                </div>
                                                <dl className="mt-4 grid grid-cols-2 gap-4 text-sm text-gray-600">
                                                    <div>
                                                        <dt className="font-medium text-gray-500">Order date</dt>
                                                        <dd className="mt-1 font-mono text-[13px] text-gray-900">
                                                            {format(toZonedTime(parseISO(po.order_date), 'Asia/Manila'), 'MMM dd, yyyy')}
                                                        </dd>
                                                    </div>
                                                    <div className="text-right">
                                                        <dt className="font-medium text-gray-500">Total</dt>
                                                        <dd className="mt-1 text-lg font-semibold text-gray-900">₱{parseFloat(po.total_amount).toFixed(2)}</dd>
                                                    </div>
                                                    <div className="col-span-2">
                                                        <dt className="font-medium text-gray-500">PO ID</dt>
                                                        <dd className="mt-1 font-mono text-xs text-gray-500">{po.po_id}</dd>
                                                    </div>
                                                </dl>
                                                <div className="mt-6 flex flex-wrap items-center gap-3">
                                                    <button
                                                        onClick={() => handleDownloadPDF(po)}
                                                        className="inline-flex items-center rounded-full border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                                                        title="Download PDF"
                                                    >
                                                        <Icon path={ICONS.download} className="mr-2 h-4 w-4" />
                                                        Download PDF
                                                    </button>
                                                    <button
                                                        onClick={() => toggleRowExpansion(po.po_id)}
                                                        className="inline-flex items-center rounded-full border border-gray-200 px-4 py-2 text-xs font-medium text-gray-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                                                        title="Toggle line items"
                                                    >
                                                        <Icon path={isExpanded ? ICONS.chevronUp : ICONS.chevronDown} className="mr-2 h-4 w-4" />
                                                        {isExpanded ? 'Hide line items' : 'View line items'}
                                                    </button>
                                                    {showActionsColumn && (
                                                        <div className="flex flex-wrap gap-2">
                                                            {isPending ? (
                                                                <>
                                                                    <button
                                                                        onClick={() => handleUpdateStatus(po.po_id, 'Ordered')}
                                                                        className="inline-flex items-center rounded-full bg-green-50 px-3 py-2 text-xs font-semibold text-green-700 transition hover:bg-green-100"
                                                                        title="Mark as Ordered"
                                                                    >
                                                                        <Icon path={ICONS.send} className="mr-1.5 h-4 w-4" />
                                                                        Mark as Ordered
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleEdit(po)}
                                                                        className="inline-flex items-center rounded-full bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700 transition hover:bg-blue-100"
                                                                        title="Edit PO"
                                                                    >
                                                                        <Icon path={ICONS.edit} className="mr-1.5 h-4 w-4" />
                                                                        Edit
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleUpdateStatus(po.po_id, 'Cancelled')}
                                                                        className="inline-flex items-center rounded-full bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                                                                        title="Cancel PO"
                                                                    >
                                                                        <Icon path={ICONS.cancel} className="mr-1.5 h-4 w-4" />
                                                                        Cancel
                                                                    </button>
                                                                    <button
                                                                        onClick={() => handleDelete(po.po_id)}
                                                                        className="inline-flex items-center rounded-full bg-red-50 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-100"
                                                                        title="Delete PO"
                                                                    >
                                                                        <Icon path={ICONS.trash} className="mr-1.5 h-4 w-4" />
                                                                        Delete
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <span className="rounded-full bg-gray-100 px-3 py-2 text-xs font-medium text-gray-500">No actions available</span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                                {isExpanded && (
                                                    <div className="mt-6">
                                                        <PurchaseOrderLines poId={po.po_id} />
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>

                                <div className="hidden lg:block">
                                    <div className="overflow-hidden rounded-2xl border border-gray-100">
                                        <table className="hidden min-w-full table-fixed text-left text-sm text-gray-700 lg:table">
                                            <thead className="bg-gray-50">
                                                <tr className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                                                    <th className="p-4">PO Number</th>
                                                    <th className="p-4">Supplier</th>
                                                    <th className="p-4">Status</th>
                                                    <th className="p-4">Order Date</th>
                                                    <th className="p-4 text-right">Total</th>
                                                    <th className="p-4 text-center">Details</th>
                                                    <th className="p-4 text-center">Download</th>
                                                    {showActionsColumn && <th className="p-4 text-right">Actions</th>}
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100 bg-white">
                                                {purchaseOrders.map((po) => (
                                                    <React.Fragment key={po.po_id}>
                                                        <tr className="transition hover:bg-blue-50/40">
                                                            <td className="p-4 font-mono text-xs text-gray-600">{po.po_number}</td>
                                                            <td className="p-4 text-sm font-medium text-gray-900">{po.supplier_name}</td>
                                                            <td className="p-4">{renderStatusBadge(po.status)}</td>
                                                            <td className="p-4 text-sm text-gray-600">{format(toZonedTime(parseISO(po.order_date), 'Asia/Manila'), 'MMM dd, yyyy')}</td>
                                                            <td className="p-4 text-right font-mono text-sm text-gray-900">₱{parseFloat(po.total_amount).toFixed(2)}</td>
                                                            <td className="p-4 text-center">
                                                                <button
                                                                    onClick={() => toggleRowExpansion(po.po_id)}
                                                                    className="inline-flex items-center justify-center rounded-full border border-transparent p-2 text-gray-500 transition hover:border-gray-200 hover:bg-gray-100 hover:text-gray-700"
                                                                    title="Toggle line items"
                                                                >
                                                                    <Icon path={expandedRows.has(po.po_id) ? ICONS.chevronUp : ICONS.chevronDown} className="h-4 w-4" />
                                                                </button>
                                                            </td>
                                                            <td className="p-4 text-center">
                                                                <button
                                                                    onClick={() => handleDownloadPDF(po)}
                                                                    className="inline-flex items-center justify-center rounded-full border border-transparent p-2 text-gray-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                                                                    title="Download PDF"
                                                                >
                                                                    <Icon path={ICONS.download} className="h-4 w-4" />
                                                                </button>
                                                            </td>
                                                            {showActionsColumn && (
                                                                <td className="p-4 text-right">
                                                                    <div className="flex items-center justify-end gap-3">
                                                                        {po.status === 'Pending' ? (
                                                                            <>
                                                                                <button
                                                                                    onClick={() => handleUpdateStatus(po.po_id, 'Ordered')}
                                                                                    className="rounded-full bg-green-50 p-2 text-green-700 transition hover:bg-green-100"
                                                                                    title="Mark as Ordered"
                                                                                >
                                                                                    <Icon path={ICONS.send} className="h-4 w-4" />
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => handleEdit(po)}
                                                                                    className="rounded-full bg-blue-50 p-2 text-blue-700 transition hover:bg-blue-100"
                                                                                    title="Edit"
                                                                                >
                                                                                    <Icon path={ICONS.edit} className="h-4 w-4" />
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => handleUpdateStatus(po.po_id, 'Cancelled')}
                                                                                    className="rounded-full bg-amber-50 p-2 text-amber-700 transition hover:bg-amber-100"
                                                                                    title="Cancel PO"
                                                                                >
                                                                                    <Icon path={ICONS.cancel} className="h-4 w-4" />
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => handleDelete(po.po_id)}
                                                                                    className="rounded-full bg-red-50 p-2 text-red-700 transition hover:bg-red-100"
                                                                                    title="Delete PO"
                                                                                >
                                                                                    <Icon path={ICONS.trash} className="h-4 w-4" />
                                                                                </button>
                                                                            </>
                                                                        ) : (
                                                                            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-500">-</span>
                                                                        )}
                                                                    </div>
                                                                </td>
                                                            )}
                                                        </tr>
                                                        {expandedRows.has(po.po_id) && (
                                                            <tr key={`${po.po_id}-details`} className="bg-gray-50/80">
                                                                <td colSpan={showActionsColumn ? 8 : 7} className="p-4">
                                                                    <PurchaseOrderLines poId={po.po_id} />
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                )}
            </div>

        </div>
    );
};

export default PurchaseOrderPage;