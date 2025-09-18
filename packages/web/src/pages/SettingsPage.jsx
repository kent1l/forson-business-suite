import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import BackupSettings from '../components/settings/BackupSettings';
import DataUtilsSettings from '../components/settings/DataUtilsSettings';
import PermissionsSettings from '../components/settings/PermissionsSettings'; // <-- NEW: Import the component
import PaymentMethodSettings from '../components/settings/PaymentMethodSettings';

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

const TaxRateSettings = ({ settings, handleChange }) => {
    const [taxRates, setTaxRates] = useState([]);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentRate, setCurrentRate] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchTaxRates = async () => {
        try {
            setLoading(true);
            const response = await api.get('/tax-rates');
            setTaxRates(response.data);
        } catch (error) {
            console.error('Failed to fetch tax rates:', error);
            toast.error('Failed to load tax rates.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTaxRates();
    }, []);

    const handleSave = async (rateData) => {
        // Validate rate data
        if (!rateData.rate_name || !rateData.rate_name.trim()) {
            toast.error('Rate name is required.');
            return;
        }
        
        // Convert rate_percentage to number and validate
        const ratePercentage = parseFloat(rateData.rate_percentage);
        if (isNaN(ratePercentage) || ratePercentage < 0 || ratePercentage > 1) {
            toast.error('Rate percentage must be a number between 0 and 1 (e.g., 0.12 for 12%).');
            return;
        }

        const validatedData = {
            ...rateData,
            rate_percentage: ratePercentage
        };

        try {
            currentRate
                ? await api.put(`/tax-rates/${currentRate.tax_rate_id}`, validatedData)
                : await api.post('/tax-rates', validatedData);
            
            setIsModalOpen(false);
            fetchTaxRates();
            toast.success('Tax rate saved successfully!');
        } catch (err) {
            console.error('Save tax rate error:', err);
            
            if (err.response?.status === 401) {
                toast.error('Authentication expired. Please log out and log back in.');
                return;
            }
            
            const errorMessage = err.response?.data?.message || 'Failed to save tax rate.';
            toast.error(errorMessage);
        }
    };

    const handleDelete = (rateId, rateName) => {
        if (!window.confirm(`Are you sure you want to delete the tax rate "${rateName}"? This action cannot be undone.`)) {
            return;
        }

        const promise = api.delete(`/tax-rates/${rateId}`);
        toast.promise(promise, {
            loading: 'Deleting tax rate...',
            success: () => {
                fetchTaxRates();
                return 'Tax rate deleted successfully!';
            },
            error: (err) => {
                console.error('Delete tax rate error:', err);
                return err.response?.data?.message || 'Failed to delete tax rate.';
            }
        });
    };

    const handleSetDefault = (rateId, rateName) => {
        const promise = api.put(`/tax-rates/${rateId}/set-default`);
        toast.promise(promise, {
            loading: 'Setting default tax rate...',
            success: () => {
                fetchTaxRates();
                return `"${rateName}" is now the default tax rate.`;
            },
            error: (err) => {
                console.error('Set default tax rate error:', err);
                return err.response?.data?.message || 'Failed to set default tax rate.';
            }
        });
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <div className="text-sm text-gray-500">Loading tax rates...</div>
            </div>
        );
    }

    return (
        <div>
            <div className="pb-4 mb-4 border-b">
                <div className="flex items-center">
                    <input 
                        type="checkbox" 
                        name="DEFAULT_IS_TAX_INCLUSIVE" 
                        id="default_is_tax_inclusive"
                        checked={settings.DEFAULT_IS_TAX_INCLUSIVE === 'true'} 
                        onChange={handleChange} 
                        className="h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500" 
                    />
                    <label htmlFor="default_is_tax_inclusive" className="ml-2 block text-sm text-gray-900">
                        New parts default to "Price is Tax Inclusive"
                    </label>
                </div>
                <p className="mt-1 text-xs text-gray-500">
                    When enabled, new parts will have tax-inclusive pricing by default. This setting does not affect existing parts.
                </p>
            </div>

            <div className="flex justify-between items-center mb-4">
                <div>
                    <p className="text-sm text-gray-600">Configure tax rates for your products and services.</p>
                    <p className="text-xs text-gray-500 mt-1">
                        {taxRates.length === 0 ? 'No tax rates configured.' : `${taxRates.length} tax rate(s) configured.`}
                    </p>
                </div>
                <button 
                    type="button" 
                    onClick={() => { setCurrentRate(null); setIsModalOpen(true); }} 
                    className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="Add new tax rate"
                >
                    Add Tax Rate
                </button>
            </div>

            {taxRates.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500 mb-3">No tax rates configured yet.</p>
                    <button 
                        type="button"
                        onClick={() => { setCurrentRate(null); setIsModalOpen(true); }}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                        Add your first tax rate
                    </button>
                </div>
            ) : (
                <div className="space-y-2">
                    {taxRates.map(rate => (
                        <div key={rate.tax_rate_id} className="flex items-center justify-between bg-gray-50 p-3 rounded-lg hover:bg-gray-100 transition-colors">
                            <div className="flex items-center">
                                <div>
                                    <span className="text-sm font-medium text-gray-900">{rate.rate_name}</span>
                                    <span className="ml-2 text-sm text-gray-600">({(rate.rate_percentage * 100).toFixed(2)}%)</span>
                                </div>
                                {rate.is_default && (
                                    <div className="ml-3 flex items-center">
                                        <Icon path={ICONS.star} className="h-4 w-4 text-yellow-500" />
                                        <span className="ml-1 text-xs text-yellow-700 font-medium">Default</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center space-x-2">
                                {!rate.is_default && (
                                    <button 
                                        onClick={() => handleSetDefault(rate.tax_rate_id, rate.rate_name)} 
                                        className="text-xs font-medium text-gray-600 hover:text-gray-900 px-2 py-1 rounded hover:bg-gray-200 transition-colors"
                                        title="Set as default tax rate"
                                    >
                                        Set Default
                                    </button>
                                )}
                                <button 
                                    onClick={() => { setCurrentRate(rate); setIsModalOpen(true); }} 
                                    className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50 transition-colors"
                                    title="Edit tax rate"
                                >
                                    <Icon path={ICONS.edit} className="h-4 w-4" />
                                </button>
                                <button 
                                    onClick={() => handleDelete(rate.tax_rate_id, rate.rate_name)} 
                                    className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                                    title="Delete tax rate"
                                    disabled={rate.is_default}
                                >
                                    <Icon path={ICONS.trash} className="h-4 w-4" />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentRate ? 'Edit Tax Rate' : 'Add New Tax Rate'}>
                <TaxRateForm rate={currentRate} onSave={handleSave} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

const TaxRateForm = ({ rate, onSave, onCancel }) => {
    const [formData, setFormData] = useState({ rate_name: '', rate_percentage: '' });

    const initialFormData = useMemo(() => {
        if (rate) {
            return { 
                rate_name: rate.rate_name || '', 
                rate_percentage: rate.rate_percentage ? rate.rate_percentage.toString() : '' 
            };
        } else {
            return { rate_name: '', rate_percentage: '' };
        }
    }, [rate]);

    const isFormDirty = useMemo(() => {
        return JSON.stringify(formData) !== JSON.stringify(initialFormData);
    }, [formData, initialFormData]);

    const isFormElement = (element) => {
        return element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT');
    };

    useEffect(() => {
        if (rate) {
            setFormData({ 
                rate_name: rate.rate_name || '', 
                rate_percentage: rate.rate_percentage ? rate.rate_percentage.toString() : '' 
            });
        } else {
            setFormData({ rate_name: '', rate_percentage: '' });
        }
    }, [rate]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        onSave(formData);
    }, [formData, onSave]);

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
                <label className="block text-sm font-medium text-gray-700 mb-1">Rate Name</label>
                <input type="text" name="rate_name" value={formData.rate_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rate Percentage (e.g., 0.12 for 12%)</label>
                <input 
                    type="number" 
                    step="0.01" 
                    min="0" 
                    max="1" 
                    name="rate_percentage" 
                    value={formData.rate_percentage} 
                    onChange={handleChange} 
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg" 
                    placeholder="0.12"
                    required 
                />
                {formData.rate_percentage && (
                    <p className="mt-1 text-xs text-gray-500">
                        This represents {(parseFloat(formData.rate_percentage) * 100).toFixed(2)}%
                    </p>
                )}
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
            } catch {
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
        const { name, value, type, checked } = e.target;
        setSettings(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? String(checked) : value
        }));
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
                {activeTab === 'payment_methods' ? (
                    <PaymentMethodSettings />
                ) : (
                    <div>
                        <div className="mb-6 border-b border-gray-200">
                            <nav className="-mb-px flex space-x-6">
                                <button type="button" onClick={() => setActiveTab('company')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'company' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Company Info</button>
                                <button type="button" onClick={() => setActiveTab('financial')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'financial' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Financial</button>
                                <button type="button" onClick={() => setActiveTab('payment_methods')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'payment_methods' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Payment Methods</button>
                                <button type="button" onClick={() => setActiveTab('tax_rates')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'tax_rates' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Tax Rates</button>
                                <button type="button" onClick={() => setActiveTab('permissions')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'permissions' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Roles & Permissions</button>
                                <button type="button" onClick={() => setActiveTab('backup')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'backup' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Backup & Restore</button>
                                <button type="button" onClick={() => setActiveTab('data')} className={`py-3 px-1 border-b-2 font-medium text-sm ${activeTab === 'data' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:border-gray-300'}`}>Data Utilities</button>
                            </nav>
                        </div>

                        {activeTab === 'company' && <CompanyInfoSettings settings={settings} handleChange={handleChange} />}
                        {activeTab === 'financial' && <FinancialSettings settings={settings} handleChange={handleChange} />}
                        {activeTab === 'tax_rates' && <TaxRateSettings settings={settings} handleChange={handleChange} />}
                        {activeTab === 'permissions' && <PermissionsSettings />}
                        {activeTab === 'backup' && <BackupSettings settings={settings} handleChange={handleChange} handleSave={handleSave} />}
                        {activeTab === 'data' && <DataUtilsSettings />}

                        {['company', 'financial', 'backup'].includes(activeTab) && (
                            <form onSubmit={handleSave}>
                                <div className="pt-4 flex justify-end mt-6 border-t">
                                    <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition">
                                        Save Settings
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default SettingsPage;
