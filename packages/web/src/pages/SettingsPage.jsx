import React, { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';

const CompanyInfoSettings = ({ settings, handleChange }) => (
    <div className="space-y-4">
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
    </div>
);

const FinancialSettings = ({ settings, handleChange }) => (
     <div className="space-y-4">
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
    </div>
);

const PaymentMethodsSettings = ({ settings, handleChange }) => {
    const paymentMethods = settings.PAYMENT_METHODS ? settings.PAYMENT_METHODS.split(',') : [];

    const handleAddMethod = () => {
        const newMethod = prompt('Enter new payment method:');
        if (newMethod && !paymentMethods.includes(newMethod)) {
            const updatedMethods = [...paymentMethods, newMethod].join(',');
            handleChange({ target: { name: 'PAYMENT_METHODS', value: updatedMethods } });
        }
    };

    const handleRemoveMethod = (methodToRemove) => {
        const updatedMethods = paymentMethods.filter(method => method !== methodToRemove).join(',');
        handleChange({ target: { name: 'PAYMENT_METHODS', value: updatedMethods } });
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-gray-600">Manage the payment options available during invoicing.</p>
                <button type="button" onClick={handleAddMethod} className="bg-gray-200 text-gray-800 px-3 py-1 rounded-lg text-sm font-semibold hover:bg-gray-300">Add Method</button>
            </div>
            <div className="space-y-2">
                {paymentMethods.map(method => (
                    <div key={method} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                        <span className="text-sm">{method}</span>
                        <button type="button" onClick={() => handleRemoveMethod(method)} className="text-red-500 hover:text-red-700 text-xs">Remove</button>
                    </div>
                ))}
            </div>
        </div>
    );
};


const SettingsPage = ({ user }) => {
    const [settings, setSettings] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('company');

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
            <div className="bg-white p-6 rounded-xl border border-gray-200 max-w-3xl">
                <form onSubmit={handleSave}>
                    <div className="mb-6 border-b border-gray-200">
                        <nav className="-mb-px flex space-x-6">
                            <button type="button" onClick={() => setActiveTab('company')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'company' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Company Info</button>
                            <button type="button" onClick={() => setActiveTab('financial')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'financial' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Financial</button>
                            <button type="button" onClick={() => setActiveTab('payments')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'payments' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Payment Methods</button>
                        </nav>
                    </div>

                    {activeTab === 'company' && <CompanyInfoSettings settings={settings} handleChange={handleChange} />}
                    {activeTab === 'financial' && <FinancialSettings settings={settings} handleChange={handleChange} />}
                    {activeTab === 'payments' && <PaymentMethodsSettings settings={settings} handleChange={handleChange} />}

                    <div className="pt-4 flex justify-end mt-6 border-t">
                        <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                            Save All Settings
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default SettingsPage;
