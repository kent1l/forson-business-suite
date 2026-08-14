import React, { useState } from 'react';

const INPUT_CLASS = 'w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';
const LABEL_CLASS = 'block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1';

const EMPLOYMENT_TYPES = ['Regular', 'Probationary', 'Contractual', 'Project-based', 'Part-time', 'Casual'];
const EMPLOYMENT_STATUSES = ['Active', 'On Leave', 'Suspended', 'Resigned', 'Terminated', 'Retired'];

const BulkEditForm = ({ selectedCount, onSave, onCancel, departments = [], managers = [] }) => {
    const [formData, setFormData] = useState({
        department_id: '',
        employment_type: '',
        employment_status: '',
        manager_employee_id: ''
    });

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const payload = {};
        for (const [key, value] of Object.entries(formData)) {
            if (value !== '') {
                payload[key] = value;
            }
        }
        onSave(payload);
    };

    return (
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5 space-y-4">
                <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                    Editing {selectedCount} selected employees. Leave fields as "(No change)" to keep existing values.
                </p>

                <div>
                    <label className={LABEL_CLASS}>Department</label>
                    <select name="department_id" value={formData.department_id} onChange={handleChange} className={INPUT_CLASS}>
                        <option value="">(No change)</option>
                        {departments.map(d => (
                            <option key={d.department_id} value={d.department_id}>{d.department_name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className={LABEL_CLASS}>Employment Type</label>
                    <select name="employment_type" value={formData.employment_type} onChange={handleChange} className={INPUT_CLASS}>
                        <option value="">(No change)</option>
                        {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>
                <div>
                    <label className={LABEL_CLASS}>Employment Status</label>
                    <select name="employment_status" value={formData.employment_status} onChange={handleChange} className={INPUT_CLASS}>
                        <option value="">(No change)</option>
                        {EMPLOYMENT_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                </div>
                <div>
                    <label className={LABEL_CLASS}>Reports to</label>
                    <select name="manager_employee_id" value={formData.manager_employee_id} onChange={handleChange} className={INPUT_CLASS}>
                        <option value="">(No change)</option>
                        {managers.map(m => (
                            <option key={m.employee_id} value={m.employee_id}>
                                {m.first_name} {m.last_name}
                            </option>
                        ))}
                    </select>
                </div>
            </div>
            
            <div className="flex-shrink-0 px-6 py-3 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 flex items-center justify-end gap-3">
                <button type="button" onClick={onCancel}
                    className="px-4 py-2 text-sm bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 focus:outline-none">
                    Cancel
                </button>
                <button type="submit"
                    className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 focus:outline-none">
                    Update {selectedCount} Employees
                </button>
            </div>
        </form>
    );
};

export default BulkEditForm;
