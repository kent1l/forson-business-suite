import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import FilterBar from '../components/ui/FilterBar';
import StatusBadge from '../components/ui/StatusBadge';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../contexts/AuthContext';

const INPUT_CLASS = 'w-full px-3 py-2 border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1';

const EMPTY = { department_name: '', description: '', cost_center_code: '', head_employee_id: '', sort_order: 0, is_active: true };

const DepartmentForm = ({ department, employees, onSave, onCancel }) => {
    const [form, setForm] = useState(EMPTY);

    useEffect(() => {
        setForm(department
            ? {
                department_name: department.department_name || '',
                description: department.description || '',
                cost_center_code: department.cost_center_code || '',
                head_employee_id: department.head_employee_id || '',
                sort_order: department.sort_order ?? 0,
                is_active: department.is_active !== false,
            }
            : EMPTY);
    }, [department]);

    const change = (e) => {
        const { name, value, type, checked } = e.target;
        setForm((p) => ({ ...p, [name]: type === 'checkbox' ? checked : value }));
    };

    return (
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
            <div>
                <label className={LABEL_CLASS}>Department Name</label>
                <input type="text" name="department_name" value={form.department_name} onChange={change} className={INPUT_CLASS} required />
            </div>
            <div>
                <label className={LABEL_CLASS}>Description</label>
                <input type="text" name="description" value={form.description} onChange={change} className={INPUT_CLASS} />
            </div>
            <div className="grid grid-cols-2 gap-4">
                <div>
                    <label className={LABEL_CLASS}>Cost Center Code</label>
                    <input type="text" name="cost_center_code" value={form.cost_center_code} onChange={change} className={INPUT_CLASS} />
                </div>
                <div>
                    <label className={LABEL_CLASS}>Sort Order</label>
                    <input type="number" name="sort_order" value={form.sort_order} onChange={change} className={INPUT_CLASS} />
                </div>
            </div>
            <div>
                <label className={LABEL_CLASS}>Department Head</label>
                <select name="head_employee_id" value={form.head_employee_id} onChange={change} className={INPUT_CLASS}>
                    <option value="">—</option>
                    {employees.map((e) => (
                        <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name}</option>
                    ))}
                </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-900 dark:text-slate-200">
                <input type="checkbox" name="is_active" checked={form.is_active} onChange={change} className="h-4 w-4 rounded border-gray-300 text-primary-600" />
                Active
            </label>
            <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700">Save Department</button>
            </div>
        </form>
    );
};

const DepartmentsPage = () => {
    const { hasPermission } = useAuth();
    const [departments, setDepartments] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [statusFilter, setStatusFilter] = useState('active');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [current, setCurrent] = useState(null);

    const canManage = hasPermission('hr:manage_departments');

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const [deptRes, empRes] = await Promise.all([
                api.get('/hr/departments', { params: { status: statusFilter } }),
                api.get('/employees', { params: { status: 'active' } }),
            ]);
            setDepartments(Array.isArray(deptRes.data) ? deptRes.data : []);
            // Unpaginated list requests return a bare array; paginated ones return
            // { data, total }. Handle both rather than assuming one shape.
            setEmployees(Array.isArray(empRes.data) ? empRes.data : (empRes.data?.data || []));
        } catch {
            setError('Failed to load departments.');
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { load(); }, [load]);

    const save = async (form) => {
        const payload = { ...form, head_employee_id: form.head_employee_id || null };
        const promise = current
            ? api.put(`/hr/departments/${current.department_id}`, payload)
            : api.post('/hr/departments', payload);
        toast.promise(promise, {
            loading: 'Saving department…',
            success: () => { setIsModalOpen(false); load(); return 'Department saved'; },
            error: (err) => err.response?.data?.message || 'Failed to save department',
        });
    };

    if (!hasPermission('hr:view')) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-danger-600">Access Denied</h1>
                <p className="text-gray-600 dark:text-slate-400 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    return (
        <div>
            <div className="flex justify-between items-center mb-6">
                <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Departments</h1>
                {canManage && (
                    <button onClick={() => { setCurrent(null); setIsModalOpen(true); }}
                        className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition">
                        Add Department
                    </button>
                )}
            </div>

            <FilterBar
                tabs={[{ key: 'active', label: 'Active' }, { key: 'inactive', label: 'Inactive' }, { key: 'all', label: 'All' }]}
                activeTab={statusFilter}
                onTabClick={setStatusFilter}
            />

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700">
                {loading && <LoadingState label="Loading departments…" />}
                {!loading && error && <ErrorState description={error} onRetry={load} />}
                {!loading && !error && departments.length === 0 && (
                    <EmptyState title="No departments" description="Create a department to start organising employees." />
                )}
                {!loading && !error && departments.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="border-b border-gray-200 dark:border-slate-700">
                                <tr className="text-sm font-semibold text-gray-600 dark:text-slate-400">
                                    <th className="p-3">Department</th>
                                    <th className="p-3">Head</th>
                                    <th className="p-3">Cost Center</th>
                                    <th className="p-3 text-center">Employees</th>
                                    <th className="p-3 text-center">Status</th>
                                    <th className="p-3 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {departments.map((d) => (
                                    <tr key={d.department_id} className="border-b border-gray-100 dark:border-slate-700/60 hover:bg-gray-50 dark:hover:bg-slate-700/40">
                                        <td className="p-3 text-sm">
                                            <div className="font-medium text-gray-800 dark:text-slate-100">{d.department_name}</div>
                                            {d.description && <div className="text-xs text-gray-500 dark:text-slate-400">{d.description}</div>}
                                        </td>
                                        <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{d.head_name || '—'}</td>
                                        <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{d.cost_center_code || '—'}</td>
                                        <td className="p-3 text-sm text-center tabular-nums text-gray-800 dark:text-slate-100">{d.employee_count}</td>
                                        <td className="p-3 text-center">
                                            <StatusBadge tone={d.is_active ? 'success' : 'neutral'} label={d.is_active ? 'Active' : 'Inactive'} />
                                        </td>
                                        <td className="p-3 text-right">
                                            {canManage && (
                                                <button onClick={() => { setCurrent(d); setIsModalOpen(true); }}
                                                    className="text-primary-600 hover:text-primary-800" aria-label={`Edit ${d.department_name}`}>
                                                    <Icon path={ICONS.edit} className="h-5 w-5" />
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={current ? 'Edit Department' : 'Add Department'}>
                <DepartmentForm department={current} employees={employees} onSave={save} onCancel={() => setIsModalOpen(false)} />
            </Modal>
        </div>
    );
};

export default DepartmentsPage;
