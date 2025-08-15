import React, { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const BackupSettings = ({ settings, handleChange, handleSave }) => {
    const [backups, setBackups] = useState([]);
    const [loading, setLoading] = useState(true);

    const fetchBackups = useCallback(async () => {
        try {
            setLoading(true);
            const response = await api.get('/backups');
            setBackups(response.data);
        } catch (error) {
            toast.error('Failed to fetch backup list.');
            console.error(error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchBackups();
    }, [fetchBackups]);

    const handleBackupNow = () => {
        const promise = api.post('/backups');
        toast.promise(promise, {
            loading: 'Starting on-demand backup...',
            success: (res) => {
                fetchBackups(); // Refresh the list after backup is created
                return res.data.message;
            },
            error: (err) => err.response?.data?.message || 'Failed to start backup.',
        });
    };

    const handleRestore = (filename) => {
        toast((t) => (
            <div className="text-center">
                <p className="font-bold">Restore Database?</p>
                <p className="text-sm my-2">
                    This will overwrite all current data with the selected backup. This action cannot be undone.
                </p>
                <div className="flex justify-center space-x-2 mt-4">
                    <button
                        onClick={() => {
                            toast.dismiss(t.id);
                            confirmRestore(filename);
                        }}
                        className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
                    >
                        Restore
                    </button>
                    <button
                        onClick={() => toast.dismiss(t.id)}
                        className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                    >
                        Cancel
                    </button>
                </div>
            </div>
        ), { duration: Infinity }); // Keep toast open until user interacts
    };

    const confirmRestore = (filename) => {
        const promise = api.post('/backups/restore', { filename });
        toast.promise(promise, {
            loading: `Restoring from ${filename}...`,
            success: (res) => `Restore successful! The application will now reload.`,
            error: (err) => err.response?.data?.message || 'Failed to restore backup.',
        });

        // Reload the page after a successful restore to reflect data changes
        promise.then(() => {
            setTimeout(() => window.location.reload(), 3000);
        });
    };

    const handleDelete = (filename) => {
        const promise = api.delete(`/backups/${filename}`);
        toast.promise(promise, {
            loading: `Deleting ${filename}...`,
            success: (res) => {
                fetchBackups(); // Refresh list
                return res.data.message;
            },
            error: (err) => err.response?.data?.message || 'Failed to delete backup.',
        });
    };

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-lg font-medium text-gray-900">Backup Configuration</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Retention (Days)</label>
                        <input
                            type="number"
                            name="BACKUP_RETENTION_DAYS"
                            value={settings.BACKUP_RETENTION_DAYS || '7'}
                            onChange={handleChange}
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                        />
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Backup Location (Read-only)</label>
                        <input
                            type="text"
                            value="/backups/"
                            readOnly
                            className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-100"
                        />
                    </div>
                </div>
            </div>

            <div>
                <h3 className="text-lg font-medium text-gray-900">Available Backups</h3>
                <div className="flex justify-end mb-4">
                    <button
                        onClick={handleBackupNow}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-blue-700 transition"
                    >
                        Backup Now
                    </button>
                </div>
                <div className="border rounded-lg overflow-hidden">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Filename</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date Created</th>
                                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loading ? (
                                <tr><td colSpan="3" className="text-center p-4">Loading backups...</td></tr>
                            ) : backups.length > 0 ? (
                                backups.map((backup) => (
                                    <tr key={backup.filename}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-mono text-gray-800">{backup.filename}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(backup.createdAt).toLocaleString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium space-x-4">
                                            <button onClick={() => handleRestore(backup.filename)} className="text-green-600 hover:text-green-900">Restore</button>
                                            <button onClick={() => handleDelete(backup.filename)} className="text-red-600 hover:text-red-900">Delete</button>
                                        </td>
                                    </tr>
                                ))
                            ) : (
                                <tr><td colSpan="3" className="text-center p-4 text-gray-500">No backups found.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default BackupSettings;
