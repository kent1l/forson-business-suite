import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import StatusBadge from '../components/ui/StatusBadge';
import InfoTip from '../components/ui/InfoTip';
import { useAuth } from '../contexts/AuthContext';

const INPUT_CLASS = 'px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

// 0 = Sunday, matching Postgres EXTRACT(DOW) and work_schedule_day.day_of_week.
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const blankWeek = () => DAY_NAMES.map((_, dow) => ({
    day_of_week: dow,
    is_rest_day: false,
    time_in: '07:00',
    time_out: dow === 0 ? '15:00' : '17:00',
    break_minutes: 60,
    expected_hours: dow === 0 ? 7 : 9,
}));

/** The API hands back times as HH:MM:SS; <input type="time"> wants HH:MM. */
const toTimeInput = (v) => (v ? String(v).slice(0, 5) : '');

const normaliseWeek = (days) => {
    const byDow = new Map((days || []).map((d) => [Number(d.day_of_week), d]));
    const defaults = blankWeek();
    return DAY_NAMES.map((_, dow) => {
        const d = byDow.get(dow);
        if (!d) return { ...defaults[dow], is_rest_day: true };
        return {
            day_of_week: dow,
            is_rest_day: Boolean(d.is_rest_day),
            time_in: toTimeInput(d.time_in) || defaults[dow].time_in,
            time_out: toTimeInput(d.time_out) || defaults[dow].time_out,
            break_minutes: d.break_minutes ?? defaults[dow].break_minutes,
            expected_hours: d.expected_hours ?? defaults[dow].expected_hours,
        };
    });
};

const WorkSchedulesPage = () => {
    const { hasPermission } = useAuth();
    const canView = hasPermission('hr:view');
    const canManage = hasPermission('hr:manage_schedules');

    const [schedules, setSchedules] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedId, setSelectedId] = useState(null);
    const [form, setForm] = useState(null);
    const [saving, setSaving] = useState(false);

    const load = useCallback(async () => {
        if (!canView) { setLoading(false); return; }
        setLoading(true);
        setError('');
        try {
            const { data } = await api.get('/hr/work-schedules');
            const list = Array.isArray(data) ? data : [];
            setSchedules(list);
            setSelectedId((prev) => (prev ?? list[0]?.schedule_id ?? null));
        } catch {
            setError('Failed to load work schedules.');
        } finally {
            setLoading(false);
        }
    }, [canView]);

    useEffect(() => { load(); }, [load]);

    // Reset the editor whenever the selection changes, so an abandoned edit on
    // one schedule never leaks into another.
    useEffect(() => {
        if (selectedId === 'new') {
            setForm({ schedule_name: '', description: '', is_default: false, is_active: true, days: blankWeek() });
            return;
        }
        const found = schedules.find((s) => s.schedule_id === selectedId);
        if (!found) { setForm(null); return; }
        setForm({
            schedule_name: found.schedule_name || '',
            description: found.description || '',
            is_default: Boolean(found.is_default),
            is_active: found.is_active !== false,
            days: normaliseWeek(found.days),
        });
    }, [selectedId, schedules]);

    const setDay = (dow, patch) => {
        setForm((f) => ({
            ...f,
            days: f.days.map((d) => (d.day_of_week === dow ? { ...d, ...patch } : d)),
        }));
    };

    const save = async () => {
        if (!form.schedule_name.trim()) return toast.error('Schedule name is required');
        if (form.days.every((d) => d.is_rest_day)) return toast.error('A schedule needs at least one working day');
        const bad = form.days.find((d) => !d.is_rest_day && (!d.time_in || !d.time_out));
        if (bad) return toast.error(`${DAY_NAMES[bad.day_of_week]} needs both a time in and a time out`);

        setSaving(true);
        try {
            const payload = { ...form };
            if (selectedId === 'new') {
                const { data } = await api.post('/hr/work-schedules', payload);
                toast.success('Work schedule created');
                await load();
                setSelectedId(data.schedule_id);
            } else {
                await api.put(`/hr/work-schedules/${selectedId}`, payload);
                toast.success('Work schedule saved');
                await load();
            }
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save work schedule');
        } finally {
            setSaving(false);
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

    const restDayCount = form ? form.days.filter((d) => d.is_rest_day).length : 0;

    return (
        <div>
            <div className="flex flex-wrap justify-between items-center gap-3 mb-2">
                <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Work Schedules</h1>
                {canManage && (
                    <button onClick={() => setSelectedId('new')}
                        className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition">
                        New schedule
                    </button>
                )}
            </div>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-6">
                A weekly pattern of working days and rest days. Generating daily time records stamps each
                employee&rsquo;s assigned schedule onto the period; a moved rest day is then corrected on the
                day itself in Time Records, and that correction survives future generation runs.
            </p>

            {loading && <LoadingState label="Loading schedules…" />}
            {!loading && error && <ErrorState description={error} onRetry={load} />}

            {!loading && !error && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="lg:col-span-1 space-y-2">
                        {schedules.length === 0 && selectedId !== 'new' && (
                            <EmptyState title="No schedules yet" description="Create one to define working days and rest days." />
                        )}
                        {schedules.map((s) => (
                            <button key={s.schedule_id} type="button" onClick={() => setSelectedId(s.schedule_id)}
                                className={`w-full text-left p-3 rounded-xl border transition ${
                                    selectedId === s.schedule_id
                                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                        : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-gray-50 dark:hover:bg-slate-700/40'
                                }`}>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="font-medium text-gray-800 dark:text-slate-100">{s.schedule_name}</span>
                                    <div className="flex items-center gap-1 shrink-0">
                                        {s.is_default && <StatusBadge tone="primary" label="Default" />}
                                        {!s.is_active && <StatusBadge tone="neutral" label="Inactive" />}
                                    </div>
                                </div>
                                <div className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                    {s.employee_count} employee{s.employee_count === 1 ? '' : 's'}
                                    {' · '}
                                    {(s.days || []).filter((d) => d.is_rest_day).length} rest day
                                    {(s.days || []).filter((d) => d.is_rest_day).length === 1 ? '' : 's'}
                                </div>
                            </button>
                        ))}
                        {selectedId === 'new' && (
                            <div className="w-full text-left p-3 rounded-xl border border-primary-500 bg-primary-50 dark:bg-primary-900/20">
                                <span className="font-medium text-gray-800 dark:text-slate-100">New schedule</span>
                            </div>
                        )}
                    </div>

                    <div className="lg:col-span-2">
                        {!form ? (
                            <EmptyState title="Select a schedule" description="Pick a schedule on the left to view or edit its week." />
                        ) : (
                            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 space-y-5">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Schedule name</label>
                                        <input type="text" value={form.schedule_name} disabled={!canManage}
                                            onChange={(e) => setForm((f) => ({ ...f, schedule_name: e.target.value }))}
                                            placeholder="e.g. Mon-Sat, Sunday rest"
                                            className={`${INPUT_CLASS} w-full`} />
                                    </div>
                                    <div>
                                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Description</label>
                                        <input type="text" value={form.description} disabled={!canManage}
                                            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                                            className={`${INPUT_CLASS} w-full`} />
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-4">
                                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                                        <input type="checkbox" checked={form.is_default} disabled={!canManage}
                                            onChange={(e) => setForm((f) => ({ ...f, is_default: e.target.checked }))} />
                                        Default for new employees
                                    </label>
                                    <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
                                        <input type="checkbox" checked={form.is_active} disabled={!canManage}
                                            onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))} />
                                        Active
                                    </label>
                                </div>

                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="border-b border-gray-200 dark:border-slate-700">
                                            <tr className="text-xs font-semibold text-gray-600 dark:text-slate-400">
                                                <th className="p-2">Day</th>
                                                <th className="p-2 text-center">
                                                    <span className="inline-flex items-center gap-1 justify-center">
                                                        Rest day
                                                        <InfoTip label="Rest day">
                                                            Marks the day non-working and disables its Time In, Time Out, and Break fields. A schedule needs at least one day that isn't a rest day.
                                                        </InfoTip>
                                                    </span>
                                                </th>
                                                <th className="p-2">Time in</th>
                                                <th className="p-2">Time out</th>
                                                <th className="p-2 text-right">Break (min)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {form.days.map((d) => (
                                                <tr key={d.day_of_week}
                                                    className={`border-b border-gray-100 dark:border-slate-700/60 ${
                                                        d.is_rest_day ? 'bg-gray-50 dark:bg-slate-700/30' : ''}`}>
                                                    <td className="p-2 text-sm font-medium text-gray-800 dark:text-slate-100">
                                                        {DAY_NAMES[d.day_of_week]}
                                                    </td>
                                                    <td className="p-2 text-center">
                                                        <input type="checkbox" checked={d.is_rest_day} disabled={!canManage}
                                                            onChange={(e) => setDay(d.day_of_week, { is_rest_day: e.target.checked })} />
                                                    </td>
                                                    <td className="p-2">
                                                        <input type="time" value={d.time_in} disabled={!canManage || d.is_rest_day}
                                                            onChange={(e) => setDay(d.day_of_week, { time_in: e.target.value })}
                                                            className={`${INPUT_CLASS} disabled:opacity-40`} />
                                                    </td>
                                                    <td className="p-2">
                                                        <input type="time" value={d.time_out} disabled={!canManage || d.is_rest_day}
                                                            onChange={(e) => setDay(d.day_of_week, { time_out: e.target.value })}
                                                            className={`${INPUT_CLASS} disabled:opacity-40`} />
                                                    </td>
                                                    <td className="p-2 text-right">
                                                        <input type="number" min="0" value={d.break_minutes}
                                                            disabled={!canManage || d.is_rest_day}
                                                            onChange={(e) => setDay(d.day_of_week, { break_minutes: Number(e.target.value) })}
                                                            className={`${INPUT_CLASS} w-24 text-right disabled:opacity-40`} />
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                <div className="flex items-center justify-between gap-3 pt-2 border-t border-gray-100 dark:border-slate-700">
                                    <span className="text-xs text-gray-500 dark:text-slate-400">
                                        {restDayCount} rest day{restDayCount === 1 ? '' : 's'} per week
                                    </span>
                                    {canManage && (
                                        <button onClick={save} disabled={saving}
                                            className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition disabled:opacity-50">
                                            {saving ? 'Saving…' : selectedId === 'new' ? 'Create schedule' : 'Save changes'}
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default WorkSchedulesPage;
