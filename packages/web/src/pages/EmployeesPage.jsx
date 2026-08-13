import React, { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import Modal from '../components/ui/Modal';
import Icon from '../components/ui/Icon';
import { ICONS } from '../constants';
import FilterBar from '../components/ui/FilterBar';
import PaginationControls from '../components/ui/PaginationControls';
import SortableHeader from '../components/ui/SortableHeader';
import StatusBadge from '../components/ui/StatusBadge';
import KPICard from '../components/ui/KPICard';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import EmployeeForm from '../components/hr/EmployeeForm';
import EmployeeDetailDrawer from '../components/hr/EmployeeDetailDrawer';
import { useAuth } from '../contexts/AuthContext';

const SELECT_CLASS = 'px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

const STATUS_TONE = {
    Active: 'success',
    'On Leave': 'warning',
    Suspended: 'warning',
    Resigned: 'neutral',
    Terminated: 'danger',
    Retired: 'neutral',
};

const FILTER_TABS = [
    { key: 'active', label: 'Active' },
    { key: 'inactive', label: 'Inactive' },
    { key: 'all', label: 'All' },
];

const EmployeesPage = () => {
    const { hasPermission } = useAuth();
    const [employees, setEmployees] = useState([]);
    const [roles, setRoles] = useState([]);
    const [departments, setDepartments] = useState([]);
    const [allEmployees, setAllEmployees] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [currentEmployee, setCurrentEmployee] = useState(null);
    const [drawerEmployeeId, setDrawerEmployeeId] = useState(null);

    const [statusFilter, setStatusFilter] = useState('active');
    const [departmentFilter, setDepartmentFilter] = useState('');
    const [employmentStatusFilter, setEmploymentStatusFilter] = useState('');
    const [search, setSearch] = useState('');
    const [sortConfig, setSortConfig] = useState({ key: 'full_name', direction: 'ASC' });
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(25);
    const [total, setTotal] = useState(0);

    const canView = hasPermission('employees:view');
    const canEdit = hasPermission('employees:edit');

    const fetchEmployees = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const res = await api.get('/employees', {
                params: {
                    status: statusFilter,
                    department: departmentFilter || undefined,
                    employment_status: employmentStatusFilter || undefined,
                    search: search.trim() || undefined,
                    page,
                    pageSize,
                    paginated: 1,
                    sortBy: sortConfig.key,
                    sortOrder: sortConfig.direction,
                },
            });
            setEmployees(res.data?.data || []);
            setTotal(res.data?.total || 0);
        } catch {
            setError('Failed to load employees.');
        } finally {
            setLoading(false);
        }
    }, [statusFilter, departmentFilter, employmentStatusFilter, search, page, pageSize, sortConfig]);

    useEffect(() => {
        if (!canView) { setLoading(false); return; }
        fetchEmployees();
    }, [canView, fetchEmployees]);

    // Reference data changes rarely, so it is fetched once rather than on every
    // filter change. The manager list is fetched unpaginated and separately from
    // the table: picking a supervisor must offer every active employee, not just
    // whoever happens to be on the current page.
    useEffect(() => {
        if (!canView) return;
        Promise.all([
            api.get('/roles'),
            api.get('/hr/departments'),
            api.get('/employees', { params: { status: 'active' } }),
        ])
            .then(([rolesRes, deptRes, allRes]) => {
                setRoles(Array.isArray(rolesRes.data) ? rolesRes.data : []);
                setDepartments(Array.isArray(deptRes.data) ? deptRes.data : []);
                // Unpaginated requests return a bare array; paginated ones return
                // { data, total }. Handle both rather than assuming one shape.
                setAllEmployees(Array.isArray(allRes.data) ? allRes.data : (allRes.data?.data || []));
            })
            .catch(() => { /* filters degrade to "All"; the list still works */ });
    }, [canView]);

    useEffect(() => { setPage(1); }, [statusFilter, departmentFilter, employmentStatusFilter, search]);

    const stats = useMemo(() => {
        const noLogin = employees.filter((e) => !e.has_system_access).length;
        const regular = employees.filter((e) => e.employment_type === 'Regular').length;
        return { noLogin, regular };
    }, [employees]);

    const handleSort = (key, direction) => { setSortConfig({ key, direction }); setPage(1); };

    const handleSave = async (employeeData) => {
        const promise = currentEmployee
            ? api.put(`/employees/${currentEmployee.employee_id}`, employeeData)
            : api.post('/employees', employeeData);
        toast.promise(promise, {
            loading: 'Saving employee…',
            success: () => { setIsModalOpen(false); fetchEmployees(); return 'Employee saved successfully'; },
            error: (err) => err.response?.data?.message || 'Failed to save employee.',
        });
    };

    // Editing needs the full record (contact, emergency, employment), which the
    // list projection does not carry.
    const openEdit = async (employeeId) => {
        try {
            const { data } = await api.get(`/employees/${employeeId}`);
            setCurrentEmployee(data);
            setIsModalOpen(true);
        } catch {
            toast.error('Failed to load employee');
        }
    };

    if (!canView) {
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
                <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Employees</h1>
                {canEdit && (
                    <button onClick={() => { setCurrentEmployee(null); setIsModalOpen(true); }}
                        className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition">
                        Add Employee
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <KPICard title="Headcount" value={total} icon="package" color="blue" loading={loading} />
                <KPICard title="Regular (this page)" value={stats.regular} icon="invoice" color="green" loading={loading} />
                <KPICard title="No system login (this page)" value={stats.noLogin} icon="warning" color="amber" loading={loading}
                    subtitle="Paid staff without accounts" />
            </div>

            <FilterBar tabs={FILTER_TABS} activeTab={statusFilter} onTabClick={setStatusFilter} />

            <div className="flex flex-wrap gap-3 mb-4">
                <input
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search name, code, username, position…"
                    className={`${SELECT_CLASS} flex-1 min-w-[220px]`}
                />
                <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className={SELECT_CLASS}>
                    <option value="">All departments</option>
                    {departments.map((d) => (
                        <option key={d.department_id} value={d.department_id}>{d.department_name}</option>
                    ))}
                </select>
                <select value={employmentStatusFilter} onChange={(e) => setEmploymentStatusFilter(e.target.value)} className={SELECT_CLASS}>
                    <option value="">All employment statuses</option>
                    {Object.keys(STATUS_TONE).map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700">
                {loading && <LoadingState label="Loading employees…" />}
                {!loading && error && <ErrorState description={error} onRetry={fetchEmployees} />}
                {!loading && !error && employees.length === 0 && (
                    <EmptyState title="No employees found" description="Try a different filter, or add an employee." />
                )}
                {!loading && !error && employees.length > 0 && (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200 dark:border-slate-700">
                                    <tr>
                                        <SortableHeader column="employee_code" sortConfig={sortConfig} onSort={handleSort}>Code</SortableHeader>
                                        <SortableHeader column="full_name" sortConfig={sortConfig} onSort={handleSort}>Name</SortableHeader>
                                        <SortableHeader column="department_name" sortConfig={sortConfig} onSort={handleSort}>Department</SortableHeader>
                                        <SortableHeader column="position_title" sortConfig={sortConfig} onSort={handleSort}>Position</SortableHeader>
                                        <SortableHeader column="employment_status" sortConfig={sortConfig} onSort={handleSort}>Employment</SortableHeader>
                                        <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-400">Access</th>
                                        <th className="p-3 text-sm font-semibold text-gray-600 dark:text-slate-400 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {employees.map((emp) => (
                                        <tr
                                            key={emp.employee_id}
                                            onClick={() => setDrawerEmployeeId(emp.employee_id)}
                                            className="border-b border-gray-100 dark:border-slate-700/60 hover:bg-gray-50 dark:hover:bg-slate-700/40 cursor-pointer"
                                        >
                                            <td className="p-3 text-xs tabular-nums text-gray-500 dark:text-slate-400">{emp.employee_code || '—'}</td>
                                            <td className="p-3 text-sm font-medium text-gray-800 dark:text-slate-100">
                                                {emp.first_name} {emp.last_name}
                                                {!emp.is_active && <span className="ml-2 text-[10px] font-bold uppercase text-danger-600">Inactive</span>}
                                            </td>
                                            <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{emp.department_name || '—'}</td>
                                            <td className="p-3 text-sm text-gray-600 dark:text-slate-300">{emp.position_title || '—'}</td>
                                            <td className="p-3 text-sm">
                                                <StatusBadge
                                                    tone={STATUS_TONE[emp.employment_status] || 'neutral'}
                                                    label={emp.employment_status || '—'}
                                                />
                                            </td>
                                            <td className="p-3 text-sm text-gray-600 dark:text-slate-300">
                                                {emp.has_system_access
                                                    ? emp.username
                                                    : <span className="text-xs text-gray-400 dark:text-slate-500">No login</span>}
                                            </td>
                                            <td className="p-3 text-sm text-right">
                                                {canEdit && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); openEdit(emp.employee_id); }}
                                                        className="text-primary-600 hover:text-primary-800"
                                                        aria-label={`Edit ${emp.first_name} ${emp.last_name}`}
                                                    >
                                                        <Icon path={ICONS.edit} className="h-5 w-5" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <PaginationControls
                            page={page}
                            pageSize={pageSize}
                            total={total}
                            onPageChange={setPage}
                            onPageSizeChange={(value) => { setPageSize(value); setPage(1); }}
                        />
                    </>
                )}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title={currentEmployee ? 'Edit Employee' : 'Add New Employee'}>
                <EmployeeForm
                    employee={currentEmployee}
                    roles={roles}
                    departments={departments}
                    managers={allEmployees}
                    onSave={handleSave}
                    onCancel={() => setIsModalOpen(false)}
                />
            </Modal>

            <EmployeeDetailDrawer
                employeeId={drawerEmployeeId}
                isOpen={Boolean(drawerEmployeeId)}
                onClose={() => setDrawerEmployeeId(null)}
                roles={roles}
                onEmployeeChanged={fetchEmployees}
            />
        </div>
    );
};

export default EmployeesPage;
