import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

const PartApplicationManager = ({ part, onCancel }) => {
    const [linkedApps, setLinkedApps] = useState([]);
    const [allApps, setAllApps] = useState([]);
    const [selectedApp, setSelectedApp] = useState('');
    const [loading, setLoading] = useState(true);

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
        if (!selectedApp) return;

        try {
            await axios.post(`http://localhost:3001/api/parts/${part.part_id}/applications`, {
                application_id: selectedApp,
            });
            fetchData(); // Refresh the lists
            setSelectedApp('');
        } catch (err) {
            alert('Failed to link application.');
            console.error(err);
        }
    };
    
    const handleUnlinkApp = async (applicationId) => {
        try {
            await axios.delete(`http://localhost:3001/api/parts/${part.part_id}/applications/${applicationId}`);
            fetchData(); // Refresh the lists
        } catch (err) {
            alert('Failed to unlink application.');
            console.error(err);
        }
    };

    return (
        <div>
            <h3 className="text-md font-medium text-gray-800 mb-2">Linked Applications</h3>
            {loading ? <p>Loading...</p> : (
                <ul className="bg-gray-50 p-3 rounded-md mb-4 h-32 overflow-y-auto">
                    {linkedApps.map(app => (
                        <li key={app.part_app_id} className="text-sm flex justify-between items-center py-1">
                           <span>{app.make} {app.model} ({app.engine})</span>
                           <button onClick={() => handleUnlinkApp(app.application_id)} className="text-red-500 hover:text-red-700">
                               <Icon path={ICONS.trash} className="h-4 w-4" />
                           </button>
                        </li>
                    ))}
                    {linkedApps.length === 0 && <li className="text-sm text-gray-500">No applications linked yet.</li>}
                </ul>
            )}

            <form onSubmit={handleLinkApp}>
                <label className="block text-sm font-medium text-gray-700 mb-1">Link New Application</label>
                <div className="flex items-center space-x-2">
                    <select
                        value={selectedApp}
                        onChange={(e) => setSelectedApp(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                    >
                        <option value="">Select a vehicle...</option>
                        {allApps.map(app => (
                            <option key={app.application_id} value={app.application_id}>
                                {app.make} {app.model} ({app.engine})
                            </option>
                        ))}
                    </select>
                    <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Link</button>
                </div>
            </form>
             <div className="mt-6 flex justify-end">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Close</button>
            </div>
        </div>
    );
};

export default PartApplicationManager;
