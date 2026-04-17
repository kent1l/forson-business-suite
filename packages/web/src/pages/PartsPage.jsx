import React, { useState, useEffect, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import SearchBar from '../components/SearchBar';
import Modal from '../components/ui/Modal';
import PartForm from '../components/forms/PartForm';
import FilterBar from '../components/ui/FilterBar';
import TagPopover from '../components/ui/TagPopover';
import PaginationControls from '../components/ui/PaginationControls';
import SortableHeader from '../components/ui/SortableHeader';
import { useAuth } from '../contexts/AuthContext';
import PartNumberManager from './PartNumberManager';
import PartApplicationManager from './PartApplicationManager';
import { formatApplicationText } from '../helpers/applicationTextHelper';
import { sortData } from '../utils/sortData';

const PartsPage = ({ user, onNavigate }) => {
    const { hasPermission } = useAuth();
    const [parts, setParts] = useState([]);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isNumberModalOpen, setIsNumberModalOpen] = useState(false);
    const [isAppModalOpen, setIsAppModalOpen] = useState(false);
    const [currentPart, setCurrentPart] = useState(null);
    const [statusFilter, setStatusFilter] = useState('active');
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedParts, setSelectedParts] = useState([]);
    const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [sortConfig, setSortConfig] = useState({ key: 'internal_sku', direction: 'ASC' });
    const [globalSortBy, setGlobalSortBy] = useState('name');
    const [globalSortDirection, setGlobalSortDirection] = useState('ASC');

    const fetchInitialData = useCallback(async () => {
        try {
            setLoading(true);
            const [partsRes, brandsRes, groupsRes] = await Promise.all([
                api.get('/parts', { params: { status: statusFilter, search: searchTerm, page, pageSize, paginated: 1, sortBy: globalSortBy, sortDirection: globalSortDirection } }),
                api.get('/brands'),
                api.get('/groups')
            ]);
            setParts(partsRes.data?.data || []);
            setTotal(partsRes.data?.total || 0);
            setBrands(brandsRes.data);
            setGroups(groupsRes.data);
        } catch (error) {
            toast.error("Failed to load data: " + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
        }
    }, [statusFilter, searchTerm, page, pageSize, globalSortBy, globalSortDirection]);

    useEffect(() => {
        const debounceTimer = setTimeout(() => {
            fetchInitialData();
        }, 300);
        return () => clearTimeout(debounceTimer);
    }, [fetchInitialData]);

    useEffect(() => {
        setPage(1);
    }, [statusFilter, searchTerm, globalSortBy, globalSortDirection]);

    const handleSave = (partData) => {
        const promise = currentPart
            ? api.put(`/parts/${currentPart.part_id}`, { ...partData, modified_by: user.employee_id })
            : api.post('/parts', { ...partData, created_by: user.employee_id });
        toast.promise(promise, {
            loading: `${currentPart ? 'Updating' : 'Creating'} part...`,
            success: (res) => {
                // Refresh list
                fetchInitialData();

                if (!currentPart) {
                    // Created new part: open the Applications manager for the new part
                    const newPart = res?.data || res;
                    setIsFormModalOpen(false);
                    setCurrentPart(newPart);
                    setIsAppModalOpen(true);
                    return 'Part created successfully!';
                }

                // Updated existing part
                setIsFormModalOpen(false);
                setCurrentPart(null);
                return 'Part updated successfully!';
            },
            error: (err) => err.response?.data?.message || `Failed to ${currentPart ? 'update' : 'create'} part.`
        });
    };

    const handleBulkSave = (updates) => {
        const filteredUpdates = Object.entries(updates).reduce((acc, [key, value]) => {
            if (value !== '' && value !== 'unchanged') {
                if (['is_active', 'is_service', 'low_stock_warning', 'is_price_change_allowed', 'is_using_default_quantity', 'is_tax_inclusive_price'].includes(key)) {
                    acc[key] = value === 'true';
                } else {
                    acc[key] = value;
                }
            }
            return acc;
        }, {});

        if (Object.keys(filteredUpdates).length === 0) {
            return toast.error("No changes were selected for bulk update.");
        }

        const payload = { partIds: selectedParts, updates: filteredUpdates };
        const promise = api.put('/parts/bulk-update', payload);

        toast.promise(promise, {
            loading: 'Applying bulk updates...',
            success: () => {
                setIsBulkEditModalOpen(false);
                setSelectedParts([]);
                fetchInitialData();
                return 'Parts updated successfully!';
            },
            error: 'Failed to apply bulk updates.'
        });
    };

    const handleDelete = (partId) => {
        toast((t) => (
            <div className="text-center">
                <p className="font-semibold">Are you sure?</p>
                <p className="text-sm my-2">This will permanently delete the part.</p>
                <div className="flex justify-center space-x-2 mt-4">
                    <button onClick={() => { toast.dismiss(t.id); confirmDelete(partId); }} className="px-4 py-2 bg-red-600 text-white rounded-lg">Delete</button>
                    <button onClick={() => toast.dismiss(t.id)} className="px-4 py-2 bg-gray-200 rounded-lg">Cancel</button>
                </div>
            </div>
        ));
    };

    const confirmDelete = (partId) => {
        const promise = api.delete(`/parts/${partId}`);
        toast.promise(promise, {
            loading: 'Deleting part...',
            success: () => {
                fetchInitialData();
                return 'Part deleted successfully!';
            },
            error: (err) => err.response?.data?.message || 'Failed to delete part.'
        });
    };

    const handleAddNew = () => {
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

    const handleSelectPart = (partId) => {
        setSelectedParts(prev =>
            prev.includes(partId) ? prev.filter(id => id !== partId) : [...prev, partId]
        );
    };

    const handleSelectAll = (e) => {
        if (e.target.checked) {
            setSelectedParts(sortedParts.map(p => p.part_id));
        } else {
            setSelectedParts([]);
        }
    };

    const sortedParts = sortData(parts, sortConfig, {
        application_text: (row) => row.applications || ''
    });

    const filterTabs = [
        { key: 'active', label: 'Active' },
        { key: 'inactive', label: 'Inactive' },
        { key: 'all', label: 'All' }
    ];

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Parts</h1>
                <div className="flex items-center space-x-4">
                    {selectedParts.length > 0 && hasPermission('parts:edit') && (
                        <button onClick={() => setIsBulkEditModalOpen(true)} className="bg-yellow-500 text-white px-4 py-2 rounded-lg font-semibold hover:bg-yellow-600 transition">
                            Bulk Edit ({selectedParts.length})
                        </button>
                    )}
                    {hasPermission('parts:merge') && (
                        <button onClick={() => onNavigate('parts_cleanup')} className="bg-purple-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-purple-700 transition">
                            Cleanup Duplicates
                        </button>
                    )}
                    {hasPermission('parts:create') && (
                        <button onClick={handleAddNew} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                            New Part
                        </button>
                    )}
                </div>
            </div>

            <div className="mb-4 space-y-3">
                <FilterBar
                    tabs={filterTabs}
                    activeTab={statusFilter}
                    onTabClick={setStatusFilter}
                />
                <div className="flex flex-wrap items-center gap-3">
                    <div className="relative w-full max-w-md">
                        <SearchBar
                            value={searchTerm}
                            onChange={setSearchTerm}
                            onClear={() => setSearchTerm('')}
                            placeholder="Search by detail, SKU, or part number..."
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="parts-global-sort-by" className="text-sm text-gray-600 whitespace-nowrap">Sort all by</label>
                        <select
                            id="parts-global-sort-by"
                            value={globalSortBy}
                            onChange={(e) => setGlobalSortBy(e.target.value)}
                            className="rounded-md border border-gray-300 px-2 py-2 text-sm"
                        >
                            <option value="name">Name</option>
                            <option value="sku">SKU</option>
                            <option value="application">Application</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="parts-global-sort-direction" className="text-sm text-gray-600 whitespace-nowrap">Order</label>
                        <select
                            id="parts-global-sort-direction"
                            value={globalSortDirection}
                            onChange={(e) => setGlobalSortDirection(e.target.value)}
                            className="rounded-md border border-gray-300 px-2 py-2 text-sm"
                        >
                            <option value="ASC">Ascending</option>
                            <option value="DESC">Descending</option>
                        </select>
                    </div>
                </div>
            </div>


            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading ? <p>Loading...</p> : (
                    <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead>
                                <tr>
                                    <th className="p-3 w-10"><input type="checkbox" onChange={handleSelectAll} checked={selectedParts.length === sortedParts.length && sortedParts.length > 0} /></th>
                                    <SortableHeader column="internal_sku" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>SKU</SortableHeader>
                                    <SortableHeader column="display_name" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Item</SortableHeader>
                                    <SortableHeader column="application_text" sortConfig={sortConfig} onSort={(key, direction) => setSortConfig({ key, direction })}>Application</SortableHeader>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {sortedParts.map(part => (
                                    <tr key={part.part_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3"><input type="checkbox" checked={selectedParts.includes(part.part_id)} onChange={() => handleSelectPart(part.part_id)} /></td>
                                        <td className="p-3 text-sm font-mono">{part.internal_sku}</td>
                                        <td className="p-3 text-sm font-medium">{part.display_name}</td>
                                        <td className="p-3 text-sm">{formatApplicationText(part.applications, { style: 'tableCell' })}</td>
                                        <td className="p-3 text-sm text-right">
                                            <div className="flex justify-end items-center space-x-4">
                                                {part.tags && <TagPopover tags={part.tags} />}
                                                {hasPermission('parts:edit') && (
                                                    <>
                                                        <button onClick={() => handleManageApps(part)} title="Manage Applications" className="text-green-600 hover:text-green-800"><Icon path={ICONS.link} className="h-5 w-5"/></button>
                                                        <button onClick={() => handleManageNumbers(part)} title="Manage Part Numbers" className="text-gray-600 hover:text-gray-800"><Icon path={ICONS.numbers} className="h-5 w-5"/></button>
                                                        <button onClick={() => handleEdit(part)} title="Edit Part" className="text-blue-600 hover:text-blue-800"><Icon path={ICONS.edit} className="h-5 w-5" /></button>
                                                    </>
                                                )}
                                                {hasPermission('parts:delete') && <button onClick={() => handleDelete(part.part_id)} title="Delete Part" className="text-red-600 hover:text-red-800"><Icon path={ICONS.trash} className="h-5 w-5" /></button>}
                                            </div>
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
                            setSelectedParts([]);
                        }}
                    />
                    </>
                )}
            </div>
            <Modal isOpen={isFormModalOpen} onClose={() => setIsFormModalOpen(false)} title={currentPart ? 'Edit Part' : 'New Part'}>
                <PartForm part={currentPart} brands={brands} groups={groups} onSave={handleSave} onCancel={() => setIsFormModalOpen(false)} onBrandGroupAdded={fetchInitialData} />
            </Modal>
            <Modal isOpen={isBulkEditModalOpen} onClose={() => setIsBulkEditModalOpen(false)} title={`Bulk Edit ${selectedParts.length} Parts`}>
                <PartForm isBulkEdit={true} brands={brands} groups={groups} onSave={handleBulkSave} onCancel={() => setIsBulkEditModalOpen(false)} onBrandGroupAdded={fetchInitialData} />
            </Modal>
             <Modal isOpen={isNumberModalOpen} onClose={() => setIsNumberModalOpen(false)} title={`Manage Numbers for: ${currentPart?.internal_sku || currentPart?.display_name || currentPart?.detail || ''}`}>
                <PartNumberManager part={currentPart} onSave={fetchInitialData} onCancel={() => setIsNumberModalOpen(false)} />
            </Modal>
            <Modal isOpen={isAppModalOpen} onClose={() => setIsAppModalOpen(false)} title={`Manage Applications for: ${currentPart?.part_numbers || currentPart?.internal_sku || currentPart?.detail || ''}`}>
                <PartApplicationManager part={currentPart} onCancel={() => setIsAppModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default PartsPage;
