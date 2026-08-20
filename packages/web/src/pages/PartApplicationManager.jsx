import { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';
import Modal from '../components/ui/Modal';
import ApplicationSearchCombobox from '../components/applications/ApplicationSearchCombobox';
import NewApplicationModal from '../components/applications/NewApplicationModal';

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
    const [linkedApps, setLinkedApps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [currentLink, setCurrentLink] = useState(null);
    const [selectedApp, setSelectedApp] = useState(null);
    const [yearStart, setYearStart] = useState('');
    const [yearEnd, setYearEnd] = useState('');
    const [showNewApp, setShowNewApp] = useState(false);
    const [appsRefreshKey, setAppsRefreshKey] = useState(0);

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
        try {
            await api.delete(`/parts/${part.part_id}/applications/${applicationId}`);
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
                    {linkedApps.map(app => (
                        <li key={app.part_app_id} className="text-sm flex justify-between items-center py-2 text-gray-900 dark:text-slate-100">
                           <div>
                                <span className="font-medium">{app.make} {app.model} {app.engine ? `(${app.engine})` : ''}</span>
                                <span className="text-xs text-gray-500 dark:text-slate-400 font-mono ml-2">{formatYearRange(app.year_start, app.year_end)}</span>
                           </div>
                           <div className="flex items-center space-x-3">
                               <button onClick={() => handleEditLink(app)} className="text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 p-1" title="Edit Years"><Icon path={ICONS.edit} className="h-4 w-4"/></button>
                               <button onClick={() => handleUnlinkApp(app.application_id)} className="text-danger-600 dark:text-danger-400 hover:text-danger-700 dark:hover:text-danger-300 p-1" title="Unlink"><Icon path={ICONS.trash} className="h-4 w-4"/></button>
                           </div>
                        </li>
                    ))}
                    {linkedApps.length === 0 && <li className="text-sm text-gray-500 dark:text-slate-400 py-4 text-center">No applications linked yet.</li>}
                </ul>
            )}

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
             <div className="mt-6 flex justify-end pt-4 border-t border-gray-200 dark:border-slate-700">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors">Close</button>
            </div>
            <Modal isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} title={`Edit Year Range for ${currentLink?.make} ${currentLink?.model}`}>
                <EditYearForm link={currentLink} onSave={handleSaveYears} onCancel={() => setIsEditModalOpen(false)} />
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
