import React, { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import SupplierForm from '../components/forms/SupplierForm';
import SupplierDetailDrawer from '../components/suppliers/SupplierDetailDrawer';
import StatusBadge from '../components/ui/StatusBadge';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import PaginationControls from '../components/ui/PaginationControls';
import SortableHeader from '../components/ui/SortableHeader';
import { useAuth } from '../contexts/AuthContext';
import { formatCurrency } from '../utils/currency';

const SuppliersPage = () => {
    const { hasPermission } = useAuth();
    const canViewAp = hasPermission('ap:view');
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentSupplier, setCurrentSupplier] = useState(null);
    const [selectedSupplier, setSelectedSupplier] = useState(null);
    const [statusFilter, setStatusFilter] = useState('active');
    const [sortConfig, setSortConfig] = useState({ key: 'supplier_name', direction: 'ASC' });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);

    const filterTabs = [
        { key: 'active', label: 'Active' },
        { key: 'inactive', label: 'Inactive' },
        { key: 'all', label: 'All' },
    ];

    const fetchSuppliers = async () => {
        try {
            setError('');
            setLoading(true);
            const response = await api.get('/suppliers', {
                params: {
                    status: statusFilter,
                    page,
                    pageSize,
                    paginated: 1,
                    sortBy: sortConfig.key,
                    sortOrder: sortConfig.direction
                }
            });
            const baseSuppliers = response.data?.data || [];
            setTotal(response.data?.total || 0);

            if (!canViewAp || baseSuppliers.length === 0) {
                setSuppliers(baseSuppliers);
                return;
            }

            // Enrich with AP balance/aging in one extra call rather than a full
            // second round trip per row; falls back gracefully if unavailable.
            try {
                const apRes = await api.get('/ap/supplier-summary', { params: { pageSize: 100 } });
                const apBySupplierId = new Map((apRes.data?.data || apRes.data || []).map(s => [s.supplier_id, s]));
                setSuppliers(baseSuppliers.map(s => ({ ...s, ap: apBySupplierId.get(s.supplier_id) || null })));
            } catch {
                setSuppliers(baseSuppliers);
            }
        } catch {
            setError('Failed to fetch suppliers.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSuppliers();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [statusFilter, page, pageSize, sortConfig]);

    useEffect(() => {
        setPage(1);
    }, [statusFilter]);

    const handleSort = (key, direction) => {
        setSortConfig({ key, direction });
        setPage(1);
    };

    const handleAdd = () => {
        setCurrentSupplier(null);
        setIsModalOpen(true);
    };

    const handleEdit = (supplier) => {
        setCurrentSupplier(supplier);
        setIsModalOpen(true);
    };

    const handleDelete = (supplierId) => {
        toast((t) => (
            <div className="flex flex-col items-center">
                <p className="font-semibold text-gray-900 dark:text-slate-100">Are you sure?</p>
                <div className="flex space-x-2 mt-2">
                    <button onClick={() => { toast.dismiss(t.id); confirmDelete(supplierId); }} className="px-3 py-1 bg-danger-600 text-white text-sm rounded-lg hover:bg-danger-700">Delete</button>
                    <button onClick={() => toast.dismiss(t.id)} className="px-3 py-1 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600">Cancel</button>
                </div>
            </div>
        ));
    };

    const confirmDelete = async (supplierId) => {
        const promise = api.delete(`/suppliers/${supplierId}`);
        toast.promise(promise, {
            loading: 'Deleting supplier...',
            success: () => { fetchSuppliers(); return 'Supplier deleted!'; },
            error: 'Failed to delete supplier.',
        });
    };

    const handleSave = async (supplierData) => {
        const promise = currentSupplier
            ? api.put(`/suppliers/${currentSupplier.supplier_id}`, supplierData)
            : api.post('/suppliers', supplierData);

        toast.promise(promise, {
            loading: 'Saving supplier...',
            success: () => {
                setIsModalOpen(false);
                fetchSuppliers();
                return 'Supplier saved!';
            },
            error: 'Failed to save supplier.',
        });
    };

    const handleRowClick = (supplier) => {
        setSelectedSupplier(supplier.ap ? { ...supplier, ...supplier.ap } : supplier);
    };

    const handleSupplierUpdated = (updated) => {
        setSelectedSupplier((prev) => prev ? { ...prev, ...updated } : prev);
        fetchSuppliers();
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Suppliers</h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">Directory, payables balance, and payment status for every supplier.</p>
                </div>
                {hasPermission('suppliers:edit') && (
                    <button onClick={handleAdd} className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition shadow-sm text-sm">
                        Add Supplier
                    </button>
                )}
            </div>

            <div className="border-b border-gray-200 dark:border-slate-700">
                <SegmentedTabs tabs={filterTabs} active={statusFilter} onChange={setStatusFilter} />
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card">
                {loading && <p className="text-gray-600 dark:text-slate-400">Loading suppliers...</p>}
                {error && <p className="text-danger-500">{error}</p>}
                {!loading && !error && (
                    <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b border-gray-200 dark:border-slate-700">
                                <tr>
                                    <SortableHeader column="supplier_name" sortConfig={sortConfig} onSort={handleSort}>Name</SortableHeader>
                                    <SortableHeader className="hidden sm:table-cell" column="contact_person" sortConfig={sortConfig} onSort={handleSort}>Contact Person</SortableHeader>
                                    <SortableHeader className="hidden md:table-cell" column="phone" sortConfig={sortConfig} onSort={handleSort}>Phone</SortableHeader>
                                    {canViewAp && <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300 text-right">AP Balance</th>}
                                    <SortableHeader className="text-center" column="status" sortConfig={sortConfig} onSort={handleSort}>Status</SortableHeader>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {suppliers.map(supplier => (
                                    <tr
                                        key={supplier.supplier_id}
                                        onClick={() => handleRowClick(supplier)}
                                        className="border-b border-gray-100 dark:border-slate-700 hover:bg-gray-50 dark:hover:bg-slate-700/50 cursor-pointer"
                                    >
                                        <td className="p-3 text-sm font-medium text-gray-800 dark:text-slate-100">
                                            <div className="flex items-center gap-2">
                                                <span>{supplier.supplier_name}</span>
                                                {supplier.ap?.payment_hold && <StatusBadge tone="danger" label="ON HOLD" />}
                                            </div>
                                        </td>
                                        <td className="p-3 text-sm hidden sm:table-cell text-gray-700 dark:text-slate-300">{supplier.contact_person}</td>
                                        <td className="p-3 text-sm hidden md:table-cell text-gray-700 dark:text-slate-300">{supplier.phone}</td>
                                        {canViewAp && (
                                            <td className="p-3 text-sm text-right font-mono text-gray-900 dark:text-slate-100">
                                                {supplier.ap ? formatCurrency(supplier.ap.total_balance_due) : '—'}
                                            </td>
                                        )}
                                        <td className="p-3 text-sm text-center">
                                            <StatusBadge tone={supplier.is_active ? 'success' : 'neutral'} label={supplier.is_active ? 'Active' : 'Inactive'} />
                                        </td>
                                        <td className="p-3 text-sm text-right" onClick={(e) => e.stopPropagation()}>
                                            {hasPermission('suppliers:edit') && (
                                                <>
                                                    <button onClick={() => handleEdit(supplier)} className="text-primary-600 dark:text-primary-400 hover:text-primary-800 dark:hover:text-primary-300 mr-4"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                                    <button onClick={() => handleDelete(supplier.supplier_id)} className="text-danger-600 dark:text-danger-400 hover:text-danger-800 dark:hover:text-danger-300"><Icon path={ICONS.trash} className="h-5 w-5"/></button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))}
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
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentSupplier ? 'Edit Supplier' : 'Add New Supplier'}>
                <SupplierForm supplier={currentSupplier} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
            {canViewAp && (
                <SupplierDetailDrawer
                    supplier={selectedSupplier}
                    isOpen={!!selectedSupplier}
                    onClose={() => setSelectedSupplier(null)}
                    onSupplierUpdated={handleSupplierUpdated}
                    initialTab="profile"
                />
            )}
        </div>
    );
};

export default SuppliersPage;
