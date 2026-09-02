import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api';
import TagInput from '../ui/TagInput'; // Corrected Path
import InfoTip from '../ui/InfoTip';

const CustomerForm = ({ customer, onSave, onCancel }) => {
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        company_name: '',
        phone: '',
        email: '',
        address: '',
        is_active: true,
        tin: '',
        registered_name: '',
        is_withholding_agent: false,
        customer_type: 'PRIVATE',
    });
    const [tags, setTags] = useState([]);

    const initialFormData = useMemo(() => ({
        first_name: customer?.first_name || '',
        last_name: customer?.last_name || '',
        company_name: customer?.company_name || '',
        phone: customer?.phone || '',
        email: customer?.email || '',
        address: customer?.address || '',
        is_active: customer?.is_active ?? true,
        tin: customer?.tin || '',
        registered_name: customer?.registered_name || '',
        is_withholding_agent: customer?.is_withholding_agent ?? false,
        customer_type: customer?.customer_type || 'PRIVATE',
    }), [customer]);

    const isFormDirty = useMemo(() => {
        const keys = Object.keys(formData);
        for (let key of keys) {
            if (formData[key] !== initialFormData[key]) return true;
        }
        if (JSON.stringify(tags) !== JSON.stringify([])) return true;
        return false;
    }, [formData, initialFormData, tags]);

    const isFormElement = (el) => {
        if (!el) return false;
        const tag = el.tagName;
        return /INPUT|TEXTAREA|SELECT/.test(tag) || el.isContentEditable;
    };

    useEffect(() => {
        if (customer) {
            setFormData({
                first_name: customer.first_name || '',
                last_name: customer.last_name || '',
                company_name: customer.company_name || '',
                phone: customer.phone || '',
                email: customer.email || '',
                address: customer.address || '',
                is_active: customer.is_active,
                tin: customer.tin || '',
                registered_name: customer.registered_name || '',
                is_withholding_agent: customer.is_withholding_agent ?? false,
                customer_type: customer.customer_type || 'PRIVATE',
            });
            // Fetch existing tags for this customer
            api.get(`/customers/${customer.customer_id}/tags`).then(res => {
                setTags(res.data.map(t => t.tag_name));
            }).catch(() => toast.error('Could not load customer tags.'));
        }
    }, [customer]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => {
            const next = { ...prev, [name]: type === 'checkbox' ? checked : value };
            // Government agencies withhold by law, so the flag isn't the encoder's
            // to forget. The API enforces the same rule; this just keeps the form
            // from showing a state the server would overrule.
            if (name === 'customer_type' && value === 'GOVERNMENT') next.is_withholding_agent = true;
            return next;
        });
    };

    const handleSubmit = useCallback((e) => {
        e.preventDefault();
        const payload = { ...formData, tags };
        onSave(payload);
    }, [formData, tags, onSave]);

    useEffect(() => {
        const handleKeyDown = (e) => {
            // Save: Ctrl/Cmd + S
            const savePressed = (navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 's';
            if (savePressed) {
                e.preventDefault();
                handleSubmit(e);
                return;
            }

            // If another component already consumed the event, don't act
            if (e.defaultPrevented) return;

            // Cancel: only if focus is not inside an input-like element
            if (e.key === 'Escape') {
                if (isFormElement(document.activeElement)) {
                    return;
                }
                // If form is dirty, confirm
                if (isFormDirty) {
                    if (!confirm('Discard changes?')) return;
                }
                onCancel();
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleSubmit, onCancel, isFormDirty]);

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">First Name <span className="text-danger-500">*</span></label>
                    <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Last Name</label>
                    <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Company Name</label>
                <input type="text" name="company_name" value={formData.company_name} onChange={handleChange} className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Phone</label>
                    <input type="text" name="phone" value={formData.phone} onChange={handleChange} className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Email</label>
                    <input type="email" name="email" value={formData.email} onChange={handleChange} className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">Address</label>
                <textarea name="address" value={formData.address} onChange={handleChange} className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" rows="3"></textarea>
            </div>
            
            <div className="pt-4 border-t border-gray-200 dark:border-slate-700 space-y-4">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Tax Details (BIR)</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300">TIN</label>
                        <input type="text" name="tin" value={formData.tin} onChange={handleChange} placeholder="123-456-789-000" className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 font-mono" />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 flex items-center gap-1">
                            Customer Type
                            <InfoTip label="Customer Type">
                                Government agencies withhold tax on every purchase by law, so selecting Government automatically marks the customer as a withholding agent.
                            </InfoTip>
                        </label>
                        <select name="customer_type" value={formData.customer_type} onChange={handleChange} className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500">
                            <option value="PRIVATE">Private</option>
                            <option value="GOVERNMENT">Government</option>
                        </select>
                    </div>
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 flex items-center gap-1">
                        Registered Name
                        <InfoTip label="Registered Name">
                            The name exactly as it appears on the customer's BIR registration. Used on the certificates they issue, which may differ from the trading name above.
                        </InfoTip>
                    </label>
                    <input type="text" name="registered_name" value={formData.registered_name} onChange={handleChange} className="mt-1 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
                </div>
                <div className="flex items-center">
                    <input
                        type="checkbox"
                        name="is_withholding_agent"
                        checked={formData.is_withholding_agent}
                        onChange={handleChange}
                        disabled={formData.customer_type === 'GOVERNMENT'}
                        className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500 disabled:opacity-60"
                    />
                    <label className="ml-2 block text-sm text-gray-900 dark:text-slate-100 flex items-center gap-1">
                        Withholding agent
                        <InfoTip label="Withholding agent">
                            Turn this on for customers BIR has designated as withholding agents. Their invoices will show the tax they are expected to deduct, and the balance is settled by the BIR Form 2307 they issue instead of by cash.
                        </InfoTip>
                    </label>
                </div>
            </div>

            <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Tags</label>
                <TagInput value={tags} onChange={setTags} />
            </div>

            <div className="flex items-center">
                <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500" />
                <label className="ml-2 block text-sm text-gray-900 dark:text-slate-100 flex items-center gap-1">
                    Active
                    <InfoTip label="Active">
                        Turning this off retires the customer from the default "Active" filter without deleting their invoice, payment, or wallet history.
                    </InfoTip>
                </label>
            </div>
            <div className="mt-6 flex justify-end space-x-3 pt-4 border-t border-gray-200 dark:border-slate-700">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors shadow-xs">Save Customer</button>
            </div>
        </form>
    );
};

export default CustomerForm;
