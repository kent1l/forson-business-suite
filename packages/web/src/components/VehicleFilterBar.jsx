import { useState, useEffect, useRef } from 'react';
import api from '../api';

// Cascading Make → Model → Engine filter bar + Year input for vehicle-based part search.
// Used in both PowerSearchPage and POSPage.
//
// Props:
//   onChange({ make_id, model_id, engine_id, year }) — called whenever any filter changes.
//     Passes null for unset dimensions. Called with all-null when cleared.
//   compact (bool, default false) — tighter layout for POS sidebar.
const VehicleFilterBar = ({ onChange, compact = false }) => {
    const [makes, setMakes] = useState([]);
    const [models, setModels] = useState([]);
    const [engines, setEngines] = useState([]);

    const [makeId, setMakeId]     = useState('');
    const [modelId, setModelId]   = useState('');
    const [engineId, setEngineId] = useState('');
    const [year, setYear]         = useState('');

    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;

    // Load makes on mount
    useEffect(() => {
        api.get('/makes').then(r => setMakes(r.data || [])).catch(() => {});
    }, []);

    // Load models when make changes
    useEffect(() => {
        setModelId('');
        setEngineId('');
        setModels([]);
        setEngines([]);
        if (makeId) {
            api.get(`/makes/${makeId}/models`).then(r => setModels(r.data || [])).catch(() => {});
        }
    }, [makeId]);

    // Load engines when model changes
    useEffect(() => {
        setEngineId('');
        setEngines([]);
        if (modelId) {
            api.get(`/models/${modelId}/engines`).then(r => setEngines(r.data || [])).catch(() => {});
        }
    }, [modelId]);

    // Notify parent on any change
    useEffect(() => {
        onChangeRef.current({
            make_id:   makeId   ? parseInt(makeId, 10)   : null,
            model_id:  modelId  ? parseInt(modelId, 10)  : null,
            engine_id: engineId ? parseInt(engineId, 10) : null,
            year:      year     ? parseInt(year, 10)     : null,
        });
    }, [makeId, modelId, engineId, year]);

    const hasFilter = makeId || modelId || engineId || year;

    const clear = () => {
        setMakeId('');
        setModelId('');
        setEngineId('');
        setYear('');
    };

    const selectCls = `w-full rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800
        text-sm text-gray-900 dark:text-slate-100 px-2 py-1.5 focus:outline-none focus:ring-1
        focus:ring-blue-500 disabled:opacity-50`;

    return (
        <div className={`flex flex-wrap items-end gap-2 ${compact ? 'text-xs' : 'text-sm'}`}>
            {/* Make */}
            <div className="flex flex-col gap-0.5 min-w-[120px] flex-1">
                {!compact && <label className="text-xs font-medium text-gray-500 dark:text-slate-400">Make</label>}
                <select
                    className={selectCls}
                    value={makeId}
                    onChange={e => setMakeId(e.target.value)}
                    aria-label="Filter by make"
                >
                    <option value="">Any make</option>
                    {makes.map(m => (
                        <option key={m.make_id} value={m.make_id}>{m.make_name}</option>
                    ))}
                </select>
            </div>

            {/* Model — only enabled after make */}
            <div className="flex flex-col gap-0.5 min-w-[130px] flex-1">
                {!compact && <label className="text-xs font-medium text-gray-500 dark:text-slate-400">Model</label>}
                <select
                    className={selectCls}
                    value={modelId}
                    onChange={e => setModelId(e.target.value)}
                    disabled={!makeId}
                    aria-label="Filter by model"
                >
                    <option value="">Any model</option>
                    {models.map(m => (
                        <option key={m.model_id} value={m.model_id}>{m.model_name}</option>
                    ))}
                </select>
            </div>

            {/* Engine — only enabled after model */}
            <div className="flex flex-col gap-0.5 min-w-[130px] flex-1">
                {!compact && <label className="text-xs font-medium text-gray-500 dark:text-slate-400">Engine</label>}
                <select
                    className={selectCls}
                    value={engineId}
                    onChange={e => setEngineId(e.target.value)}
                    disabled={!modelId}
                    aria-label="Filter by engine"
                >
                    <option value="">Any engine</option>
                    {engines.map(e => (
                        <option key={e.engine_id} value={e.engine_id}>{e.engine_code}</option>
                    ))}
                </select>
            </div>

            {/* Year */}
            <div className="flex flex-col gap-0.5 min-w-[80px]">
                {!compact && <label className="text-xs font-medium text-gray-500 dark:text-slate-400">Year</label>}
                <input
                    type="number"
                    min="1980"
                    max="2099"
                    placeholder="Year"
                    value={year}
                    onChange={e => setYear(e.target.value)}
                    className={`w-20 rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800
                        text-sm text-gray-900 dark:text-slate-100 px-2 py-1.5 focus:outline-none focus:ring-1
                        focus:ring-blue-500`}
                    aria-label="Filter by year"
                />
            </div>

            {/* Clear button — only when something is set */}
            {hasFilter && (
                <button
                    type="button"
                    onClick={clear}
                    className="self-end px-2 py-1.5 text-xs text-gray-500 dark:text-slate-400 hover:text-red-500
                        dark:hover:text-red-400 border border-transparent hover:border-red-300 rounded transition-colors"
                    aria-label="Clear vehicle filters"
                >
                    Clear
                </button>
            )}
        </div>
    );
};

export default VehicleFilterBar;
