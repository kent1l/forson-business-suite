import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

const CustomerForm = ({ customer, onSave, onCancel }) => {
    const [formData, setFormData] = useState({ first_name: '', last_name: '', company_name: '', phone: '', email: '', address: '' });

    useEffect(() => {
        if (customer) {
            setFormData(customer);
        } else {
            setFormData({ first_name: '', last_name: '', company_name: '', phone: '', email: '', address: '' });
        }
    }, [customer]);

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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">First Name</label>
                    <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last Name</label>
                    <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                <input type="text" name="company_name" value={formData.company_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                    <input type="text" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                    <input type="email" name="email" value={formData.email} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                <textarea name="address" value={formData.address} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows="3"></textarea>
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
        </form>
    );
};

const CustomersPage = () => {
    const [customers, setCustomers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentCustomer, setCurrentCustomer] = useState(null);

    const fetchCustomers = async () => {
        try {
            setError('');
            setLoading(true);
            const response = await axios.get('http://localhost:3001/api/customers');
            setCustomers(response.data);
        } catch (err) {
            setError('Failed to fetch customers.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchCustomers();
    }, []);

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
        const promise = axios.delete(`http://localhost:3001/api/customers/${customerId}`);
        toast.promise(promise, {
            loading: 'Deleting customer...',
            success: () => { fetchCustomers(); return 'Customer deleted!'; },
            error: (err) => err.response?.data?.message || 'Failed to delete customer.',
        });
    };

    const handleSave = async (customerData) => {
        const promise = currentCustomer
            ? axios.put(`http://localhost:3001/api/customers/${currentCustomer.customer_id}`, customerData)
            : axios.post('http://localhost:3001/api/customers', customerData);

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

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Customers</h1>
                <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                    Add Customer
                </button>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading customers...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Company</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 hidden sm:table-cell">Phone</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 hidden md:table-cell">Email</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {customers.map(customer => (
                                    <tr key={customer.customer_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-medium text-gray-800">{customer.first_name} {customer.last_name}</td>
                                        <td className="p-3 text-sm">{customer.company_name}</td>
                                        <td className="p-3 text-sm hidden sm:table-cell">{customer.phone}</td>
                                        <td className="p-3 text-sm hidden md:table-cell">{customer.email}</td>
                                        <td className="p-3 text-sm text-right">
                                            <button onClick={() => handleEdit(customer)} className="text-blue-600 hover:text-blue-800 mr-4"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                            <button onClick={() => handleDelete(customer.customer_id)} className="text-red-600 hover:text-red-800"><Icon path={ICONS.trash} className="h-5 w-5"/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentCustomer ? 'Edit Customer' : 'Add New Customer'}>
                <CustomerForm customer={currentCustomer} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default CustomersPage;
