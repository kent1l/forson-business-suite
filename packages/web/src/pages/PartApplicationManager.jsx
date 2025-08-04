import React, { useState, useEffect } from 'react';
import axios from 'axios';
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
    const [allApps, setAllApps] = useState([]);
    const [newLinkData, setNewLinkData] = useState({ application_id: '', year_start: '', year_end: '' });
    const [loading, setLoading] = useState(true);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [currentLink, setCurrentLink] = useState(null);

    const fetchData = async () => {
        if (part) {
            setLoading(true);
            try {
                const [linkedRes, allRes] = await Promise.all([
                    axios.get(`http://localhost:3001/api/parts/${part.part_id}/applications`),
                    axios.get('http://localhost:3001/api/applications')
                ]);
                setLinkedApps(linkedRes.data);
                setAllApps(allRes.data);
            } catch (err) {
                console.error("Failed to fetch applications", err);
            } finally {
                setLoading(false);
            }
        }
    };

    useEffect(() => {
        fetchData();
    }, [part]);

    const handleLinkApp = async (e) => {
        e.preventDefault();
        if (!newLinkData.application_id) return;

        try {
            await axios.post(`http://localhost:3001/api/parts/${part.part_id}/applications`, newLinkData);
            fetchData();
            setNewLinkData({ application_id: '', year_start: '', year_end: '' });
        } catch (err) {
            alert('Failed to link application.');
            console.error(err);
        }
    };
    
    const handleUnlinkApp = async (applicationId) => {
        try {
            await axios.delete(`http://localhost:3001/api/parts/${part.part_id}/applications/${applicationId}`);
            fetchData();
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
            fetchData();
        } catch (err) {
            alert('Failed to update year range.');
        }
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
                                <span className="text-xs text-gray-500 ml-2">[{app.year_start || '...'} - {app.year_end || '...'}]</span>
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
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <select
                        value={newLinkData.application_id}
                        onChange={(e) => setNewLinkData(prev => ({...prev, application_id: e.target.value}))}
                        className="sm:col-span-3 w-full px-3 py-2 border border-gray-300 rounded-lg"
                    >
                        <option value="">Select a vehicle...</option>
                        {allApps.map(app => (
                            <option key={app.application_id} value={app.application_id}>
                                {app.make} {app.model} ({app.engine})
                            </option>
                        ))}
                    </select>
                     <input type="number" placeholder="Year Start" value={newLinkData.year_start} onChange={(e) => setNewLinkData(prev => ({...prev, year_start: e.target.value}))} className="px-3 py-2 border border-gray-300 rounded-lg" />
                     <input type="number" placeholder="Year End" value={newLinkData.year_end} onChange={(e) => setNewLinkData(prev => ({...prev, year_end: e.target.value}))} className="px-3 py-2 border border-gray-300 rounded-lg" />
                    <button type="submit" className="sm:col-span-3 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Link Application</button>
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
