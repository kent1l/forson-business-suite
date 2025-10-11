import { useState, useEffect } from 'react';
import api from '../api';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';

const PartApplicationManager = ({ part, onCancel }) => {
    const [linkedApps, setLinkedApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [currentLink, setCurrentLink] = useState(null);
    const [editForm, setEditForm] = useState({
        make: '',
        model: '',
        engine: '',
        notes: '',
        year_start: '',
        year_end: ''
    });
    const [formValues, setFormValues] = useState({
        make: '',
        model: '',
        engine: '',
        notes: '',
        year_start: '',
        year_end: ''
    });

    useEffect(() => {
        const run = async () => {
            if (!part) {
                setLinkedApps([]);
                resetForm();
                return;
            }

            setLoading(true);
            try {
                const linkedRes = await api.get(`/parts/${part.part_id}/applications`);
                setLinkedApps(linkedRes.data || []);
                resetForm();
            } catch (error) {
                console.error("Failed to fetch applications", error);
            } finally {
                setLoading(false);
            }
        };
        run();
    }, [part]);

    const resetForm = () => setFormValues({ make: '', model: '', engine: '', notes: '', year_start: '', year_end: '' });

    useEffect(() => {
        if (currentLink) {
            setEditForm({
                make: currentLink.make || '',
                model: currentLink.model || '',
                engine: currentLink.engine || '',
                notes: currentLink.notes || '',
                year_start: currentLink.year_start || '',
                year_end: currentLink.year_end || ''
            });
        }
    }, [currentLink]);

    const handleFieldChange = (field) => (e) => {
        const value = e.target.value;
        setFormValues(prev => ({ ...prev, [field]: value }));
    };

    const refetchData = async () => {
        if (part) {
            setLoading(true);
            try {
                const linkedRes = await api.get(`/parts/${part.part_id}/applications`);
                setLinkedApps(linkedRes.data || []);
                resetForm();
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

        if (!hasManualEntry) {
            alert('Please provide at least one of make, model, or engine.');
            return;
        }

        const payload = {
            make: trimmedMake || undefined,
            model: trimmedModel || undefined,
            engine: trimmedEngine || undefined,
            notes: trimmedNotes || undefined,
            year_start: formValues.year_start || null,
            year_end: formValues.year_end || null
        };

        try {
            await api.post(`/parts/${part.part_id}/applications`, payload);

            await refetchData();
            resetForm();
        } catch (error) {
            alert('Failed to link application: ' + (error.response?.data?.message || error.message));
            console.error(error);
        }
    };
    
    const handleUnlinkApp = async (link) => {
        try {
            await api.delete(`/parts/${part.part_id}/flexible-applications/${link.part_app_flex_id || link.link_id}`);
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

    const handleEditFieldChange = (field) => (e) => {
        const value = e.target.value;
        setEditForm(prev => ({ ...prev, [field]: value }));
    };

    const handleSaveApplication = async (link, values) => {
        try {
            await api.put(`/part-applications-flex/${link.part_app_flex_id || link.link_id}`, {
                make: values.make,
                model: values.model,
                engine: values.engine,
                notes: values.notes,
                year_start: values.year_start,
                year_end: values.year_end
            });
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
                                    <span className="inline-flex items-center rounded-full bg-gray-200 px-2 py-0.5 uppercase tracking-wide">flex</span>
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
                <form onSubmit={(e) => { e.preventDefault(); handleSaveApplication(currentLink, editForm); }} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
                        <input name="make" value={editForm.make} onChange={handleEditFieldChange('make')} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., Toyota" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                        <input name="model" value={editForm.model} onChange={handleEditFieldChange('model')} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., Hilux" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Engine</label>
                        <input name="engine" value={editForm.engine} onChange={handleEditFieldChange('engine')} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., 2.4L Diesel" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                        <textarea name="notes" value={editForm.notes} onChange={handleEditFieldChange('notes')} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="Optional notes or trim details" rows={2} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Year Start</label>
                            <input type="number" name="year_start" value={editForm.year_start} onChange={handleEditFieldChange('year_start')} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., 2010" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Year End</label>
                            <input type="number" name="year_end" value={editForm.year_end} onChange={handleEditFieldChange('year_end')} className="w-full px-3 py-2 border border-gray-300 rounded-lg" placeholder="e.g., 2015" />
                        </div>
                    </div>
                    <div className="mt-6 flex justify-end space-x-4">
                        <button type="button" onClick={() => setIsEditModalOpen(false)} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                        <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Changes</button>
                    </div>
                </form>
            </Modal>
        </div>
    );
};

export default PartApplicationManager;
