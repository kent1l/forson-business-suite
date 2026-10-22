import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';
import { QrCode, ArrowLeft, X, Building2, Palette, FileText, Wallet, Percent, CreditCard, Receipt, Users, ClipboardList, BarChart3, Copy, ShieldCheck, DatabaseBackup, Database, Smartphone } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import BackupSettings from '../components/settings/BackupSettings';
import DataUtilsSettings from '../components/settings/DataUtilsSettings';
import PermissionsSettings from '../components/settings/PermissionsSettings'; // <-- NEW: Import the component
import PaymentMethodSettings from '../components/settings/PaymentMethodSettings';
import DeduplicationSettings from '../components/settings/DeduplicationSettings';
import BrandIdentitySettings from '../components/settings/BrandIdentitySettings';
import ARAdjustmentSettings from '../components/settings/ARAdjustmentSettings';
import AnalyticsSettings from '../components/settings/AnalyticsSettings';
import PhysicalDocumentSettings from '../components/settings/PhysicalDocumentSettings';

const MobileAppSettings = ({ settings, handleChange }) => {
    const [showQR, setShowQR] = useState(false);
    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Mobile App Version (OTA Update)</label>
                <input
                    type="text"
                    name="mobile_app_version"
                    value={settings.mobile_app_version || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                    placeholder="1.0.0"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                    Updating this version number will force all active mobile warehouse clients to download the latest `.apk` binary.
                </p>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1 mt-4">Release Notes (Optional)</label>
                <textarea
                    name="mobile_app_release_notes"
                    value={settings.mobile_app_release_notes || ''}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                    rows="3"
                    placeholder="Added new barcode scanning features..."
                ></textarea>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                    This message will be displayed on the update screen for all users.
                </p>
            </div>

            <div className="pt-4 border-t border-gray-200 dark:border-slate-700 mt-6">
                <h3 className="text-sm font-medium text-gray-700 dark:text-slate-300 mb-2">Device Provisioning</h3>
                <p className="text-xs text-gray-500 dark:text-slate-500 mb-3">
                    Generate a QR code that warehouse staff can scan to instantly access the mobile setup portal and download the app.
                </p>
                <button
                    type="button"
                    onClick={() => setShowQR(true)}
                    className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-slate-600 shadow-sm text-sm font-medium rounded-md text-gray-700 dark:text-slate-300 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                    <QrCode className="h-5 w-5 mr-2 text-gray-400 dark:text-slate-500" />
                    Show QR Code
                </button>
            </div>

            <Modal isOpen={showQR} onClose={() => setShowQR(false)} title="Provisioning QR Code">
                <div className="flex flex-col items-center justify-center p-6 text-center">
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 mb-4 inline-block">
                        <QRCodeSVG
                            value={`${window.location.origin}/mobile-setup`}
                            size={256}
                            level="H"
                            includeMargin={true}
                        />
                    </div>
                    <h4 className="text-lg font-bold text-gray-900 dark:text-slate-100 mb-1">Scan to Install</h4>
                    <p className="text-sm text-gray-500 dark:text-slate-500">
                        Point a device camera at this QR code to open the OTA download portal.
                    </p>
                    <div className="mt-6 bg-gray-50 dark:bg-slate-900 rounded px-4 py-2 text-xs font-mono text-gray-600 dark:text-slate-400 border border-gray-200 dark:border-slate-700 w-full truncate">
                        {`${window.location.origin}/mobile-setup`}
                    </div>
                </div>
            </Modal>
        </div>
    );
};

const CompanyInfoSettings = ({ settings, handleChange }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4 items-start">
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Company Name</label>
            <input type="text" name="COMPANY_NAME" value={settings.COMPANY_NAME} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Company Address</label>
            <input type="text" name="COMPANY_ADDRESS" value={settings.COMPANY_ADDRESS} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
        </div>
        <div className="contents">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Company Phone</label>
                <input type="text" name="COMPANY_PHONE" value={settings.COMPANY_PHONE} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Company Email</label>
                <input type="email" name="COMPANY_EMAIL" value={settings.COMPANY_EMAIL} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
        </div>
        <div className="contents">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Company Website</label>
                <input type="text" name="COMPANY_WEBSITE" value={settings.COMPANY_WEBSITE || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" placeholder="https://forson.ph" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Tax Identification No. (TIN)</label>
                <input type="text" name="COMPANY_TIN" value={settings.COMPANY_TIN || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" placeholder="123-456-789-000" />
            </div>
        </div>
        <div className="contents">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Remittance Bank Name</label>
                <input type="text" name="COMPANY_BANK_NAME" value={settings.COMPANY_BANK_NAME || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" placeholder="BDO Unibank, Inc." />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Remittance Bank Account #</label>
                <input type="text" name="COMPANY_BANK_ACCOUNT" value={settings.COMPANY_BANK_ACCOUNT || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" placeholder="00-1234-5678-90" />
            </div>
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Application Timezone</label>
            <select
                name="APP_TIMEZONE"
                value={settings.APP_TIMEZONE || 'Asia/Manila'}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 dark:text-slate-100"
            >
                <option value="Asia/Manila">Asia/Manila (PHT, UTC+8)</option>
                <option value="Asia/Singapore">Asia/Singapore (SGT, UTC+8)</option>
                <option value="Asia/Tokyo">Asia/Tokyo (JST, UTC+9)</option>
                <option value="Asia/Hong_Kong">Asia/Hong_Kong (HKT, UTC+8)</option>
                <option value="UTC">UTC (Coordinated Universal Time, UTC+0)</option>
                <option value="Europe/London">Europe/London (GMT/BST, UTC+0/+1)</option>
                <option value="Europe/Berlin">Europe/Berlin (CET/CEST, UTC+1/+2)</option>
                <option value="America/New_York">America/New_York (EST/EDT, UTC-5/-4)</option>
                <option value="America/Chicago">America/Chicago (CST/CDT, UTC-6/-5)</option>
                <option value="America/Denver">America/Denver (MST/MDT, UTC-7/-6)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (PST/PDT, UTC-8/-7)</option>
                <option value="Australia/Sydney">Australia/Sydney (AEST/AEDT, UTC+10/+11)</option>
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">Configures the default timezone used for reports, backups, and scheduler logs.</p>
        </div>
    </div>
);

// Picker for a payment-terms setting that stores a human-readable label
// (e.g. "30 days", "Due on receipt") -- the same string is printed verbatim
// on Statements of Account, so it can't be collapsed to a bare day count.
// Falls back to free text for a label that doesn't match any configured
// payment_term row, mirroring the select+custom pattern on InvoicingPage.
const PaymentTermsPicker = ({ label, name, value, onChange, terms, infoTip }) => {
    const termNames = terms.map(t => t.term_name);
    const isKnown = termNames.includes(value);
    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                {label}
                {infoTip && <InfoTip label={label}>{infoTip}</InfoTip>}
            </label>
            <div className="flex items-center space-x-3">
                <select
                    value={isKnown ? value : 'custom'}
                    onChange={e => e.target.value !== 'custom' && onChange({ target: { name, value: e.target.value } })}
                    className="px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                >
                    {terms.map(t => <option key={t.payment_term_id} value={t.term_name}>{t.term_name}</option>)}
                    <option value="custom">Custom...</option>
                </select>
                <input
                    type="text"
                    name={name}
                    value={value || ''}
                    onChange={onChange}
                    className="flex-1 px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                    placeholder="e.g., 30 days"
                />
            </div>
        </div>
    );
};

const FinancialSettings = ({ settings, handleChange }) => {
    const [paymentTerms, setPaymentTerms] = useState([]);

    useEffect(() => {
        api.get('/payment-terms')
            .then(res => setPaymentTerms(res.data || []))
            .catch(err => console.error('Failed to fetch payment terms', err.message));
    }, []);

    return (
        <div className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Currency Symbol</label>
                <input type="text" name="DEFAULT_CURRENCY_SYMBOL" value={settings.DEFAULT_CURRENCY_SYMBOL} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
            <PaymentTermsPicker
                label="Default Payment Terms"
                name="DEFAULT_PAYMENT_TERMS"
                value={settings.DEFAULT_PAYMENT_TERMS}
                onChange={handleChange}
                terms={paymentTerms}
                infoTip="Pre-selected in the Payment Terms field when the Invoicing page loads a new sale."
            />
            <PaymentTermsPicker
                label="Default On Account Payment Terms"
                name="DEFAULT_ON_ACCOUNT_PAYMENT_TERMS"
                value={settings.DEFAULT_ON_ACCOUNT_PAYMENT_TERMS}
                onChange={handleChange}
                terms={paymentTerms}
                infoTip="Applied to the Payment Terms field when a sale is paid On Account instead of the general default above."
            />
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Invoice Footer Message</label>
                <textarea name="INVOICE_FOOTER_MESSAGE" value={settings.INVOICE_FOOTER_MESSAGE} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" rows="3"></textarea>
            </div>
        </div>
    );
};

const PayrollSettings = ({ settings, handleChange }) => (
    <div className="space-y-4">
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                Statutory Deduction Schedule
                <InfoTip label="Statutory Deduction Schedule">
                    Determines how monthly statutory contributions (SSS, PhilHealth, Pag-IBIG) are split across semi-monthly cutoffs.
                </InfoTip>
            </label>
            <select
                name="PAYROLL_STATUTORY_SCHEDULE"
                value={settings.PAYROLL_STATUTORY_SCHEDULE || 'SPLIT_HALF'}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 rounded-lg"
            >
                <option value="SPLIT_HALF">Split Evenly (Half on 1st &amp; 2nd Cutoff)</option>
                <option value="FIRST_CUTOFF">1st Cutoff Only (Full deduction on 1st cutoff)</option>
                <option value="SECOND_CUTOFF">2nd Cutoff Only (Full deduction on 2nd cutoff)</option>
            </select>
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                Split evenly deducts 50% per cutoff. Choose 1st or 2nd Cutoff Only to deduct 100% on that cutoff.
            </p>
        </div>
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">
                Annual Working Days Divisor
            </label>
            <input
                type="number"
                name="PAYROLL_WORKING_DAYS_PER_YEAR"
                value={settings.PAYROLL_WORKING_DAYS_PER_YEAR || '313'}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 dark:text-slate-100 rounded-lg"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                Divisor converting daily rates to monthly basis for statutory lookups (default: 313 days/year).
            </p>
        </div>
    </div>
);

const CycleCountSettings = ({ settings, handleChange }) => (
    <div className="space-y-4">
        <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Enable Cycle Counting</label>
            <div className="mt-2 flex items-center">
                <input
                    type="checkbox"
                    name="CYCLE_COUNT_ENABLED"
                    checked={settings.CYCLE_COUNT_ENABLED === 'true'}
                    onChange={(e) => handleChange({ target: { name: 'CYCLE_COUNT_ENABLED', value: e.target.checked ? 'true' : 'false' } })}
                    className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 dark:border-slate-600 rounded"
                />
                <span className="ml-2 text-sm text-gray-600 dark:text-slate-300">Turn on automated nightly task generation</span>
            </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Schedule (CRON format)</label>
                <input type="text" name="CYCLE_COUNT_SCHEDULE" value={settings.CYCLE_COUNT_SCHEDULE || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" placeholder="0 2 * * *" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Items Per Batch</label>
                <input type="number" name="CYCLE_COUNT_BATCH_SIZE" value={settings.CYCLE_COUNT_BATCH_SIZE || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Days-until-count weight</label>
                <input type="number" name="CYCLE_COUNT_UNCOUNTED_WEIGHT" value={settings.CYCLE_COUNT_UNCOUNTED_WEIGHT || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Sales velocity weight (30d)</label>
                <input type="number" name="CYCLE_COUNT_VELOCITY_WEIGHT" value={settings.CYCLE_COUNT_VELOCITY_WEIGHT || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Cost weight</label>
                <input type="number" step="0.001" min="0" name="CYCLE_COUNT_COST_WEIGHT" value={settings.CYCLE_COUNT_COST_WEIGHT || '0.01'} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Adjustment risk multiplier</label>
                <input type="number" step="0.1" min="1" name="CYCLE_COUNT_ADJUSTMENT_MULTIPLIER" value={settings.CYCLE_COUNT_ADJUSTMENT_MULTIPLIER || '2'} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Points for negative stock</label>
                <input type="number" name="CYCLE_COUNT_NEGATIVE_STOCK_WEIGHT" value={settings.CYCLE_COUNT_NEGATIVE_STOCK_WEIGHT || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Auto-Approve Max Variance Qty</label>
                <input type="number" name="CYCLE_COUNT_MAX_VARIANCE_QTY" value={settings.CYCLE_COUNT_MAX_VARIANCE_QTY || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                    Auto-Approve Max Financial Impact
                    <InfoTip label="Auto-Approve Max Financial Impact">
                        Count discrepancies at or below this dollar amount are applied to inventory automatically, with no human review. Set this conservatively — a high number here lets bigger count errors slip through unnoticed.
                    </InfoTip>
                </label>
                <input type="number" step="0.01" name="CYCLE_COUNT_MAX_FINANCIAL_IMPACT" value={settings.CYCLE_COUNT_MAX_FINANCIAL_IMPACT || ''} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" />
            </div>
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
                <div className="text-sm text-gray-500 dark:text-slate-500">Loading tax rates...</div>
            </div>
        );
    }

    return (
        <div>
            <div className="pb-4 mb-4 border-b border-gray-200 dark:border-slate-700">
                <div className="flex items-center">
                    <input
                        type="checkbox"
                        name="DEFAULT_IS_TAX_INCLUSIVE"
                        id="default_is_tax_inclusive"
                        checked={settings.DEFAULT_IS_TAX_INCLUSIVE === 'true'}
                        onChange={handleChange}
                        className="h-4 w-4 text-primary-600 border-gray-300 dark:border-slate-600 rounded focus:ring-primary-500"
                    />
                    <label htmlFor="default_is_tax_inclusive" className="ml-2 block text-sm text-gray-900 dark:text-slate-100">
                        New parts default to "Price is Tax Inclusive"
                    </label>
                </div>
                <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                    When enabled, new parts will have tax-inclusive pricing by default. This setting does not affect existing parts.
                </p>
            </div>

            <div className="flex justify-between items-center mb-4">
                <div>
                    <p className="text-sm text-gray-600 dark:text-slate-300">Configure tax rates for your products and services.</p>
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">
                        {taxRates.length === 0 ? 'No tax rates configured.' : `${taxRates.length} tax rate(s) configured.`}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => { setCurrentRate(null); setIsModalOpen(true); }}
                    className="bg-primary-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary-700 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500"
                    aria-label="Add new tax rate"
                >
                    Add Tax Rate
                </button>
            </div>

            {taxRates.length === 0 ? (
                <div className="text-center py-8 bg-gray-50 dark:bg-slate-900 rounded-lg">
                    <p className="text-sm text-gray-500 dark:text-slate-500 mb-3">No tax rates configured yet.</p>
                    <button
                        type="button"
                        onClick={() => { setCurrentRate(null); setIsModalOpen(true); }}
                        className="text-primary-600 dark:text-primary-500 hover:text-primary-700 dark:hover:text-primary-600 text-sm font-medium"
                    >
                        Add your first tax rate
                    </button>
                </div>
            ) : (
                <div className="space-y-2">
                    {taxRates.map(rate => (
                        <div key={rate.tax_rate_id} className="flex items-center justify-between bg-gray-50 dark:bg-slate-900 p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors">
                            <div className="flex items-center">
                                <div>
                                    <span className="text-sm font-medium text-gray-900 dark:text-slate-100">{rate.rate_name}</span>
                                    <span className="ml-2 text-sm text-gray-600 dark:text-slate-400">({(rate.rate_percentage * 100).toFixed(2)}%)</span>
                                </div>
                                {rate.is_default && (
                                    <div className="ml-3 flex items-center">
                                        <Icon path={ICONS.star} className="h-4 w-4 text-yellow-500" />
                                        <span className="ml-1 text-xs text-yellow-700 dark:text-warning-500 font-medium">Default</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex items-center space-x-2">
                                {!rate.is_default && (
                                    <button
                                        onClick={() => handleSetDefault(rate.tax_rate_id, rate.rate_name)}
                                        className="text-xs font-medium text-gray-600 dark:text-slate-300 hover:text-gray-900 dark:hover:text-slate-100 px-2 py-1 rounded hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors"
                                        title="Set as default tax rate"
                                    >
                                        Set Default
                                    </button>
                                )}
                                <button
                                    onClick={() => { setCurrentRate(rate); setIsModalOpen(true); }}
                                    className="text-primary-600 dark:text-primary-500 hover:text-primary-700 dark:hover:text-primary-600 p-1 rounded hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors"
                                    title="Edit tax rate"
                                >
                                    <Icon path={ICONS.edit} className="h-4 w-4" />
                                </button>
                                <button
                                    onClick={() => handleDelete(rate.tax_rate_id, rate.rate_name)}
                                    className="text-danger-500 hover:text-danger-700 p-1 rounded hover:bg-danger-50 dark:hover:bg-danger-900/30 transition-colors"
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
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Rate Name</label>
                <input type="text" name="rate_name" value={formData.rate_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                    Rate Percentage (e.g., 0.12 for 12%)
                    <InfoTip label="Rate Percentage">
                        Enter this as a decimal fraction of 1, not a whole-number percentage — 12% is <code>0.12</code>, not <code>12</code>. This value feeds directly into pricing and invoice totals shown to customers.
                    </InfoTip>
                </label>
                <input
                    type="number"
                    step="0.01"
                    min="0"
                    max="1"
                    name="rate_percentage"
                    value={formData.rate_percentage}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg"
                    placeholder="0.12"
                    required
                />
                {formData.rate_percentage && (
                    <p className="mt-1 text-xs text-gray-500 dark:text-slate-500">
                        This represents {(parseFloat(formData.rate_percentage) * 100).toFixed(2)}%
                    </p>
                )}
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg">Save</button>
            </div>
        </form>
    );
};


const SETTINGS_NAV = [
    { group: 'General', items: [
        { id: 'company', label: 'Company Info', icon: Building2 },
        { id: 'brand_identity', label: 'Brand Identity', icon: Palette },
        { id: 'physical_documents', label: 'Physical Documents', icon: FileText },
    ] },
    { group: 'Finance', items: [
        { id: 'financial', label: 'Financial', icon: Wallet },
        { id: 'tax_rates', label: 'Tax Rates', icon: Percent },
        { id: 'payment_methods', label: 'Payment Methods', icon: CreditCard },
        { id: 'ar_adjustments', label: 'A/R Concessions', icon: Receipt },
        { id: 'payroll', label: 'Payroll', icon: Users },
    ] },
    { group: 'Operations', items: [
        { id: 'cycle_count', label: 'Cycle Count', icon: ClipboardList },
        { id: 'analytics', label: 'Analytics', icon: BarChart3 },
        { id: 'deduplication', label: 'Deduplication', icon: Copy },
    ] },
    { group: 'System', items: [
        { id: 'permissions', label: 'Permissions', icon: ShieldCheck },
        { id: 'backup', label: 'Backup', icon: DatabaseBackup },
        { id: 'data', label: 'Data Utilities', icon: Database },
        { id: 'mobile_app', label: 'Mobile App', icon: Smartphone },
    ] },
];

const SettingsPage = ({ user, onNavigate }) => {
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
            error: (err) => err.response?.data?.message || 'Failed to save settings.',
        });
        return promise;
    };

    if (user.permission_level_id !== 10) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-danger-600">Access Denied</h1>
                <p className="text-gray-600 dark:text-slate-300 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    if (loading) {
        return <p className="text-gray-700 dark:text-slate-300">Loading settings...</p>;
    }

    const activeItem = SETTINGS_NAV.flatMap(g => g.items).find(t => t.id === activeTab);
    const showSave = ['company', 'financial', 'payroll', 'cycle_count', 'backup', 'mobile_app', 'ar_adjustments', 'analytics'].includes(activeTab);
    const handleBack = () => onNavigate?.('dashboard');

    const panels = {
        company: <CompanyInfoSettings settings={settings} handleChange={handleChange} />,
        brand_identity: <BrandIdentitySettings settings={settings} handleChange={handleChange} handleSave={handleSave} />,
        financial: <FinancialSettings settings={settings} handleChange={handleChange} />,
        payroll: <PayrollSettings settings={settings} handleChange={handleChange} />,
        tax_rates: <TaxRateSettings settings={settings} handleChange={handleChange} />,
        payment_methods: <PaymentMethodSettings />,
        physical_documents: <PhysicalDocumentSettings />,
        ar_adjustments: <ARAdjustmentSettings settings={settings} handleChange={handleChange} />,
        analytics: <AnalyticsSettings settings={settings} handleChange={handleChange} />,
        cycle_count: <CycleCountSettings settings={settings} handleChange={handleChange} />,
        deduplication: <DeduplicationSettings />,
        permissions: <PermissionsSettings />,
        backup: <BackupSettings settings={settings} handleChange={handleChange} handleSave={handleSave} />,
        data: <DataUtilsSettings />,
        mobile_app: <MobileAppSettings settings={settings} handleChange={handleChange} />,
    };

    const navBtn = (t, mobile) => {
        const NavIcon = t.icon;
        const active = activeTab === t.id;
        return (
            <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg text-sm font-medium transition whitespace-nowrap ${mobile ? 'px-3 py-2 shrink-0' : 'w-full px-3 py-2 text-left'} ${active
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-400'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-slate-400 dark:hover:bg-slate-700/50'}`}
            >
                <NavIcon size={16} className="shrink-0" />
                {t.label}
            </button>
        );
    };

    return (
        <div className="w-full settings-enter">
            <div className="flex items-center gap-3 mb-6">
                <button
                    type="button"
                    onClick={handleBack}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 text-sm font-medium text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition"
                >
                    <ArrowLeft size={16} /> Back
                </button>
                <div>
                    <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100 leading-tight">Application Settings</h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400">Manage your company, finance, system and security preferences.</p>
                </div>
            </div>

            <div className="flex flex-col lg:flex-row gap-6 items-start">
                {/* Mobile / tablet: horizontal scroll pills */}
                <nav className="lg:hidden w-full flex gap-1 overflow-x-auto pb-1" aria-label="Settings sections">
                    {SETTINGS_NAV.flatMap(g => g.items).map(t => navBtn(t, true))}
                </nav>
                {/* Desktop: grouped sidebar */}
                <nav className="hidden lg:block w-64 shrink-0 sticky top-4 space-y-5 bg-white dark:bg-slate-800 p-3 rounded-xl border border-gray-200 dark:border-slate-700 max-h-[calc(100vh-2rem)] overflow-y-auto" aria-label="Settings sections">
                    {SETTINGS_NAV.map(g => (
                        <div key={g.group}>
                            <p className="px-3 mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-slate-500">{g.group}</p>
                            <div className="space-y-0.5">{g.items.map(t => navBtn(t, false))}</div>
                        </div>
                    ))}
                </nav>

                <section className="flex-1 min-w-0 w-full bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
                    <header className="flex items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 py-4 border-b border-gray-200 dark:border-slate-700">
                        <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">{activeItem?.label}</h2>
                        <button type="button" onClick={handleBack} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-100" title="Exit settings">
                            <X size={16} /> Exit
                        </button>
                    </header>
                    <div key={activeTab} className="p-4 sm:p-6 lg:p-8 settings-panel-in">{panels[activeTab]}</div>
                    {showSave && (
                        <form onSubmit={handleSave} className="sticky bottom-0 flex justify-end gap-3 px-4 sm:px-6 lg:px-8 py-3 border-t border-gray-200 dark:border-slate-700 bg-white/90 dark:bg-slate-800/90 backdrop-blur rounded-b-xl">
                            <button type="button" onClick={handleBack} className="px-5 py-2 rounded-lg border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-100 dark:hover:bg-slate-700 transition">Cancel</button>
                            <button type="submit" className="bg-primary-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-primary-700 transition">Save Settings</button>
                        </form>
                    )}
                </section>
            </div>
        </div>
    );
};

export default SettingsPage;
