import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import ApplicationSearchCombobox from '../components/applications/ApplicationSearchCombobox';
import NewApplicationModal from '../components/applications/NewApplicationModal';

const EditApplicationForm = ({ link, onSave, onCancel }) => {
    const isFlex = link?.source === 'flex';
    const [form, setForm] = useState({
        make: '',
        model: '',
        engine: '',
        notes: '',
        year_start: '',
        year_end: ''
    });

    const initialFormData = useMemo(() => {
        if (!link) {
            return { make: '', model: '', engine: '', notes: '', year_start: '', year_end: '' };
        }
        return {
            make: link.make || '',
            model: link.model || '',
            engine: link.engine || '',
            notes: link.notes || '',
            year_start: link.year_start || '',
            year_end: link.year_end || ''
        };
    }, [link]);

    useEffect(() => {
        setForm(initialFormData);
    }, [initialFormData]);

    const isFormDirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initialFormData), [form, initialFormData]);

    const isFormElement = (element) => element && ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setForm(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = useCallback((e) => {
        if (e) e.preventDefault();
        onSave(link, form);
    }, [link, form, onSave]);

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
            {isFlex && (
                <>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
                        <input name="make" value={form.make} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., Toyota" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                        <input name="model" value={form.model} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., Hilux" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Engine</label>
                        <input name="engine" value={form.engine} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., 2.4L Diesel" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                        <textarea name="notes" value={form.notes} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Optional notes or trim details" rows={2} />
                    </div>
                </>
            )}
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Year Start</label>
                    <input type="number" name="year_start" value={form.year_start} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., 2010" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Year End</label>
                    <input type="number" name="year_end" value={form.year_end} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., 2015" />
                </div>
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Changes</button>
            </div>
        </form>
    );
};

const PartApplicationManager = ({ part, onCancel }) => {
    const [linkedApps, setLinkedApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [currentLink, setCurrentLink] = useState(null);
    const [selectedApp, setSelectedApp] = useState(null);
    const [formValues, setFormValues] = useState({
        make: '',
        model: '',
        engine: '',
        notes: '',
        year_start: '',
        year_end: ''
    });
    const [showNewApp, setShowNewApp] = useState(false);
    const [appsRefreshKey, setAppsRefreshKey] = useState(0);

    useEffect(() => {
        const run = async () => {
            if (!part) {
                setLinkedApps([]);
                resetForm();
                setSelectedApp(null);
                return;
            }

            setLoading(true);
            try {
                const linkedRes = await api.get(`/parts/${part.part_id}/applications`);
                setLinkedApps(linkedRes.data || []);
                resetForm();
                setSelectedApp(null);
            } catch (error) {
                console.error("Failed to fetch applications", error);
            } finally {
                setLoading(false);
            }
        };
        run();
    }, [part]);

    useEffect(() => {
        if (selectedApp) {
            setFormValues(prev => ({
                ...prev,
                make: selectedApp.make || '',
                model: selectedApp.model || '',
                engine: selectedApp.engine || ''
            }));
        }
    }, [selectedApp]);

    const resetForm = () => setFormValues({ make: '', model: '', engine: '', notes: '', year_start: '', year_end: '' });

    const handleFieldChange = (field) => (e) => {
        const value = e.target.value;
        setFormValues(prev => ({ ...prev, [field]: value }));
        if (['make', 'model', 'engine'].includes(field) && selectedApp) {
            setSelectedApp(null);
        }
    };

    const refetchData = async () => {
        if (part) {
            setLoading(true);
            try {
                const linkedRes = await api.get(`/parts/${part.part_id}/applications`);
                setLinkedApps(linkedRes.data || []);
                resetForm();
                setSelectedApp(null);
            } catch (error) {
                console.error("Failed to fetch applications", error);
            } finally {
                setLoading(false);
            }
        }
    };

    const handleLinkApp = async (e) => {
        e.preventDefault();
        const trimmedMake = formValues.make.trim();
        const trimmedModel = formValues.model.trim();
        const trimmedEngine = formValues.engine.trim();
        const trimmedNotes = formValues.notes.trim();
        const hasManualEntry = trimmedMake || trimmedModel || trimmedEngine;

        if (!selectedApp?.application_id && !hasManualEntry) {
            alert('Please select an application or provide make/model/engine details.');
            return;
        }

        const payload = {
            year_start: formValues.year_start || null,
            year_end: formValues.year_end || null,
            notes: trimmedNotes || undefined
        };

        if (selectedApp?.application_id) {
            payload.application_id = selectedApp.application_id;
        }

        if (hasManualEntry) {
            payload.make = trimmedMake;
            payload.model = trimmedModel;
            payload.engine = trimmedEngine;
        }

        try {
            await api.post(`/parts/${part.part_id}/applications`, payload);

            await refetchData();
            setSelectedApp(null);
            resetForm();
        } catch (error) {
            alert('Failed to link application: ' + (error.response?.data?.message || error.message));
            console.error(error);
        }
    };
    
    const handleUnlinkApp = async (link) => {
        try {
            if (link.source === 'legacy') {
                await api.delete(`/parts/${part.part_id}/applications/${link.application_id}`);
            } else {
                await api.delete(`/parts/${part.part_id}/flexible-applications/${link.part_app_flex_id || link.link_id}`);
            }
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

    const handleSaveApplication = async (link, values) => {
        try {
            if (link.source === 'legacy') {
                await api.put(`/part-applications/${link.part_app_id}`, {
                    year_start: values.year_start || null,
                    year_end: values.year_end || null
                });
            } else {
                await api.put(`/part-applications-flex/${link.part_app_flex_id || link.link_id}`, {
                    make: values.make,
                    model: values.model,
                    engine: values.engine,
                    notes: values.notes,
                    year_start: values.year_start,
                    year_end: values.year_end
                });
            }
            setIsEditModalOpen(false);
            await refetchData();
        } catch (error) {
            console.error(error);
            alert('Failed to update application.');
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
                        <li key={app.link_id || app.part_app_id || app.part_app_flex_id} className="text-sm flex justify-between items-start py-2 border-b border-gray-200 last:border-b-0">
                           <div className="flex-1">
                                <div className="font-medium text-gray-800">
                                    {[app.make, app.model, app.engine].filter(Boolean).join(' ') || 'Unspecified application'}
                                </div>
                                <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                                    {app.source && (
                                        <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 uppercase tracking-wide">{app.source}</span>
                                    )}
                                    <span>{formatYearRange(app.year_start, app.year_end)}</span>
                                    {app.notes && <span className="italic text-gray-400">{app.notes}</span>}
                                </div>
                            </div>
                           <div className="flex items-center space-x-3 pl-4">
                               <button type="button" onClick={() => handleEditLink(app)} className="text-blue-600 hover:text-blue-800"><Icon path={ICONS.edit} className="h-4 w-4"/></button>
                               <button type="button" onClick={() => handleUnlinkApp(app)} className="text-red-500 hover:text-red-700"><Icon path={ICONS.trash} className="h-4 w-4"/></button>
                           </div>
                        </li>
                    ))}
                    {linkedApps.length === 0 && <li className="text-sm text-gray-500">No applications linked yet.</li>}
                </ul>
            )}

            <form onSubmit={handleLinkApp}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Link New Application</label>
                <div className="grid grid-cols-1 gap-2">
                    <div className="flex items-end gap-2">
                        <div className="flex-1">
                            <ApplicationSearchCombobox value={selectedApp} onChange={setSelectedApp} refreshKey={appsRefreshKey} />
                        </div>
                        <button type="button" onClick={() => setShowNewApp(true)} className="px-3 py-2 bg-gray-200 rounded-lg hover:bg-gray-300 flex items-center gap-1">
                            <Icon path={ICONS.plus} className="h-4 w-4" /> New
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
                            <input
                                type="text"
                                value={formValues.make}
                                onChange={handleFieldChange('make')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder="e.g., Toyota"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                            <input
                                type="text"
                                value={formValues.model}
                                onChange={handleFieldChange('model')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder="e.g., Hilux"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Engine</label>
                            <input
                                type="text"
                                value={formValues.engine}
                                onChange={handleFieldChange('engine')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                                placeholder="e.g., 2.4L Diesel"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes / Trim</label>
                        <textarea
                            value={formValues.notes}
                            onChange={handleFieldChange('notes')}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            rows={2}
                            placeholder="Optional notes or trim details"
                        />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Year Start</label>
                            <input
                                type="number"
                                placeholder="e.g., 2010"
                                value={formValues.year_start}
                                onChange={handleFieldChange('year_start')}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Year End</label>
                            <input
                                type="number"
                                placeholder="e.g., 2015"
                                value={formValues.year_end}
                                onChange={handleFieldChange('year_end')}
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
            <Modal
                isOpen={isEditModalOpen}
                onClose={() => setIsEditModalOpen(false)}
                title={`Edit ${[currentLink?.make, currentLink?.model, currentLink?.engine].filter(Boolean).join(' ') || 'Application'}`}
            >
                <EditApplicationForm link={currentLink} onSave={handleSaveApplication} onCancel={() => setIsEditModalOpen(false)} />
            </Modal>
            <NewApplicationModal
                isOpen={showNewApp}
                onClose={() => setShowNewApp(false)}
                onCreated={(app) => { setSelectedApp(app); setAppsRefreshKey(k => k + 1); }}
            />
        </div>
    );
};

export default PartApplicationManager;
