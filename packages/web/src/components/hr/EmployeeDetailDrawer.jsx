import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../api';
import Drawer from '../ui/Drawer';
import SegmentedTabs from '../ui/SegmentedTabs';
import StatusBadge from '../ui/StatusBadge';
import LoadingState from '../ui/LoadingState';
import { useAuth } from '../../contexts/AuthContext';

/**
 * 360-degree view of one employee, modelled on SupplierDetailDrawer.
 *
 * Tab visibility is permission-driven: Compensation needs hr:manage_compensation
 * and Government IDs needs hr:view_sensitive, because pay rates and government
 * identifiers are the two genuinely confidential slices of an HR record. Later
 * phases append DTR and Payslips tabs here.
 */

const INPUT_CLASS = 'w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

const STATUS_TONE = {
    Active: 'success',
    'On Leave': 'warning',
    Suspended: 'warning',
    Resigned: 'neutral',
    Terminated: 'danger',
    Retired: 'neutral',
};

const peso = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? `₱${n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
};

const DetailRow = ({ label, value }) => (
    <div>
        <span className="text-xs text-gray-500 dark:text-slate-400">{label}</span>
        <p className="text-sm text-gray-900 dark:text-slate-100">{value || '—'}</p>
    </div>
);

// --- Profile -------------------------------------------------------------

const ProfileTab = ({ employee }) => (
    <div className="p-4 space-y-5">
        <div className="grid grid-cols-2 gap-3">
            <DetailRow label="Employee Code" value={employee.employee_code} />
            <DetailRow label="Birth Date" value={employee.birth_date} />
            <DetailRow label="Gender" value={employee.gender} />
            <DetailRow label="Civil Status" value={employee.civil_status} />
        </div>
        <div className="border-t border-gray-200 dark:border-slate-700 pt-4 grid grid-cols-2 gap-3">
            <DetailRow label="Mobile" value={employee.mobile_no} />
            <DetailRow label="Personal Email" value={employee.personal_email} />
            <div className="col-span-2">
                <DetailRow
                    label="Address"
                    value={[employee.address_line, employee.barangay, employee.city, employee.province, employee.postal_code]
                        .filter(Boolean).join(', ')}
                />
            </div>
        </div>
        <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">
                Emergency Contact
            </h3>
            <div className="grid grid-cols-2 gap-3">
                <DetailRow label="Name" value={employee.emergency_contact_name} />
                <DetailRow label="Relationship" value={employee.emergency_contact_relation} />
                <DetailRow label="Phone" value={employee.emergency_contact_phone} />
            </div>
        </div>
    </div>
);

// --- Employment ----------------------------------------------------------

const EmploymentTab = ({ employee, roles, canManageAccess, onEmployeeChanged }) => {
    const [granting, setGranting] = useState(false);
    const [form, setForm] = useState({ username: '', password: '', permission_level_id: '' });
    const [saving, setSaving] = useState(false);

    const submitAccess = async (e) => {
        e.preventDefault();
        setSaving(true);
        try {
            await api.put(`/employees/${employee.employee_id}/access`, form);
            toast.success(employee.has_system_access ? 'System access updated' : 'System access granted');
            setGranting(false);
            setForm({ username: '', password: '', permission_level_id: '' });
            onEmployeeChanged();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to update system access');
        } finally {
            setSaving(false);
        }
    };

    const revoke = async () => {
        if (!window.confirm(`Revoke system access for ${employee.first_name} ${employee.last_name}? Their HR and payroll record is kept.`)) return;
        try {
            await api.delete(`/employees/${employee.employee_id}/access`);
            toast.success('System access revoked');
            onEmployeeChanged();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to revoke system access');
        }
    };

    return (
        <div className="p-4 space-y-5">
            <div className="grid grid-cols-2 gap-3">
                <DetailRow label="Position" value={employee.position_title} />
                <DetailRow label="Department" value={employee.department_name} />
                <DetailRow label="Employment Type" value={employee.employment_type} />
                <DetailRow label="Employment Status" value={employee.employment_status} />
                <DetailRow label="Date Hired" value={employee.date_hired} />
                <DetailRow label="Date Regularized" value={employee.date_regularized} />
                <DetailRow label="Reports To" value={employee.manager_name} />
                <DetailRow label="Payroll" value={employee.is_payroll_eligible ? 'Included' : 'Excluded'} />
                {employee.date_separated && (
                    <>
                        <DetailRow label="Date Separated" value={employee.date_separated} />
                        <DetailRow label="Separation Reason" value={employee.separation_reason} />
                    </>
                )}
            </div>

            <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-100">System Access</h3>
                    <StatusBadge
                        tone={employee.has_system_access ? 'success' : 'neutral'}
                        label={employee.has_system_access ? `Login: ${employee.username}` : 'No login'}
                    />
                </div>
                <p className="text-xs text-gray-500 dark:text-slate-400 mb-3">
                    {employee.has_system_access
                        ? 'This employee can sign in to the system.'
                        : 'This employee is paid but has no way to sign in.'}
                </p>

                {canManageAccess && !granting && (
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={() => { setGranting(true); setForm({ username: employee.username || '', password: '', permission_level_id: employee.permission_level_id || '' }); }}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700"
                        >
                            {employee.has_system_access ? 'Change login or role' : 'Grant system access'}
                        </button>
                        {employee.has_system_access && (
                            <button type="button" onClick={revoke} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-danger-100 text-danger-800 hover:bg-danger-200 dark:bg-danger-900/30 dark:text-danger-400">
                                Revoke access
                            </button>
                        )}
                    </div>
                )}

                {canManageAccess && granting && (
                    <form onSubmit={submitAccess} className="space-y-3">
                        <input className={INPUT_CLASS} placeholder="Username" autoComplete="off" required
                            value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
                        <input className={INPUT_CLASS} type="password" autoComplete="new-password"
                            placeholder={employee.has_system_access ? 'New password (leave blank to keep current)' : 'Password'}
                            required={!employee.has_system_access}
                            value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                        <select className={INPUT_CLASS} required
                            value={form.permission_level_id} onChange={(e) => setForm({ ...form, permission_level_id: e.target.value })}>
                            <option value="">Select a role…</option>
                            {roles.map((r) => (
                                <option key={r.permission_level_id} value={r.permission_level_id}>{r.level_name}</option>
                            ))}
                        </select>
                        <div className="flex gap-2">
                            <button type="submit" disabled={saving} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                            <button type="button" onClick={() => setGranting(false)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">
                                Cancel
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

// --- Compensation --------------------------------------------------------

const BLANK_COMPENSATION = {
    effective_date: '', base_rate: '', reason: '',
    pay_basis: 'daily', salary_model: '',
    is_overtime_exempt: false, is_tardiness_exempt: false,
};

const CompensationTab = ({ employee }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState(BLANK_COMPENSATION);
    const isMonthly = form.pay_basis === 'monthly';

    // Picking a monthly basis pre-selects the arrangement it almost always comes
    // with — a guaranteed salary, exempt from overtime and tardiness — while
    // leaving every part of it overridable. The two exemptions are genuinely
    // independent of the pay basis: a monthly-paid rank-and-file worker is still
    // legally entitled to overtime.
    const changeBasis = (pay_basis) => setForm((prev) => ({
        ...prev,
        pay_basis,
        salary_model: pay_basis === 'monthly' ? (prev.salary_model || 'GUARANTEED') : '',
        is_overtime_exempt: pay_basis === 'monthly',
        is_tardiness_exempt: pay_basis === 'monthly',
    }));

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await api.get(`/hr/employees/${employee.employee_id}/compensation`);
            setHistory(Array.isArray(data) ? data : []);
        } catch {
            toast.error('Failed to load compensation history');
        } finally {
            setLoading(false);
        }
    }, [employee.employee_id]);

    useEffect(() => { load(); }, [load]);

    const submit = async (e) => {
        e.preventDefault();
        try {
            await api.post(`/hr/employees/${employee.employee_id}/compensation`, form);
            toast.success('Rate change recorded');
            setAdding(false);
            setForm(BLANK_COMPENSATION);
            load();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to record rate change');
        }
    };

    if (loading) return <LoadingState />;

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-100">Rate History</h3>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                        A rate change is a new dated record, never an edit — so past payroll stays reproducible.
                    </p>
                </div>
                {!adding && (
                    <button type="button" onClick={() => setAdding(true)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700">
                        Add rate change
                    </button>
                )}
            </div>

            {adding && (
                <form onSubmit={submit} className="space-y-2 p-3 rounded-lg bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700">
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Effective Date</label>
                            <input type="date" required className={INPUT_CLASS} value={form.effective_date}
                                onChange={(e) => setForm({ ...form, effective_date: e.target.value })} />
                        </div>
                        <div>
                            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Pay Basis</label>
                            <select className={INPUT_CLASS} value={form.pay_basis}
                                onChange={(e) => changeBasis(e.target.value)}>
                                <option value="daily">Daily rate</option>
                                <option value="monthly">Monthly salary</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <div>
                            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">
                                {isMonthly ? 'Monthly Salary' : 'Daily Rate'}
                            </label>
                            <input type="number" step="0.01" min="0" required className={INPUT_CLASS} value={form.base_rate}
                                onChange={(e) => setForm({ ...form, base_rate: e.target.value })} />
                        </div>
                        {isMonthly && (
                            <div>
                                <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Salary Model</label>
                                <select className={INPUT_CLASS} value={form.salary_model}
                                    onChange={(e) => setForm({ ...form, salary_model: e.target.value })}>
                                    <option value="GUARANTEED">Guaranteed — attendance never reduces pay</option>
                                    <option value="ATTENDANCE">Attendance-based — unpaid absences deduct</option>
                                </select>
                            </div>
                        )}
                    </div>
                    {isMonthly && (
                        <p className="text-xs text-gray-500 dark:text-slate-400">
                            {form.salary_model === 'ATTENDANCE'
                                ? 'Paid exactly half the monthly salary each cutoff, less unpaid absences and approved leave without pay.'
                                : 'Paid exactly half the monthly salary each cutoff regardless of attendance. Only approved leave without pay reduces it.'}
                        </p>
                    )}
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-300">
                            <input type="checkbox" checked={form.is_overtime_exempt}
                                onChange={(e) => setForm({ ...form, is_overtime_exempt: e.target.checked })} />
                            Exempt from overtime
                        </label>
                        <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-slate-300">
                            <input type="checkbox" checked={form.is_tardiness_exempt}
                                onChange={(e) => setForm({ ...form, is_tardiness_exempt: e.target.checked })} />
                            Exempt from tardiness deductions
                        </label>
                    </div>
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Reason</label>
                        <input type="text" className={INPUT_CLASS} placeholder="Hire, Regularization, Merit increase, Wage order"
                            value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
                    </div>
                    <div className="flex gap-2">
                        <button type="submit" className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700">Save</button>
                        <button type="button" onClick={() => setAdding(false)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">Cancel</button>
                    </div>
                </form>
            )}

            {history.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-slate-400 py-6 text-center">No compensation on record yet.</p>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                        <thead className="border-b border-gray-200 dark:border-slate-700">
                            <tr className="text-xs text-gray-500 dark:text-slate-400">
                                <th className="py-2 font-semibold">Effective</th>
                                <th className="py-2 font-semibold">Basis</th>
                                <th className="py-2 font-semibold text-right">Rate</th>
                                <th className="py-2 font-semibold">Reason</th>
                                <th className="py-2 font-semibold">Recorded By</th>
                            </tr>
                        </thead>
                        <tbody>
                            {history.map((row, idx) => (
                                <tr key={row.compensation_id} className="border-b border-gray-100 dark:border-slate-800">
                                    <td className="py-2 text-gray-900 dark:text-slate-100">
                                        {row.effective_date}
                                        {/* The first row is the newest: history comes back newest-first. */}
                                        {idx === 0 && <span className="ml-2 text-[10px] font-bold uppercase text-success-600">Current</span>}
                                    </td>
                                    <td className="py-2 text-gray-600 dark:text-slate-400">
                                        {row.pay_basis === 'monthly' ? 'Monthly' : 'Daily'}
                                        {row.salary_model === 'ATTENDANCE' && (
                                            <span className="ml-1 text-[10px] uppercase text-gray-400 dark:text-slate-500">att.</span>
                                        )}
                                        {row.is_overtime_exempt && (
                                            <span className="ml-1 text-[10px] uppercase text-gray-400 dark:text-slate-500">OT-exempt</span>
                                        )}
                                    </td>
                                    <td className="py-2 text-right tabular-nums text-gray-900 dark:text-slate-100">
                                        {peso(row.base_rate)}
                                        <span className="ml-1 text-[10px] text-gray-400 dark:text-slate-500">
                                            {row.pay_basis === 'monthly' ? '/mo' : '/day'}
                                        </span>
                                    </td>
                                    <td className="py-2 text-gray-600 dark:text-slate-400">{row.reason || '—'}</td>
                                    <td className="py-2 text-gray-600 dark:text-slate-400">{row.created_by_name || '—'}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

// --- Benefits, deductions and statutory overrides ------------------------

const FREQUENCY_LABEL = {
    EVERY_CUTOFF: 'Every cutoff',
    FIRST_CUTOFF: '1st cutoff only',
    SECOND_CUTOFF: '2nd cutoff only',
    MONTHLY: 'Monthly (split)',
};

const OVERRIDABLE = [
    ['SSS_EE', 'SSS'],
    ['SSS_MPF_EE', 'SSS WISP'],
    ['PHIC_EE', 'PhilHealth'],
    ['HDMF_EE', 'Pag-IBIG'],
    ['WTAX', 'Withholding Tax'],
];

const PayComponentsTab = ({ employee, canOverride }) => {
    const [catalog, setCatalog] = useState([]);
    const [assigned, setAssigned] = useState([]);
    const [overrides, setOverrides] = useState([]);
    const [loading, setLoading] = useState(true);
    const [addingComponent, setAddingComponent] = useState(false);
    const [addingOverride, setAddingOverride] = useState(false);
    const [cForm, setCForm] = useState({ component_code: '', amount: '', frequency: 'MONTHLY', effective_from: '' });
    const [oForm, setOForm] = useState({ component_code: 'HDMF_EE', override_amount: '', reason: '', effective_from: '' });

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const requests = [
                api.get('/hr/pay-components'),
                api.get(`/hr/employees/${employee.employee_id}/pay-components`),
            ];
            if (canOverride) requests.push(api.get(`/hr/employees/${employee.employee_id}/statutory-overrides`));
            const [cat, mine, ov] = await Promise.all(requests);
            setCatalog(Array.isArray(cat.data) ? cat.data : []);
            setAssigned(Array.isArray(mine.data) ? mine.data : []);
            setOverrides(ov && Array.isArray(ov.data) ? ov.data : []);
        } catch {
            toast.error('Failed to load pay components');
        } finally {
            setLoading(false);
        }
    }, [employee.employee_id, canOverride]);

    useEffect(() => { load(); }, [load]);

    const addComponent = async (e) => {
        e.preventDefault();
        try {
            await api.post(`/hr/employees/${employee.employee_id}/pay-components`, cForm);
            toast.success('Component assigned');
            setAddingComponent(false);
            setCForm({ component_code: '', amount: '', frequency: 'MONTHLY', effective_from: '' });
            load();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to assign component');
        }
    };

    const removeComponent = async (epcId) => {
        if (!window.confirm('Stop applying this component? Past payslips are unaffected.')) return;
        try {
            await api.delete(`/hr/employees/${employee.employee_id}/pay-components/${epcId}`);
            toast.success('Component removed');
            load();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to remove');
        }
    };

    const addOverride = async (e) => {
        e.preventDefault();
        try {
            await api.post(`/hr/employees/${employee.employee_id}/statutory-overrides`, oForm);
            toast.success('Override saved');
            setAddingOverride(false);
            setOForm({ component_code: 'HDMF_EE', override_amount: '', reason: '', effective_from: '' });
            load();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save override');
        }
    };

    const removeOverride = async (id) => {
        if (!window.confirm('Remove this override? The standard computed amount will apply again.')) return;
        try {
            await api.delete(`/hr/employees/${employee.employee_id}/statutory-overrides/${id}`);
            toast.success('Override removed');
            load();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to remove');
        }
    };

    if (loading) return <LoadingState />;

    const active = assigned.filter((a) => a.is_active);

    return (
        <div className="p-4 space-y-6">
            <div>
                <div className="flex items-center justify-between mb-2">
                    <div>
                        <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-100">Benefits &amp; Deductions</h3>
                        <p className="text-xs text-gray-500 dark:text-slate-400">
                            Recurring items added to every payroll run in their date range.
                        </p>
                    </div>
                    {!addingComponent && (
                        <button type="button" onClick={() => setAddingComponent(true)}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 flex-shrink-0">
                            Add
                        </button>
                    )}
                </div>

                {addingComponent && (
                    <form onSubmit={addComponent} className="space-y-2 p-3 mb-3 rounded-lg bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700">
                        <select required className={INPUT_CLASS} value={cForm.component_code}
                            onChange={(e) => setCForm({ ...cForm, component_code: e.target.value })}>
                            <option value="">Select a component…</option>
                            <optgroup label="Earnings">
                                {catalog.filter((c) => c.component_type === 'EARNING').map((c) => (
                                    <option key={c.component_code} value={c.component_code}>
                                        {c.component_name}{c.is_taxable ? ' (taxable)' : ''}
                                    </option>
                                ))}
                            </optgroup>
                            <optgroup label="Deductions">
                                {catalog.filter((c) => c.component_type === 'DEDUCTION').map((c) => (
                                    <option key={c.component_code} value={c.component_code}>{c.component_name}</option>
                                ))}
                            </optgroup>
                        </select>
                        <div className="grid grid-cols-2 gap-2">
                            <input type="number" step="0.01" min="0" required placeholder="Amount" className={INPUT_CLASS}
                                value={cForm.amount} onChange={(e) => setCForm({ ...cForm, amount: e.target.value })} />
                            <select className={INPUT_CLASS} value={cForm.frequency}
                                onChange={(e) => setCForm({ ...cForm, frequency: e.target.value })}>
                                {Object.entries(FREQUENCY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                            </select>
                        </div>
                        <input type="date" required className={INPUT_CLASS} value={cForm.effective_from}
                            onChange={(e) => setCForm({ ...cForm, effective_from: e.target.value })} />
                        <div className="flex gap-2">
                            <button type="submit" className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white">Save</button>
                            <button type="button" onClick={() => setAddingComponent(false)}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">Cancel</button>
                        </div>
                    </form>
                )}

                {active.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-slate-400 py-4 text-center">Nothing assigned yet.</p>
                ) : (
                    <table className="w-full text-left text-sm">
                        <tbody>
                            {active.map((a) => (
                                <tr key={a.epc_id} className="border-b border-gray-100 dark:border-slate-800">
                                    <td className="py-2">
                                        <div className="text-gray-900 dark:text-slate-100">{a.component_name}</div>
                                        <div className="text-xs text-gray-500 dark:text-slate-400">
                                            {FREQUENCY_LABEL[a.frequency]} · from {a.effective_from}
                                        </div>
                                    </td>
                                    <td className="py-2 text-right">
                                        <StatusBadge tone={a.component_type === 'EARNING' ? 'success' : 'warning'}
                                            label={a.component_type === 'EARNING' ? 'Earning' : 'Deduction'} />
                                    </td>
                                    <td className="py-2 text-right tabular-nums text-gray-900 dark:text-slate-100">
                                        {a.rate_percent != null ? `${(Number(a.rate_percent) * 100).toFixed(2)}%` : peso(a.amount)}
                                    </td>
                                    <td className="py-2 text-right">
                                        <button onClick={() => removeComponent(a.epc_id)}
                                            className="text-xs text-danger-600 hover:text-danger-800">Remove</button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {canOverride && (
                <div className="border-t border-gray-200 dark:border-slate-700 pt-4">
                    <div className="flex items-center justify-between mb-2">
                        <div>
                            <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-100">Statutory Overrides</h3>
                            <p className="text-xs text-gray-500 dark:text-slate-400">
                                Replace a computed contribution with a fixed monthly amount. Every override is logged with its reason.
                            </p>
                        </div>
                        {!addingOverride && (
                            <button type="button" onClick={() => setAddingOverride(true)}
                                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 flex-shrink-0">
                                Add
                            </button>
                        )}
                    </div>

                    {addingOverride && (
                        <form onSubmit={addOverride} className="space-y-2 p-3 mb-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
                            <div className="grid grid-cols-2 gap-2">
                                <select className={INPUT_CLASS} value={oForm.component_code}
                                    onChange={(e) => setOForm({ ...oForm, component_code: e.target.value })}>
                                    {OVERRIDABLE.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                                </select>
                                <input type="number" step="0.01" min="0" required placeholder="Monthly amount"
                                    className={INPUT_CLASS} value={oForm.override_amount}
                                    onChange={(e) => setOForm({ ...oForm, override_amount: e.target.value })} />
                            </div>
                            <input type="date" required className={INPUT_CLASS} value={oForm.effective_from}
                                onChange={(e) => setOForm({ ...oForm, effective_from: e.target.value })} />
                            <textarea required rows={2} placeholder="Reason (required)" className={INPUT_CLASS}
                                value={oForm.reason} onChange={(e) => setOForm({ ...oForm, reason: e.target.value })} />
                            <div className="flex gap-2">
                                <button type="submit" className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white">Save</button>
                                <button type="button" onClick={() => setAddingOverride(false)}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">Cancel</button>
                            </div>
                        </form>
                    )}

                    {overrides.filter((o) => o.is_active).length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-slate-400 py-4 text-center">
                            No overrides — standard rates apply.
                        </p>
                    ) : (
                        <table className="w-full text-left text-sm">
                            <tbody>
                                {overrides.filter((o) => o.is_active).map((o) => (
                                    <tr key={o.override_id} className="border-b border-gray-100 dark:border-slate-800">
                                        <td className="py-2">
                                            <div className="text-gray-900 dark:text-slate-100">{o.component_name}</div>
                                            <div className="text-xs text-gray-500 dark:text-slate-400">
                                                from {o.effective_from} · {o.reason}
                                            </div>
                                        </td>
                                        <td className="py-2 text-right tabular-nums text-gray-900 dark:text-slate-100">
                                            {peso(o.override_amount)}/mo
                                        </td>
                                        <td className="py-2 text-right">
                                            <button onClick={() => removeOverride(o.override_id)}
                                                className="text-xs text-danger-600 hover:text-danger-800">Remove</button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
};

// --- Government IDs ------------------------------------------------------

const GOV_FIELDS = [
    ['sss_no', 'SSS Number'],
    ['tin', 'TIN'],
    ['philhealth_no', 'PhilHealth Number'],
    ['pagibig_mid_no', 'Pag-IBIG MID'],
    ['bank_name', 'Bank'],
    ['bank_account_name', 'Account Name'],
    ['bank_account_no', 'Account Number'],
];

const GovernmentIdsTab = ({ employee }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get(`/hr/employees/${employee.employee_id}/government-ids`);
            setData(res.data || {});
        } catch {
            toast.error('Failed to load government IDs');
        } finally {
            setLoading(false);
        }
    }, [employee.employee_id]);

    useEffect(() => { load(); }, [load]);

    const submit = async (e) => {
        e.preventDefault();
        try {
            const res = await api.put(`/hr/employees/${employee.employee_id}/government-ids`, form);
            setData(res.data);
            setEditing(false);
            toast.success('Government IDs saved');
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save government IDs');
        }
    };

    if (loading) return <LoadingState />;

    return (
        <div className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
                <p className="text-xs text-gray-500 dark:text-slate-400">
                    Every view and change of this tab is recorded in an access log.
                </p>
                {!editing && (
                    <button type="button" onClick={() => { setForm({ ...data }); setEditing(true); }}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 flex-shrink-0">
                        Edit
                    </button>
                )}
            </div>

            {editing ? (
                <form onSubmit={submit} className="space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {GOV_FIELDS.map(([key, label]) => (
                            <div key={key}>
                                <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">{label}</label>
                                <input type="text" className={INPUT_CLASS} value={form[key] || ''}
                                    onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
                            </div>
                        ))}
                    </div>
                    <div className="flex gap-2">
                        <button type="submit" className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700">Save</button>
                        <button type="button" onClick={() => setEditing(false)} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">Cancel</button>
                    </div>
                </form>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {GOV_FIELDS.map(([key, label]) => (
                        <DetailRow key={key} label={label} value={data?.[key]} />
                    ))}
                </div>
            )}
        </div>
    );
};

// --- Drawer shell --------------------------------------------------------

const EmployeeDetailDrawer = ({ employeeId, isOpen, onClose, roles = [], onEmployeeChanged }) => {
    const { hasPermission } = useAuth();
    const [employee, setEmployee] = useState(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('profile');

    const canSeeSensitive = hasPermission('hr:view_sensitive');
    const canSeeCompensation = hasPermission('hr:manage_compensation');
    const canOverride = hasPermission('payroll:override');
    const canManageAccess = hasPermission('employees:edit');

    const load = useCallback(async () => {
        if (!employeeId) return;
        setLoading(true);
        try {
            const { data } = await api.get(`/employees/${employeeId}`);
            setEmployee(data);
        } catch {
            toast.error('Failed to load employee');
        } finally {
            setLoading(false);
        }
    }, [employeeId]);

    useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

    // Reset to the first tab between employees so the drawer never opens on a
    // tab the next employee's viewer is not allowed to see.
    useEffect(() => { setActiveTab('profile'); }, [employeeId]);

    const handleChanged = () => { load(); onEmployeeChanged?.(); };

    const tabs = [
        { key: 'profile', label: 'Profile' },
        { key: 'employment', label: 'Employment' },
        ...(canSeeCompensation ? [{ key: 'compensation', label: 'Compensation' }] : []),
        ...(canSeeCompensation ? [{ key: 'components', label: 'Pay Items' }] : []),
        ...(canSeeSensitive ? [{ key: 'government', label: 'Government IDs' }] : []),
    ];

    const fullName = employee
        ? [employee.first_name, employee.middle_name, employee.last_name, employee.suffix].filter(Boolean).join(' ')
        : 'Employee';

    return (
        <Drawer isOpen={isOpen} onClose={onClose} title={fullName} size="lg">
            {loading || !employee ? (
                <LoadingState />
            ) : (
                <div>
                    <div className="px-4 pt-2 pb-3 border-b border-gray-200 dark:border-slate-700">
                        <div className="flex flex-wrap items-center gap-2 mb-3">
                            <StatusBadge
                                tone={STATUS_TONE[employee.employment_status] || 'neutral'}
                                label={employee.employment_status || 'Unknown'}
                            />
                            {!employee.has_system_access && <StatusBadge tone="neutral" label="No login" />}
                            {!employee.is_active && <StatusBadge tone="danger" label="Inactive" />}
                            <span className="text-xs text-gray-500 dark:text-slate-400 tabular-nums">{employee.employee_code}</span>
                        </div>
                        <SegmentedTabs tabs={tabs} active={activeTab} onChange={setActiveTab} />
                    </div>

                    {activeTab === 'profile' && <ProfileTab employee={employee} />}
                    {activeTab === 'employment' && (
                        <EmploymentTab employee={employee} roles={roles} canManageAccess={canManageAccess} onEmployeeChanged={handleChanged} />
                    )}
                    {activeTab === 'compensation' && canSeeCompensation && <CompensationTab employee={employee} />}
                    {activeTab === 'components' && canSeeCompensation && (
                        <PayComponentsTab employee={employee} canOverride={canOverride} />
                    )}
                    {activeTab === 'government' && canSeeSensitive && <GovernmentIdsTab employee={employee} />}
                </div>
            )}
        </Drawer>
    );
};

export default EmployeeDetailDrawer;
