import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import SupplierForm from '../components/forms/SupplierForm';
import FilterBar from '../components/ui/FilterBar';

const SuppliersPage = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentSupplier, setCurrentSupplier] = useState(null);
    const [statusFilter, setStatusFilter] = useState('active');

    const filterTabs = [
        { key: 'active', label: 'Active' },
        { key: 'inactive', label: 'Inactive' },
        { key: 'all', label: 'All' },
    ];

    const fetchSuppliers = async () => {
        try {
            setError('');
            setLoading(true);
            const response = await axios.get(`http://localhost:3001/api/suppliers?status=${statusFilter}`);
            setSuppliers(response.data);
        } catch (err) {
            setError('Failed to fetch suppliers.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSuppliers();
    }, [statusFilter]);

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
                <p className="font-semibold">Are you sure?</p>
                <div className="flex space-x-2 mt-2">
                    <button onClick={() => { toast.dismiss(t.id); confirmDelete(supplierId); }} className="px-3 py-1 bg-red-600 text-white text-sm rounded-md">Delete</button>
                    <button onClick={() => toast.dismiss(t.id)} className="px-3 py-1 bg-gray-200 text-gray-800 text-sm rounded-md">Cancel</button>
                </div>
            </div>
        ));
    };
    
    const confirmDelete = async (supplierId) => {
        const promise = axios.delete(`http://localhost:3001/api/suppliers/${supplierId}`);
        toast.promise(promise, {
            loading: 'Deleting supplier...',
            success: () => { fetchSuppliers(); return 'Supplier deleted!'; },
            error: 'Failed to delete supplier.',
        });
    };

    const handleSave = async (supplierData) => {
        const promise = currentSupplier
            ? axios.put(`http://localhost:3001/api/suppliers/${currentSupplier.supplier_id}`, supplierData)
            : axios.post('http://localhost:3001/api/suppliers', supplierData);

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

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Suppliers</h1>
                <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                    Add Supplier
                </button>
            </div>

            <FilterBar 
                tabs={filterTabs}
                activeTab={statusFilter}
                onTabClick={setStatusFilter}
            />

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading suppliers...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 hidden sm:table-cell">Contact Person</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 hidden md:table-cell">Phone</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-center">Status</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {suppliers.map(supplier => (
                                    <tr key={supplier.supplier_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-medium text-gray-800">{supplier.supplier_name}</td>
                                        <td className="p-3 text-sm hidden sm:table-cell">{supplier.contact_person}</td>
                                        <td className="p-3 text-sm hidden md:table-cell">{supplier.phone}</td>
                                        <td className="p-3 text-sm text-center">
                                            <span className={`px-2 py-1 text-xs font-semibold rounded-full ${supplier.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                {supplier.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="p-3 text-sm text-right">
                                            <button onClick={() => handleEdit(supplier)} className="text-blue-600 hover:text-blue-800 mr-4"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                            <button onClick={() => handleDelete(supplier.supplier_id)} className="text-red-600 hover:text-red-800"><Icon path={ICONS.trash} className="h-5 w-5"/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentSupplier ? 'Edit Supplier' : 'Add New Supplier'}>
                <SupplierForm supplier={currentSupplier} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default SuppliersPage;