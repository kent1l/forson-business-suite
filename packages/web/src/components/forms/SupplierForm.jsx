import React, { useState, useEffect, useCallback, useMemo } from 'react';

const BLANK_FORM = {
    supplier_name: '', contact_person: '', phone: '',
    email: '', address: '', payment_terms_days: '', is_active: true
};

const SupplierForm = ({ supplier, onSave, onCancel }) => {
    const [formData, setFormData] = useState(BLANK_FORM);

    const initialFormData = useMemo(() => supplier ? { ...BLANK_FORM, ...supplier } : BLANK_FORM, [supplier]);

    const isFormDirty = useMemo(() => {
        const keys = Object.keys(formData);
        for (let key of keys) {
            if (formData[key] !== initialFormData[key]) return true;
        }
        return false;
    }, [formData, initialFormData]);

    const isFormElement = (el) => {
        if (!el) return false;
        const tag = el.tagName;
        return /INPUT|TEXTAREA|SELECT/.test(tag) || el.isContentEditable;
    };

    useEffect(() => {
        setFormData(supplier ? { ...BLANK_FORM, ...supplier } : BLANK_FORM);
    }, [supplier]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSubmit = useCallback((e) => {
        e.preventDefault();
        onSave({
            ...formData,
            payment_terms_days: formData.payment_terms_days === '' ? null : parseInt(formData.payment_terms_days, 10),
        });
    }, [formData, onSave]);

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

    const inputClass = "w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg";
    const labelClass = "block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1";

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className={labelClass}>Supplier Name</label>
                <input type="text" name="supplier_name" value={formData.supplier_name} onChange={handleChange} className={inputClass} required />
            </div>
            <div>
                <label className={labelClass}>Contact Person</label>
                <input type="text" name="contact_person" value={formData.contact_person || ''} onChange={handleChange} className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className={labelClass}>Phone</label>
                    <input type="text" name="phone" value={formData.phone || ''} onChange={handleChange} className={inputClass} />
                </div>
                <div>
                    <label className={labelClass}>Email</label>
                    <input type="email" name="email" value={formData.email || ''} onChange={handleChange} className={inputClass} />
                </div>
            </div>
            <div>
                <label className={labelClass}>Address</label>
                <textarea name="address" value={formData.address || ''} onChange={handleChange} rows={2} className={inputClass} />
            </div>
            <div>
                <label className={labelClass}>Payment Terms (days)</label>
                <input
                    type="number"
                    name="payment_terms_days"
                    min="0"
                    placeholder="e.g. 30"
                    value={formData.payment_terms_days ?? ''}
                    onChange={handleChange}
                    className={inputClass}
                />
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">Used to auto-compute bill due dates when goods are received from this supplier.</p>
            </div>

            <div className="flex items-center">
                <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="h-4 w-4 text-primary-600 border-gray-300 dark:border-slate-600 rounded" />
                <label className="ml-2 block text-sm text-gray-900 dark:text-slate-100">Account is Active</label>
            </div>

            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-100 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">Save</button>
            </div>
        </form>
    );
};

export default SupplierForm;
