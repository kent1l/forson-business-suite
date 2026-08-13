import React, { useState, useEffect, useCallback, useMemo } from 'react';

/**
 * Create/edit form for an employee's HR record.
 *
 * Credentials are deliberately NOT part of this form once an employee exists:
 * the API splits profile edits (PUT /employees/:id) from credential changes
 * (PUT /employees/:id/access), so system access is managed from the detail
 * drawer's Employment tab instead. On create, the form can optionally
 * provision a login in the same request.
 */

const INPUT_CLASS = 'w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

const EMPLOYMENT_TYPES = ['Regular', 'Probationary', 'Contractual', 'Project-based', 'Part-time', 'Casual'];
const EMPLOYMENT_STATUSES = ['Active', 'On Leave', 'Suspended', 'Resigned', 'Terminated', 'Retired'];
const CIVIL_STATUSES = ['Single', 'Married', 'Widowed', 'Separated'];

const Section = ({ title, children }) => (
    <div className="space-y-3">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 border-b border-gray-200 dark:border-slate-700 pb-1">
            {title}
        </h3>
        {children}
    </div>
);

const Field = ({ label, children }) => (
    <div>
        <label className={LABEL_CLASS}>{label}</label>
        {children}
    </div>
);

const EMPTY_FORM = {
    first_name: '', middle_name: '', last_name: '', suffix: '',
    position_title: '', department_id: '', manager_employee_id: '',
    employment_type: 'Regular', employment_status: 'Active',
    date_hired: '', birth_date: '', gender: '', civil_status: '',
    mobile_no: '', personal_email: '',
    address_line: '', barangay: '', city: '', province: '', postal_code: '',
    emergency_contact_name: '', emergency_contact_relation: '', emergency_contact_phone: '',
    is_active: true, is_payroll_eligible: true,
    // Create-only: optional login provisioning.
    has_system_access: false, username: '', password: '', permission_level_id: '',
};

const EmployeeForm = ({ employee, onSave, onCancel, roles = [], departments = [], managers = [] }) => {
    const buildInitial = useCallback(() => {
        if (!employee) return { ...EMPTY_FORM };
        const next = { ...EMPTY_FORM };
        for (const key of Object.keys(EMPTY_FORM)) {
            if (employee[key] !== undefined && employee[key] !== null) next[key] = employee[key];
        }
        // Editing never carries credential fields.
        return { ...next, has_system_access: false, username: '', password: '', permission_level_id: '' };
    }, [employee]);

    const [formData, setFormData] = useState(buildInitial);
    const initialFormData = useMemo(buildInitial, [buildInitial]);

    useEffect(() => { setFormData(buildInitial()); }, [buildInitial]);

    const isFormDirty = useMemo(
        () => JSON.stringify(formData) !== JSON.stringify(initialFormData),
        [formData, initialFormData]
    );

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
    };

    const handleSubmit = useCallback((e) => {
        if (e) e.preventDefault();
        // Empty strings would fail the numeric/date column types, so drop them.
        const payload = {};
        for (const [key, value] of Object.entries(formData)) {
            if (value === '') continue;
            payload[key] = value;
        }
        payload.is_active = formData.is_active;
        payload.is_payroll_eligible = formData.is_payroll_eligible;
        if (!employee) payload.has_system_access = formData.has_system_access;
        onSave(payload);
    }, [formData, onSave, employee]);

    const isFormElement = (el) => el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.target && isFormElement(e.target)) return;
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSubmit();
            } else if (e.key === 'Escape') {
                if (isFormDirty && !window.confirm('You have unsaved changes. Are you sure you want to cancel?')) return;
                onCancel();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleSubmit, onCancel, isFormDirty]);

    return (
        <form onSubmit={handleSubmit} className="space-y-6 max-h-[70vh] overflow-y-auto pr-1">
            <Section title="Personal">
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <Field label="First Name">
                        <input type="text" name="first_name" value={formData.first_name} onChange={handleChange} className={INPUT_CLASS} required />
                    </Field>
                    <Field label="Middle Name">
                        <input type="text" name="middle_name" value={formData.middle_name} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                    <Field label="Last Name">
                        <input type="text" name="last_name" value={formData.last_name} onChange={handleChange} className={INPUT_CLASS} required />
                    </Field>
                    <Field label="Suffix">
                        <input type="text" name="suffix" value={formData.suffix} onChange={handleChange} className={INPUT_CLASS} placeholder="Jr., III" />
                    </Field>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Birth Date">
                        <input type="date" name="birth_date" value={formData.birth_date} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                    <Field label="Gender">
                        <select name="gender" value={formData.gender} onChange={handleChange} className={INPUT_CLASS}>
                            <option value="">—</option>
                            <option value="Male">Male</option>
                            <option value="Female">Female</option>
                        </select>
                    </Field>
                    <Field label="Civil Status">
                        <select name="civil_status" value={formData.civil_status} onChange={handleChange} className={INPUT_CLASS}>
                            <option value="">—</option>
                            {CIVIL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </Field>
                </div>
            </Section>

            <Section title="Contact">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Mobile Number">
                        <input type="text" name="mobile_no" value={formData.mobile_no} onChange={handleChange} className={INPUT_CLASS} placeholder="09XX XXX XXXX" />
                    </Field>
                    <Field label="Personal Email">
                        <input type="email" name="personal_email" value={formData.personal_email} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                </div>
                <Field label="Address">
                    <input type="text" name="address_line" value={formData.address_line} onChange={handleChange} className={INPUT_CLASS} placeholder="House no., street" />
                </Field>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <Field label="Barangay">
                        <input type="text" name="barangay" value={formData.barangay} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                    <Field label="City / Municipality">
                        <input type="text" name="city" value={formData.city} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                    <Field label="Province">
                        <input type="text" name="province" value={formData.province} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                    <Field label="Postal Code">
                        <input type="text" name="postal_code" value={formData.postal_code} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                </div>
            </Section>

            <Section title="Emergency Contact">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <Field label="Name">
                        <input type="text" name="emergency_contact_name" value={formData.emergency_contact_name} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                    <Field label="Relationship">
                        <input type="text" name="emergency_contact_relation" value={formData.emergency_contact_relation} onChange={handleChange} className={INPUT_CLASS} placeholder="Spouse, Parent" />
                    </Field>
                    <Field label="Phone">
                        <input type="text" name="emergency_contact_phone" value={formData.emergency_contact_phone} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                </div>
            </Section>

            <Section title="Employment">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Position Title">
                        <input type="text" name="position_title" value={formData.position_title} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                    <Field label="Department">
                        <select name="department_id" value={formData.department_id} onChange={handleChange} className={INPUT_CLASS}>
                            <option value="">—</option>
                            {departments.map((d) => (
                                <option key={d.department_id} value={d.department_id}>{d.department_name}</option>
                            ))}
                        </select>
                    </Field>
                    <Field label="Employment Type">
                        <select name="employment_type" value={formData.employment_type} onChange={handleChange} className={INPUT_CLASS}>
                            {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                        </select>
                    </Field>
                    <Field label="Employment Status">
                        <select name="employment_status" value={formData.employment_status} onChange={handleChange} className={INPUT_CLASS}>
                            {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </Field>
                    <Field label="Date Hired">
                        <input type="date" name="date_hired" value={formData.date_hired} onChange={handleChange} className={INPUT_CLASS} />
                    </Field>
                    <Field label="Reports To">
                        <select name="manager_employee_id" value={formData.manager_employee_id} onChange={handleChange} className={INPUT_CLASS}>
                            <option value="">—</option>
                            {managers
                                .filter((m) => !employee || m.employee_id !== employee.employee_id)
                                .map((m) => (
                                    <option key={m.employee_id} value={m.employee_id}>
                                        {m.first_name} {m.last_name}
                                    </option>
                                ))}
                        </select>
                    </Field>
                </div>
                <div className="flex flex-wrap gap-6 pt-1">
                    <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-200">
                        <input type="checkbox" name="is_active" checked={formData.is_active} onChange={handleChange} className="h-4 w-4 rounded border-gray-300 text-primary-600" />
                        Record is active
                    </label>
                    <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-200">
                        <input type="checkbox" name="is_payroll_eligible" checked={formData.is_payroll_eligible} onChange={handleChange} className="h-4 w-4 rounded border-gray-300 text-primary-600" />
                        Include in payroll
                    </label>
                </div>
            </Section>

            {/* System access is only offered at creation time. For an existing
                employee it is managed from the drawer's Employment tab, which
                calls the dedicated /access endpoints. */}
            {!employee && (
                <Section title="System Access">
                    <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-200">
                        <input type="checkbox" name="has_system_access" checked={formData.has_system_access} onChange={handleChange} className="h-4 w-4 rounded border-gray-300 text-primary-600" />
                        Give this employee a login
                    </label>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                        Leave unchecked for staff who are paid but never use the system — drivers, mechanics, helpers.
                    </p>
                    {formData.has_system_access && (
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                            <Field label="Username">
                                <input type="text" name="username" value={formData.username} onChange={handleChange} className={INPUT_CLASS} required autoComplete="off" />
                            </Field>
                            <Field label="Password">
                                <input type="password" name="password" value={formData.password} onChange={handleChange} className={INPUT_CLASS} required autoComplete="new-password" />
                            </Field>
                            <Field label="Role">
                                <select name="permission_level_id" value={formData.permission_level_id} onChange={handleChange} className={INPUT_CLASS} required>
                                    <option value="">Select a role…</option>
                                    {roles.map((r) => (
                                        <option key={r.permission_level_id} value={r.permission_level_id}>{r.level_name}</option>
                                    ))}
                                </select>
                            </Field>
                        </div>
                    )}
                </Section>
            )}

            <div className="flex justify-end gap-3 pt-2 border-t border-gray-200 dark:border-slate-700">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">
                    Cancel
                </button>
                <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700">
                    Save Employee
                </button>
            </div>
        </form>
    );
};

export default EmployeeForm;
