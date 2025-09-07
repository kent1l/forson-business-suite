import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { toast } from 'react-hot-toast';
import api from '../../api';
import TagInput from '../ui/TagInput'; // Corrected Path

const CustomerForm = ({ customer, onSave, onCancel }) => {
    const [formData, setFormData] = useState({
        first_name: '',
        last_name: '',
        company_name: '',
        phone: '',
        email: '',
        address: '',
        is_active: true,
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
            });
            // Fetch existing tags for this customer
            api.get(`/customers/${customer.customer_id}/tags`).then(res => {
                setTags(res.data.map(t => t.tag_name));
            }).catch(() => toast.error('Could not load customer tags.'));
        }
    }, [customer]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
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
                    <label className="block text-sm font-medium text-gray-700">First Name</label>
                    <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} className="mt-1 w-full px-3 py-2 border rounded-lg" required />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Last Name</label>
                    <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} className="mt-1 w-full px-3 py-2 border rounded-lg" />
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700">Company Name</label>
                <input type="text" name="company_name" value={formData.company_name} onChange={handleChange} className="mt-1 w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                    <label className="block text-sm font-medium text-gray-700">Phone</label>
                    <input type="text" name="phone" value={formData.phone} onChange={handleChange} className="mt-1 w-full px-3 py-2 border rounded-lg" />
                </div>
                <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <input type="email" name="email" value={formData.email} onChange={handleChange} className="mt-1 w-full px-3 py-2 border rounded-lg" />
                </div>
            </div>
            <div>
                <label className="block text-sm font-medium text-gray-700">Address</label>
                <textarea name="address" value={formData.address} onChange={handleChange} className="mt-1 w-full px-3 py-2 border rounded-lg" rows="3"></textarea>
            </div>
            
            <div>
                <label className="block text-sm font-medium text-gray-700">Tags</label>
                <TagInput value={tags} onChange={setTags} />
            </div>

            <div className="flex items-center">
                <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="h-4 w-4 rounded" />
                <label className="ml-2 block text-sm text-gray-900">Active</label>
            </div>
            <div className="mt-6 flex justify-end space-x-4">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Customer</button>
            </div>
        </form>
    );
};

export default CustomerForm;
