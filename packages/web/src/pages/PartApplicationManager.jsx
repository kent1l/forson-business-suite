import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import api from '../api';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import ApplicationSearchCombobox from '../components/applications/ApplicationSearchCombobox';
import ApplicationCascadeForm from '../components/applications/ApplicationCascadeForm';
import { useAuth } from '../contexts/AuthContext';
import {
    groupFitmentsForDisplay,
    formatFitmentGroup,
    formatApplicationScopeBadge,
    formatQualifierSummary,
} from '../utils/engineCodeFormat';

const CONFIDENCE_BADGE = {
    exact: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    high: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    medium: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    low: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    unresolved: 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-slate-200',
};

const STATUS_BADGE = {
    'Confirmed compatible': 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
    'Sourced suggestion': 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
    'Needs review': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    'Needs details': 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
    'Unresolved': 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
    'Already linked': 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300',
    'Excluded': 'bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300',
};

const describeCandidate = (c) => {
    const prefix = c.effect === 'exclude' ? 'EXCLUDES: ' : '';
    const parts = [c.make, c.model, c.chassis ? `[${c.chassis}]` : null, c.engine].filter(Boolean);
    const base = parts.length ? parts.join(' ') : '(unspecified vehicle)';
    const years = (c.year_start || c.year_end)
        ? ` (${[c.year_start, c.year_end].filter(Boolean).join('-')})`
        : '';
    const quals = formatQualifierSummary(c);
    return `${prefix}${base}${years}${quals ? ` [${quals}]` : ''}`;
};

export const DescribeFitmentPanel = ({ partId, onCommitted, onStage }) => {
    const [text, setText] = useState('');
    const [parsing, setParsing] = useState(false);
    const [parseError, setParseError] = useState('');
    const [notes, setNotes] = useState('');
    const [candidates, setCandidates] = useState(null); // null = not parsed yet
    const [reviewId, setReviewId] = useState(null);
    const [parseSource, setParseSource] = useState(null); // 'local' | 'hybrid' | 'ai'
    const [editingIndex, setEditingIndex] = useState(null);
    const [promoteAliasOnEdit, setPromoteAliasOnEdit] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveErrors, setSaveErrors] = useState({});
    const parseRequest = useRef(0);

    const handleParse = useCallback(async (value = text) => {
        if (!value.trim()) return;
        const request = ++parseRequest.current;
        setParsing(true);
        setParseError('');
        try {
            const { data } = await api.post('/applications/parse-fitment-text', {
                text: value,
                part_id: partId ?? undefined,
            });
            if (request !== parseRequest.current) return;
            const rawList = data.candidates || data.fitments || [];
            const withMeta = rawList
                .filter(f => f.disposition !== 'dismissed')
                .map(f => {
                    const isAlreadyLinked = Boolean(f.already_linked || f.disposition === 'already_linked');
                    const isUnresolved = f.confidence_label === 'unresolved' || (!f.make_id && !f.model_id && !f.engine_id && !f.chassis_id);
                    const defaultSelected = f.preselected !== undefined
                        ? Boolean(f.preselected)
                        : (!isAlreadyLinked && !isUnresolved && f.confidence === 'high' && !f.alternative_group_id);
                    return {
                        ...f,
                        selected: defaultSelected,
                        year_start: f.year_start ?? '',
                        year_end: f.year_end ?? '',
                        _rawMake: f.make_id ? null : f.make,
                        _rawModel: f.model_id ? null : f.model,
                        _rawEngine: f.engine_id ? null : f.engine,
                    };
                });
            setCandidates(withMeta);
            setReviewId(data.review_id || null);
            setNotes(data.notes || '');
            setParseSource(data.source || 'local');
            setSaveErrors({});
        } catch (error) {
            if (request !== parseRequest.current) return;
            setParseError(error.response?.data?.error || error.response?.data?.message || error.message);
            setCandidates(null);
            setReviewId(null);
            setParseSource(null);
        } finally {
            if (request === parseRequest.current) setParsing(false);
        }
    }, [text, partId]);

    useEffect(() => {
        if (text.trim().length < 3) {
            parseRequest.current += 1;
            setCandidates(null);
            setReviewId(null);
            return undefined;
        }
        const timer = setTimeout(() => handleParse(text), 600);
        return () => clearTimeout(timer);
    }, [text, handleParse]);

    const updateCandidate = (idx, patch) => {
        setCandidates(prev => prev.map((c, i) => i === idx ? { ...c, ...patch } : c));
    };

    const removeCandidate = async (idx) => {
        const target = candidates?.[idx];
        setCandidates(prev => prev.filter((_, i) => i !== idx));
        if (reviewId && target) {
            try {
                await api.patch(`/applications/fitment-reviews/${reviewId}`, {
                    action: 'dismiss_candidate',
                    candidate_id: target.candidate_id,
                    interpretation_key: target.interpretation_key,
                    disposition: 'dismissed',
                    reason: 'Dismissed in review panel',
                });
            } catch {
                // Non-blocking review dismissal persistence
            }
        }
    };

    const recordCorrectionAndOptionalAlias = async (original, payload, shouldPromoteAlias) => {
        try {
            await api.post('/applications/fitment-corrections', {
                part_id: partId ?? null,
                review_id: reviewId ?? null,
                candidate_id: original.candidate_id ?? null,
                raw_text: original.clause_text || text,
                original: {
                    make: original.make,
                    model: original.model,
                    engine: original.engine,
                },
                corrected: {
                    make_id: payload.make_id ?? null,
                    model_id: payload.model_id ?? null,
                    engine_id: payload.engine_id ?? null,
                },
                promote_to_alias: Boolean(shouldPromoteAlias),
            });
        } catch {
            // Non-blocking correction logging
        }

        if (!shouldPromoteAlias) return;

        const learnings = [
            { raw: original._rawMake, type: 'make', id: payload.make_id },
            { raw: original._rawModel, type: 'model', id: payload.model_id, make_id: payload.make_id },
            { raw: original._rawEngine, type: 'engine', id: payload.engine_id },
        ];
        for (const { raw, type, id, make_id } of learnings) {
            if (!raw || !id) continue;
            try {
                await api.post('/applications/fitment-alias', {
                    type,
                    target_id: id,
                    make_id: make_id ?? undefined,
                    alias_text: raw,
                });
            } catch {
                // Non-atomic phrases or collisions are rejected by the server; fitment edit still succeeds
            }
        }
    };

    const handleEditSave = (idx, payload) => {
        const original = candidates[idx];
        recordCorrectionAndOptionalAlias(original, payload, promoteAliasOnEdit);
        updateCandidate(idx, {
            make_id: payload.make_id ?? null,
            make: payload.make ?? null,
            model_id: payload.model_id ?? null,
            model: payload.model ?? null,
            chassis_id: payload.chassis_id ?? original.chassis_id ?? null,
            chassis: payload.chassis ?? original.chassis ?? null,
            engine_id: payload.engine_id ?? null,
            engine: payload.engine ?? null,
            displacement_liters: payload.displacement_liters ?? null,
            fuel_type: payload.fuel_type ?? null,
            confidence: 'high',
            confidence_label: 'high',
            ui_badge: 'Needs review',
            selected: true,
        });
        setEditingIndex(null);
        setPromoteAliasOnEdit(false);
    };

    const selectedCount = (candidates || []).filter(c => c.selected && !c.already_linked).length;

    const handleSaveSelected = async () => {
        if (!candidates) return;
        setSaving(true);
        const errors = {};
        const batchIdemSeed = `${partId || 'stage'}-${Date.now()}`;
        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            if (!c.selected || c.already_linked) continue;
            try {
                if (c.year_start && c.year_end && Number(c.year_start) > Number(c.year_end)) {
                    throw new Error('Start year must not be after end year.');
                }
                const { data: app } = await api.post('/applications', {
                    make_id: c.make_id ?? undefined,
                    make: c.make_id ? undefined : (c.make ?? undefined),
                    model_id: c.model_id ?? undefined,
                    model: c.model_id ? undefined : (c.model ?? undefined),
                    chassis_id: c.chassis_id ?? undefined,
                    chassis: c.chassis_id ? undefined : (c.chassis ?? undefined),
                    engine_id: c.engine_id ?? undefined,
                    engine: c.engine_id ? undefined : (c.engine ?? undefined),
                    displacement_liters: c.displacement_liters ?? undefined,
                    fuel_type: c.fuel_type ?? undefined,
                });
                const fitment = {
                    ...app,
                    make: app.make ?? c.make,
                    model: app.model ?? c.model,
                    chassis: app.chassis ?? c.chassis ?? null,
                    engine: app.engine ?? c.engine,
                    year_start: c.year_start || null,
                    year_end: c.year_end || null,
                    effect: c.effect || 'include',
                    market: c.market || null,
                    variant: c.variant || null,
                    position: c.position || null,
                    drivetrain: c.drivetrain || null,
                };
                if (onStage) {
                    onStage(fitment);
                } else {
                    await api.post(`/parts/${partId}/applications`, fitment, {
                        headers: { 'Idempotency-Key': `${batchIdemSeed}-${i}` },
                    });
                }
            } catch (error) {
                errors[i] = error.response?.data?.message || error.message;
            }
        }
        setSaving(false);
        setSaveErrors(errors);
        if (Object.keys(errors).length === 0) {
            setCandidates(null);
            setReviewId(null);
            setText('');
            setNotes('');
            setParseSource(null);
            onCommitted();
        } else {
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
                    for wording that cannot be matched. Review the results before adding them.
                </InfoTip>
            </h4>
            {onStage && <p className="text-xs text-gray-500 dark:text-slate-400 mb-2">Adding a fitment can create catalog entries. Save the part to link the selected fitments.</p>}
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
                    onClick={() => handleParse(text)}
                    disabled={parsing || !text.trim()}
                    className="px-3.5 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 border border-gray-300 dark:border-slate-600 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors disabled:opacity-50"
                >
                    {parsing ? 'Updating suggestions…' : 'Parse Description'}
                </button>
            </div>
            {parseError && <p role="alert" aria-live="polite" className="text-sm text-danger-600 dark:text-danger-400 mt-2">{parseError}</p>}

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
                        <div key={idx} className={`flex items-start gap-2 p-2 border rounded-lg ${c.effect === 'exclude' ? 'border-danger-200 dark:border-danger-900/60 bg-danger-50/30 dark:bg-danger-950/20' : 'border-gray-200 dark:border-slate-700'}`}>
                            <input
                                id={`fitment-candidate-${idx}`}
                                type="checkbox"
                                checked={c.selected}
                                disabled={c.already_linked}
                                onChange={(e) => updateCandidate(idx, { selected: e.target.checked })}
                                className="mt-1 disabled:opacity-50"
                            />
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <label htmlFor={`fitment-candidate-${idx}`} className="text-sm font-medium text-gray-900 dark:text-slate-100 cursor-pointer">
                                        {describeCandidate(c)}
                                    </label>
                                    {c.effect === 'exclude' && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-danger-100 text-danger-800 dark:bg-danger-900/50 dark:text-danger-300">
                                            Excluded
                                        </span>
                                    )}
                                    {c.ui_badge && (
                                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[c.ui_badge] || CONFIDENCE_BADGE.low}`}>
                                            {c.ui_badge}
                                        </span>
                                    )}
                                    <span className={`text-xs px-1.5 py-0.5 rounded ${CONFIDENCE_BADGE[c.confidence] || CONFIDENCE_BADGE.low}`}>
                                        Confidence: {c.confidence}
                                    </span>
                                    {!c.make_id && c.make && <span className="text-xs text-gray-500 dark:text-slate-400">(new make)</span>}
                                    {!c.model_id && c.model && <span className="text-xs text-gray-500 dark:text-slate-400">(new model)</span>}
                                    {!c.engine_id && c.engine && <span className="text-xs text-gray-500 dark:text-slate-400">(new engine)</span>}
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                    <input
                                        type="number" placeholder="Year start" aria-label={`Year start for candidate ${idx + 1}`} value={c.year_start}
                                        onChange={(e) => updateCandidate(idx, { year_start: e.target.value })}
                                        className="w-24 px-2 py-1 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 font-mono rounded text-xs"
                                    />
                                    <input
                                        type="number" placeholder="Year end" aria-label={`Year end for candidate ${idx + 1}`} value={c.year_end}
                                        onChange={(e) => updateCandidate(idx, { year_end: e.target.value })}
                                        className="w-24 px-2 py-1 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 font-mono rounded text-xs"
                                    />
                                    <button type="button" onClick={() => setEditingIndex(idx)} className="text-primary-600 dark:text-primary-400 hover:text-primary-700 text-xs font-medium">Edit</button>
                                    <button type="button" onClick={() => removeCandidate(idx)} className="text-danger-600 dark:text-danger-400 hover:text-danger-700 text-xs font-medium">Remove</button>
                                </div>
                                {saveErrors[idx] && <p role="alert" aria-live="polite" className="text-xs text-danger-600 dark:text-danger-400 mt-1">{saveErrors[idx]}</p>}
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
                                {saving ? 'Saving…' : `${onStage ? 'Add' : 'Save'} ${selectedCount} Selected Fitment${selectedCount === 1 ? '' : 's'}`}
                            </button>
                        </div>
                    )}
                </div>
            )}

            <Modal isOpen={editingIndex !== null} onClose={() => { setEditingIndex(null); setPromoteAliasOnEdit(false); }} title="Edit Parsed Fitment">
                {editingIndex !== null && (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 p-2 bg-gray-50 dark:bg-slate-800/60 border border-gray-200 dark:border-slate-700 rounded-lg">
                            <input
                                id="promote-alias-checkbox"
                                type="checkbox"
                                checked={promoteAliasOnEdit}
                                onChange={(e) => setPromoteAliasOnEdit(e.target.checked)}
                            />
                            <label htmlFor="promote-alias-checkbox" className="text-xs text-gray-700 dark:text-slate-300 cursor-pointer">
                                Save atomic synonym as a global catalog alias (only for single-vehicle synonyms)
                            </label>
                        </div>
                        <ApplicationCascadeForm
                            submitLabel="Apply"
                            application={candidates[editingIndex]}
                            onCancel={() => { setEditingIndex(null); setPromoteAliasOnEdit(false); }}
                            onSave={(payload) => handleEditSave(editingIndex, payload)}
                        />
                    </div>
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
            await api.put(`/part-applications/${partAppId}`, {
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
                                <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-medium">
                                        {group.fitments[0].make} {group.fitments[0].model}
                                        {group.fitments[0].chassis ? ` [${group.fitments[0].chassis}]` : ''}
                                        {group.fitments[0].engine ? ` (${group.fitments[0].engine})` : ''}
                                    </span>
                                    <span className="text-xs text-gray-500 dark:text-slate-400 font-mono">{formatYearRange(group.fitments[0].year_start, group.fitments[0].year_end)}</span>
                                    {group.fitments[0].effect === 'exclude' && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-danger-100 text-danger-800 dark:bg-danger-900/50 dark:text-danger-300">
                                            Excluded
                                        </span>
                                    )}
                                    {formatQualifierSummary(group.fitments[0]) && (
                                        <span className="text-xs text-gray-500 dark:text-slate-400">
                                            [{formatQualifierSummary(group.fitments[0])}]
                                        </span>
                                    )}
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_BADGE[formatApplicationScopeBadge(group.fitments[0])] || CONFIDENCE_BADGE.low}`}>
                                        {formatApplicationScopeBadge(group.fitments[0])}
                                    </span>
                                </div>
                                {canEdit && (
                                    <div className="flex items-center space-x-3">
                                        <button onClick={() => handleEditLink(group.fitments[0])} className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 p-1" title="Edit Years"><Icon path={ICONS.edit} className="h-4 w-4"/></button>
                                        <button onClick={() => handleUnlinkApp(group.fitments[0].application_id)} className="text-danger-600 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 p-1" title="Unlink"><Icon path={ICONS.trash} className="h-4 w-4"/></button>
                                    </div>
                                )}
                            </li>
                        ) : (
                            <li key={`group-${groupIdx}`} className="py-2 text-gray-900 dark:text-slate-100">
                                <div className="text-sm font-medium flex items-center gap-1.5 flex-wrap" title={group.engineCodes.join(', ')}>
                                    <span>{formatFitmentGroup(group)}</span>
                                    {group.effect === 'exclude' && (
                                        <span className="text-xs px-1.5 py-0.5 rounded font-medium bg-danger-100 text-danger-800 dark:bg-danger-900/50 dark:text-danger-300">
                                            Excluded
                                        </span>
                                    )}
                                </div>
                                <ul className="mt-1 ml-3 space-y-1 border-l border-gray-200 dark:border-slate-700 pl-3">
                                    {group.fitments.map(app => (
                                        <li key={app.part_app_id} className="flex justify-between items-center text-xs text-gray-600 dark:text-slate-300">
                                            <div className="flex items-center gap-1.5">
                                                <span className="font-mono">{app.engine || '—'}</span>
                                                <span className={`text-[11px] px-1 py-0.5 rounded font-medium ${STATUS_BADGE[formatApplicationScopeBadge(app)] || CONFIDENCE_BADGE.low}`}>
                                                    {formatApplicationScopeBadge(app)}
                                                </span>
                                            </div>
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
