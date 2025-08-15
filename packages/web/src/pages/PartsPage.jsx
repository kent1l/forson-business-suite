import React, { useState, useEffect, useCallback } from 'react';
import api from '../api'; 
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import PartForm from '../components/forms/PartForm'; // Import the new form
import PartNumberManager from './PartNumberManager';
import PartApplicationManager from './PartApplicationManager';
import FilterBar from '../components/ui/FilterBar';

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
    const [isSelectMode, setIsSelectMode] = useState(false);
    const [selectedParts, setSelectedParts] = useState(new Set());

    const filterTabs = [
        { key: 'active', label: 'Active' },
        { key: 'inactive', label: 'Inactive' },
        { key: 'all', label: 'All' },
    ];

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            setError('');
            const params = {
                search: searchTerm,
                status: statusFilter,
            };
            const partsRes = await api.get('/parts', { params });
            setParts(partsRes.data);
        } catch (err) {
            setError('Failed to fetch parts.');
        } finally {
            setLoading(false);
        }
    }, [searchTerm, statusFilter]);

    const fetchDropdownData = async () => {
        try {
            const [brandsRes, groupsRes] = await Promise.all([
                api.get('/brands'),
                api.get('/groups')
            ]);
            setBrands(brandsRes.data);
            setGroups(groupsRes.data);
        } catch (err) {
            console.error(err);
            setError('Failed to fetch initial data.');
        }
    };

    useEffect(() => {
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
        setIsSelectMode(false);
        setIsFormModalOpen(true);
    };

    const handleEdit = (part) => {
        setCurrentPart(part);
        setIsSelectMode(false);
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
        const promise = api.delete(`/parts/${partId}`);
        toast.promise(promise, {
            loading: 'Deleting part...',
            success: () => { fetchData(); return 'Part deleted!'; },
            error: 'Failed to delete part.',
        });
    };

    const handleSave = async (partData) => {
        if (isSelectMode) {
            const payload = {
                partIds: Array.from(selectedParts),
                updates: partData
            };
            
            const promise = api.put('/parts/bulk-update', payload);
            toast.promise(promise, {
                loading: 'Applying bulk update...',
                success: () => {
                    setIsFormModalOpen(false);
                    setIsSelectMode(false);
                    setSelectedParts(new Set());
                    fetchData();
                    return 'Parts updated successfully!';
                },
                error: (err) => err.response?.data?.message || 'Failed to update parts.'
            });
        } else {
            const payload = {
                ...partData,
                created_by: !currentPart ? user.employee_id : undefined,
                modified_by: currentPart ? user.employee_id : undefined,
            };
            const promise = currentPart
                ? api.put(`/parts/${currentPart.part_id}`, payload)
                : api.post('/parts', payload);
            toast.promise(promise, {
                loading: 'Saving part...',
                success: () => {
                    setIsFormModalOpen(false);
                    fetchData();
                    return 'Part saved successfully!';
                },
                error: 'Failed to save part.',
            });
        }
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            const allPartIds = new Set(parts.map(p => p.part_id));
            setSelectedParts(allPartIds);
        } else {
            setSelectedParts(new Set());
        }
    };

    const handleSelectOne = (partId, isChecked) => {
        const newSelected = new Set(selectedParts);
        if (isChecked) {
            newSelected.add(partId);
        } else {
            newSelected.delete(partId);
        }
        setSelectedParts(newSelected);
    };

    const handleBulkEditClick = () => {
        if (selectedParts.size === 0) {
            return toast.error('Please select at least one part to edit.');
        }
        setCurrentPart(null);
        setIsFormModalOpen(true);
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
                    {user.permission_level_id >= 5 && !isSelectMode && (
                        <button onClick={() => setIsSelectMode(true)} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300 transition whitespace-nowrap">
                            Bulk Actions
                        </button>
                    )}
                    <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition whitespace-nowrap">
                        Add Part
                    </button>
                </div>
            </div>

            {isSelectMode && (
                <div className="bg-white p-3 rounded-xl border border-gray-200 mb-4 flex justify-between items-center">
                    <span className="font-semibold text-gray-700">{selectedParts.size} items selected</span>
                    <div>
                        <button onClick={handleBulkEditClick} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition mr-2">
                            Bulk Edit
                        </button>
                        <button onClick={() => { setIsSelectMode(false); setSelectedParts(new Set()); }} className="bg-gray-200 text-gray-800 px-4 py-2 rounded-lg font-semibold hover:bg-gray-300 transition">
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            <FilterBar 
                tabs={filterTabs}
                activeTab={statusFilter}
                onTabClick={setStatusFilter}
            />

            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading parts...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    {isSelectMode && (
                                        <th className="p-3 w-12">
                                            <input type="checkbox" onChange={handleSelectAll} checked={selectedParts.size === parts.length && parts.length > 0} className="h-4 w-4" />
                                        </th>
                                    )}
                                    <th className="p-3 text-sm font-semibold text-gray-600">SKU</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Display Name</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Applications</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {parts.map(part => (
                                    <tr key={part.part_id} className={`border-b hover:bg-gray-50 ${selectedParts.has(part.part_id) ? 'bg-blue-50' : ''}`}>
                                        {isSelectMode && (
                                            <td className="p-3">
                                                <input type="checkbox" checked={selectedParts.has(part.part_id)} onChange={(e) => handleSelectOne(part.part_id, e.target.checked)} className="h-4 w-4" />
                                            </td>
                                        )}
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
            <Modal isOpen={isFormModalOpen} onClose={() => setIsFormModalOpen(false)} title={isSelectMode ? 'Bulk Edit Parts' : (currentPart ? 'Edit Part' : 'Add New Part')}>
                <PartForm 
                    part={currentPart} 
                    brands={brands} 
                    groups={groups} 
                    onSave={handleSave} 
                    onCancel={() => setIsFormModalOpen(false)}
                    onBrandGroupAdded={fetchDropdownData}
                    isBulkEdit={isSelectMode}
                    selectedCount={selectedParts.size}
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
