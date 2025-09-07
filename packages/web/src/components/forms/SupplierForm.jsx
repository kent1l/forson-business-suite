import React, { useState, useEffect, useCallback, useMemo } from 'react';

const SupplierForm = ({ supplier, onSave, onCancel }) => {
    const [formData, setFormData] = useState({
        supplier_name: '', contact_person: '', phone: '', 
        email: '', address: '', is_active: true 
    });

    const initialFormData = useMemo(() => supplier ? { ...supplier } : { 
        supplier_name: '', contact_person: '', phone: '', 
        email: '', address: '', is_active: true 
    }, [supplier]);

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
        if (supplier) {
            setFormData(supplier);
        } else {
             setFormData({ 
                supplier_name: '', contact_person: '', phone: '', 
                email: '', address: '', is_active: true 
            });
        }
    }, [supplier]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSubmit = useCallback((e) => {
        e.preventDefault();
        onSave(formData);
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

    return (
        <form onSubmit={handleSubmit} className="space-y-4">
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Supplier Name</label>
                <input type="text" name="supplier_name" value={formData.supplier_name} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" required />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contact Person</label>
                <input type="text" name="contact_person" value={formData.contact_person} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                <input type="text" name="phone" value={formData.phone} onChange={handleChange} className="w-full px-3 py-2 border border-gray-300 rounded-lg" />
            </div>

            {/* NEWLY ADDED */}
            <div className="flex items-center">
                <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="h-4 w-4 text-blue-600 border-gray-300 rounded" />
                <label className="ml-2 block text-sm text-gray-900">Account is Active</label>
            </div>

            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save</button>
            </div>
        </form>
    );
};

export default SupplierForm;