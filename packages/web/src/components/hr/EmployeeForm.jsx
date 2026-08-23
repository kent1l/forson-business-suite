import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import SegmentedTabs from '../ui/SegmentedTabs';
import api from '../../api';

/**
 * Create/edit form for an employee's HR record.
 *
 * The record has ~25 fields, which as one long scroll meant you lost your place
 * and had to scroll to reach Save. It is split into tabs instead — and tabs
 * rather than numbered steps because the facets (who they are, how to reach
 * them, their job, their login) are genuinely parallel, not a sequence. You can
 * fill them in any order and save from anywhere.
 *
 * Credentials are deliberately NOT editable here once an employee exists: the
 * API splits profile edits (PUT /employees/:id) from credential changes
 * (PUT /employees/:id/access), so system access is managed from the detail
 * drawer's Employment tab. On create, a login can be provisioned in the same
 * request, so the Access tab appears only then.
 */

const INPUT_CLASS = 'w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent';
const INPUT_ERROR_CLASS = 'border-danger-500 dark:border-danger-500';
const LABEL_CLASS = 'block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1';

const EMPLOYMENT_TYPES = ['Regular', 'Probationary', 'Contractual', 'Project-based', 'Part-time', 'Casual'];
const EMPLOYMENT_STATUSES = ['Active', 'On Leave', 'Suspended', 'Resigned', 'Terminated', 'Retired'];
const SEPARATED_STATUSES = ['Resigned', 'Terminated', 'Retired'];
const CIVIL_STATUSES = ['Single', 'Married', 'Widowed', 'Separated'];

const Field = ({ label, required, error, hint, children, className = '' }) => (
    <div className={className}>
        <label className={LABEL_CLASS}>
            {label}
            {required && <span className="text-danger-600 ml-0.5" aria-hidden="true">*</span>}
        </label>
        {children}
        {/* An error replaces the hint rather than stacking, so the field never
            jumps height when validation fires. */}
        {error
            ? <p className="mt-1 text-xs text-danger-600">{error}</p>
            : hint ? <p className="mt-1 text-xs text-gray-400 dark:text-slate-500">{hint}</p> : null}
    </div>
);

const Grid = ({ cols = 2, children }) => (
    <div className={`grid grid-cols-1 ${cols === 2 ? 'sm:grid-cols-2' : cols === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4'} gap-x-4 gap-y-3`}>
        {children}
    </div>
);

const SectionNote = ({ children }) => (
    <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">{children}</p>
);

const EMPTY_FORM = {
    first_name: '', middle_name: '', last_name: '', suffix: '',
    position_title: '', department_id: '', manager_employee_id: '',
    worker_class: 'EMPLOYEE', employment_type: 'Regular', employment_status: 'Active',
    date_hired: '', birth_date: '', gender: '', civil_status: '',
    date_separated: '', separation_reason: '',
    mobile_no: '', personal_email: '',
    address_line: '', barangay: '', city: '', province: '', postal_code: '',
    emergency_contact_name: '', emergency_contact_relation: '', emergency_contact_phone: '',
    is_active: true, is_payroll_eligible: true, work_schedule_id: '',
    has_system_access: false, username: '', password: '', permission_level_id: '',
};

// Which tab owns each field, so a validation failure can send you to the right
// place instead of just refusing to save.
const FIELD_TAB = {
    first_name: 'personal', last_name: 'personal',
    date_separated: 'employment',
    username: 'access', password: 'access', permission_level_id: 'access',
};

const EmployeeForm = ({ employee, onSave, onCancel, roles = [], departments = [], managers = [] }) => {
    const [tab, setTab] = useState('personal');
    const [errors, setErrors] = useState({});
    const [workSchedules, setWorkSchedules] = useState([]);
    const formRef = useRef(null);

    // Fetched here rather than threaded down as a prop: the picker is the only
    // consumer, and every caller of this form would otherwise have to load it.
    useEffect(() => {
        api.get('/hr/work-schedules')
            .then(({ data }) => setWorkSchedules(Array.isArray(data) ? data.filter((s) => s.is_active !== false) : []))
            .catch(() => { /* picker falls back to "Company default" */ });
    }, []);

    const buildInitial = useCallback(() => {
        if (!employee) return { ...EMPTY_FORM };
        const next = { ...EMPTY_FORM };
        for (const key of Object.keys(EMPTY_FORM)) {
            if (employee[key] !== undefined && employee[key] !== null) next[key] = employee[key];
        }
        return { ...next, has_system_access: false, username: '', password: '', permission_level_id: '' };
    }, [employee]);

    const [formData, setFormData] = useState(buildInitial);
    const initialFormData = useMemo(buildInitial, [buildInitial]);

    useEffect(() => {
        setFormData(buildInitial());
        setErrors({});
        setTab('personal');
    }, [buildInitial]);

    const isFormDirty = useMemo(
        () => JSON.stringify(formData) !== JSON.stringify(initialFormData),
        [formData, initialFormData]
    );

    const isJobOrder = formData.worker_class === 'JOB_ORDER';

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData((prev) => ({ ...prev, [name]: type === 'checkbox' ? checked : value }));
        // Clear the error as soon as the field is touched: keeping it visible
        // while someone is fixing it is just nagging.
        if (errors[name]) setErrors((prev) => ({ ...prev, [name]: undefined }));
    };

    const validate = useCallback(() => {
        const found = {};
        if (!formData.first_name.trim()) found.first_name = 'Required';
        if (!formData.last_name.trim()) found.last_name = 'Required';
        if (SEPARATED_STATUSES.includes(formData.employment_status) && !formData.date_separated) {
            found.date_separated = 'Required when status is Resigned, Terminated, or Retired';
        }
        if (!employee && formData.has_system_access) {
            if (!formData.username.trim()) found.username = 'Required to create a login';
            if (!formData.password) found.password = 'Required to create a login';
            if (!formData.permission_level_id) found.permission_level_id = 'Pick a role';
        }
        return found;
    }, [formData, employee]);

    const handleSubmit = useCallback((e) => {
        if (e) e.preventDefault();
        const found = validate();
        setErrors(found);

        const firstBad = Object.keys(found)[0];
        if (firstBad) {
            // Send the user to the tab holding the problem, then focus it.
            const targetTab = FIELD_TAB[firstBad] || 'personal';
            setTab(targetTab);
            requestAnimationFrame(() => {
                formRef.current?.querySelector(`[name="${firstBad}"]`)?.focus();
            });
            return;
        }

        const payload = {};
        for (const [key, value] of Object.entries(formData)) {
            if (value === '') continue;
            payload[key] = value;
        }
        payload.is_active = formData.is_active;
        payload.is_payroll_eligible = formData.is_payroll_eligible;
        if (!employee) payload.has_system_access = formData.has_system_access;
        onSave(payload);
    }, [formData, onSave, employee, validate]);

    const isFormElement = (el) => el && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);

    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSubmit();
                return;
            }
            if (e.target && isFormElement(e.target)) return;
            if (e.key === 'Escape') {
                if (isFormDirty && !window.confirm('You have unsaved changes. Discard them?')) return;
                onCancel();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [handleSubmit, onCancel, isFormDirty]);

    // A dot on a tab marks where an unresolved problem lives.
    const tabHasError = (key) => Object.keys(errors)
        .some((f) => errors[f] && (FIELD_TAB[f] || 'personal') === key);

    const TABS = [
        { key: 'personal', label: 'Personal' },
        { key: 'contact', label: 'Contact' },
        { key: 'employment', label: 'Employment' },
        ...(employee ? [] : [{ key: 'access', label: 'Access' }]),
    ].map((t) => ({ ...t, label: tabHasError(t.key) ? `${t.label} •` : t.label }));

    const err = (name) => errors[name];
    const cls = (name) => `${INPUT_CLASS} ${err(name) ? INPUT_ERROR_CLASS : ''}`;

    return (
        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col h-full">
            <div className="flex-shrink-0 px-6 pt-4 pb-3 border-b border-gray-200 dark:border-slate-700">
                <SegmentedTabs tabs={TABS} active={tab} onChange={setTab} variant="pills" />
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto px-6 py-5">
                {tab === 'personal' && (
                    <div className="space-y-4">
                        <Grid cols={4}>
                            <Field label="First name" required error={err('first_name')}>
                                <input type="text" name="first_name" value={formData.first_name}
                                    onChange={handleChange} className={cls('first_name')} autoFocus />
                            </Field>
                            <Field label="Middle name">
                                <input type="text" name="middle_name" value={formData.middle_name} onChange={handleChange} className={INPUT_CLASS} />
                            </Field>
                            <Field label="Last name" required error={err('last_name')}>
                                <input type="text" name="last_name" value={formData.last_name}
                                    onChange={handleChange} className={cls('last_name')} />
                            </Field>
                            <Field label="Suffix" hint="Jr., III">
                                <input type="text" name="suffix" value={formData.suffix} onChange={handleChange} className={INPUT_CLASS} />
                            </Field>
                        </Grid>
                        <Grid cols={3}>
                            <Field label="Date of birth">
                                <input type="date" name="birth_date" value={formData.birth_date} onChange={handleChange} className={INPUT_CLASS} />
                            </Field>
                            <Field label="Gender">
                                <select name="gender" value={formData.gender} onChange={handleChange} className={INPUT_CLASS}>
                                    <option value="">Not specified</option>
                                    <option value="Male">Male</option>
                                    <option value="Female">Female</option>
                                </select>
                            </Field>
                            <Field label="Civil status">
                                <select name="civil_status" value={formData.civil_status} onChange={handleChange} className={INPUT_CLASS}>
                                    <option value="">Not specified</option>
                                    {CIVIL_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </Field>
                        </Grid>
                    </div>
                )}

                {tab === 'contact' && (
                    <div className="space-y-5">
                        <div>
                            <Grid cols={2}>
                                <Field label="Mobile number" hint="09XX XXX XXXX">
                                    <input type="text" name="mobile_no" value={formData.mobile_no} onChange={handleChange} className={INPUT_CLASS} />
                                </Field>
                                <Field label="Personal email">
                                    <input type="email" name="personal_email" value={formData.personal_email} onChange={handleChange} className={INPUT_CLASS} />
                                </Field>
                            </Grid>
                        </div>

                        <div>
                            <Field label="Street address">
                                <input type="text" name="address_line" value={formData.address_line} onChange={handleChange} className={INPUT_CLASS} />
                            </Field>
                            <div className="mt-3">
                                <Grid cols={4}>
                                    <Field label="Barangay">
                                        <input type="text" name="barangay" value={formData.barangay} onChange={handleChange} className={INPUT_CLASS} />
                                    </Field>
                                    <Field label="City">
                                        <input type="text" name="city" value={formData.city} onChange={handleChange} className={INPUT_CLASS} />
                                    </Field>
                                    <Field label="Province">
                                        <input type="text" name="province" value={formData.province} onChange={handleChange} className={INPUT_CLASS} />
                                    </Field>
                                    <Field label="Postal code">
                                        <input type="text" name="postal_code" value={formData.postal_code} onChange={handleChange} className={INPUT_CLASS} />
                                    </Field>
                                </Grid>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-gray-200 dark:border-slate-700">
                            <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-100">Emergency contact</h3>
                            <SectionNote>Who to call if something happens at work.</SectionNote>
                            <Grid cols={3}>
                                <Field label="Name">
                                    <input type="text" name="emergency_contact_name" value={formData.emergency_contact_name} onChange={handleChange} className={INPUT_CLASS} />
                                </Field>
                                <Field label="Relationship" hint="Spouse, parent">
                                    <input type="text" name="emergency_contact_relation" value={formData.emergency_contact_relation} onChange={handleChange} className={INPUT_CLASS} />
                                </Field>
                                <Field label="Phone">
                                    <input type="text" name="emergency_contact_phone" value={formData.emergency_contact_phone} onChange={handleChange} className={INPUT_CLASS} />
                                </Field>
                            </Grid>
                        </div>
                    </div>
                )}

                {tab === 'employment' && (
                    <div className="space-y-5">
                        <Grid cols={2}>
                            <Field label="Position">
                                <input type="text" name="position_title" value={formData.position_title} onChange={handleChange} className={INPUT_CLASS} />
                            </Field>
                            <Field label="Department">
                                <select name="department_id" value={formData.department_id} onChange={handleChange} className={INPUT_CLASS}>
                                    <option value="">Unassigned</option>
                                    {departments.map((d) => (
                                        <option key={d.department_id} value={d.department_id}>{d.department_name}</option>
                                    ))}
                                </select>
                            </Field>
                            <Field label="Worker class">
                                <select name="worker_class" value={formData.worker_class} onChange={handleChange} className={INPUT_CLASS}>
                                    <option value="EMPLOYEE">Employee</option>
                                    <option value="JOB_ORDER">Job Order / Contract of Service</option>
                                </select>
                                {isJobOrder && (
                                    <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                        Paid through a separate Job Order payroll run. No SSS, PhilHealth,
                                        Pag-IBIG or withholding tax, and excluded from the statutory reports.
                                    </p>
                                )}
                            </Field>
                            {/* Regular / Probationary / Casual are employee-only concepts, so the
                                field is hidden rather than shown with nothing that applies. */}
                            {!isJobOrder && (
                                <Field label="Employment type">
                                    <select name="employment_type" value={formData.employment_type} onChange={handleChange} className={INPUT_CLASS}>
                                        {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </Field>
                            )}
                            <Field label="Status">
                                <select name="employment_status" value={formData.employment_status} onChange={handleChange} className={INPUT_CLASS}>
                                    {EMPLOYMENT_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </Field>
                            <Field label="Date hired">
                                <input type="date" name="date_hired" value={formData.date_hired} onChange={handleChange} className={INPUT_CLASS} />
                            </Field>
                            {/* Resigned/Terminated/Retired require a separation date — the
                                database rejects the status change without one, since payroll
                                can't tell which days of a cutoff were still employment. */}
                            {SEPARATED_STATUSES.includes(formData.employment_status) && (
                                <>
                                    <Field label="Date separated" required error={err('date_separated')}>
                                        <input type="date" name="date_separated" value={formData.date_separated}
                                            onChange={handleChange} className={cls('date_separated')} />
                                    </Field>
                                    <Field label="Separation reason">
                                        <input type="text" name="separation_reason" value={formData.separation_reason} onChange={handleChange} className={INPUT_CLASS} />
                                    </Field>
                                </>
                            )}
                            <Field label="Reports to">
                                <select name="manager_employee_id" value={formData.manager_employee_id} onChange={handleChange} className={INPUT_CLASS}>
                                    <option value="">No one</option>
                                    {managers
                                        .filter((m) => !employee || m.employee_id !== employee.employee_id)
                                        .map((m) => (
                                            <option key={m.employee_id} value={m.employee_id}>
                                                {m.first_name} {m.last_name}
                                            </option>
                                        ))}
                                </select>
                            </Field>
                            <Field label="Work schedule">
                                <select name="work_schedule_id" value={formData.work_schedule_id} onChange={handleChange} className={INPUT_CLASS}>
                                    <option value="">Company default</option>
                                    {workSchedules.map((s) => (
                                        <option key={s.schedule_id} value={s.schedule_id}>{s.schedule_name}</option>
                                    ))}
                                </select>
                                <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
                                    Sets which days are rest days when time records are generated.
                                </p>
                            </Field>
                        </Grid>

                        <div className="pt-4 border-t border-gray-200 dark:border-slate-700 space-y-3">
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input type="checkbox" name="is_payroll_eligible" checked={formData.is_payroll_eligible}
                                    onChange={handleChange}
                                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                                <span>
                                    <span className="block text-sm text-gray-900 dark:text-slate-100">Include in payroll</span>
                                    <span className="block text-xs text-gray-500 dark:text-slate-400">
                                        Uncheck only for people paid entirely outside this system. Job-order
                                        workers are paid here too — in their own Job Order run — so leave this on.
                                    </span>
                                </span>
                            </label>
                            {/* The old hint said "uncheck for consultants", which reads exactly like a
                                job-order worker and silently excludes them from their own run. */}
                            {isJobOrder && !formData.is_payroll_eligible && (
                                <p className="text-xs text-warning-700 dark:text-warning-500 pl-7">
                                    This job-order worker will be skipped when you compute a Job Order
                                    payroll run. Tick “Include in payroll” to pay them here.
                                </p>
                            )}
                            <label className="flex items-start gap-3 cursor-pointer">
                                <input type="checkbox" name="is_active" checked={formData.is_active}
                                    onChange={handleChange}
                                    className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                                <span>
                                    <span className="block text-sm text-gray-900 dark:text-slate-100">Record is active</span>
                                    <span className="block text-xs text-gray-500 dark:text-slate-400">
                                        Inactive records stay on file but drop out of the default lists.
                                    </span>
                                </span>
                            </label>
                        </div>
                    </div>
                )}

                {tab === 'access' && !employee && (
                    <div className="space-y-4">
                        <label className="flex items-start gap-3 cursor-pointer">
                            <input type="checkbox" name="has_system_access" checked={formData.has_system_access}
                                onChange={handleChange}
                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500" />
                            <span>
                                <span className="block text-sm font-medium text-gray-900 dark:text-slate-100">
                                    Give this employee a login
                                </span>
                                <span className="block text-xs text-gray-500 dark:text-slate-400">
                                    Leave this off for staff who are paid but never use the system — drivers,
                                    mechanics, helpers. You can grant access later at any time.
                                </span>
                            </span>
                        </label>

                        {formData.has_system_access && (
                            <div className="pt-4 border-t border-gray-200 dark:border-slate-700">
                                <Grid cols={3}>
                                    <Field label="Username" required error={err('username')}>
                                        <input type="text" name="username" value={formData.username}
                                            onChange={handleChange} className={cls('username')} autoComplete="off" />
                                    </Field>
                                    <Field label="Password" required error={err('password')}>
                                        <input type="password" name="password" value={formData.password}
                                            onChange={handleChange} className={cls('password')} autoComplete="new-password" />
                                    </Field>
                                    <Field label="Role" required error={err('permission_level_id')}>
                                        <select name="permission_level_id" value={formData.permission_level_id}
                                            onChange={handleChange} className={cls('permission_level_id')}>
                                            <option value="">Select…</option>
                                            {roles.map((r) => (
                                                <option key={r.permission_level_id} value={r.permission_level_id}>{r.level_name}</option>
                                            ))}
                                        </select>
                                    </Field>
                                </Grid>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/*
              * Outside the scroll region, so Save is reachable from any tab
              * without scrolling AND never covers the fields. An earlier
              * `sticky bottom-0` inside the scroll area did pin the bar, but it
              * overlaid the last row of inputs.
              */}
            <div className="flex-shrink-0 px-6 py-3 bg-white dark:bg-slate-800 border-t border-gray-200 dark:border-slate-700 flex items-center justify-between gap-4">
                <p className="text-xs text-gray-400 dark:text-slate-500 hidden sm:block">
                    {isFormDirty ? 'Unsaved changes' : 'No changes yet'}
                    <span className="mx-2">·</span>
                    <kbd className="font-sans">Ctrl</kbd>+<kbd className="font-sans">S</kbd> to save
                </p>
                <div className="flex gap-3 ml-auto">
                    <button type="button" onClick={onCancel}
                        className="px-4 py-2 text-sm bg-gray-100 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                        Cancel
                    </button>
                    <button type="submit"
                        className="px-4 py-2 text-sm bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-800">
                        {employee ? 'Save changes' : 'Add employee'}
                    </button>
                </div>
            </div>
        </form>
    );
};

export default EmployeeForm;
