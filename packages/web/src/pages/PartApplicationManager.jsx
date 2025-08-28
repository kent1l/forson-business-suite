import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { Combobox } from '@headlessui/react';
// toast not used here
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';

const EditYearForm = ({ link, onSave, onCancel }) => {
    const [years, setYears] = useState({ year_start: '', year_end: '' });

    useEffect(() => {
        if (link) {
            setYears({
                year_start: link.year_start || '',
                year_end: link.year_end || ''
            });
        }
    }, [link]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setYears(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(link.part_app_id, years);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year Start</label>
                <input type="number" name="year_start" value={years.year_start} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., 2010" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Year End</label>
                <input type="number" name="year_end" value={years.year_end} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., 2015" />
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Years</button>
            </div>
        </form>
    );
};

const PartApplicationManager = ({ part, onCancel }) => {
    const [linkedApps, setLinkedApps] = useState([]);
    const [makes, setMakes] = useState([]);
    const [models, setModels] = useState([]);
    const [engines, setEngines] = useState([]);
    const [makeQuery, setMakeQuery] = useState('');
    const [modelQuery, setModelQuery] = useState('');
    const [engineQuery, setEngineQuery] = useState('');
    const [selectedMake, setSelectedMake] = useState(null);
    const [selectedModel, setSelectedModel] = useState(null);
    const [selectedEngine, setSelectedEngine] = useState(null);
    const [showMakeOptions, setShowMakeOptions] = useState(false);
    const [showModelOptions, setShowModelOptions] = useState(false);
    const [showEngineOptions, setShowEngineOptions] = useState(false);
    const [newLinkData, setNewLinkData] = useState({ 
        make_id: '', 
        model_id: '', 
        engine_id: '',
        year_start: '', 
        year_end: '' 
    });
    const [loading, setLoading] = useState(true);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [currentLink, setCurrentLink] = useState(null);

    const fetchModels = async (makeId) => {
        try {
            const response = await axios.get(`http://localhost:3001/api/makes/${makeId}/models`);
            setModels(response.data);
        } catch (error) {
            console.error('Failed to fetch models:', error);
            setModels([]);
        }
    };

    const fetchEngines = async (modelId) => {
        try {
            const response = await axios.get(`http://localhost:3001/api/models/${modelId}/engines`);
            setEngines(response.data);
        } catch (error) {
            console.error('Failed to fetch engines:', error);
            setEngines([]);
        }
    };

    const handleMakeChange = async (e) => {
        const makeId = e.target.value;
        setNewLinkData(prev => ({ 
            ...prev, 
            make_id: makeId,
            model_id: '',
            engine_id: ''
        }));
        setModels([]);
        setEngines([]);
        if (makeId) {
            await fetchModels(makeId);
        }
    };

    const handleModelChange = async (e) => {
        const modelId = e.target.value;
        setNewLinkData(prev => ({ 
            ...prev, 
            model_id: modelId,
            engine_id: ''
        }));
        setEngines([]);
        if (modelId) {
            await fetchEngines(modelId);
        }
    };

    const handleEngineChange = (e) => {
        const engineId = e.target.value;
        setNewLinkData(prev => ({ 
            ...prev, 
            engine_id: engineId
        }));
    };

    useEffect(() => {
        const run = async () => {
            if (part) {
                setLoading(true);
                try {
                    const [linkedRes, makesRes] = await Promise.all([
                        axios.get(`http://localhost:3001/api/parts/${part.part_id}/applications`),
                        axios.get('http://localhost:3001/api/makes')
                    ]);
                    setLinkedApps(linkedRes.data);
                    setMakes(makesRes.data);
                } catch (error) {
                    console.error("Failed to fetch applications", error);
                } finally {
                    setLoading(false);
                }
            }
        };
        run();
    }, [part]);

    const refetchData = async () => {
        if (part) {
            setLoading(true);
            try {
                const [linkedRes, makesRes] = await Promise.all([
                    axios.get(`http://localhost:3001/api/parts/${part.part_id}/applications`),
                    axios.get('http://localhost:3001/api/makes')
                ]);
                setLinkedApps(linkedRes.data);
                setMakes(makesRes.data);
            } catch (error) {
                console.error("Failed to fetch applications", error);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleLinkApp = async (e) => {
        e.preventDefault();
        if (!newLinkData.make_id || !newLinkData.model_id) {
            alert('Make and Model are required.');
            return;
        }

        try {
            // First, get or create the application
            const appResponse = await axios.post('http://localhost:3001/api/applications', {
                make_id: newLinkData.make_id,
                model_id: newLinkData.model_id,
                engine_id: newLinkData.engine_id || null
            });

            // Then link it to the part
            await axios.post(`http://localhost:3001/api/parts/${part.part_id}/applications`, {
                application_id: appResponse.data.application_id,
                year_start: newLinkData.year_start || null,
                year_end: newLinkData.year_end || null
            });

            await refetchData();
            setNewLinkData({ 
                make_id: '', 
                model_id: '', 
                engine_id: '',
                year_start: '', 
                year_end: '' 
            });
        } catch (error) {
            alert('Failed to link application: ' + (error.response?.data?.message || error.message));
            console.error(error);
        }
    };
    
    const handleUnlinkApp = async (applicationId) => {
        try {
            await axios.delete(`http://localhost:3001/api/parts/${part.part_id}/applications/${applicationId}`);
            await refetchData();
        } catch (err) {
            alert('Failed to unlink application.');
            console.error(err);
        }
    };

    const handleEditLink = (link) => {
        setCurrentLink(link);
        setIsEditModalOpen(true);
    };
    
    const handleSaveYears = async (partAppId, years) => {
        try {
            await axios.put(`http://localhost:3001/api/part-applications/${partAppId}`, years);
            setIsEditModalOpen(false);
            await refetchData();
        } catch (error) {
            console.error(error);
            alert('Failed to update year range.');
        }
    };

    const formatYearRange = (start, end) => {
        const startYear = parseInt(start, 10);
        const endYear = parseInt(end, 10);

        if (startYear && endYear) {
            if (startYear === endYear) return `[${startYear}]`;
            return `[${startYear}-${endYear}]`;
        }
        if (startYear) return `[${startYear}]`;
        if (endYear) return `[${endYear}]`;
        return '';
    };

    return (
        <div>
            <h3 className="text-md font-medium text-gray-800 mb-2">Linked Applications</h3>
            {loading ? <p>Loading...</p> : (
                <ul className="bg-gray-50 p-3 rounded-md mb-4 h-32 overflow-y-auto">
                    {linkedApps.map(app => (
                        <li key={app.part_app_id} className="text-sm flex justify-between items-center py-1">
                           <div>
                                <span>{app.make} {app.model} ({app.engine})</span>
                                <span className="text-xs text-gray-500 ml-2">{formatYearRange(app.year_start, app.year_end)}</span>
                           </div>
                           <div className="flex items-center space-x-3">
                               <button onClick={() => handleEditLink(app)} className="text-blue-600 hover:text-blue-800"><Icon path={ICONS.edit} className="h-4 w-4"/></button>
                               <button onClick={() => handleUnlinkApp(app.application_id)} className="text-red-500 hover:text-red-700"><Icon path={ICONS.trash} className="h-4 w-4"/></button>
                           </div>
                        </li>
                    ))}
                    {linkedApps.length === 0 && <li className="text-sm text-gray-500">No applications linked yet.</li>}
                </ul>
            )}

            <form onSubmit={handleLinkApp}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Link New Application</label>
                <div className="grid grid-cols-1 gap-2">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
                        <Combobox value={selectedMake} onChange={(val) => { setSelectedMake(val); if (val?.make_id) handleMakeChange({ target: { value: val.make_id } }); else handleMakeChange({ target: { value: '' }}); }} nullable>
                            <div className="relative">
                                <Combobox.Input
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                    displayValue={(m) => m?.make_name || ''}
                                    onChange={(e) => { setMakeQuery(e.target.value); setSelectedMake(null); handleMakeChange({ target: { value: '' }}); }}
                                    onFocus={() => setShowMakeOptions(true)}
                                    onBlur={() => setTimeout(() => setShowMakeOptions(false), 150)}
                                    required
                                />
                                {(showMakeOptions || makeQuery !== '') && (
                                    <Combobox.Options className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md max-h-48 overflow-auto">
                                        {makes.filter(m => m.make_name.toLowerCase().includes(makeQuery.toLowerCase())).map(make => (
                                            <Combobox.Option key={make.make_id} value={make} className={({ active }) => `cursor-pointer select-none p-2 ${active ? 'bg-blue-100' : ''}`}>
                                                {make.make_name}
                                            </Combobox.Option>
                                        ))}
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
                        <Combobox value={selectedModel} onChange={(val) => { setSelectedModel(val); if (val?.model_id) handleModelChange({ target: { value: val.model_id } }); else handleModelChange({ target: { value: '' }}); }} nullable>
                            <div className="relative">
                                <Combobox.Input
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                    displayValue={(m) => m?.model_name || ''}
                                    onChange={(e) => { setModelQuery(e.target.value); setSelectedModel(null); handleModelChange({ target: { value: '' }}); }}
                                    onFocus={() => setShowModelOptions(true)}
                                    onBlur={() => setTimeout(() => setShowModelOptions(false), 150)}
                                    required
                                    disabled={!newLinkData.make_id}
                                />
                                {(showModelOptions || modelQuery !== '') && newLinkData.make_id && (
                                    <Combobox.Options className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md max-h-48 overflow-auto">
                                        {models.filter(m => m.model_name.toLowerCase().includes(modelQuery.toLowerCase())).map(model => (
                                            <Combobox.Option key={model.model_id} value={model} className={({ active }) => `cursor-pointer select-none p-2 ${active ? 'bg-blue-100' : ''}`}>
                                                {model.model_name}
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">Engine (Optional)</label>
                        <Combobox value={selectedEngine} onChange={(val) => { setSelectedEngine(val); if (val?.engine_id) handleEngineChange({ target: { value: val.engine_id } }); else handleEngineChange({ target: { value: '' }}); }} nullable>
                            <div className="relative">
                                <Combobox.Input
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                    displayValue={(e) => e?.engine_name || ''}
                                    onChange={(e) => { setEngineQuery(e.target.value); setSelectedEngine(null); handleEngineChange({ target: { value: '' }}); }}
                                    onFocus={() => setShowEngineOptions(true)}
                                    onBlur={() => setTimeout(() => setShowEngineOptions(false), 150)}
                                    disabled={!newLinkData.model_id}
                                />
                                {(showEngineOptions || engineQuery !== '') && newLinkData.model_id && (
                                    <Combobox.Options className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-md max-h-48 overflow-auto">
                                        {engines.filter(en => en.engine_name.toLowerCase().includes(engineQuery.toLowerCase())).map(engine => (
                                            <Combobox.Option key={engine.engine_id} value={engine} className={({ active }) => `cursor-pointer select-none p-2 ${active ? 'bg-blue-100' : ''}`}>
                                                {engine.engine_name}
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
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Year Start</label>
                            <input 
                                type="number" 
                                placeholder="e.g., 2010" 
                                value={newLinkData.year_start || ''} 
                                onChange={(e) => setNewLinkData(prev => ({...prev, year_start: e.target.value}))} 
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Year End</label>
                            <input 
                                type="number" 
                                placeholder="e.g., 2015" 
                                value={newLinkData.year_end || ''} 
                                onChange={(e) => setNewLinkData(prev => ({...prev, year_end: e.target.value}))} 
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                            />
                        </div>
                    </div>
                    <button type="submit" className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 mt-2">
                        Link Application
                    </button>
                </div>
            </form>
             <div className="mt-6 flex justify-end">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Close</button>
            </div>
            <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title={`Edit Year Range for ${currentLink?.make} ${currentLink?.model}`}>
                <EditYearForm link={currentLink} onSave={handleSaveYears} onCancel={() => setIsEditModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default PartApplicationManager;
