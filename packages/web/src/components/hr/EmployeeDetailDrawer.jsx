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

const CompensationTab = ({ employee }) => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const [adding, setAdding] = useState(false);
    const [form, setForm] = useState({ effective_date: '', base_rate: '', reason: '' });

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
            setForm({ effective_date: '', base_rate: '', reason: '' });
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
                            <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Daily Rate</label>
                            <input type="number" step="0.01" min="0" required className={INPUT_CLASS} value={form.base_rate}
                                onChange={(e) => setForm({ ...form, base_rate: e.target.value })} />
                        </div>
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
                                <th className="py-2 font-semibold text-right">Daily Rate</th>
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
                                    <td className="py-2 text-right tabular-nums text-gray-900 dark:text-slate-100">{peso(row.base_rate)}</td>
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
                    {activeTab === 'government' && canSeeSensitive && <GovernmentIdsTab employee={employee} />}
                </div>
            )}
        </Drawer>
    );
};

export default EmployeeDetailDrawer;
