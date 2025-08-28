import React, { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import { useAuth } from '../contexts/AuthContext'; // <-- NEW: Import useAuth

const ApplicationForm = ({ application, onSave, onCancel }) => {
    const [makes, setMakes] = useState([]);
    const [models, setModels] = useState([]);
    const [engines, setEngines] = useState([]);
    const [formData, setFormData] = useState({ 
        make_id: '', 
        model_id: '', 
        engine_id: '', 
        make_name: '',
        model_name: '',
        engine_name: ''
    });

    useEffect(() => {
        // Fetch all makes when component mounts
        const fetchMakes = async () => {
            try {
                const response = await api.get('/makes');
                setMakes(response.data);
        } catch (error) {
            console.error('Failed to fetch makes:', error);
            }
        };
        fetchMakes();
    }, []);

    useEffect(() => {
        if (application) {
            setFormData({
                make_id: application.make_id,
                model_id: application.model_id,
                engine_id: application.engine_id,
                make_name: application.make,
                model_name: application.model,
                engine_name: application.engine
            });
            // Fetch related data when editing
            if (application.make_id) {
                fetchModels(application.make_id);
                if (application.model_id) {
                    fetchEngines(application.model_id);
                }
            }
        }
    }, [application]);

    const fetchModels = async (makeId) => {
        try {
            const response = await api.get(`/makes/${makeId}/models`);
            setModels(response.data);
        } catch (error) {
            console.error('Failed to fetch models:', error);
            setModels([]);
        }
    };

    const fetchEngines = async (modelId) => {
        try {
            const response = await api.get(`/models/${modelId}/engines`);
            setEngines(response.data);
        } catch (error) {
            console.error('Failed to fetch engines:', error);
            setEngines([]);
        }
    };

    // For combobox: if value matches an existing make name, resolve make_id; otherwise treat as a new make name
    const handleMakeChange = async (e) => {
        const val = e.target.value;
        const matched = makes.find(m => m.make_name.toLowerCase() === val.toLowerCase());
        if (matched) {
            setFormData(prev => ({
                ...prev,
                make_id: String(matched.make_id),
                make_name: matched.make_name,
                model_id: '',
                model_name: '',
                engine_id: '',
                engine_name: ''
            }));
            setModels([]);
            setEngines([]);
            await fetchModels(matched.make_id);
        } else {
            setFormData(prev => ({
                ...prev,
                make_id: '',
                make_name: val,
                model_id: '',
                model_name: '',
                engine_id: '',
                engine_name: ''
            }));
            setModels([]);
            setEngines([]);
        }
    };

    const handleModelChange = async (e) => {
        const val = e.target.value;
        const matched = models.find(m => m.model_name.toLowerCase() === val.toLowerCase());
        if (matched) {
            setFormData(prev => ({
                ...prev,
                model_id: String(matched.model_id),
                model_name: matched.model_name,
                engine_id: '',
                engine_name: ''
            }));
            setEngines([]);
            await fetchEngines(matched.model_id);
        } else {
            setFormData(prev => ({
                ...prev,
                model_id: '',
                model_name: val,
                engine_id: '',
                engine_name: ''
            }));
            setEngines([]);
        }
    };

    const handleEngineChange = (e) => {
        const val = e.target.value;
        const matched = engines.find(en => en.engine_name.toLowerCase() === val.toLowerCase());
        if (matched) {
            setFormData(prev => ({ ...prev, engine_id: String(matched.engine_id), engine_name: matched.engine_name }));
        } else {
            setFormData(prev => ({ ...prev, engine_id: '', engine_name: val }));
        }
    };

    const handleSubmit = (e) => {
        e.preventDefault();

        // Send both IDs (if we have them) and names (for creation if needed)
        const payload = {
            make_id: formData.make_id ? Number(formData.make_id) : undefined,
            model_id: formData.model_id ? Number(formData.model_id) : undefined,
            engine_id: formData.engine_id ? Number(formData.engine_id) : undefined,
            make: formData.make_name,
            model: formData.model_name,
            engine: formData.engine_name || undefined
        };

        onSave(payload);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
                <input
                    list="make-list"
                    value={formData.make_name}
                    onChange={handleMakeChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                />
                <datalist id="make-list">
                    {makes.map(m => <option key={m.make_id} value={m.make_name} />)}
                </datalist>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                <input
                    list="model-list"
                    value={formData.model_name}
                    onChange={handleModelChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    required
                    disabled={!formData.make_name}
                />
                <datalist id="model-list">
                    {models.map(m => <option key={m.model_id} value={m.model_name} />)}
                </datalist>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Engine</label>
                <input
                    list="engine-list"
                    value={formData.engine_name}
                    onChange={handleEngineChange}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    disabled={!formData.model_name}
                />
                <datalist id="engine-list">
                    {engines.map(e => <option key={e.engine_id} value={e.engine_name} />)}
                </datalist>
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
        </form>
    );
};

const ApplicationsPage = () => {
    const { hasPermission } = useAuth(); // <-- NEW: Use the auth context
    const [applications, setApplications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentApp, setCurrentApp] = useState(null);

    const fetchApplications = async () => {
        try {
            setError('');
            setLoading(true);
            const response = await api.get('/applications');
            setApplications(response.data);
        } catch (error) {
            console.error('Failed to fetch applications:', error);
            setError('Failed to fetch applications.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchApplications();
    }, []);

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
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Make</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Model</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Engine</th>
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
                )}
            </div>
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentApp ? 'Edit Application' : 'Add New Application'}>
                <ApplicationForm application={currentApp} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default ApplicationsPage;
