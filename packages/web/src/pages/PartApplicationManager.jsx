import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import ApplicationSearchCombobox from '../components/applications/ApplicationSearchCombobox';
import ApplicationCascadeForm from '../components/applications/ApplicationCascadeForm';
import { useAuth } from '../contexts/AuthContext';
import { groupFitmentsForDisplay, formatFitmentGroup } from '../utils/engineCodeFormat';

const CONFIDENCE_BADGE = {
    high: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    low: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
};

const describeCandidate = (c) => {
    const parts = [c.make, c.model, c.engine].filter(Boolean);
    const base = parts.length ? parts.join(' ') : '(unspecified vehicle)';
    const years = (c.year_start || c.year_end)
        ? ` (${[c.year_start, c.year_end].filter(Boolean).join('-')})`
        : '';
    return base + years;
};

// Phase 5: staff describe a fitment in plain text and get back structured,
// editable candidate rows to review before anything is saved. The parse
// endpoint only proposes -- nothing is written until "Save Selected" commits
// each accepted row through the normal /applications + link endpoints below,
// which independently re-validate any id the AI claimed to have matched.
const DescribeFitmentPanel = ({ partId, onCommitted }) => {
    const [text, setText] = useState('');
    const [parsing, setParsing] = useState(false);
    const [parseError, setParseError] = useState('');
    const [notes, setNotes] = useState('');
    const [candidates, setCandidates] = useState(null); // null = not parsed yet
    const [parseSource, setParseSource] = useState(null); // 'local' | 'hybrid' | 'ai'
    const [editingIndex, setEditingIndex] = useState(null);
    const [saving, setSaving] = useState(false);
    const [saveErrors, setSaveErrors] = useState({});

    const handleParse = async () => {
        if (!text.trim()) return;
        setParsing(true);
        setParseError('');
        try {
            const { data } = await api.post('/applications/parse-fitment-text', { text });
            // Keep each row's originally typed text so that if the reviewer
            // resolves it by hand we can record what it meant (see
            // recordAliasFromEdit).
            const withMeta = (data.fitments || []).map(f => ({
                ...f,
                selected: true,
                year_start: f.year_start ?? '',
                year_end: f.year_end ?? '',
                _rawMake: f.make_id ? null : f.make,
                _rawModel: f.model_id ? null : f.model,
                _rawEngine: f.engine_id ? null : f.engine,
            }));
            setCandidates(withMeta);
            setNotes(data.notes || '');
            setParseSource(data.source || 'ai');
            setSaveErrors({});
        } catch (error) {
            setParseError(error.response?.data?.error || error.response?.data?.message || error.message);
            setCandidates(null);
            setParseSource(null);
        } finally {
            setParsing(false);
        }
    };

    const updateCandidate = (idx, patch) => {
        setCandidates(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
    };

    const removeCandidate = (idx) => {
        setCandidates(prev => prev.filter((_, i) => i !== idx));
    };

    // The learning loop (PRD-FBS-FIT-002 §8.3): when a reviewer resolves text the
    // parser could not match, record what that text meant. The next time anyone
    // types it, the deterministic parser resolves it locally and no AI call is
    // needed at all. Recorded only on an explicit edit -- never inferred from a
    // silent save -- and a failure here must never block the fitment itself.
    const recordAliasFromEdit = async (original, payload) => {
        const learnings = [
            { raw: original._rawMake, key: 'make_id', id: payload.make_id },
            { raw: original._rawModel, key: 'model_id', id: payload.model_id },
            { raw: original._rawEngine, key: 'engine_id', id: payload.engine_id },
        ];
        for (const { raw, key, id } of learnings) {
            if (!raw || !id) continue;
            try {
                await api.post('/applications/fitment-alias', { alias_text: raw, [key]: id });
            } catch {
                // A duplicate or a collision with a canonical name is expected
                // and harmless; the fitment save is what matters.
            }
        }
    };

    const handleEditSave = (idx, payload) => {
        const original = candidates[idx];
        recordAliasFromEdit(original, payload);
        // ApplicationCascadeForm's payload uses undefined for unset fields;
        // normalize those back to null/'' so the candidate row stays consistent.
        updateCandidate(idx, {
            make_id: payload.make_id ?? null,
            make: payload.make ?? null,
            model_id: payload.model_id ?? null,
            model: payload.model ?? null,
            engine_id: payload.engine_id ?? null,
            engine: payload.engine ?? null,
            displacement_liters: payload.displacement_liters ?? null,
            fuel_type: payload.fuel_type ?? null,
            confidence: 'high' // user-confirmed via the cascading form
        });
        setEditingIndex(null);
    };

    const selectedCount = (candidates || []).filter(c => c.selected).length;

    const handleSaveSelected = async () => {
        if (!candidates) return;
        setSaving(true);
        const errors = {};
        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            if (!c.selected) continue;
            try {
                const { data: app } = await api.post('/applications', {
                    make_id: c.make_id ?? undefined,
                    make: c.make_id ? undefined : (c.make ?? undefined),
                    model_id: c.model_id ?? undefined,
                    model: c.model_id ? undefined : (c.model ?? undefined),
                    engine_id: c.engine_id ?? undefined,
                    engine: c.engine_id ? undefined : (c.engine ?? undefined),
                    displacement_liters: c.displacement_liters ?? undefined,
                    fuel_type: c.fuel_type ?? undefined
                });
                await api.post(`/parts/${partId}/applications`, {
                    application_id: app.application_id,
                    year_start: c.year_start || null,
                    year_end: c.year_end || null
                });
            } catch (error) {
                errors[i] = error.response?.data?.message || error.message;
            }
        }
        setSaving(false);
        setSaveErrors(errors);
        if (Object.keys(errors).length === 0) {
            setCandidates(null);
            setText('');
            setNotes('');
            setParseSource(null);
            onCommitted();
        } else {
            // Keep only the rows that failed so staff can retry/fix just those.
            setCandidates(prev => prev.filter((_, i) => errors[i] !== undefined).map(c => ({ ...c, selected: true })));
            onCommitted();
        }
    };

    return (
        <div className="mt-6 pt-4 border-t border-gray-200 dark:border-slate-700">
            <h4 className="text-sm font-medium text-gray-800 dark:text-slate-100 mb-2 flex items-center gap-1">
                Describe Fitment
                <InfoTip label="Describe Fitment">
                    Type a natural description like "Fits Hilux 2005-2015 2.5L Diesel, also Fortuner same years"
                    and review the parsed rows below before saving. Recognised makes, models, engine codes and
                    shorthand like "4D55/6" are matched instantly against the catalog; AI assistance is used only
                    for wording that cannot be matched. Nothing is written until you save.
                </InfoTip>
            </h4>
            <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={2}
                placeholder="e.g. Fits Toyota Hilux 2005-2015 2.5L & 3.0L Diesel, also fits Fortuner same years"
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            <div className="flex justify-end mt-2">
                <button
                    type="button"
                    onClick={handleParse}
                    disabled={parsing || !text.trim()}
                    className="px-3.5 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors disabled:opacity-50"
                >
                    {parsing ? 'Parsing…' : 'Parse Description'}
                </button>
            </div>
            {parseError && <p className="text-sm text-danger-600 dark:text-danger-400 mt-2">{parseError}</p>}

            {candidates && (
                <div className="mt-3 space-y-2">
                    {parseSource && (
                        <p className="text-xs text-gray-500 dark:text-slate-400">
                            {parseSource === 'local'
                                ? 'Matched directly against the catalog — no AI used.'
                                : parseSource === 'hybrid'
                                    ? 'Partly matched against the catalog; AI assisted with the rest.'
                                    : 'Parsed with AI assistance.'}
                        </p>
                    )}
                    {notes && <p className="text-xs text-amber-700 dark:text-amber-400 italic">{notes}</p>}
                    {candidates.length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">No fitments recognized in that text.</p>}
                    {candidates.map((c, idx) => (
                        <div key={idx} className="flex items-start gap-2 p-2 border border-gray-200 dark:border-slate-700 rounded-lg">
                            <input
                                type="checkbox"
                                checked={c.selected}
                                onChange={(e) => updateCandidate(idx, { selected: e.target.checked })}
                                className="mt-1"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{describeCandidate(c)}</span>
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${CONFIDENCE_BADGE[c.confidence] || CONFIDENCE_BADGE.low}`}>{c.confidence}</span>
                                    {!c.make_id && c.make && <span className="text-xs text-gray-500 dark:text-slate-400">(new make)</span>}
                                    {!c.model_id && c.model && <span className="text-xs text-gray-500 dark:text-slate-400">(new model)</span>}
                                    {!c.engine_id && c.engine && <span className="text-xs text-gray-500 dark:text-slate-400">(new engine)</span>}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                    <input
                                        type="number" placeholder="Year start" value={c.year_start}
                                        onChange={(e) => updateCandidate(idx, { year_start: e.target.value })}
                                        className="w-24 px-2 py-1 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 font-mono rounded text-xs"
                                    />
                                    <input
                                        type="number" placeholder="Year end" value={c.year_end}
                                        onChange={(e) => updateCandidate(idx, { year_end: e.target.value })}
                                        className="w-24 px-2 py-1 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 font-mono rounded text-xs"
                                    />
                                    <button type="button" onClick={() => setEditingIndex(idx)} className="text-primary-600 dark:text-primary-400 hover:text-primary-700 text-xs font-medium">Edit</button>
                                    <button type="button" onClick={() => removeCandidate(idx)} className="text-danger-600 dark:text-danger-400 hover:text-danger-700 text-xs font-medium">Remove</button>
                                </div>
                                {saveErrors[idx] && <p className="text-xs text-danger-600 dark:text-danger-400 mt-1">{saveErrors[idx]}</p>}
                            </div>
                        </div>
                    ))}
                    {candidates.length > 0 && (
                        <div className="flex justify-end">
                            <button
                                type="button"
                                onClick={handleSaveSelected}
                                disabled={saving || selectedCount === 0}
                                className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors shadow-xs disabled:opacity-50"
                            >
                                {saving ? 'Saving…' : `Save ${selectedCount} Selected Fitment${selectedCount === 1 ? '' : 's'}`}
                            </button>
                        </div>
                    )}
                </div>
            )}

            <Modal isOpen={editingIndex !== null} onClose={() => setEditingIndex(null)} title="Edit Parsed Fitment">
                {editingIndex !== null && (
                    <ApplicationCascadeForm
                        submitLabel="Apply"
                        application={candidates[editingIndex]}
                        onCancel={() => setEditingIndex(null)}
                        onSave={(payload) => handleEditSave(editingIndex, payload)}
                    />
                )}
            </Modal>
        </div>
    );
};

const EditYearForm = ({ link, onSave, onCancel }) => {
    const [years, setYears] = useState({ year_start: '', year_end: '' });

    const initialFormData = useMemo(() => {
        if (link) {
            return {
                year_start: link.year_start || '',
                year_end: link.year_end || ''
            };
        } else {
            return { year_start: '', year_end: '' };
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
                year_start: link.year_start || '',
                year_end: link.year_end || ''
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
            <div className="mt-6 flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-slate-700">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors shadow-xs">Save Years</button>
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
                year_end: yearEnd || null
            });

            await refetchData();
            setSelectedApp(null);
            setYearStart('');
            setYearEnd('');
        } catch (error) {
            alert('Failed to link application: ' + (error.response?.data?.message || error.message));
            console.error(error);
        }
    };
    
    const handleUnlinkApp = async (applicationId) => {
        if (!canEdit) return;
        try {
            await api.delete(`/parts/${part.part_id}/applications/${applicationId}`);
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

    const handleSaveYears = async (partAppId, years) => {
        if (!canEdit) return;
        try {
            await api.put(`/part-applications/${partAppId}`, years);
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
        <div className="space-y-4">
            <h3 className="text-md font-medium text-gray-800 dark:text-slate-100 mb-2 flex items-center gap-1">
                Linked Applications
                <InfoTip label="Application">
                    An Application is a specific vehicle fitment — a Make, Model, and optional Engine, with an
                    optional year range. Linking one to a part records "this part fits this vehicle."
                </InfoTip>
            </h3>
            {loading ? <p className="text-sm text-gray-500 dark:text-slate-400">Loading...</p> : (
                <ul className="bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700 p-3 rounded-lg mb-4 h-36 overflow-y-auto divide-y divide-gray-100 dark:divide-slate-700/60">
                    {displayGroups.map((group, groupIdx) => (
                        group.fitments.length === 1 ? (
                            <li key={group.fitments[0].part_app_id} className="text-sm flex justify-between items-center py-2 text-gray-900 dark:text-slate-100">
                                <div>
                                    <span className="font-medium">{group.fitments[0].make} {group.fitments[0].model} {group.fitments[0].engine ? `(${group.fitments[0].engine})` : ''}</span>
                                    <span className="text-xs text-gray-500 dark:text-slate-400 font-mono ml-2">{formatYearRange(group.fitments[0].year_start, group.fitments[0].year_end)}</span>
                                </div>
                                {canEdit && (
                                    <div className="flex items-center space-x-3">
                                        <button onClick={() => handleEditLink(group.fitments[0])} className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 p-1" title="Edit Years"><Icon path={ICONS.edit} className="h-4 w-4"/></button>
                                        <button onClick={() => handleUnlinkApp(group.fitments[0].application_id)} className="text-danger-600 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 p-1" title="Unlink"><Icon path={ICONS.trash} className="h-4 w-4"/></button>
                                    </div>
                                )}
                            </li>
                        ) : (
                            // Several engines share this vehicle and year range, so the
                            // header shows them in the shorthand staff write by hand
                            // ("4D55/6"). Each engine is still its own row underneath
                            // with its own controls -- the compression is display only,
                            // and every engine remains individually linked and
                            // individually removable.
                            <li key={`group-${groupIdx}`} className="py-2 text-gray-900 dark:text-slate-100">
                                <div className="text-sm font-medium" title={group.engineCodes.join(', ')}>
                                    {formatFitmentGroup(group)}
                                </div>
                                <ul className="mt-1 ml-3 space-y-1 border-l border-gray-200 dark:border-slate-700 pl-3">
                                    {group.fitments.map(app => (
                                        <li key={app.part_app_id} className="flex justify-between items-center text-xs text-gray-600 dark:text-slate-300">
                                            <span className="font-mono">{app.engine || '—'}</span>
                                            {canEdit && (
                                                <div className="flex items-center space-x-2">
                                                    <button onClick={() => handleEditLink(app)} className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 p-1" title="Edit Years"><Icon path={ICONS.edit} className="h-3.5 w-3.5"/></button>
                                                    <button onClick={() => handleUnlinkApp(app.application_id)} className="text-danger-600 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 p-1" title="Unlink"><Icon path={ICONS.trash} className="h-3.5 w-3.5"/></button>
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
                        Link New Application
                        <InfoTip label="Year Start / Year End">
                            Optionally limit the fitment to specific model years (e.g., 2010-2015). Leave both
                            blank if the fitment applies to all years of that vehicle.
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
                        <button type="submit" className="w-full px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 mt-2 text-sm font-medium transition-colors shadow-xs">
                            Link Application
                        </button>
                    </div>
                </form>
            )}
            {canEdit && <DescribeFitmentPanel partId={part.part_id} onCommitted={refetchData} />}
             <div className="mt-6 flex justify-end pt-4 border-t border-gray-200 dark:border-slate-700">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors">Close</button>
            </div>
            <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title={`Edit Year Range for ${currentLink?.make} ${currentLink?.model}`}>
                <EditYearForm link={currentLink} onSave={handleSaveYears} onCancel={() => setIsEditModalOpen(false)} />
            </Modal>
            <Modal isOpen={showNewApp} onClose={() => setShowNewApp(false)} title="Add New Application">
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
