import React, { useState, useEffect } from 'react';
import { Combobox } from '@headlessui/react';
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
    const [selectedMake, setSelectedMake] = useState(null);
    const [selectedModel, setSelectedModel] = useState(null);
    const [selectedEngine, setSelectedEngine] = useState(null);
    const [makeQuery, setMakeQuery] = useState('');
    const [modelQuery, setModelQuery] = useState('');
    const [engineQuery, setEngineQuery] = useState('');
    const [showMakeOptions, setShowMakeOptions] = useState(false);
    const [showModelOptions, setShowModelOptions] = useState(false);
    const [showEngineOptions, setShowEngineOptions] = useState(false);
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
            // initialize selected items if editing existing application
            if (application.make_id) {
                const sel = makes.find(m => m.make_id === application.make_id) || null;
                setSelectedMake(sel);
                setMakeQuery(sel?.make_name || application.make || '');
            }
            if (application.model_id) {
                const selM = models.find(m => m.model_id === application.model_id) || null;
                setSelectedModel(selM);
                setModelQuery(selM?.model_name || application.model || '');
            }
            if (application.engine_id) {
                const selE = engines.find(e => e.engine_id === application.engine_id) || null;
                setSelectedEngine(selE);
                setEngineQuery(selE?.engine_name || application.engine || '');
            }
            // Fetch related data when editing
            if (application.make_id) {
                fetchModels(application.make_id);
                if (application.model_id) {
                    fetchEngines(application.model_id);
                }
            }
        }
    }, [application, makes, models, engines]);

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

    // Combobox handlers
    const handleMakeSelect = async (make) => {
        if (make && make.make_id) {
            setSelectedMake(make);
            setFormData(prev => ({
                ...prev,
                make_id: String(make.make_id),
                make_name: make.make_name,
                model_id: '',
                model_name: '',
                engine_id: '',
                engine_name: ''
            }));
            setModels([]);
            setEngines([]);
            await fetchModels(make.make_id);
        }
    };

    const handleMakeInput = (val) => {
        setMakeQuery(val);
        setSelectedMake(null);
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
    };

    const handleModelSelect = async (model) => {
        if (model && model.model_id) {
            setSelectedModel(model);
            setFormData(prev => ({
                ...prev,
                model_id: String(model.model_id),
                model_name: model.model_name,
                engine_id: '',
                engine_name: ''
            }));
            setEngines([]);
            await fetchEngines(model.model_id);
        }
    };

    const handleModelInput = (val) => {
        setModelQuery(val);
        setSelectedModel(null);
        setFormData(prev => ({
            ...prev,
            model_id: '',
            model_name: val,
            engine_id: '',
            engine_name: ''
        }));
        setEngines([]);
    };

    const handleEngineSelect = (engine) => {
        if (engine && engine.engine_id) {
            setSelectedEngine(engine);
            setFormData(prev => ({
                ...prev,
                engine_id: String(engine.engine_id),
                engine_name: engine.engine_name
            }));
        }
    };

    const handleEngineInput = (val) => {
        setEngineQuery(val);
        setSelectedEngine(null);
        setFormData(prev => ({
            ...prev,
            engine_id: '',
            engine_name: val
        }));
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
                <Combobox value={selectedMake} onChange={handleMakeSelect} nullable>
                    <div className="relative">
                        <Combobox.Input
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            displayValue={(m) => m?.make_name || formData.make_name}
                            onChange={(e) => handleMakeInput(e.target.value)}
                            onFocus={() => setShowMakeOptions(true)}
                            onBlur={() => setTimeout(() => setShowMakeOptions(false), 150)}
                            placeholder="Type or select make"
                            required
                        />
                        {(showMakeOptions || makeQuery !== '') && (
                            <Combobox.Options className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md max-h-48 overflow-auto">
                                {makes
                                    .filter(m => m.make_name.toLowerCase().includes(makeQuery.toLowerCase()))
                                    .map(m => (
                                        <Combobox.Option key={m.make_id} value={m} className={({ active }) => `cursor-pointer select-none p-2 ${active ? 'bg-blue-100' : ''}`}>
                                            {m.make_name}
                                        </Combobox.Option>
                                    ))}
                                {/* Create new option when typed value doesn't match any existing */}
                                {makeQuery && !makes.some(m => m.make_name.toLowerCase() === makeQuery.toLowerCase()) && (
                                    <Combobox.Option value={{ make_name: makeQuery }} className={({ active }) => `cursor-pointer select-none p-2 ${active ? 'bg-green-100' : ''}`}>
                                        Create new "{makeQuery}"
                                    </Combobox.Option>
                                )}
                            </Combobox.Options>
                        )}
                    </div>
                </Combobox>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                <Combobox value={selectedModel} onChange={handleModelSelect} nullable>
                    <div className="relative">
                        <Combobox.Input
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            displayValue={(m) => m?.model_name || formData.model_name}
                            onChange={(e) => handleModelInput(e.target.value)}
                            onFocus={() => setShowModelOptions(true)}
                            onBlur={() => setTimeout(() => setShowModelOptions(false), 150)}
                            placeholder="Type or select model"
                            required
                            disabled={!formData.make_id}
                        />
                        {(showModelOptions || modelQuery !== '') && formData.make_id && (
                            <Combobox.Options className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md max-h-48 overflow-auto">
                                {models
                                    .filter(m => m.model_name.toLowerCase().includes(modelQuery.toLowerCase()))
                                    .map(m => (
                                        <Combobox.Option key={m.model_id} value={m} className={({ active }) => `cursor-pointer select-none p-2 ${active ? 'bg-blue-100' : ''}`}>
                                            {m.model_name}
                                        </Combobox.Option>
                                    ))}
                                {modelQuery && !models.some(m => m.model_name.toLowerCase() === modelQuery.toLowerCase()) && (
                                    <Combobox.Option value={{ model_name: modelQuery }} className={({ active }) => `cursor-pointer select-none p-2 ${active ? 'bg-green-100' : ''}`}>
                                        Create new "{modelQuery}"
                                    </Combobox.Option>
                                )}
                            </Combobox.Options>
                        )}
                    </div>
                </Combobox>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Engine</label>
                <Combobox value={selectedEngine} onChange={handleEngineSelect} nullable>
                    <div className="relative">
                        <Combobox.Input
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            displayValue={(e) => e?.engine_name || formData.engine_name}
                            onChange={(e) => handleEngineInput(e.target.value)}
                            onFocus={() => setShowEngineOptions(true)}
                            onBlur={() => setTimeout(() => setShowEngineOptions(false), 150)}
                            placeholder="Type or select engine"
                            disabled={!formData.model_id}
                        />
                        {(showEngineOptions || engineQuery !== '') && formData.model_id && (
                            <Combobox.Options className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md max-h-48 overflow-auto">
                                {engines
                                    .filter(en => en.engine_name.toLowerCase().includes(engineQuery.toLowerCase()))
                                    .map(en => (
                                        <Combobox.Option key={en.engine_id} value={en} className={({ active }) => `cursor-pointer select-none p-2 ${active ? 'bg-blue-100' : ''}`}>
                                            {en.engine_name}
                                        </Combobox.Option>
                                    ))}
                                {engineQuery && !engines.some(en => en.engine_name.toLowerCase() === engineQuery.toLowerCase()) && (
                                    <Combobox.Option value={{ engine_name: engineQuery }} className={({ active }) => `cursor-pointer select-none p-2 ${active ? 'bg-green-100' : ''}`}>
                                        Create new "{engineQuery}"
                                    </Combobox.Option>
                                )}
                            </Combobox.Options>
                        )}
                    </div>
                </Combobox>
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

