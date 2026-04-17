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

const CustomersPage = () => {
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

    const filterTabs = [
        { key: 'active', label: 'Active' },
        { key: 'inactive', label: 'Inactive' },
        { key: 'all', label: 'All' },
    ];

    const fetchCustomers = async () => {
        try {
            setError('');
            setLoading(true);
            const response = await api.get('/customers', { params: { status: statusFilter, page, pageSize, paginated: 1 } });
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
    }, [statusFilter, page, pageSize]);

    useEffect(() => {
        setPage(1);
    }, [statusFilter]);

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
                <p className="font-semibold">Are you sure?</p>
                <div className="flex space-x-2 mt-2">
                    <button onClick={() => { toast.dismiss(t.id); confirmDelete(customerId); }} className="px-3 py-1 bg-red-600 text-white text-sm rounded-md">Delete</button>
                    <button onClick={() => toast.dismiss(t.id)} className="px-3 py-1 bg-gray-200 text-gray-800 text-sm rounded-md">Cancel</button>
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
            : api.post('/customers', customerData);

        toast.promise(promise, {
            loading: 'Saving customer...',
            success: () => {
                setIsModalOpen(false);
                fetchCustomers();
                return 'Customer saved successfully!';
            },
            error: 'Failed to save customer.',
        });
    };

    const sortedCustomers = sortData(customers, sortConfig, {
        full_name: (row) => `${row.first_name || ''} ${row.last_name || ''}`.trim(),
        status: (row) => (row.is_active ? 1 : 0)
    });

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Customers</h1>
                {hasPermission('customers:edit') && (
                    <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                        Add Customer
                    </button>
                )}
            </div>

            <FilterBar 
                tabs={filterTabs}
                activeTab={statusFilter}
                onTabClick={setStatusFilter}
            />

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading customers...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <SortableHeader column="full_name" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Name</SortableHeader>
                                    <SortableHeader column="company_name" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Company</SortableHeader>
                                    <SortableHeader className="hidden sm:table-cell" column="phone" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Phone</SortableHeader>
                                    <SortableHeader className="text-center" column="status" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Status</SortableHeader>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedCustomers.map(customer => (
                                    <tr key={customer.customer_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-medium text-gray-800">{customer.first_name} {customer.last_name}</td>
                                        <td className="p-3 text-sm">{customer.company_name}</td>
                                        <td className="p-3 text-sm hidden sm:table-cell">{customer.phone}</td>
                                        <td className="p-3 text-sm text-center">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${customer.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                {customer.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-sm text-right">
                                            {hasPermission('customers:edit') && (
                                                <>
                                                    <button onClick={() => handleEdit(customer)} className="text-blue-600 hover:text-blue-800 mr-4"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                                    <button onClick={() => handleDelete(customer.customer_id)} className="text-red-600 hover:text-red-800"><Icon path={ICONS.trash} className="h-5 w-5"/></button>
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
        </div>
    );
};

export default CustomersPage;
