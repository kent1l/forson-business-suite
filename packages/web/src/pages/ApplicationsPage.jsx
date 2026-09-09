import React, { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import PaginationControls from '../components/ui/PaginationControls';
import SortableHeader from '../components/ui/SortableHeader';
import { useAuth } from '../contexts/AuthContext'; // <-- NEW: Import useAuth
import ApplicationCascadeForm from '../components/applications/ApplicationCascadeForm';

const ApplicationsPage = () => {
    const { hasPermission } = useAuth(); // <-- NEW: Use the auth context
    const [applications, setApplications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentApp, setCurrentApp] = useState(null);
    const [sortConfig, setSortConfig] = useState({ key: 'make', direction: 'ASC' });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);

    const fetchApplications = async () => {
        try {
            setError('');
            setLoading(true);
            const response = await api.get('/applications', {
                params: {
                    page,
                    pageSize,
                    paginated: 1,
                    sortBy: sortConfig.key,
                    sortOrder: sortConfig.direction
                }
            });
            setApplications(response.data?.data || []);
            setTotal(response.data?.total || 0);
        } catch (error) {
            console.error('Failed to fetch applications:', error);
            setError('Failed to fetch applications.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchApplications();
    }, [page, pageSize, sortConfig]);

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
            ? api.put(`/applications/${currentApp.application_id}`, appData)
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
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Vehicle Applications</h1>
                {hasPermission('applications:edit') && (
                    <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                        Add Application
                    </button>
                )}
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading applications...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <SortableHeader column="make" sortConfig={sortConfig} onSort={handleSort}>Make</SortableHeader>
                                    <SortableHeader column="model" sortConfig={sortConfig} onSort={handleSort}>Model</SortableHeader>
                                    <SortableHeader column="engine" sortConfig={sortConfig} onSort={handleSort}>Engine</SortableHeader>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {applications.map(app => (
                                    <tr key={app.application_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-medium text-gray-800">{app.make}</td>
                                        <td className="p-3 text-sm">{app.model}</td>
                                        <td className="p-3 text-sm">{app.engine}</td>
                                        <td className="p-3 text-sm text-right">
                                            {hasPermission('applications:edit') && (
                                                <>
                                                    <button onClick={() => handleEdit(app)} className="text-blue-600 hover:text-blue-800 mr-4"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                                    <button onClick={() => handleDelete(app.application_id)} className="text-red-600 hover:text-red-800"><Icon path={ICONS.trash} className="h-5 w-5"/></button>
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
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentApp ? 'Edit Application' : 'Add New Application'}>
                <ApplicationCascadeForm application={currentApp} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default ApplicationsPage;
