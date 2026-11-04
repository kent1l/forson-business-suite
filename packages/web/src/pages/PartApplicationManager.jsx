import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../api';
import { createUuid } from '../utils/createUuid';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import ApplicationSearchCombobox from '../components/applications/ApplicationSearchCombobox';
import ApplicationCascadeForm from '../components/applications/ApplicationCascadeForm';
import EngineCodeText from '../components/applications/EngineCodeText';
import { formatSearchFitments } from '../helpers/searchFitmentText';
import { useAuth } from '../contexts/AuthContext';
import {
    groupFitmentsForDisplay,
    formatApplicationScopeBadge,
    fitmentSavePayload,
} from '../utils/engineCodeFormat';

const CONFIDENCE_BADGE = {
    exact: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    high: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    low: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    unresolved: 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-slate-200',
};

const STATUS_BADGE = {
    'Linked': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    'Vehicle combination': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    'Choose vehicle': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    'Needs details': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    'Unresolved': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    'Already linked': 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
    'Excluded': 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
};

const describeCandidate = c => formatSearchFitments({ fitment_rules: [c] });

export const DescribeFitmentPanel = ({ partId, onCommitted, onStage }) => {
    const [text, setText] = useState('');
    const [parsing, setParsing] = useState(false);
    const [error, setError] = useState('');
    const [candidates, setCandidates] = useState(null);
    const [editingIndex, setEditingIndex] = useState(null);
    const [saving, setSaving] = useState(false);
    const [residue, setResidue] = useState([]);
    const requestVersion = useRef(0);
    const saveKeys = useRef(new Map());

    const parse = useCallback(async () => {
        if (!text.trim()) return;
        const version = ++requestVersion.current;
        setParsing(true);
        setError('');
        try {
            const { data } = await api.post('/applications/parse-fitment-text', { text });
            if (version !== requestVersion.current) return;
            setCandidates((data.fitments || []).map(c => ({ ...c,
                year_start: c.year_start ?? '', year_end: c.year_end ?? '',
                selected: c.confidence_label !== 'unresolved' && !c.alternative_group_id,
            })));
            setResidue(data.residue || []);
        } catch (err) {
            if (version === requestVersion.current) setError(err.response?.data?.message || err.message);
        } finally {
            if (version === requestVersion.current) setParsing(false);
        }
    }, [text]);

    const update = (index, patch) => setCandidates(rows => rows.map((row, i) => i === index ? { ...row, ...patch } :
        patch.selected && rows[index].alternative_group_id && row.alternative_group_id === rows[index].alternative_group_id ? { ...row, selected: false } : row));

    const save = async () => {
        setSaving(true);
        setError('');
        const failures = [];
        const saved = new Set();
        for (const [index, candidate] of candidates.entries()) {
            if (!candidate.selected || candidate.already_linked) continue;
            const payload = fitmentSavePayload(candidate);
            try {
                if (onStage) onStage(payload);
                else {
                    const key = JSON.stringify(payload);
                    if (!saveKeys.current.has(key)) saveKeys.current.set(key, createUuid());
                    await api.post(`/parts/${partId}/applications`, payload, { headers: { 'Idempotency-Key': saveKeys.current.get(key) } });
                }
                saved.add(index);
            } catch (err) { failures.push(`${describeCandidate(candidate)}: ${err.response?.data?.message || err.message}`); }
        }
        setCandidates(rows => rows.map((row, index) => saved.has(index) ? { ...row, selected: false, already_linked: true } : row));
        setError(failures.join('\n'));
        setSaving(false);
        onCommitted();
    };

    return (
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-slate-700 space-y-3">
            <h4 className="font-medium">Describe vehicle combinations</h4>
            <p className="text-sm text-gray-500">Enter makes, models, chassis or engines. Select the combinations to link; other details are optional.</p>
            <textarea aria-label="Vehicle description" value={text} disabled={saving}
                onChange={e => { setText(e.target.value); requestVersion.current += 1; setCandidates(null); setParsing(false); }}
                placeholder="e.g. Toyota Hilux 2KD-FTV 2005–2015; Mitsubishi 4D56"
                className="w-full border rounded-lg p-3 dark:bg-slate-900 dark:border-slate-600" />
            <button type="button" disabled={parsing || saving || !text.trim()} onClick={parse}
                className="px-3 py-2 rounded-lg bg-primary-600 text-white disabled:opacity-50">{parsing ? 'Finding vehicles…' : 'Find Combinations'}</button>
            {error && <p role="alert" className="text-sm text-red-600 whitespace-pre-line">{error}</p>}
            {residue.length > 0 && <p className="text-sm text-gray-500">Unrecognized: {residue.join(', ')}. You can edit a combination or add one manually.</p>}
            {candidates?.length === 0 && <p className="text-sm text-gray-500">No combinations found. Try another description or add one manually.</p>}
            {candidates?.map((candidate, index) => (
                <div key={index} className="border rounded-lg p-3 dark:border-slate-600 space-y-2">
                    <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={Boolean(candidate.selected)} disabled={saving || candidate.already_linked || candidate.confidence_label === 'unresolved'} onChange={e => update(index, { selected: e.target.checked })} />
                        {describeCandidate(candidate)}
                        {candidate.already_linked && <span className="text-green-600">Linked</span>}
                    </label>
                    {candidate.alternative_group_id && <p className="text-xs text-gray-500">Choose the intended combination.</p>}
                    {candidate.confidence_label === 'unresolved' && <p className="text-xs text-gray-500">Edit to choose the vehicle.</p>}
                    <div className="flex flex-wrap gap-2">
                        {['year_start','year_end'].map((key, i) => <input key={key} type="number" aria-label={`${i ? 'End' : 'Start'} year for combination ${index + 1}`} placeholder={i ? 'End year' : 'Start year'} value={candidate[key]} disabled={saving || candidate.already_linked} onChange={e => update(index, { [key]: e.target.value })} className="w-28 border rounded p-1 dark:bg-slate-900 dark:border-slate-600" />)}
                        <button type="button" disabled={saving || candidate.already_linked} onClick={() => setEditingIndex(index)} className="text-sm text-primary-600">Edit</button>
                        <button type="button" disabled={saving} onClick={() => setCandidates(rows => rows.filter((_, i) => i !== index))} className="text-sm text-red-600">Remove</button>
                    </div>
                </div>
            ))}
            {candidates?.some(c => c.selected && !c.already_linked) && <button type="button" disabled={saving} onClick={save} className="px-4 py-2 bg-primary-600 text-white rounded-lg disabled:opacity-50">{saving ? 'Saving…' : onStage ? 'Add Selected Combinations' : 'Link Selected Combinations'}</button>}
            <Modal isOpen={editingIndex !== null} onClose={() => setEditingIndex(null)} title="Edit Vehicle Combination">
                {editingIndex !== null && <ApplicationCascadeForm application={candidates[editingIndex]} onCancel={() => setEditingIndex(null)} onSave={payload => {
                    update(editingIndex, { ...payload, confidence_label: 'high', selected: true });
                    setEditingIndex(null);
                }} />}
            </Modal>
        </div>
    );
};

const EditYearForm = ({ link, onSave, onCancel }) => {
    const [years, setYears] = useState({ year_start: '', year_end: '', position: '' });

    const initialFormData = useMemo(() => {
        if (link) {
            return {
                year_start: link.link_year_start ?? '',
                year_end: link.link_year_end ?? '',
                position: link.position || ''
            };
        } else {
            return { year_start: '', year_end: '', position: '' };
        }
    }, [link]);

    const isFormDirty = useMemo(() => {
        return JSON.stringify(years) !== JSON.stringify(initialFormData);
    }, [years, initialFormData]);

    const isFormElement = (element) => {
        return element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');
    };

    useEffect(() => {
        if (link) {
            setYears({
                year_start: link.link_year_start ?? '',
                year_end: link.link_year_end ?? '',
                position: link.position || ''
            });
        }
    }, [link]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setYears(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = useCallback((e) => {
        if (e) e.preventDefault();
        onSave(link.part_app_id, years);
    }, [link, years, onSave]);

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

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Year Start</label>
                <input type="number" name="year_start" value={years.year_start} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 font-mono rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="e.g., 2010" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Year End</label>
                <input type="number" name="year_end" value={years.year_end} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 font-mono rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" placeholder="e.g., 2015" />
            </div>
            <label className="block text-sm">Position (optional)
                <input name="position" value={years.position} onChange={handleChange} placeholder="e.g. Front, rear, left, right" className="w-full border rounded-lg p-2 dark:bg-slate-900 dark:border-slate-600" />
            </label>
            <p className="text-xs text-gray-500">Blank years use the vehicle combination’s year range.</p>
            <div className="mt-6 flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-slate-700">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors shadow-xs">Save Link Details</button>
            </div>
        </form>
    );
};

const PartApplicationManager = ({ part, onCancel }) => {
    const { hasPermission } = useAuth();
    const canEdit = hasPermission('applications:edit');
    const [linkedApps, setLinkedApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [currentLink, setCurrentLink] = useState(null);
    const [selectedApp, setSelectedApp] = useState(null);
    const [yearStart, setYearStart] = useState('');
    const [yearEnd, setYearEnd] = useState('');
    const [position, setPosition] = useState('');
    const [showNewApp, setShowNewApp] = useState(false);
    const [appsRefreshKey, setAppsRefreshKey] = useState(0);

    // Engines are stored and linked atomically, which is correct but makes a
    // fitment list read as a wall of near-identical codes. Grouping recombines
    // them for display only, and only within an identical make/model/year
    // context -- never across vehicles.
    const displayGroups = useMemo(() => groupFitmentsForDisplay(linkedApps), [linkedApps]);

    useEffect(() => {
        const run = async () => {
            if (part) {
                setLoading(true);
                try {
                    const linkedRes = await api.get(`/parts/${part.part_id}/applications`);
                    setLinkedApps(linkedRes.data || []);
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
                const linkedRes = await api.get(`/parts/${part.part_id}/applications`);
                setLinkedApps(linkedRes.data || []);
            } catch (error) {
                console.error("Failed to fetch applications", error);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleLinkApp = async (e) => {
        e.preventDefault();
        if (!canEdit) return;
        if (!selectedApp?.application_id) {
            alert('Please select an application.');
            return;
        }

        try {
            await api.post(`/parts/${part.part_id}/applications`, {
                application_id: selectedApp.application_id,
                year_start: yearStart || null,
                year_end: yearEnd || null,
                position: position || null
            });

            await refetchData();
            setSelectedApp(null);
            setYearStart('');
            setYearEnd('');
            setPosition('');
        } catch (error) {
            alert('Failed to link application: ' + (error.response?.data?.message || error.message));
            console.error(error);
        }
    };
    
    const handleUnlinkApp = async (app) => {
        if (!canEdit) return;
        try {
            await api.delete(`/parts/${part.part_id}/application-rules/${app.rule_id}`, { data: { expected_version: app.row_version } });
            await refetchData();
        } catch (err) {
            alert('Failed to unlink application.');
            console.error(err);
        }
    };

    const handleEditLink = (link) => {
        if (!canEdit) return;
        setCurrentLink(link);
        setIsEditModalOpen(true);
    };

    const handleSaveYears = async (_partAppId, years) => {
        if (!canEdit) return;
        try {
            await api.put(`/parts/${part.part_id}/application-rules/${currentLink.rule_id}`, {
                ...years,
                expected_rule_version: currentLink?.row_version,
            });
            setIsEditModalOpen(false);
            await refetchData();
        } catch (error) {
            console.error(error);
            alert('Failed to update year range: ' + (error.response?.data?.message || error.message));
        }
    };
    return (
        <div className="space-y-4">
            <h3 className="text-md font-medium text-gray-800 dark:text-slate-100 mb-2 flex items-center gap-1">
                Linked Vehicle Combinations
                <InfoTip label="Application">
                    A vehicle combination records make, model, chassis, engine and optional classification details, with an
                    optional year range. Linking one to a part records "this part fits this vehicle."
                </InfoTip>
            </h3>
            {loading ? <p className="text-sm text-gray-500 dark:text-slate-400">Loading...</p> : (
                <ul className="bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 p-3 rounded-lg mb-4 h-36 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700/60">
                    {displayGroups.map((group, groupIdx) => (
                        group.fitments.length === 1 ? (
                            <li key={group.fitments[0].rule_id} className="text-sm flex justify-between items-center py-2 text-gray-900 dark:text-slate-100">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-medium" title={formatSearchFitments({ fitment_rules: group.fitments }, { compact: false })}>
                                        {formatSearchFitments({ fitment_rules: group.fitments })}
                                    </span>
                                    {group.fitments[0].effect === 'exclude' && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-danger-100 text-danger-800 dark:bg-danger-900/50 dark:text-danger-300">
                                            Excluded
                                        </span>
                                    )}
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[formatApplicationScopeBadge(group.fitments[0]).label] || CONFIDENCE_BADGE.low}`}>
                                        {formatApplicationScopeBadge(group.fitments[0]).label}
                                    </span>
                                </div>
                                {canEdit && (
                                    <div className="flex items-center space-x-3">
                                        <button onClick={() => handleEditLink(group.fitments[0])} className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 p-1" title="Edit Link Details"><Icon path={ICONS.edit} className="h-4 w-4"/></button>
                                        <button onClick={() => handleUnlinkApp(group.fitments[0])} className="text-danger-600 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 p-1" title="Unlink"><Icon path={ICONS.trash} className="h-4 w-4"/></button>
                                    </div>
                                )}
                            </li>
                        ) : (
                            <li key={`group-${groupIdx}`} className="py-2 text-gray-900 dark:text-slate-100">
                                <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap" title={group.engineCodes.join(', ')}>
                                    <span>{formatSearchFitments({ fitment_rules: group.fitments })}</span>
                                    {group.effect === 'exclude' && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-danger-100 text-danger-800 dark:bg-danger-900/50 dark:text-danger-300">
                                            Excluded
                                        </span>
                                    )}
                                </div>
                                <ul className="mt-1 ml-3 space-y-1 border-l border-gray-200 dark:border-slate-700 pl-3">
                                    {group.fitments.map(app => (
                                        <li key={app.rule_id} className="flex justify-between items-center text-xs text-gray-600 dark:text-slate-300">
                                            <div className="flex items-center gap-1.5">
                                                <EngineCodeText codes={app.engine} className="font-mono" />
                                                <span className={`text-[11px] px-1 py-0.5 rounded font-medium ${STATUS_BADGE[formatApplicationScopeBadge(app).label] || CONFIDENCE_BADGE.low}`}>
                                                    {formatApplicationScopeBadge(app).label}
                                                </span>
                                            </div>
                                            {canEdit && (
                                                <div className="flex items-center space-x-2">
                                                    <button onClick={() => handleEditLink(app)} className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 p-1" title="Edit Link Details"><Icon path={ICONS.edit} className="h-3.5 w-3.5"/></button>
                                                    <button onClick={() => handleUnlinkApp(app)} className="text-danger-600 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 p-1" title="Unlink"><Icon path={ICONS.trash} className="h-3.5 w-3.5"/></button>
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                </ul>
                            </li>
                        )
                    ))}
                    {linkedApps.length === 0 && <li className="text-sm text-gray-500 dark:text-slate-400 py-4 text-center">No applications linked yet.</li>}
                </ul>
            )}

            {canEdit && (
                <form onSubmit={handleLinkApp}>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                        Link Vehicle Combination
                        <InfoTip label="Year Start / Year End">
                            Optionally limit the fitment to specific model years (e.g., 2010-2015). Leave both
                            blank to use the selected combination’s years.
                        </InfoTip>
                    </label>
                    <div className="grid grid-cols-1 gap-2">
                        <div className="flex items-end gap-2">
                            <div className="flex-1">
                                <ApplicationSearchCombobox value={selectedApp} onChange={setSelectedApp} refreshKey={appsRefreshKey} />
                            </div>
                            <button type="button" onClick={() => setShowNewApp(true)} className="px-3.5 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 flex items-center gap-1 text-sm font-medium transition-colors">
                                <Icon path={ICONS.plus} className="h-4 w-4" /> New
                            </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Year Start</label>
                                <input
                                    type="number"
                                    placeholder="e.g., 2010"
                                    value={yearStart}
                                    onChange={(e) => setYearStart(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 font-mono rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Year End</label>
                                <input
                                    type="number"
                                    placeholder="e.g., 2015"
                                    value={yearEnd}
                                    onChange={(e) => setYearEnd(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 font-mono rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                        </div>
                        <label className="text-sm text-gray-700 dark:text-slate-300">Position (optional)
                            <input value={position} onChange={e => setPosition(e.target.value)} placeholder="e.g. Front or rear" className="w-full border rounded-lg p-2 dark:bg-slate-900 dark:border-slate-600" />
                        </label>
                        <button type="submit" className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 mt-2 text-sm font-medium transition-colors shadow-xs">
                            Link Combination
                        </button>
                    </div>
                </form>
            )}
            {canEdit && <DescribeFitmentPanel partId={part.part_id} onCommitted={refetchData} />}
             <div className="mt-6 flex justify-end pt-4 border-t border-gray-200 dark:border-slate-700">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors">Close</button>
            </div>
            <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title={`Edit Link Details for ${currentLink?.make} ${currentLink?.model}`}>
                <EditYearForm link={currentLink} onSave={handleSaveYears} onCancel={() => setIsEditModalOpen(false)} />
            </Modal>
            <Modal isOpen={showNewApp} onClose={() => setShowNewApp(false)} title="Add Vehicle Combination">
                <ApplicationCascadeForm
                    submitLabel="Create"
                    onCancel={() => setShowNewApp(false)}
                    onSave={async (payload) => {
                        try {
                            const { data } = await api.post('/applications', payload);
                            setSelectedApp(data);
                            setAppsRefreshKey(k => k + 1);
                            setShowNewApp(false);
                        } catch (error) {
                            alert('Failed to create application: ' + (error.response?.data?.message || error.message));
                        }
                    }}
                />
            </Modal>
        </div>
    );
};

export default PartApplicationManager;
