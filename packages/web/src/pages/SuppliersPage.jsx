import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast'; // 1. Import toast
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

const SupplierForm = ({ supplier, onSave, onCancel }) => {
    // ... (This component remains the same)
    const [formData, setFormData] = useState({
        supplier_name: '', contact_person: '', phone: '', email: '', address: ''
    });

    useEffect(() => {
        if (supplier) {
            setFormData(supplier);
        } else {
             setFormData({ supplier_name: '', contact_person: '', phone: '', email: '', address: '' });
        }
    }, [supplier]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name</label>
                <input type="text" name="supplier_name" value={formData.supplier_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                <input type="text" name="contact_person" value={formData.contact_person} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="text" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
        </form>
    );
};

const SuppliersPage = () => {
    const [suppliers, setSuppliers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentSupplier, setCurrentSupplier] = useState(null);

    const fetchSuppliers = async () => {
        try {
            setError('');
            setLoading(true);
            const response = await axios.get('http://localhost:3001/api/suppliers');
            setSuppliers(response.data);
        } catch (err) {
            setError('Failed to fetch suppliers.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSuppliers();
    }, []);

    const handleAdd = () => {
        setCurrentSupplier(null);
        setIsModalOpen(true);
    };

    const handleEdit = (supplier) => {
        setCurrentSupplier(supplier);
        setIsModalOpen(true);
    };

    const handleDelete = (supplierId) => {
        // 2. Use a confirmation toast
        toast((t) => (
            <div className="flex flex-col items-center">
                <p className="font-semibold">Are you sure?</p>
                <p className="text-sm text-gray-600 mb-3">This action cannot be undone.</p>
                <div className="flex space-x-2">
                    <button
                        onClick={() => {
                            toast.dismiss(t.id);
                            confirmDelete(supplierId);
                        }}
                        className="px-3 py-1 bg-red-600 text-white text-sm rounded-md hover:bg-red-700"
                    >
                        Delete
                    </button>
                    <button
                        onClick={() => toast.dismiss(t.id)}
                        className="px-3 py-1 bg-gray-200 text-gray-800 text-sm rounded-md hover:bg-gray-300"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        ), {
            duration: 6000,
        });
    };
    
    const confirmDelete = async (supplierId) => {
        const promise = axios.delete(`http://localhost:3001/api/suppliers/${supplierId}`);
        
        // 3. Use a promise-based toast for loading, success, and error states
        toast.promise(promise, {
            loading: 'Deleting supplier...',
            success: () => {
                fetchSuppliers(); // Refresh the list on success
                return 'Supplier deleted successfully!';
            },
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
                return 'Supplier saved successfully!';
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
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading suppliers...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">ID</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 hidden sm:table-cell">Contact Person</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 hidden md:table-cell">Phone</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {suppliers.map(supplier => (
                                    <tr key={supplier.supplier_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm">{supplier.supplier_id}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800">{supplier.supplier_name}</td>
                                        <td className="p-3 text-sm hidden sm:table-cell">{supplier.contact_person}</td>
                                        <td className="p-3 text-sm hidden md:table-cell">{supplier.phone}</td>
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
