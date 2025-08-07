import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import PartNumberManager from './PartNumberManager';
import PartApplicationManager from './PartApplicationManager';

const BrandGroupForm = ({ type, onSave, onCancel }) => {
    const [name, setName] = useState('');
    const [code, setCode] = useState('');

    const handleSubmit = async (e) => {
        e.preventDefault();
        const endpoint = type === 'Brand' ? '/api/brands' : '/api/groups';
        const payload = type === 'Brand' ? { brand_name: name, brand_code: code } : { group_name: name, group_code: code };
        
        const promise = axios.post(`http://localhost:3001${endpoint}`, payload);
        toast.promise(promise, {
            loading: `Adding ${type}...`,
            success: (response) => {
                onSave(response.data);
                return `${type} added successfully!`;
            },
            error: `Failed to add ${type}.`
        });
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{type} Name</label>
                <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{type} Code (max 10 chars)</label>
                <input type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength="10" className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
        </form>
    );
};

const PartForm = ({ part, brands, groups, onSave, onCancel, onBrandGroupAdded }) => {
    const [formData, setFormData] = useState({
        detail: '', brand_id: '', group_id: '', part_numbers_string: '',
        reorder_point: 0, warning_quantity: 0, is_active: true,
        last_cost: 0, last_sale_price: 0, barcode: '', measurement_unit: 'pcs',
        is_price_change_allowed: true, is_using_default_quantity: true,
        is_service: false, low_stock_warning: false
    });
    const [isBrandModalOpen, setIsBrandModalOpen] = useState(false);
    const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);

    useEffect(() => {
        if (part) {
            setFormData({
                detail: part.detail || '',
                brand_id: part.brand_id || '',
                group_id: part.group_id || '',
                part_numbers_string: '',
                reorder_point: part.reorder_point || 0,
                warning_quantity: part.warning_quantity || 0,
                is_active: part.is_active,
                last_cost: part.last_cost || 0,
                last_sale_price: part.last_sale_price || 0,
                barcode: part.barcode || '',
                measurement_unit: part.measurement_unit || 'pcs',
                is_price_change_allowed: part.is_price_change_allowed,
                is_using_default_quantity: part.is_using_default_quantity,
                is_service: part.is_service,
                low_stock_warning: part.low_stock_warning,
            });
        } else {
            setFormData({
                detail: '', brand_id: '', group_id: '', part_numbers_string: '',
                reorder_point: 0, warning_quantity: 0, is_active: true,
                last_cost: 0, last_sale_price: 0, barcode: '', measurement_unit: 'pcs',
                is_price_change_allowed: true, is_using_default_quantity: true,
                is_service: false, low_stock_warning: false
            });
        }
    }, [part]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };
    
    const handleNewBrandGroup = (newItem, type) => {
        onBrandGroupAdded();
        if(type === 'Brand') {
            setFormData(prev => ({...prev, brand_id: newItem.brand_id}));
            setIsBrandModalOpen(false);
        } else {
            setFormData(prev => ({...prev, group_id: newItem.group_id}));
            setIsGroupModalOpen(false);
        }
    };

    return (
        <>
            <form onSubmit={handleSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto p-1">
                {/* --- Primary Fields --- */}
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Part Detail</label>
                    <input type="text" name="detail" value={formData.detail} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
                </div>
                {!part && (
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Part Numbers (optional)</label>
                        <textarea name="part_numbers_string" value={formData.part_numbers_string} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows="2" placeholder="OEM123, MFG456; ALT789"></textarea>
                    </div>
                )}
                <div className="flex items-end space-x-2">
                    <div className="flex-grow">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Brand</label>
                        <select name="brand_id" value={formData.brand_id} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                            <option value="">Select a Brand</option>
                            {brands.map(brand => <option key={brand.brand_id} value={brand.brand_id}>{brand.brand_name}</option>)}
                        </select>
                    </div>
                    <button type="button" onClick={() => setIsBrandModalOpen(true)} className="px-3 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 text-sm">New</button>
                </div>
                <div className="flex items-end space-x-2">
                    <div className="flex-grow">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Group</label>
                        <select name="group_id" value={formData.group_id} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required>
                            <option value="">Select a Group</option>
                            {groups.map(group => <option key={group.group_id} value={group.group_id}>{group.group_name}</option>)}
                        </select>
                    </div>
                    <button type="button" onClick={() => setIsGroupModalOpen(true)} className="px-3 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 text-sm">New</button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Last Cost</label>
                        <input type="number" step="0.01" name="last_cost" value={formData.last_cost} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Last Sale Price</label>
                        <input type="number" step="0.01" name="last_sale_price" value={formData.last_sale_price} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                </div>

                {/* --- Advanced Options Drawer --- */}
                <div className="pt-4 border-t">
                    <button type="button" onClick={() => setShowAdvanced(!showAdvanced)} className="text-sm font-medium text-blue-600 hover:text-blue-800">
                        {showAdvanced ? 'Hide Advanced Options' : 'Show Advanced Options'}
                    </button>
                    <div className={`transition-all duration-300 ease-in-out overflow-hidden ${showAdvanced ? 'max-h-96 mt-4' : 'max-h-0'}`}>
                        <div className="space-y-4">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Barcode</label>
                                    <input type="text" name="barcode" value={formData.barcode} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
                                    <input type="text" name="measurement_unit" value={formData.measurement_unit} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Reorder Point</label>
                                    <input type="number" name="reorder_point" value={formData.reorder_point} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Warning Qty</label>
                                    <input type="number" name="warning_quantity" value={formData.warning_quantity} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-4 border-t">
                                <div className="flex items-center"><input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Active</label></div>
                                <div className="flex items-center"><input type="checkbox" name="is_service" checked={formData.is_service} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Is Service</label></div>
                                <div className="flex items-center"><input type="checkbox" name="low_stock_warning" checked={formData.low_stock_warning} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Low Stock Warning</label></div>
                                <div className="flex items-center"><input type="checkbox" name="is_price_change_allowed" checked={formData.is_price_change_allowed} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Price Change Allowed</label></div>
                                <div className="flex items-center"><input type="checkbox" name="is_using_default_quantity" checked={formData.is_using_default_quantity} onChange={handleChange} className="h-4 w-4" /><label className="ml-2 text-sm">Use Default Qty</label></div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="mt-6 flex justify-end space-x-4 pt-4 border-t">
                    <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
                </div>
            </form>
            <Modal isOpen={isBrandModalOpen} onClose={() => setIsBrandModalOpen(false)} title="Add New Brand">
                <BrandGroupForm type="Brand" onSave={(newBrand) => handleNewBrandGroup(newBrand, 'Brand')} onCancel={() => setIsBrandModalOpen(false)} />
            </Modal>
            <Modal isOpen={isGroupModalOpen} onClose={() => setIsGroupModalOpen(false)} title="Add New Group">
                <BrandGroupForm type="Group" onSave={(newGroup) => handleNewBrandGroup(newGroup, 'Group')} onCancel={() => setIsGroupModalOpen(false)} />
            </Modal>
        </>
    );
};

const PartsPage = ({ user }) => {
    const [parts, setParts] = useState([]);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isNumberModalOpen, setIsNumberModalOpen] = useState(false);
    const [isAppModalOpen, setIsAppModalOpen] = useState(false);
    const [currentPart, setCurrentPart] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('active');

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const params = {
                search: searchTerm,
                status: statusFilter,
            };
            const partsRes = await axios.get('http://localhost:3001/api/parts', { params });
            setParts(partsRes.data);
        } catch (err) {
            setError('Failed to fetch parts.');
        } finally {
            setLoading(false);
        }
    }, [searchTerm, statusFilter]);

    useEffect(() => {
        const fetchDropdownData = async () => {
            try {
                const [brandsRes, groupsRes] = await Promise.all([
                    axios.get('http://localhost:3001/api/brands'),
                    axios.get('http://localhost:3001/api/groups')
                ]);
                setBrands(brandsRes.data);
                setGroups(groupsRes.data);
            } catch (err) {
                console.error(err);
                setError('Failed to fetch initial data.');
            }
        };
        fetchDropdownData();
    }, []);

    useEffect(() => {
        const debounceTimer = setTimeout(() => {
            fetchData();
        }, 300);
        return () => clearTimeout(debounceTimer);
    }, [fetchData]);

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
                <div className="flex space-x-2 mt-2">
                    <button onClick={() => { toast.dismiss(t.id); confirmDelete(partId); }} className="px-3 py-1 bg-red-600 text-white text-sm rounded-md">Delete</button>
                    <button onClick={() => toast.dismiss(t.id)} className="px-3 py-1 bg-gray-200 text-gray-800 text-sm rounded-md">Cancel</button>
                </div>
            </div>
        ));
    };

    const confirmDelete = async (partId) => {
        const promise = axios.delete(`http://localhost:3001/api/parts/${partId}`);
        toast.promise(promise, {
            loading: 'Deleting part...',
            success: () => { fetchData(); return 'Part deleted!'; },
            error: 'Failed to delete part.',
        });
    };

    const handleSave = async (partData) => {
        const payload = {
            ...partData,
            created_by: !currentPart ? user.employee_id : undefined,
            modified_by: currentPart ? user.employee_id : undefined,
        };

        const promise = currentPart
            ? axios.put(`http://localhost:3001/api/parts/${currentPart.part_id}`, payload)
            : axios.post('http://localhost:3001/api/parts', payload);

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
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
                <h1 className="text-2xl font-semibold text-gray-800">Parts</h1>
                <div className="w-full sm:w-auto flex items-center space-x-2">
                    <div className="relative w-full sm:w-64">
                         <Icon path={ICONS.search} className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                         <input 
                            type="text"
                            placeholder="Search parts..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg"
                         />
                    </div>
                    <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition whitespace-nowrap">
                        Add Part
                    </button>
                </div>
            </div>

            <div className="mb-4">
                <div className="flex space-x-4 border-b">
                    <button onClick={() => setStatusFilter('active')} className={`py-2 px-4 text-sm font-medium ${statusFilter === 'active' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}>Active</button>
                    <button onClick={() => setStatusFilter('inactive')} className={`py-2 px-4 text-sm font-medium ${statusFilter === 'inactive' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}>Inactive</button>
                    <button onClick={() => setStatusFilter('all')} className={`py-2 px-4 text-sm font-medium ${statusFilter === 'all' ? 'border-b-2 border-blue-600 text-blue-600' : 'text-gray-500'}`}>All</button>
                </div>
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
                                    <th className="p-3 text-sm font-semibold text-gray-600">Display Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Applications</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {parts.map(part => (
                                    <tr key={part.part_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-mono align-top">{part.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium text-gray-800 align-top">{part.display_name}</td>
                                        <td className="p-3 text-sm text-gray-600 align-top">{part.applications}</td>
                                        <td className="p-3 text-sm text-right space-x-4 align-top">
                                            <button onClick={() => handleManageApps(part)} className="text-green-600 hover:text-green-800" title="Manage Part Applications"><Icon path={ICONS.link} className="h-5 w-5"/></button>
                                            <button onClick={() => handleManageNumbers(part)} className="text-gray-600 hover:text-gray-800" title="Manage Part Numbers"><Icon path={ICONS.numbers} className="h-5 w-5"/></button>
                                            <button onClick={() => handleEdit(part)} className="text-blue-600 hover:text-blue-800" title="Edit Part"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                            <button onClick={() => handleDelete(part.part_id)} className="text-red-600 hover:text-red-800" title="Delete Part"><Icon path={ICONS.trash} className="h-5 w-5"/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <Modal isOpen={isFormModalOpen} onClose={() => setIsFormModalOpen(false)} title={currentPart ? 'Edit Part' : 'Add New Part'}>
                <PartForm 
                    part={currentPart} 
                    brands={brands} 
                    groups={groups} 
                    onSave={handleSave} 
                    onCancel={() => setIsFormModalOpen(false)}
                    onBrandGroupAdded={fetchData}
                />
            </Modal>
            
            <Modal isOpen={isNumberModalOpen} onClose={() => setIsNumberModalOpen(false)} title={`Manage Numbers for: ${currentPart?.detail}`}>
                <PartNumberManager part={currentPart} onSave={fetchData} onCancel={() => setIsNumberModalOpen(false)} />
            </Modal>

            <Modal isOpen={isAppModalOpen} onClose={() => setIsAppModalOpen(false)} title={`Manage Applications for: ${currentPart?.detail}`}>
                <PartApplicationManager part={currentPart} onCancel={() => setIsAppModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default PartsPage;
