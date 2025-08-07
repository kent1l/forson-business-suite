import React, { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

const SettingsPage = ({ user }) => {
    const [settings, setSettings] = useState({
        COMPANY_NAME: '',
        COMPANY_ADDRESS: '',
        COMPANY_PHONE: '',
        COMPANY_EMAIL: '',
        COMPANY_WEBSITE: '',
        DEFAULT_TAX_RATE: '',
        INVOICE_FOOTER_MESSAGE: '',
        DEFAULT_CURRENCY_SYMBOL: ''
    });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSettings = async () => {
            try {
                setLoading(true);
                const response = await api.get('/settings');
                setSettings(response.data);
            } catch (err) {
                toast.error('Failed to load settings.');
            } finally {
                setLoading(false);
            }
        };

        if (user.permission_level_id === 10) {
            fetchSettings();
        }
    }, [user.permission_level_id]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setSettings(prev => ({ ...prev, [name]: value }));
    };

    const handleSave = async (e) => {
        e.preventDefault();
        const promise = api.put('/settings', settings);
        toast.promise(promise, {
            loading: 'Saving settings...',
            success: 'Settings saved successfully!',
            error: 'Failed to save settings.',
        });
    };

    if (user.permission_level_id !== 10) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-red-600">Access Denied</h1>
                <p className="text-gray-600 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    if (loading) {
        return <p>Loading settings...</p>;
    }

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 mb-6">Application Settings</h1>
            <div className="bg-white p-6 rounded-xl border border-gray-200 max-w-2xl">
                <form onSubmit={handleSave} className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-900 border-b pb-2">Company Information</h3>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Company Name</label>
                        <input type="text" name="COMPANY_NAME" value={settings.COMPANY_NAME} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Company Address</label>
                        <input type="text" name="COMPANY_ADDRESS" value={settings.COMPANY_ADDRESS} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Company Phone</label>
                            <input type="text" name="COMPANY_PHONE" value={settings.COMPANY_PHONE} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Company Email</label>
                            <input type="email" name="COMPANY_EMAIL" value={settings.COMPANY_EMAIL} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                        </div>
                    </div>
                     <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Company Website</label>
                        <input type="text" name="COMPANY_WEBSITE" value={settings.COMPANY_WEBSITE} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                    </div>

                    <h3 className="text-lg font-medium text-gray-900 border-b pb-2 pt-4">Financial Settings</h3>
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Default Tax Rate</label>
                            <input type="number" step="0.01" name="DEFAULT_TAX_RATE" value={settings.DEFAULT_TAX_RATE} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Currency Symbol</label>
                            <input type="text" name="DEFAULT_CURRENCY_SYMBOL" value={settings.DEFAULT_CURRENCY_SYMBOL} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Footer Message</label>
                        <textarea name="INVOICE_FOOTER_MESSAGE" value={settings.INVOICE_FOOTER_MESSAGE} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows="3"></textarea>
                    </div>

                    <div className="pt-4 flex justify-end">
                        <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                            Save Settings
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SettingsPage;
