import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import KPICard from '../components/ui/KPICard';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import InfoTip from '../components/ui/InfoTip';
import AttendanceGrid from '../components/hr/AttendanceGrid';
import { useAuth } from '../contexts/AuthContext';

const INPUT_CLASS = 'px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

const DAY_TYPES = [
    'Present', 'Half Day', 'Absent', 'On Leave',
    'Rest Day', 'Rest Day Worked', 'Holiday', 'Holiday Worked', 'Suspended',
];

const DAY_TONE = {
    Present: 'success',
    'Half Day': 'warning',
    Absent: 'danger',
    'On Leave': 'info',
    'Rest Day': 'neutral',
    'Rest Day Worked': 'primary',
    Holiday: 'neutral',
    'Holiday Worked': 'primary',
    Suspended: 'warning',
};

/**
 * Returns the semi-monthly period containing `today` — the 1st-15th or the
 * 16th-end of month, matching the company's payroll cutoffs.
 */
const currentPeriod = () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (now.getDate() <= 15) {
        return { from: iso(new Date(y, m, 1)), to: iso(new Date(y, m, 15)) };
    }
    return { from: iso(new Date(y, m, 16)), to: iso(new Date(y, m + 1, 0)) };
};

const DtrPage = () => {
    const { hasPermission } = useAuth();
    // The grid opens first: "who was in this period?" is the question HR asks on
    // arrival, and the flat table only answers it one row at a time.
    const [tab, setTab] = useState('grid');
    const [period, setPeriod] = useState(currentPeriod);
    const [departments, setDepartments] = useState([]);
    const [departmentFilter, setDepartmentFilter] = useState('');
    const [employeeFilter, setEmployeeFilter] = useState('');
    const [employees, setEmployees] = useState([]);

    const [records, setRecords] = useState([]);
    const [summary, setSummary] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [generating, setGenerating] = useState(false);
    const [savingId, setSavingId] = useState(null);

    const canView = hasPermission('dtr:view');
    const canEdit = hasPermission('dtr:edit');
    const canGenerate = hasPermission('dtr:generate');

    useEffect(() => {
        if (!canView) return;
        Promise.all([
            api.get('/hr/departments'),
            api.get('/employees', { params: { status: 'active' } }),
        ]).then(([d, e]) => {
            setDepartments(Array.isArray(d.data) ? d.data : []);
            setEmployees(Array.isArray(e.data) ? e.data : (e.data?.data || []));
        }).catch(() => { /* filters degrade to All */ });
    }, [canView]);

    const load = useCallback(async () => {
        if (!canView) { setLoading(false); return; }
        setLoading(true);
        setError('');
        try {
            const params = {
                from: period.from,
                to: period.to,
                department: departmentFilter || undefined,
            };
            if (tab === 'records' || tab === 'grid') {
                const { data } = await api.get('/dtr', {
                    params: { ...params, employee_id: employeeFilter || undefined },
                });
                setRecords(Array.isArray(data) ? data : (data?.data || []));
            } else {
                const { data } = await api.get('/dtr/summary', { params });
                setSummary(Array.isArray(data) ? data : []);
            }
        } catch {
            setError('Failed to load daily time records.');
        } finally {
            setLoading(false);
        }
    }, [canView, tab, period, departmentFilter, employeeFilter]);

    useEffect(() => { load(); }, [load]);

    const generate = async () => {
        setGenerating(true);
        try {
            const { data } = await api.post('/dtr/generate', {
                from: period.from,
                to: period.to,
                department: departmentFilter || undefined,
            });
            toast.success(
                data.created > 0
                    ? `Created ${data.created} day${data.created === 1 ? '' : 's'} for ${data.employees} employee${data.employees === 1 ? '' : 's'}.`
                    : 'Every day in this period already exists — nothing to create.'
            );
            load();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to generate records');
        } finally {
            setGenerating(false);
        }
    };

    // Inline edit: change a day type straight from the table, since that is the
    // correction HR makes constantly.
    const changeDayType = async (record, dayType) => {
        setSavingId(record.dtr_id);
        try {
            const { data } = await api.put(`/dtr/${record.dtr_id}`, { day_type: dayType });
            setRecords((prev) => prev.map((r) => (r.dtr_id === record.dtr_id ? { ...r, ...data } : r)));
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to update record');
            load();
        } finally {
            setSavingId(null);
        }
    };

    const stats = useMemo(() => {
        const paid = records.reduce((sum, r) => sum + Number(r.day_fraction || 0), 0);
        return {
            rows: records.length,
            paid: Math.round(paid * 100) / 100,
            absent: records.filter((r) => r.day_type === 'Absent').length,
            locked: records.filter((r) => r.is_locked).length,
        };
    }, [records]);

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
            <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Daily Time Records</h1>
                {canGenerate && (
                    <button onClick={generate} disabled={generating}
                        className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition disabled:opacity-50">
                        {generating ? 'Generating…' : 'Generate for period'}
                    </button>
                )}
            </div>

            <div className="flex flex-wrap gap-3 mb-4 items-end">
                <div>
                    <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">From</label>
                    <input type="date" value={period.from} className={INPUT_CLASS}
                        onChange={(e) => setPeriod((p) => ({ ...p, from: e.target.value }))} />
                </div>
                <div>
                    <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">To</label>
                    <input type="date" value={period.to} className={INPUT_CLASS}
                        onChange={(e) => setPeriod((p) => ({ ...p, to: e.target.value }))} />
                </div>
                <button type="button" onClick={() => setPeriod(currentPeriod())}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">
                    This cutoff
                </button>
                <div>
                    <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Department</label>
                    <select value={departmentFilter} onChange={(e) => setDepartmentFilter(e.target.value)} className={INPUT_CLASS}>
                        <option value="">All departments</option>
                        {departments.map((d) => <option key={d.department_id} value={d.department_id}>{d.department_name}</option>)}
                    </select>
                </div>
                {tab !== 'summary' && (
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Employee</label>
                        <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)} className={INPUT_CLASS}>
                            <option value="">All employees</option>
                            {employees.map((e) => (
                                <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name}</option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {tab !== 'summary' && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
                    <KPICard title="Day records" value={stats.rows} icon="invoice" color="blue" loading={loading} />
                    <KPICard title="Days payable" value={stats.paid} icon="currency" color="green" loading={loading} />
                    <KPICard title="Absences" value={stats.absent} icon="warning" color="amber" loading={loading} />
                    <KPICard title="Locked by payroll" value={stats.locked} icon="package" color="gray" loading={loading}
                        subtitle="Cannot be edited" />
                </div>
            )}

            <div className="mb-4 border-b border-gray-200 dark:border-slate-700">
                <SegmentedTabs
                    tabs={[
                        { key: 'grid', label: 'Attendance Grid' },
                        { key: 'records', label: 'Daily Records' },
                        { key: 'summary', label: 'Period Summary' },
                    ]}
                    active={tab}
                    onChange={setTab}
                />
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700">
                {loading && <LoadingState label="Loading records…" />}
                {!loading && error && <ErrorState description={error} onRetry={load} />}

                {!loading && !error && tab === 'grid' && (
                    records.length === 0 ? (
                        <EmptyState
                            title="No records for this period"
                            description={canGenerate
                                ? 'Use "Generate for period" to create days from each employee\'s work schedule.'
                                : 'Nothing has been generated for these dates yet.'}
                        />
                    ) : (
                        <AttendanceGrid
                            records={records}
                            period={period}
                            canEdit={canEdit}
                            savingId={savingId}
                            onChangeDayType={changeDayType}
                        />
                    )
                )}

                {!loading && !error && tab === 'records' && (
                    records.length === 0 ? (
                        <EmptyState
                            title="No records for this period"
                            description={canGenerate
                                ? 'Use "Generate for period" to create days from each employee\'s work schedule.'
                                : 'Nothing has been generated for these dates yet.'}
                        />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200 dark:border-slate-700">
                                    <tr className="text-sm font-semibold text-gray-600 dark:text-slate-400">
                                        <th className="p-2">Date</th>
                                        <th className="p-2">Employee</th>
                                        <th className="p-2">
                                            <span className="inline-flex items-center gap-1">
                                                Day Type
                                                <InfoTip label="Day Type">
                                                    Present, Half Day, Absent, On Leave, Rest Day, Rest Day Worked, Holiday, Holiday Worked, or Suspended — this is the attendance value payroll reads. Editable inline unless the day is locked.
                                                </InfoTip>
                                            </span>
                                        </th>
                                        <th className="p-2 text-right">Days</th>
                                        <th className="p-2 text-right">Hours</th>
                                        <th className="p-2">Shift</th>
                                        <th className="p-2">Remarks</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {records.map((r) => (
                                        <tr key={r.dtr_id} className="border-b border-gray-100 dark:border-slate-700/60 hover:bg-gray-50 dark:hover:bg-slate-700/40">
                                            <td className="p-2 text-sm tabular-nums text-gray-800 dark:text-slate-100 whitespace-nowrap">
                                                {r.work_date}
                                                {/* Spelled out rather than shown as an icon: there is no lock
                                                    glyph in ICONS, and "why can't I edit this?" needs a plain
                                                    answer more than it needs a symbol. */}
                                                {r.is_locked && (
                                                    <span className="ml-2 text-[10px] font-bold uppercase text-gray-400 dark:text-slate-500">
                                                        Locked
                                                    </span>
                                                )}
                                            </td>
                                            <td className="p-2 text-sm text-gray-800 dark:text-slate-100">{r.employee_name}</td>
                                            <td className="p-2 text-sm">
                                                {canEdit && !r.is_locked ? (
                                                    <select
                                                        value={r.day_type}
                                                        disabled={savingId === r.dtr_id}
                                                        onChange={(e) => changeDayType(r, e.target.value)}
                                                        className={`${INPUT_CLASS} py-1 text-xs`}
                                                    >
                                                        {DAY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                                                    </select>
                                                ) : (
                                                    <StatusBadge tone={DAY_TONE[r.day_type] || 'neutral'} label={r.day_type} />
                                                )}
                                            </td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-800 dark:text-slate-100">
                                                {Number(r.day_fraction).toFixed(2)}
                                            </td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">
                                                {Number(r.hours_worked).toFixed(2)}
                                            </td>
                                            <td className="p-2 text-xs text-gray-500 dark:text-slate-400 whitespace-nowrap">
                                                {r.time_in ? `${String(r.time_in).slice(0, 5)}–${String(r.time_out).slice(0, 5)}` : '—'}
                                            </td>
                                            <td className="p-2 text-xs text-gray-500 dark:text-slate-400">{r.remarks || '—'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                )}

                {!loading && !error && tab === 'summary' && (
                    summary.length === 0 ? (
                        <EmptyState title="Nothing to summarise" description="No payroll-eligible employees matched these filters." />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200 dark:border-slate-700">
                                    <tr className="text-sm font-semibold text-gray-600 dark:text-slate-400">
                                        <th className="p-2">Employee</th>
                                        <th className="p-2">Department</th>
                                        <th className="p-2 text-right">
                                            <span className="inline-flex items-center gap-1 justify-end">
                                                Days Paid
                                                <InfoTip label="Days Paid" align="right">
                                                    The sum of each day's day fraction for the period: a whole Present day counts as 1.00, a Half Day as 0.50, and non-working entries count as 0.00.
                                                </InfoTip>
                                            </span>
                                        </th>
                                        <th className="p-2 text-right">Worked</th>
                                        <th className="p-2 text-right">Absent</th>
                                        <th className="p-2 text-right">Leave</th>
                                        <th className="p-2 text-right">Holiday</th>
                                        <th className="p-2 text-right">Hours</th>
                                        <th className="p-2 text-right">OT</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {summary.map((s) => (
                                        <tr key={s.employee_id} className="border-b border-gray-100 dark:border-slate-700/60">
                                            <td className="p-2 text-sm font-medium text-gray-800 dark:text-slate-100">{s.employee_name}</td>
                                            <td className="p-2 text-sm text-gray-600 dark:text-slate-300">{s.department_name || '—'}</td>
                                            <td className="p-2 text-sm text-right tabular-nums font-semibold text-gray-900 dark:text-slate-50">
                                                {Number(s.days_paid).toFixed(2)}
                                            </td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">{s.days_worked}</td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">{s.days_absent}</td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">{s.days_on_leave}</td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">{s.days_holiday}</td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">
                                                {Number(s.hours_worked).toFixed(2)}
                                            </td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">
                                                {Number(s.overtime_hours).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                )}
            </div>
        </div>
    );
};

export default DtrPage;
