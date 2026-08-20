import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

const asArray = (value) => (Array.isArray(value) ? value : []);

const PartsPage = ({ user, onNavigate }) => {
    const { hasPermission } = useAuth();
    const [parts, setParts] = useState([]);
    const [brands, setBrands] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [listError, setListError] = useState('');
    const [isFormModalOpen, setIsFormModalOpen] = useState(false);
    const [isNumberModalOpen, setIsNumberModalOpen] = useState(false);
    const [isAppModalOpen, setIsAppModalOpen] = useState(false);
    const [currentPart, setCurrentPart] = useState(null);
    const [statusFilter, setStatusFilter] = useState('active');
    const [searchTerm, setSearchTerm] = useState('');
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [selectedParts, setSelectedParts] = useState([]);
    const [isBulkEditModalOpen, setIsBulkEditModalOpen] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [globalSortBy, setGlobalSortBy] = useState('name');
    const [globalSortDirection, setGlobalSortDirection] = useState('ASC');

    const sortConfig = useMemo(() => ({
        key: globalSortBy === 'sku' ? 'internal_sku' : (globalSortBy === 'application' ? 'application_text' : 'display_name'),
        direction: globalSortDirection
    }), [globalSortBy, globalSortDirection]);

    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearchTerm(searchTerm);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const fetchInitialData = useCallback(async () => {
        try {
            setLoading(true);
            setListError('');
            const [partsRes, brandsRes, groupsRes] = await Promise.all([
                api.get('/parts', { params: { status: statusFilter, search: debouncedSearchTerm, page, pageSize, paginated: 1, sortBy: globalSortBy, sortDirection: globalSortDirection } }),
                api.get('/brands'),
                api.get('/groups')
            ]);
            setParts(asArray(partsRes.data?.data));
            setTotal(partsRes.data?.total || 0);
            setBrands(asArray(brandsRes.data?.data ?? brandsRes.data));
            setGroups(asArray(groupsRes.data?.data ?? groupsRes.data));
        } catch (error) {
            setParts([]);
            setTotal(0);
            setListError(error.response?.data?.message || 'Unable to load parts right now.');
            toast.error("Failed to load data: " + (error.response?.data?.message || error.message));
        } finally {
            setLoading(false);
        }
    }, [statusFilter, debouncedSearchTerm, page, pageSize, globalSortBy, globalSortDirection]);

    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    useEffect(() => {
        setPage(1);
    }, [statusFilter, debouncedSearchTerm, globalSortBy, globalSortDirection]);

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
                <p className="font-semibold text-gray-900 dark:text-slate-100">Are you sure?</p>
                <p className="text-sm my-2 text-gray-600 dark:text-slate-400">This will permanently delete the part.</p>
                <div className="flex justify-center space-x-2 mt-4">
                    <button onClick={() => { toast.dismiss(t.id); confirmDelete(partId); }} className="px-4 py-2 bg-danger-600 text-white rounded-lg hover:bg-danger-700 text-sm font-medium">Delete</button>
                    <button onClick={() => toast.dismiss(t.id)} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium">Cancel</button>
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
            setSelectedParts(parts.map(p => p.part_id));
        } else {
            setSelectedParts([]);
        }
    };

    const handleHeaderSort = (key, direction) => {
        const keyMap = { internal_sku: 'sku', display_name: 'name', application_text: 'application' };
        if (keyMap[key]) {
            setGlobalSortBy(keyMap[key]);
            setGlobalSortDirection(direction);
        }
        setPage(1);
    };

    const filterTabs = [
        { key: 'active', label: 'Active' },
        { key: 'inactive', label: 'Inactive' },
        { key: 'all', label: 'All' }
    ];

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Parts</h1>
                <div className="flex items-center space-x-3">
                    {selectedParts.length > 0 && hasPermission('parts:edit') && (
                        <button onClick={() => setIsBulkEditModalOpen(true)} className="bg-warning-500 hover:bg-warning-600 text-white px-4 py-2 rounded-lg font-semibold transition shadow-sm text-sm">
                            Bulk Edit ({selectedParts.length})
                        </button>
                    )}
                    {hasPermission('parts:merge') && (
                        <button onClick={() => onNavigate('parts_cleanup')} className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg font-semibold transition shadow-sm text-sm">
                            Cleanup Duplicates
                        </button>
                    )}
                    {hasPermission('parts:create') && (
                        <button onClick={handleAddNew} className="bg-primary-600 hover:bg-primary-700 text-white px-4 py-2 rounded-lg font-semibold transition shadow-sm text-sm">
                            New Part
                        </button>
                    )}
                </div>
            </div>

            <div className="space-y-3">
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
                        <label htmlFor="parts-global-sort-by" className="text-sm text-gray-600 dark:text-slate-400 whitespace-nowrap">Sort all by</label>
                        <select
                            id="parts-global-sort-by"
                            value={globalSortBy}
                            onChange={(e) => setGlobalSortBy(e.target.value)}
                            className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="name">Name</option>
                            <option value="sku">SKU</option>
                            <option value="application">Application</option>
                        </select>
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="parts-global-sort-direction" className="text-sm text-gray-600 dark:text-slate-400 whitespace-nowrap">Order</label>
                        <select
                            id="parts-global-sort-direction"
                            value={globalSortDirection}
                            onChange={(e) => setGlobalSortDirection(e.target.value)}
                            className="rounded-md border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                        >
                            <option value="ASC">Ascending</option>
                            <option value="DESC">Descending</option>
                        </select>
                    </div>
                </div>
            </div>


            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 shadow-card relative overflow-hidden">
                {loading && (
                    <div className="absolute inset-x-0 top-0 h-1 bg-primary-600 animate-pulse z-10" />
                )}
                {listError && (
                    <div className="mb-4 rounded-lg border border-danger-200 dark:border-danger-800/60 bg-danger-50 dark:bg-danger-950/30 px-3 py-2 text-sm text-danger-700 dark:text-danger-400">
                        {listError}
                    </div>
                )}
                <div className="overflow-x-auto">
                    <table className="w-full text-left table-fixed">
                        <colgroup>
                            <col className="w-10" />
                            <col className="w-36" />
                            <col className="w-5/12" />
                            <col className="w-5/12" />
                            <col className="w-44" />
                            <col className="w-36" />
                        </colgroup>
                        <thead>
                            <tr className="bg-gray-50 dark:bg-slate-700/40 border-b border-gray-200 dark:border-slate-700 text-gray-700 dark:text-slate-300">
                                <th className="p-3 w-10"><input type="checkbox" onChange={handleSelectAll} checked={selectedParts.length === parts.length && parts.length > 0} className="rounded border-gray-300 dark:border-slate-600 text-primary-600" /></th>
                                <SortableHeader className="w-36" column="internal_sku" sortConfig={sortConfig} onSort={handleHeaderSort}>SKU</SortableHeader>
                                <SortableHeader className="w-5/12" column="display_name" sortConfig={sortConfig} onSort={handleHeaderSort}>Item</SortableHeader>
                                <SortableHeader className="w-5/12" column="application_text" sortConfig={sortConfig} onSort={handleHeaderSort}>Application</SortableHeader>
                                <th className="p-3 w-44 text-sm font-semibold text-gray-600 dark:text-slate-300">Barcodes</th>
                                <th className="p-3 w-36 text-sm font-semibold text-gray-600 dark:text-slate-300 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className={`divide-y divide-gray-100 dark:divide-slate-700/60 transition-opacity duration-150 ${loading ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                            {parts.map(part => (
                                <tr key={part.part_id} className="hover:bg-gray-50 dark:hover:bg-slate-700/40 text-gray-800 dark:text-slate-200 transition-colors">
                                    <td className="p-3"><input type="checkbox" checked={selectedParts.includes(part.part_id)} onChange={() => handleSelectPart(part.part_id)} className="rounded border-gray-300 dark:border-slate-600 text-primary-600" /></td>
                                    <td className="p-3 text-sm font-mono text-gray-900 dark:text-slate-100 truncate">{part.internal_sku}</td>
                                    <td className="p-3 text-sm font-medium text-gray-900 dark:text-slate-100 truncate" title={part.display_name}>{part.display_name}</td>
                                    <td className="p-3 text-sm text-gray-700 dark:text-slate-300 truncate" title={formatApplicationText(part.applications, { style: 'tableCell' })}>{formatApplicationText(part.applications, { style: 'tableCell' })}</td>
                                    <td className="p-3 text-sm">
                                        {part.barcodes && part.barcodes.length > 0 ? (
                                            <div className="flex items-center space-x-1">
                                                <span className="bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200 text-xs px-2 py-1 rounded border border-gray-200 dark:border-slate-600 font-mono">{part.barcodes[0]}</span>
                                                {part.barcodes.length > 1 && (
                                                    <span className="text-xs text-gray-500 dark:text-slate-400 cursor-help" title={part.barcodes.slice(1).join(', ')}>+{part.barcodes.length - 1} more</span>
                                                )}
                                            </div>
                                        ) : (
                                            <span className="text-gray-400 dark:text-slate-500 text-xs">-</span>
                                        )}
                                    </td>
                                    <td className="p-3 text-sm text-right">
                                        <div className="flex justify-end items-center space-x-3">
                                            {part.tags && <TagPopover tags={part.tags} />}
                                            {hasPermission('parts:edit') && (
                                                <>
                                                    <button onClick={() => handleManageApps(part)} title="Manage Applications" className="text-success-600 dark:text-success-400 hover:text-success-700 dark:hover:text-success-300 p-1"><Icon path={ICONS.link} className="h-5 w-5"/></button>
                                                    <button onClick={() => handleManageNumbers(part)} title="Manage Part Numbers" className="text-gray-500 dark:text-slate-400 hover:text-gray-700 dark:hover:text-slate-200 p-1"><Icon path={ICONS.numbers} className="h-5 w-5"/></button>
                                                    <button onClick={() => handleEdit(part)} title="Edit Part" className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 p-1"><Icon path={ICONS.edit} className="h-5 w-5" /></button>
                                                </>
                                            )}
                                            {hasPermission('parts:delete') && <button onClick={() => handleDelete(part.part_id)} title="Delete Part" className="text-danger-600 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 p-1"><Icon path={ICONS.trash} className="h-5 w-5" /></button>}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {parts.length === 0 && !loading && (
                                <tr>
                                    <td colSpan="6" className="p-8 text-center text-gray-500 dark:text-slate-400">No data to display.</td>
                                </tr>
                            )}
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
