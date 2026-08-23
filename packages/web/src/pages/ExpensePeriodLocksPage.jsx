import { useCallback, useEffect, useState } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import { ICONS } from '../constants';

const monthLabel = (periodMonth) =>
    new Date(`${periodMonth}T00:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

export default function ExpensePeriodLocksPage() {
    const [months, setMonths] = useState([]);
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(false);
    const [busyMonth, setBusyMonth] = useState(null);
    const [unlockTarget, setUnlockTarget] = useState(null); // { period_month }
    const [unlockReason, setUnlockReason] = useState('');

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const [monthsRes, historyRes] = await Promise.all([
                api.get('/period-locks', { params: { months: 12 } }),
                api.get('/period-locks/history', { params: { months: 12 } })
            ]);
            setMonths(monthsRes.data || []);
            setHistory(historyRes.data || []);
        } catch (error) {
            console.error('Error fetching period locks:', error);
            toast.error('Failed to load period locks');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleLock = async (periodMonth) => {
        setBusyMonth(periodMonth);
        try {
            await api.post('/period-locks/lock', { period_month: periodMonth.slice(0, 7) });
            toast.success(`${monthLabel(periodMonth)} locked`);
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to lock period');
        } finally {
            setBusyMonth(null);
        }
    };

    const openUnlockModal = (periodMonth) => {
        setUnlockTarget(periodMonth);
        setUnlockReason('');
    };

    const handleUnlock = async (e) => {
        e.preventDefault();
        if (!unlockReason.trim()) {
            toast.error('A reason is required to reopen a locked period');
            return;
        }
        setBusyMonth(unlockTarget);
        try {
            await api.post('/period-locks/unlock', {
                period_month: unlockTarget.slice(0, 7),
                reason: unlockReason.trim()
            });
            toast.success(`${monthLabel(unlockTarget)} reopened`);
            setUnlockTarget(null);
            fetchData();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Failed to reopen period');
        } finally {
            setBusyMonth(null);
        }
    };

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                    Expense Period Locks
                    <InfoTip label="Period Locks">
                        A locked month cannot be written to by anyone — no new expenses, edits, or voids dated
                        into it — until it is explicitly reopened. Reopening requires a reason and is logged, the
                        same way voiding an expense requires a reason. This protects reported figures from
                        silently changing after the fact.
                    </InfoTip>
                </h1>
                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                    Lock a month once its expenses are reported and reconciled. Reopen only when a correction is needed.
                </p>
            </div>

            <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-xs overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-gray-50 dark:bg-slate-900/50 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                        <tr>
                            <th className="px-6 py-3">Month</th>
                            <th className="px-6 py-3">Status</th>
                            <th className="px-6 py-3 text-right">Action</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                        {loading && (
                            <tr><td colSpan={3} className="px-6 py-8 text-center text-gray-400 dark:text-slate-500">Loading...</td></tr>
                        )}
                        {!loading && months.map((m) => (
                            <tr key={m.period_month}>
                                <td className="px-6 py-3 font-medium text-gray-900 dark:text-slate-100">{monthLabel(m.period_month)}</td>
                                <td className="px-6 py-3">
                                    {m.is_locked ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300">
                                            <Icon path={ICONS.lock} className="w-3 h-3" /> Locked
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300">
                                            Open
                                        </span>
                                    )}
                                </td>
                                <td className="px-6 py-3 text-right">
                                    {m.is_locked ? (
                                        <button
                                            onClick={() => openUnlockModal(m.period_month)}
                                            disabled={busyMonth === m.period_month}
                                            className="px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 border border-amber-300 dark:border-amber-700 rounded-lg hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors cursor-pointer disabled:opacity-50"
                                        >
                                            Reopen
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleLock(m.period_month)}
                                            disabled={busyMonth === m.period_month}
                                            className="px-3 py-1.5 text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                                        >
                                            {busyMonth === m.period_month ? 'Locking...' : 'Lock'}
                                        </button>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {history.length > 0 && (
                <div>
                    <h2 className="text-sm font-semibold text-gray-700 dark:text-slate-300 mb-2">Lock history</h2>
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700 shadow-xs overflow-hidden">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 dark:bg-slate-900/50 text-left text-xs font-semibold text-gray-500 dark:text-slate-400 uppercase tracking-wider">
                                <tr>
                                    <th className="px-6 py-3">Month</th>
                                    <th className="px-6 py-3">Locked by</th>
                                    <th className="px-6 py-3">Reopened by</th>
                                    <th className="px-6 py-3">Reason</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                                {history.map((h) => (
                                    <tr key={h.lock_id}>
                                        <td className="px-6 py-3 text-gray-900 dark:text-slate-100">{monthLabel(h.period_month)}</td>
                                        <td className="px-6 py-3 text-gray-600 dark:text-slate-400">
                                            {h.locked_by?.first_name ? `${h.locked_by.first_name} ${h.locked_by.last_name || ''}`.trim() : '—'}
                                        </td>
                                        <td className="px-6 py-3 text-gray-600 dark:text-slate-400">
                                            {h.unlocked_by?.first_name ? `${h.unlocked_by.first_name} ${h.unlocked_by.last_name || ''}`.trim() : '—'}
                                        </td>
                                        <td className="px-6 py-3 text-gray-600 dark:text-slate-400">{h.unlock_reason || '—'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {unlockTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 w-full max-w-md overflow-hidden">
                        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-700">
                            <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Reopen {monthLabel(unlockTarget)}</h3>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                                This is logged. Once your correction is made, lock the period again.
                            </p>
                        </div>
                        <form onSubmit={handleUnlock} className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider mb-1">
                                    Reason <span className="text-danger-500">*</span>
                                </label>
                                <textarea
                                    rows="3"
                                    value={unlockReason}
                                    onChange={(e) => setUnlockReason(e.target.value)}
                                    placeholder="e.g. Correcting a miskeyed fuel amount for Aug 20"
                                    autoFocus
                                    className="w-full px-3 py-2 text-sm bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded-lg text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
                                />
                            </div>
                            <div className="flex items-center justify-end gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => setUnlockTarget(null)}
                                    className="px-4 py-2 text-sm font-medium text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 rounded-lg transition-colors cursor-pointer"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={busyMonth === unlockTarget}
                                    className="px-5 py-2 text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 rounded-lg shadow-sm transition-colors cursor-pointer disabled:opacity-60"
                                >
                                    {busyMonth === unlockTarget ? 'Reopening...' : 'Reopen Period'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
