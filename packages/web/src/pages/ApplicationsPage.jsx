import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import PaginationControls from '../components/ui/PaginationControls';
import SortableHeader from '../components/ui/SortableHeader';
import { useAuth } from '../contexts/AuthContext';
import ApplicationCascadeForm from '../components/applications/ApplicationCascadeForm';
import ApplicationModelRow from '../components/applications/ApplicationModelRow';

const ApplicationsPage = () => {
    const { hasPermission } = useAuth();
    const [applications, setApplications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentApp, setCurrentApp] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: 'make', direction: 'ASC' });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);
    const [expandedGroups, setExpandedGroups] = useState(new Set());
    const requestId = useRef(0);

    const fetchApplications = useCallback(async () => {
        const id = ++requestId.current;
        try {
            setError('');
            setLoading(true);
            const response = await api.get('/applications', {
                params: {
                    page,
                    pageSize,
                    paginated: 1,
                    groupBy: 'model',
                    sortBy: sortConfig.key,
                    sortOrder: sortConfig.direction
                }
            });
            if (id !== requestId.current) return;
            const lastPage = Math.max(1, Math.ceil((response.data?.total || 0) / pageSize));
            if (page > lastPage) {
                setPage(lastPage);
                return;
            }
            setApplications(response.data?.data || []);
            setTotal(response.data?.total || 0);
        } catch (error) {
            if (id !== requestId.current) return;
            console.error('Failed to fetch applications:', error);
            setError('Failed to fetch applications.');
        } finally {
            if (id === requestId.current) setLoading(false);
        }
    }, [page, pageSize, sortConfig]);

    useEffect(() => {
        fetchApplications();
        return () => { requestId.current += 1; };
    }, [fetchApplications]);

    const handleSort = (key, direction) => {
        setSortConfig({ key, direction });
        setPage(1);
    };

    const handleAdd = () => {
        setCurrentApp(null);
        setIsModalOpen(true);
    };

    const handleEdit = (app) => {
        setCurrentApp(app);
        setIsModalOpen(true);
    };

    const handleDelete = (appId) => {
        toast((t) => (
            <div className="flex flex-col items-center">
                <p className="font-semibold">Are you sure?</p>
                <p className="text-sm text-gray-600 mb-3">This may affect linked parts.</p>
                <div className="flex space-x-2">
                    <button
                        onClick={() => {
                            toast.dismiss(t.id);
                            confirmDelete(appId);
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
        ));
    };

    const confirmDelete = async (appId) => {
        const promise = api.delete(`/applications/${appId}`);
        toast.promise(promise, {
            loading: 'Deleting application...',
            success: () => {
                fetchApplications();
                return 'Application deleted successfully!';
            },
            error: (err) => err.response?.data?.message || 'Failed to delete application.',
        });
    };

    const handleSave = async (appData) => {
        const promise = currentApp
            ? api.put(`/applications/${currentApp.application_id}`, {
                ...appData,
                expected_version: currentApp.row_version,
            })
            : api.post('/applications', appData);

        toast.promise(promise, {
            loading: 'Saving application...',
            success: () => {
                setIsModalOpen(false);
                fetchApplications();
                return 'Application saved successfully!';
            },
            error: (err) => err.response?.data?.message || 'Failed to save application.',
        });
    };

    return (
        <div>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Vehicle Applications</h1>
                    <p className="mt-1 text-sm text-gray-500 dark:text-slate-400">Browse by model. Keep every vehicle combination within reach.</p>
                </div>
                {hasPermission('applications:edit') && (
                    <button onClick={handleAdd} className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-700 transition">
                        Add Combination
                    </button>
                )}
            </div>
            <div className="min-w-0 overflow-hidden rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                <div className="border-b border-gray-100 px-4 py-4 dark:border-slate-700 sm:px-6">
                    <p className="text-sm font-semibold text-gray-800 dark:text-slate-200">Grouped by model</p>
                    <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-slate-400">Values summarize recorded combinations. Expand a model to see which details belong together.</p>
                </div>
                {loading && <p role="status" className="p-6 text-sm text-gray-500">Loading applications...</p>}
                {error && <p role="alert" aria-live="polite" className="p-6 text-sm text-red-500">{error}</p>}
                {!loading && !error && (
                    <>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[960px] text-left">
                            <caption className="sr-only">Vehicle applications grouped by model. Expand a model to view its recorded combinations.</caption>
                            <thead className="border-b border-gray-200 dark:border-slate-700">
                                <tr>
                                    <SortableHeader column="make" sortConfig={sortConfig} onSort={handleSort}>Make</SortableHeader>
                                    <SortableHeader column="model" sortConfig={sortConfig} onSort={handleSort}>Model</SortableHeader>
                                    <SortableHeader column="engine" sortConfig={sortConfig} onSort={handleSort}>Engine</SortableHeader>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300">Chassis</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300">Classification</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-300 text-right">Combinations</th>
                                </tr>
                            </thead>
                            <tbody>
                                {applications.length === 0 && <tr><td colSpan={6} className="p-10 text-center text-sm text-gray-500">No vehicle applications yet. Add a combination to get started.</td></tr>}
                                {applications.map(group => (
                                    <ApplicationModelRow
                                        key={group.group_key}
                                        group={group}
                                        expanded={expandedGroups.has(group.group_key)}
                                        onToggle={() => setExpandedGroups(previous => {
                                            const next = new Set(previous);
                                            if (next.has(group.group_key)) next.delete(group.group_key);
                                            else next.add(group.group_key);
                                            return next;
                                        })}
                                        canEdit={hasPermission('applications:edit')}
                                        onEdit={handleEdit}
                                        onDelete={handleDelete}
                                    />
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <PaginationControls
                        className="px-4 pb-4 sm:px-6"
                        itemLabel={total === 1 ? 'model group' : 'model groups'}
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
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentApp ? 'Edit Vehicle Combination' : 'Add Vehicle Combination'}>
                <ApplicationCascadeForm application={currentApp} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default ApplicationsPage;
