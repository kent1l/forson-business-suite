import React, { useState, useEffect } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import PartNumberManager from './PartNumberManager';
import PartApplicationManager from './PartApplicationManager';

const PartForm = ({ part, brands, groups, onSave, onCancel }) => {
    const [formData, setFormData] = useState({ detail: '', brand_id: '', group_id: '' });

    useEffect(() => {
        if (part) {
            setFormData(part);
        } else {
            setFormData({ detail: '', brand_id: '', group_id: '' });
        }
    }, [part]);

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
                <label className="block text-sm font-medium text-gray-700 mb-1">Part Detail</label>
                <input type="text" name="detail" value={formData.detail} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                <select name="brand_id" value={formData.brand_id} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                    <option value="">Select a Brand</option>
                    {brands.map(brand => <option key={brand.brand_id} value={brand.brand_id}>{brand.brand_name}</option>)}
                </select>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
                <select name="group_id" value={formData.group_id} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                    <option value="">Select a Group</option>
                    {groups.map(group => <option key={group.group_id} value={group.group_id}>{group.group_name}</option>)}
                </select>
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
        </form>
    );
};

const PartsPage = () => {
    const [parts, setParts] = useState([]);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isNumberModalOpen, setIsNumberModalOpen] = useState(false);
    const [isAppModalOpen, setIsAppModalOpen] = useState(false);
    const [currentPart, setCurrentPart] = useState(null);

    const fetchData = async () => {
        try {
            setLoading(true);
            setError('');
            const [partsRes, brandsRes, groupsRes] = await Promise.all([
                axios.get('http://localhost:3001/api/parts'),
                axios.get('http://localhost:3001/api/brands'),
                axios.get('http://localhost:3001/api/groups')
            ]);
            setParts(partsRes.data);
            setBrands(brandsRes.data);
            setGroups(groupsRes.data);
        } catch (err) {
            setError('Failed to fetch data.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, []);

    const handleAdd = () => {
        setCurrentPart(null);
        setIsFormModalOpen(true);
    };

    const handleEdit = (part) => {
        setCurrentPart(part);
        setIsFormModalOpen(true);
    };
    
    const handleManageNumbers = (part) => {
        setCurrentPart(part);
        setIsNumberModalOpen(true);
    };

    const handleManageApps = (part) => {
        setCurrentPart(part);
        setIsAppModalOpen(true);
    };

    const handleDelete = (partId) => {
        toast((t) => (
            <div className="flex flex-col items-center">
                <p className="font-semibold">Are you sure?</p>
                <p className="text-sm text-gray-600 mb-3">This action cannot be undone.</p>
                <div className="flex space-x-2">
                    <button
                        onClick={() => {
                            toast.dismiss(t.id);
                            confirmDelete(partId);
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

    const confirmDelete = async (partId) => {
        const promise = axios.delete(`http://localhost:3001/api/parts/${partId}`);
        toast.promise(promise, {
            loading: 'Deleting part...',
            success: () => {
                fetchData();
                return 'Part deleted successfully!';
            },
            error: 'Failed to delete part.',
        });
    };

    const handleSave = async (partData) => {
        const promise = currentPart
            ? axios.put(`http://localhost:3001/api/parts/${currentPart.part_id}`, partData)
            : axios.post('http://localhost:3001/api/parts', partData);

        toast.promise(promise, {
            loading: 'Saving part...',
            success: () => {
                setIsFormModalOpen(false);
                fetchData();
                return 'Part saved successfully!';
            },
            error: 'Failed to save part.',
        });
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Parts</h1>
                <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                    Add Part
                </button>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading parts...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">SKU</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Detail</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Brand</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Group</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {parts.map(part => (
                                    <tr key={part.part_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono">{part.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800">{part.detail}</td>
                                        <td className="p-3 text-sm">{part.brand_name}</td>
                                        <td className="p-3 text-sm">{part.group_name}</td>
                                        <td className="p-3 text-sm text-right space-x-4">
                                            <button onClick={() => handleManageApps(part)} className="text-green-600 hover:text-green-800" title="Manage Part Applications">
                                                <Icon path={ICONS.link} className="h-5 w-5"/>
                                            </button>
                                            <button onClick={() => handleManageNumbers(part)} className="text-gray-600 hover:text-gray-800" title="Manage Part Numbers">
                                                <Icon path={ICONS.numbers} className="h-5 w-5"/>
                                            </button>
                                            <button onClick={() => handleEdit(part)} className="text-blue-600 hover:text-blue-800" title="Edit Part">
                                                <Icon path={ICONS.edit} className="h-5 w-5"/>
                                            </button>
                                            <button onClick={() => handleDelete(part.part_id)} className="text-red-600 hover:text-red-800" title="Delete Part">
                                                <Icon path={ICONS.trash} className="h-5 w-5"/>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <Modal isOpen={isFormModalOpen} onClose={() => setIsFormModalOpen(false)} title={currentPart ? 'Edit Part' : 'Add New Part'}>
                <PartForm part={currentPart} brands={brands} groups={groups} onSave={handleSave} onCancel={() => setIsFormModalOpen(false)} />
            </Modal>
            
            <Modal isOpen={isNumberModalOpen} onClose={() => setIsNumberModalOpen(false)} title={`Manage Numbers for: ${currentPart?.detail}`}>
                <PartNumberManager part={currentPart} onCancel={() => setIsNumberModalOpen(false)} />
            </Modal>

            <Modal isOpen={isAppModalOpen} onClose={() => setIsAppModalOpen(false)} title={`Manage Applications for: ${currentPart?.detail}`}>
                <PartApplicationManager part={currentPart} onCancel={() => setIsAppModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default PartsPage;
