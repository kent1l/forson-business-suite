import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';

const ApplicationForm = ({ application, onSave, onCancel }) => {
    const [formData, setFormData] = useState({ make: '', model: '', engine: '' });

    useEffect(() => {
        if (application) {
            setFormData(application);
        } else {
            setFormData({ make: '', model: '', engine: '' });
        }
    }, [application]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        onSave(formData);
    };

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Make</label>
                <input type="text" name="make" value={formData.make} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Model</label>
                <input type="text" name="model" value={formData.model} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Engine</label>
                <input type="text" name="engine" value={formData.engine} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
        </form>
    );
};

const ApplicationsPage = () => {
    const [applications, setApplications] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentApp, setCurrentApp] = useState(null);

    const fetchApplications = async () => {
        try {
            setError('');
            setLoading(true);
            const response = await axios.get('http://localhost:3001/api/applications');
            setApplications(response.data);
        } catch (err) {
            setError('Failed to fetch applications.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchApplications();
    }, []);

    const handleAdd = () => {
        setCurrentApp(null);
        setIsModalOpen(true);
    };

    const handleEdit = (app) => {
        setCurrentApp(app);
        setIsModalOpen(true);
    };

    const handleDelete = async (appId) => {
        if (window.confirm('Are you sure you want to delete this application?')) {
            try {
                await axios.delete(`http://localhost:3001/api/applications/${appId}`);
                fetchApplications();
            } catch (err) {
                alert(err.response?.data?.message || 'Failed to delete application.');
            }
        }
    };

    const handleSave = async (appData) => {
        try {
            if (currentApp) {
                await axios.put(`http://localhost:3001/api/applications/${currentApp.application_id}`, appData);
            } else {
                await axios.post('http://localhost:3001/api/applications', appData);
            }
            setIsModalOpen(false);
            fetchApplications();
        } catch (err) {
            alert('Failed to save application.');
        }
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800">Vehicle Applications</h1>
                <button onClick={handleAdd} className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                    Add Application
                </button>
            </div>
            <div className="bg-white p-6 rounded-xl border border-gray-200">
                {loading && <p>Loading applications...</p>}
                {error && <p className="text-red-500">{error}</p>}
                {!loading && !error && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b">
                                <tr>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Make</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Model</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600">Engine</th>
                                    <th className="p-3 text-sm font-semibold text-gray-600 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {applications.map(app => (
                                    <tr key={app.application_id} className="border-b hover:bg-gray-50">
                                        <td className="p-3 text-sm font-medium text-gray-800">{app.make}</td>
                                        <td className="p-3 text-sm">{app.model}</td>
                                        <td className="p-3 text-sm">{app.engine}</td>
                                        <td className="p-3 text-sm text-right">
                                            <button onClick={() => handleEdit(app)} className="text-blue-600 hover:text-blue-800 mr-4"><Icon path={ICONS.edit} className="h-5 w-5"/></button>
                                            <button onClick={() => handleDelete(app.application_id)} className="text-red-600 hover:text-red-800"><Icon path={ICONS.trash} className="h-5 w-5"/></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentApp ? 'Edit Application' : 'Add New Application'}>
                <ApplicationForm application={currentApp} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default ApplicationsPage;
