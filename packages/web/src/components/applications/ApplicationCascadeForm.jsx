import { useState, useEffect, useCallback, useMemo } from 'react';
import { Combobox } from '@headlessui/react';
import api from '../../api';

// Shared Make -> Model -> Engine cascading picker with case-insensitive
// existing-match detection ("Create new X" only offered when nothing matches).
// Used both by the vehicle taxonomy admin screen (ApplicationsPage) and by the
// day-to-day "link a fitment to this part" flow (PartApplicationManager), so
// staff get the same safe, dedupe-aware entry experience everywhere instead of
// the taxonomy screen having a better one than the part-editing flow.
//
// Engine is global master data (not scoped to a model), so this also supports
// an "engine only" mode for the common real-world case of a part that fits any
// vehicle using a given engine code, independent of make/model.
const ApplicationCascadeForm = ({ application, onSave, onCancel, submitLabel = 'Save' }) => {
    const [engineOnly, setEngineOnly] = useState(false);
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
        engine_name: '',
        displacement_liters: '',
        fuel_type: ''
    });
    // Tracks the engine's specs as loaded, so we only PUT /engines/:id when the
    // user actually changed them for an *existing* engine (creating a new one
    // sends displacement/fuel_type along with the create payload instead).
    const [originalEngineSpecs, setOriginalEngineSpecs] = useState(null);

    const initialFormData = useMemo(() => {
        if (application) {
            return {
                make_id: application.make_id || '',
                model_id: application.model_id || '',
                engine_id: application.engine_id || '',
                make_name: application.make || '',
                model_name: application.model || '',
                engine_name: application.engine || ''
            };
        }
        return { make_id: '', model_id: '', engine_id: '', make_name: '', model_name: '', engine_name: '' };
    }, [application]);

    const isFormDirty = useMemo(() => JSON.stringify(formData) !== JSON.stringify(initialFormData), [formData, initialFormData]);
    const isFormElement = (element) => element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');

    // Global engine list, used in "engine only" mode.
    useEffect(() => {
        if (!engineOnly) return;
        api.get('/engines').then(res => setEngines(res.data)).catch(err => console.error('Failed to fetch engines:', err));
    }, [engineOnly]);

    useEffect(() => {
        api.get('/makes').then(res => setMakes(res.data)).catch(err => console.error('Failed to fetch makes:', err));
    }, []);

    useEffect(() => {
        if (!application) return;
        setEngineOnly(!application.make_id && !application.model_id && !!application.engine_id);
        setOriginalEngineSpecs(null);
        setFormData({
            make_id: application.make_id || '',
            model_id: application.model_id || '',
            engine_id: application.engine_id || '',
            make_name: application.make || '',
            model_name: application.model || '',
            engine_name: application.engine || '',
            displacement_liters: '',
            fuel_type: ''
        });
        if (application.make_id) {
            setSelectedMake({ make_id: application.make_id, make_name: application.make });
            setMakeQuery(application.make || '');
            fetchModels(application.make_id);
        }
        if (application.model_id) {
            setSelectedModel({ model_id: application.model_id, model_name: application.model });
            setModelQuery(application.model || '');
            fetchEngines(application.model_id);
        }
        if (application.engine_id) {
            setSelectedEngine({ engine_id: application.engine_id, engine_code: application.engine });
            setEngineQuery(application.engine || '');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const toggleEngineOnly = (checked) => {
        setEngineOnly(checked);
        setSelectedMake(null);
        setSelectedModel(null);
        setSelectedEngine(null);
        setMakeQuery('');
        setModelQuery('');
        setEngineQuery('');
        setModels([]);
        setOriginalEngineSpecs(null);
        setFormData({ make_id: '', model_id: '', engine_id: '', make_name: '', model_name: '', engine_name: '', displacement_liters: '', fuel_type: '' });
    };

    const handleMakeSelect = async (make) => {
        if (!make) return;
        if (make.make_id) {
            setSelectedMake(make);
            setFormData(prev => ({ ...prev, make_id: String(make.make_id), make_name: make.make_name, model_id: '', model_name: '', engine_id: '', engine_name: '' }));
            setModels([]);
            setEngines([]);
            await fetchModels(make.make_id);
            return;
        }
        if (make.make_name) {
            setSelectedMake({ make_name: make.make_name });
            setFormData(prev => ({ ...prev, make_id: '', make_name: make.make_name, model_id: '', model_name: '', engine_id: '', engine_name: '' }));
            setModels([]);
            setEngines([]);
        }
    };

    const handleMakeInput = (val) => {
        setMakeQuery(val);
        setSelectedMake(null);
        setFormData(prev => ({ ...prev, make_id: '', make_name: val, model_id: '', model_name: '', engine_id: '', engine_name: '' }));
        setModels([]);
        setEngines([]);
    };

    const handleModelSelect = async (model) => {
        if (!model) return;
        if (model.model_id) {
            setSelectedModel(model);
            setFormData(prev => ({ ...prev, model_id: String(model.model_id), model_name: model.model_name, engine_id: '', engine_name: '' }));
            setEngines([]);
            await fetchEngines(model.model_id);
            return;
        }
        if (model.model_name) {
            setSelectedModel({ model_name: model.model_name });
            setFormData(prev => ({ ...prev, model_id: '', model_name: model.model_name, engine_id: '', engine_name: '' }));
            setEngines([]);
        }
    };

    const handleModelInput = (val) => {
        setModelQuery(val);
        setSelectedModel(null);
        setFormData(prev => ({ ...prev, model_id: '', model_name: val, engine_id: '', engine_name: '' }));
        setEngines([]);
    };

    const handleEngineSelect = (engine) => {
        if (!engine) return;
        if (engine.engine_id) {
            setSelectedEngine(engine);
            const specs = {
                displacement_liters: engine.displacement_liters != null ? String(engine.displacement_liters) : '',
                fuel_type: engine.fuel_type || ''
            };
            setOriginalEngineSpecs(specs);
            setFormData(prev => ({ ...prev, engine_id: String(engine.engine_id), engine_name: engine.engine_code, ...specs }));
            return;
        }
        if (engine.engine_code) {
            setSelectedEngine({ engine_code: engine.engine_code });
            setOriginalEngineSpecs(null);
            setFormData(prev => ({ ...prev, engine_id: '', engine_name: engine.engine_code }));
        }
    };

    const handleEngineInput = (val) => {
        setEngineQuery(val);
        setSelectedEngine(null);
        setOriginalEngineSpecs(null);
        setFormData(prev => ({ ...prev, engine_id: '', engine_name: val }));
    };

    const handleSubmit = useCallback(async (e) => {
        if (e) e.preventDefault();

        // Editing an existing engine's specs is a deliberate separate action from
        // linking a fitment -- save it via PUT /engines/:id first if changed.
        if (formData.engine_id && originalEngineSpecs) {
            const changed = formData.displacement_liters !== originalEngineSpecs.displacement_liters
                || formData.fuel_type !== originalEngineSpecs.fuel_type;
            if (changed) {
                try {
                    await api.put(`/engines/${formData.engine_id}`, {
                        displacement_liters: formData.displacement_liters ? Number(formData.displacement_liters) : null,
                        fuel_type: formData.fuel_type || null
                    });
                } catch (err) {
                    alert('Failed to update engine specs: ' + (err.response?.data?.message || err.message));
                    return;
                }
            }
        }

        const engineExtras = !formData.engine_id
            ? {
                displacement_liters: formData.displacement_liters ? Number(formData.displacement_liters) : undefined,
                fuel_type: formData.fuel_type || undefined
            }
            : {};

        const payload = engineOnly
            ? {
                make_id: undefined,
                model_id: undefined,
                make: undefined,
                model: undefined,
                engine_id: formData.engine_id ? Number(formData.engine_id) : undefined,
                engine: formData.engine_name || undefined,
                ...engineExtras
            }
            : {
                make_id: formData.make_id ? Number(formData.make_id) : undefined,
                model_id: formData.model_id ? Number(formData.model_id) : undefined,
                engine_id: formData.engine_id ? Number(formData.engine_id) : undefined,
                make: formData.make_name || undefined,
                model: formData.model_name || undefined,
                engine: formData.engine_name || undefined,
                ...engineExtras
            };
        onSave(payload);
    }, [engineOnly, formData, onSave, originalEngineSpecs]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target && isFormElement(e.target)) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSubmit();
            } else if (e.key === 'Escape') {
                if (isFormDirty) {
                    const confirmCancel = window.confirm('You have unsaved changes. Are you sure you want to cancel?');
                    if (!confirmCancel) return;
                }
                onCancel();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleSubmit, onCancel, isFormDirty]);

    const inputClass = 'w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
    const optionsClass = 'absolute z-10 mt-1 w-full bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 rounded-md max-h-48 overflow-auto';
    const optionClass = ({ active }) => `cursor-pointer select-none p-2 text-sm ${active ? 'bg-blue-100 dark:bg-slate-700' : ''}`;
    const createOptionClass = ({ active }) => `cursor-pointer select-none p-2 text-sm ${active ? 'bg-green-100 dark:bg-green-900/40' : ''}`;

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                <input type="checkbox" checked={engineOnly} onChange={(e) => toggleEngineOnly(e.target.checked)} />
                Engine only (fits any vehicle with this engine)
            </label>

            {!engineOnly && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Make</label>
                        <Combobox value={selectedMake} onChange={handleMakeSelect} nullable>
                            <div className="relative">
                                <Combobox.Input
                                    className={inputClass}
                                    displayValue={(m) => m?.make_name || formData.make_name}
                                    onChange={(e) => handleMakeInput(e.target.value)}
                                    onFocus={() => setShowMakeOptions(true)}
                                    onBlur={() => setTimeout(() => setShowMakeOptions(false), 150)}
                                    placeholder="Type or select make"
                                    required
                                />
                                {(showMakeOptions || makeQuery !== '') && (
                                    <Combobox.Options className={optionsClass}>
                                        {makes.filter(m => m.make_name.toLowerCase().includes(makeQuery.toLowerCase())).map(m => (
                                            <Combobox.Option key={m.make_id} value={m} className={optionClass}>{m.make_name}</Combobox.Option>
                                        ))}
                                        {makeQuery && !makes.some(m => m.make_name.toLowerCase() === makeQuery.toLowerCase()) && (
                                            <Combobox.Option value={{ make_name: makeQuery }} className={createOptionClass}>Create new "{makeQuery}"</Combobox.Option>
                                        )}
                                    </Combobox.Options>
                                )}
                            </div>
                        </Combobox>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Model</label>
                        <Combobox value={selectedModel} onChange={handleModelSelect} nullable>
                            <div className="relative">
                                <Combobox.Input
                                    className={inputClass}
                                    displayValue={(m) => m?.model_name || formData.model_name}
                                    onChange={(e) => handleModelInput(e.target.value)}
                                    onFocus={() => setShowModelOptions(true)}
                                    onBlur={() => setTimeout(() => setShowModelOptions(false), 150)}
                                    placeholder="Type or select model"
                                    required
                                    disabled={!(formData.make_id || (formData.make_name && formData.make_name.trim() !== ''))}
                                />
                                {(showModelOptions || modelQuery !== '') && (formData.make_id || (formData.make_name && formData.make_name.trim() !== '')) && (
                                    <Combobox.Options className={optionsClass}>
                                        {models.filter(m => m.model_name.toLowerCase().includes(modelQuery.toLowerCase())).map(m => (
                                            <Combobox.Option key={m.model_id} value={m} className={optionClass}>{m.model_name}</Combobox.Option>
                                        ))}
                                        {modelQuery && !models.some(m => m.model_name.toLowerCase() === modelQuery.toLowerCase()) && (
                                            <Combobox.Option value={{ model_name: modelQuery }} className={createOptionClass}>Create new "{modelQuery}"</Combobox.Option>
                                        )}
                                    </Combobox.Options>
                                )}
                            </div>
                        </Combobox>
                    </div>
                </>
            )}

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Engine {!engineOnly && '(optional)'}</label>
                <Combobox value={selectedEngine} onChange={handleEngineSelect} nullable>
                    <div className="relative">
                        <Combobox.Input
                            className={inputClass}
                            displayValue={(e) => e?.engine_code || formData.engine_name}
                            onChange={(e) => handleEngineInput(e.target.value)}
                            onFocus={() => setShowEngineOptions(true)}
                            onBlur={() => setTimeout(() => setShowEngineOptions(false), 150)}
                            placeholder="Type or select engine code (e.g. 4D56)"
                            required={engineOnly}
                            disabled={!engineOnly && !(formData.model_id || (formData.model_name && formData.model_name.trim() !== ''))}
                        />
                        {(showEngineOptions || engineQuery !== '') && (engineOnly || formData.model_id || (formData.model_name && formData.model_name.trim() !== '')) && (
                            <Combobox.Options className={optionsClass}>
                                {engines.filter(en => en.engine_code.toLowerCase().includes(engineQuery.toLowerCase())).map(en => (
                                    <Combobox.Option key={en.engine_id} value={en} className={optionClass}>{en.engine_code}</Combobox.Option>
                                ))}
                                {engineQuery && !engines.some(en => en.engine_code.toLowerCase() === engineQuery.toLowerCase()) && (
                                    <Combobox.Option value={{ engine_code: engineQuery }} className={createOptionClass}>Create new "{engineQuery}"</Combobox.Option>
                                )}
                            </Combobox.Options>
                        )}
                    </div>
                </Combobox>
            </div>

            {formData.engine_name && formData.engine_name.trim() !== '' && (
                <div className="grid grid-cols-2 gap-2">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Displacement (L)</label>
                        <input
                            type="number"
                            step="0.1"
                            placeholder="e.g., 2.5"
                            value={formData.displacement_liters}
                            onChange={(e) => setFormData(prev => ({ ...prev, displacement_liters: e.target.value }))}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Fuel Type</label>
                        <select
                            value={formData.fuel_type}
                            onChange={(e) => setFormData(prev => ({ ...prev, fuel_type: e.target.value }))}
                            className={inputClass}
                        >
                            <option value="">-- Unspecified --</option>
                            <option value="diesel">Diesel</option>
                            <option value="gasoline">Gasoline</option>
                            <option value="hybrid">Hybrid</option>
                            <option value="mild_hybrid">Mild Hybrid</option>
                            <option value="electric">Electric</option>
                            <option value="other">Other</option>
                        </select>
                    </div>
                </div>
            )}

            <div className="mt-6 flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-slate-700">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors shadow-xs">{submitLabel}</button>
            </div>
        </form>
    );
};

export default ApplicationCascadeForm;
