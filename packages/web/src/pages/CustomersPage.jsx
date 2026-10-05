import React, { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import CustomerForm from '../components/forms/CustomerForm';
import FilterBar from '../components/ui/FilterBar';
import PaginationControls from '../components/ui/PaginationControls';
import SortableHeader from '../components/ui/SortableHeader';
import { useAuth } from '../contexts/AuthContext'; // <-- NEW: Import useAuth
import { sortData } from '../utils/sortData';
import { postWithJevConfirmation } from '../helpers/jevConfirmation';
import CustomerPurchaseHistoryModal from '../components/customers/CustomerPurchaseHistoryModal';

const CustomersPage = ({ onNavigate }) => {
    const { hasPermission } = useAuth(); // <-- NEW: Use the auth context
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentCustomer, setCurrentCustomer] = useState(null);
    const [statusFilter, setStatusFilter] = useState('active');
    const [sortConfig, setSortConfig] = useState({ key: 'first_name', direction: 'ASC' });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [historyCustomer, setHistoryCustomer] = useState(null);

    const filterTabs = [
        { key: 'active', label: 'Active' },
        { key: 'inactive', label: 'Inactive' },
        { key: 'all', label: 'All' },
    ];

    const fetchCustomers = async () => {
        try {
            setError('');
            setLoading(true);
            const response = await api.get('/customers', {
                params: {
                    status: statusFilter,
                    page,
                    pageSize,
                    paginated: 1,
                    sortBy: sortConfig.key,
                    sortOrder: sortConfig.direction
                }
            });
            setCustomers(response.data?.data || []);
            setTotal(response.data?.total || 0);
        } catch (err) {
            setError('Failed to fetch customers.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCustomers();
    }, [statusFilter, page, pageSize, sortConfig]);

    useEffect(() => {
        setPage(1);
    }, [statusFilter]);

    const handleSort = (key, direction) => {
        setSortConfig({ key, direction });
        setPage(1);
    };

    const handleAdd = () => {
        setCurrentCustomer(null);
        setIsModalOpen(true);
    };

    const handleEdit = (customer) => {
        setCurrentCustomer(customer);
        setIsModalOpen(true);
    };

    const handleDelete = (customerId) => {
        toast((t) => (
            <div className="flex flex-col items-center">
                <p className="font-semibold text-gray-900 dark:text-slate-100">Are you sure?</p>
                <div className="flex space-x-2 mt-2">
                    <button onClick={() => { toast.dismiss(t.id); confirmDelete(customerId); }} className="px-3 py-1 bg-danger-600 text-white text-sm rounded-lg hover:bg-danger-700">Delete</button>
                    <button onClick={() => toast.dismiss(t.id)} className="px-3 py-1 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 text-sm rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600">Cancel</button>
                </div>
            </div>
        ));
    };

    const confirmDelete = async (customerId) => {
        const promise = api.delete(`/customers/${customerId}`);
        toast.promise(promise, {
            loading: 'Deleting customer...',
            success: () => { fetchCustomers(); return 'Customer deleted!'; },
            error: (err) => err.response?.data?.message || 'Failed to delete customer.',
        });
    };

    const handleSave = async (customerData) => {
        const promise = currentCustomer
            ? api.put(`/customers/${currentCustomer.customer_id}`, customerData)
            : postWithJevConfirmation('/customers', customerData, 'customer');

        toast.promise(promise, {
            loading: 'Saving customer...',
            success: (res) => {
                setIsModalOpen(false);
                fetchCustomers();
                return res?.data?.existing ? 'Using the existing customer.' : 'Customer saved successfully!';
            },
            error: (err) => err.response?.data?.message || 'Failed to save customer.',
        });
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Customers</h1>
                {hasPermission('customers:edit') && <div className="flex gap-2">
                    <button onClick={() => onNavigate('customer_management')} className="border border-primary-600 text-primary-700 dark:text-primary-300 px-4 py-2 rounded-lg font-semibold hover:bg-primary-50 dark:hover:bg-primary-950 transition text-sm">Clean duplicates</button>
                    <button onClick={handleAdd} className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition shadow-sm text-sm">Add Customer</button>
                </div>}
            </div>

            <FilterBar 
                tabs={filterTabs}
                activeTab={statusFilter}
                onTabClick={setStatusFilter}
            />

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card">
                {loading && <p className="text-gray-500 dark:text-slate-400">Loading customers...</p>}
                {error && <p className="text-danger-600 dark:text-danger-400">{error}</p>}
                {!loading && !error && (
                    <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 dark:bg-slate-700/40 border-b border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300">
                                <tr>
                                    <SortableHeader column="full_name" sortConfig={sortConfig} onSort={handleSort}>Name</SortableHeader>
                                    <SortableHeader column="company_name" sortConfig={sortConfig} onSort={handleSort}>Company</SortableHeader>
                                    <SortableHeader className="hidden sm:table-cell" column="phone" sortConfig={sortConfig} onSort={handleSort}>Phone</SortableHeader>
                                    <SortableHeader className="text-center" column="status" sortConfig={sortConfig} onSort={handleSort}>Status</SortableHeader>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
                                {customers.map(customer => (
                                    <tr key={customer.customer_id} onClick={() => setHistoryCustomer(customer)} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-slate-700/40 text-gray-800 dark:text-slate-200 transition-colors">
                                        <td className="p-3 text-sm font-medium text-gray-900 dark:text-slate-100">{customer.first_name} {customer.last_name}</td>
                                        <td className="p-3 text-sm text-gray-700 dark:text-slate-300">{customer.company_name}</td>
                                        <td className="p-3 text-sm hidden sm:table-cell text-gray-700 dark:text-slate-300 font-mono">{customer.phone}</td>
                                        <td className="p-3 text-sm text-center">
                                            <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${customer.is_active ? 'bg-success-100 dark:bg-success-900/30 text-success-800 dark:text-success-400 border border-success-200 dark:border-success-800' : 'bg-danger-100 dark:bg-danger-900/30 text-danger-800 dark:text-danger-400 border border-danger-200 dark:border-danger-800'}`}>
                                                {customer.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-sm text-right">
                                            {hasPermission('customers:edit') && (
                                                <>
                                                    <button onClick={(event) => { event.stopPropagation(); handleEdit(customer); }} className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 mr-3 p-1" title="Edit Customer"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                                    <button onClick={(event) => { event.stopPropagation(); handleDelete(customer.customer_id); }} className="text-danger-600 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 p-1" title="Delete Customer"><Icon path={ICONS.trash} className="h-5 w-5"/></button>
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
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentCustomer ? 'Edit Customer' : 'Add New Customer'}>
                <CustomerForm customer={currentCustomer} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
            <CustomerPurchaseHistoryModal customer={historyCustomer} isOpen={!!historyCustomer} onClose={() => setHistoryCustomer(null)} />
        </div>
    );
};

export default CustomersPage;
