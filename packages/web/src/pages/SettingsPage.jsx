import React, { useState, useEffect } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import BackupSettings from '../components/settings/BackupSettings'; // 1. Import the new component

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
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Currency Symbol</label>
            <input type="text" name="DEFAULT_CURRENCY_SYMBOL" value={settings.DEFAULT_CURRENCY_SYMBOL} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Payment Terms</label>
            <input type="text" name="DEFAULT_PAYMENT_TERMS" value={settings.DEFAULT_PAYMENT_TERMS} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Invoice Footer Message</label>
            <textarea name="INVOICE_FOOTER_MESSAGE" value={settings.INVOICE_FOOTER_MESSAGE} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" rows="3"></textarea>
        </div>
    </div>
);

const TaxRateSettings = () => {
    const [taxRates, setTaxRates] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentRate, setCurrentRate] = useState(null);

    const fetchTaxRates = async () => {
        const response = await api.get('/tax-rates');
        setTaxRates(response.data);
    };

    useEffect(() => {
        fetchTaxRates();
    }, []);

    const handleSave = (rateData) => {
        const promise = currentRate
            ? api.put(`/tax-rates/${currentRate.tax_rate_id}`, rateData)
            : api.post('/tax-rates', rateData);
        
        toast.promise(promise, {
            loading: 'Saving tax rate...',
            success: () => {
                setIsModalOpen(false);
                fetchTaxRates();
                return 'Tax rate saved!';
            },
            error: 'Failed to save tax rate.'
        });
    };

    const handleDelete = (rateId) => {
        const promise = api.delete(`/tax-rates/${rateId}`);
        toast.promise(promise, {
            loading: 'Deleting tax rate...',
            success: () => {
                fetchTaxRates();
                return 'Tax rate deleted!';
            },
            error: (err) => err.response?.data?.message || 'Failed to delete.'
        });
    };

    const handleSetDefault = (rateId) => {
        const promise = api.put(`/tax-rates/${rateId}/set-default`);
        toast.promise(promise, {
            loading: 'Setting default...',
            success: () => {
                fetchTaxRates();
                return 'Default tax rate updated!';
            },
            error: 'Failed to set default.'
        });
    };

    return (
        <div>
            <div className="flex justify-between items-center mb-4">
                <p className="text-sm text-gray-600">Manage tax rates for your products.</p>
                <button type="button" onClick={() => { setCurrentRate(null); setIsModalOpen(true); }} className="bg-blue-600 text-white px-3 py-1 rounded-lg text-sm font-semibold hover:bg-blue-700">Add Rate</button>
            </div>
            <div className="space-y-2">
                {taxRates.map(rate => (
                    <div key={rate.tax_rate_id} className="flex items-center justify-between bg-gray-50 p-2 rounded-lg">
                        <div className="flex items-center">
                            <span className="text-sm font-medium">{rate.rate_name} ({(rate.rate_percentage * 100).toFixed(2)}%)</span>
                            {rate.is_default && (
                                <Icon path={ICONS.star} className="h-4 w-4 text-yellow-500 ml-2" />
                            )}
                        </div>
                        <div className="flex items-center space-x-3">
                            {!rate.is_default && (
                                <button onClick={() => handleSetDefault(rate.tax_rate_id)} className="text-xs font-semibold text-gray-600 hover:text-black">Set as Default</button>
                            )}
                            <button onClick={() => { setCurrentRate(rate); setIsModalOpen(true); }} className="text-blue-600 hover:text-blue-800"><Icon path={ICONS.edit} className="h-4 w-4" /></button>
                            <button onClick={() => handleDelete(rate.tax_rate_id)} className="text-red-500 hover:text-red-700"><Icon path={ICONS.trash} className="h-4 w-4" /></button>
                        </div>
                    </div>
                ))}
            </div>
            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentRate ? 'Edit Tax Rate' : 'Add New Tax Rate'}>
                <TaxRateForm rate={currentRate} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

const TaxRateForm = ({ rate, onSave, onCancel }) => {
    const [formData, setFormData] = useState({ rate_name: '', rate_percentage: '' });

    useEffect(() => {
        if (rate) {
            setFormData({ rate_name: rate.rate_name, rate_percentage: rate.rate_percentage });
        } else {
            setFormData({ rate_name: '', rate_percentage: '' });
        }
    }, [rate]);

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
                <label className="block text-sm font-medium text-gray-700 mb-1">Rate Name</label>
                <input type="text" name="rate_name" value={formData.rate_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rate Percentage (e.g., 0.12 for 12%)</label>
                <input type="number" step="0.0001" name="rate_percentage" value={formData.rate_percentage} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg">Save</button>
            </div>
        </form>
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
            <div className="bg-white p-6 rounded-xl border border-gray-200 max-w-4xl">
                <form onSubmit={handleSave}>
                    <div className="mb-6 border-b border-gray-200">
                        <nav className="-mb-px flex space-x-6">
                            <button type="button" onClick={() => setActiveTab('company')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'company' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Company Info</button>
                            <button type="button" onClick={() => setActiveTab('financial')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'financial' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Financial</button>
                            <button type="button" onClick={() => setActiveTab('tax_rates')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'tax_rates' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Tax Rates</button>
                            {/* 2. Add the new Backup & Restore tab */}
                            <button type="button" onClick={() => setActiveTab('backup')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'backup' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Backup & Restore</button>
                        </nav>
                    </div>

                    {activeTab === 'company' && <CompanyInfoSettings settings={settings} handleChange={handleChange} />}
                    {activeTab === 'financial' && <FinancialSettings settings={settings} handleChange={handleChange} />}
                    {activeTab === 'tax_rates' && <TaxRateSettings />}
                    {/* 3. Render the new component when its tab is active */}
                    {activeTab === 'backup' && <BackupSettings settings={settings} handleChange={handleChange} handleSave={handleSave} />}

                    {/* 4. Only show the "Save All" button for tabs that need it */}
                    {['company', 'financial'].includes(activeTab) && (
                        <div className="pt-4 flex justify-end mt-6 border-t">
                            <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                                Save Settings
                            </button>
                        </div>
                    )}
                </form>
            </div>
        </div>
    );
};

export default SettingsPage;
