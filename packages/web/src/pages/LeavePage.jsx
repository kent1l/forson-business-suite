import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import Modal from '../components/ui/Modal';
import SegmentedTabs from '../components/ui/SegmentedTabs';
import StatusBadge from '../components/ui/StatusBadge';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../contexts/AuthContext';

const INPUT_CLASS = 'w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500';
const FILTER_CLASS = 'px-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100';
const LABEL_CLASS = 'block text-xs text-gray-500 dark:text-slate-400 mb-1';

const STATUS_TONE = { Pending: 'warning', Approved: 'success', Rejected: 'danger', Cancelled: 'neutral' };

const LeaveRequestForm = ({ employees, leaveTypes, onSave, onCancel }) => {
    const [form, setForm] = useState({
        employee_id: '', leave_type_id: '', date_from: '', date_to: '', day_fraction: '1', reason: '',
    });

    const change = (e) => setForm((p) => ({ ...p, [e.target.name]: e.target.value }));

    return (
        <form onSubmit={(e) => { e.preventDefault(); onSave(form); }} className="space-y-4">
            <div>
                <label className={LABEL_CLASS}>Employee</label>
                <select name="employee_id" value={form.employee_id} onChange={change} className={INPUT_CLASS} required>
                    <option value="">Select an employee…</option>
                    {employees.map((e) => (
                        <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name}</option>
                    ))}
                </select>
            </div>
            <div>
                <label className={LABEL_CLASS}>Leave Type</label>
                <select name="leave_type_id" value={form.leave_type_id} onChange={change} className={INPUT_CLASS} required>
                    <option value="">Select a leave type…</option>
                    {leaveTypes.map((t) => (
                        <option key={t.leave_type_id} value={t.leave_type_id}>
                            {t.leave_name}{t.is_paid ? '' : ' (unpaid)'}
                        </option>
                    ))}
                </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
                <div>
                    <label className={LABEL_CLASS}>From</label>
                    <input type="date" name="date_from" value={form.date_from} onChange={change} className={INPUT_CLASS} required />
                </div>
                <div>
                    <label className={LABEL_CLASS}>To</label>
                    <input type="date" name="date_to" value={form.date_to} onChange={change} className={INPUT_CLASS} required />
                </div>
            </div>
            <div>
                <label className={LABEL_CLASS}>Duration</label>
                <select name="day_fraction" value={form.day_fraction} onChange={change} className={INPUT_CLASS}>
                    <option value="1">Whole day(s)</option>
                    <option value="0.5">Half day(s)</option>
                </select>
                <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                    Rest days and holidays inside the range are not charged against the balance.
                </p>
            </div>
            <div>
                <label className={LABEL_CLASS}>Reason</label>
                <textarea name="reason" value={form.reason} onChange={change} rows={2} className={INPUT_CLASS} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={onCancel} className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg hover:bg-gray-300 dark:hover:bg-slate-600">Cancel</button>
                <button type="submit" className="px-4 py-2 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700">File Request</button>
            </div>
        </form>
    );
};

const LeavePage = () => {
    const { hasPermission } = useAuth();
    const [tab, setTab] = useState('requests');
    const [statusFilter, setStatusFilter] = useState('Pending');
    const [requests, setRequests] = useState([]);
    const [leaveTypes, setLeaveTypes] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [balanceEmployee, setBalanceEmployee] = useState('');
    const [balances, setBalances] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);

    const canView = hasPermission('leave:view');
    const canRequest = hasPermission('leave:request');
    const canApprove = hasPermission('leave:approve');

    useEffect(() => {
        if (!canView) return;
        Promise.all([
            api.get('/leave/types'),
            api.get('/employees', { params: { status: 'active' } }),
        ]).then(([t, e]) => {
            setLeaveTypes(Array.isArray(t.data) ? t.data : []);
            setEmployees(Array.isArray(e.data) ? e.data : (e.data?.data || []));
        }).catch(() => { /* form degrades; list still works */ });
    }, [canView]);

    const load = useCallback(async () => {
        if (!canView) { setLoading(false); return; }
        setLoading(true);
        setError('');
        try {
            if (tab === 'requests') {
                const { data } = await api.get('/leave/requests', {
                    params: { status: statusFilter || undefined },
                });
                setRequests(Array.isArray(data) ? data : (data?.data || []));
            } else if (balanceEmployee) {
                const { data } = await api.get(`/leave/balances/${balanceEmployee}`);
                setBalances(data.balances || []);
            } else {
                setBalances([]);
            }
        } catch {
            setError('Failed to load leave data.');
        } finally {
            setLoading(false);
        }
    }, [canView, tab, statusFilter, balanceEmployee]);

    useEffect(() => { load(); }, [load]);

    const fileRequest = async (form) => {
        const promise = api.post('/leave/requests', {
            ...form,
            day_fraction: Number(form.day_fraction),
        });
        toast.promise(promise, {
            loading: 'Filing leave request…',
            success: () => { setIsModalOpen(false); load(); return 'Leave request filed'; },
            error: (err) => err.response?.data?.message || 'Failed to file leave request',
        });
    };

    const act = async (leaveId, action, confirmText) => {
        if (confirmText && !window.confirm(confirmText)) return;
        try {
            const { data } = await api.post(`/leave/requests/${leaveId}/${action}`, {});
            if (action === 'approve') {
                let msg = `Approved — ${data.dtr_days_updated} day(s) marked on the DTR.`;
                if (data.locked_days?.length) {
                    // Payroll has already consumed those days, so the DTR cannot
                    // fully reflect the approval. Say so rather than imply success.
                    msg += ` ${data.locked_days.length} day(s) were locked by payroll and left unchanged.`;
                }
                toast.success(msg);
            } else if (action === 'cancel') {
                toast.success(`Cancelled — ${data.dtr_days_reverted} DTR day(s) reverted.`);
            } else {
                toast.success('Request rejected');
            }
            load();
        } catch (err) {
            toast.error(err.response?.data?.message || `Failed to ${action} request`);
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
            <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Leave</h1>
                {canRequest && (
                    <button onClick={() => setIsModalOpen(true)}
                        className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition">
                        File Leave Request
                    </button>
                )}
            </div>

            <div className="mb-4 border-b border-gray-200 dark:border-slate-700">
                <SegmentedTabs
                    tabs={[
                        { key: 'requests', label: 'Requests' },
                        { key: 'balances', label: 'Balances' },
                    ]}
                    active={tab}
                    onChange={setTab}
                />
            </div>

            <div className="flex flex-wrap gap-3 mb-4">
                {tab === 'requests' ? (
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={FILTER_CLASS}>
                        <option value="">All statuses</option>
                        <option value="Pending">Pending</option>
                        <option value="Approved">Approved</option>
                        <option value="Rejected">Rejected</option>
                        <option value="Cancelled">Cancelled</option>
                    </select>
                ) : (
                    <select value={balanceEmployee} onChange={(e) => setBalanceEmployee(e.target.value)} className={FILTER_CLASS}>
                        <option value="">Select an employee…</option>
                        {employees.map((e) => (
                            <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name}</option>
                        ))}
                    </select>
                )}
            </div>

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700">
                {loading && <LoadingState label="Loading…" />}
                {!loading && error && <ErrorState description={error} onRetry={load} />}

                {!loading && !error && tab === 'requests' && (
                    requests.length === 0 ? (
                        <EmptyState title="No leave requests" description="Nothing matches this filter." />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200 dark:border-slate-700">
                                    <tr className="text-sm font-semibold text-gray-600 dark:text-slate-400">
                                        <th className="p-2">Employee</th>
                                        <th className="p-2">Type</th>
                                        <th className="p-2">Dates</th>
                                        <th className="p-2 text-right">Days</th>
                                        <th className="p-2">Status</th>
                                        <th className="p-2">Reason</th>
                                        <th className="p-2 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {requests.map((r) => (
                                        <tr key={r.leave_id} className="border-b border-gray-100 dark:border-slate-700/60">
                                            <td className="p-2 text-sm font-medium text-gray-800 dark:text-slate-100">{r.employee_name}</td>
                                            <td className="p-2 text-sm text-gray-600 dark:text-slate-300">
                                                {r.leave_name}
                                                {!r.is_paid && <span className="ml-1 text-[10px] font-bold uppercase text-warning-600">Unpaid</span>}
                                            </td>
                                            <td className="p-2 text-sm tabular-nums text-gray-600 dark:text-slate-300 whitespace-nowrap">
                                                {r.date_from === r.date_to ? r.date_from : `${r.date_from} → ${r.date_to}`}
                                            </td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-800 dark:text-slate-100">
                                                {Number(r.total_days).toFixed(2)}
                                            </td>
                                            <td className="p-2"><StatusBadge tone={STATUS_TONE[r.status] || 'neutral'} label={r.status} /></td>
                                            <td className="p-2 text-xs text-gray-500 dark:text-slate-400 max-w-[200px] truncate">{r.reason || '—'}</td>
                                            <td className="p-2 text-right whitespace-nowrap">
                                                {r.status === 'Pending' && canApprove && (
                                                    <>
                                                        <button onClick={() => act(r.leave_id, 'approve')}
                                                            className="px-2 py-1 text-xs font-semibold rounded-md bg-success-100 text-success-800 hover:bg-success-200 dark:bg-success-900/30 dark:text-success-400 mr-1">
                                                            Approve
                                                        </button>
                                                        <button onClick={() => act(r.leave_id, 'reject')}
                                                            className="px-2 py-1 text-xs font-semibold rounded-md bg-danger-100 text-danger-800 hover:bg-danger-200 dark:bg-danger-900/30 dark:text-danger-400 mr-1">
                                                            Reject
                                                        </button>
                                                    </>
                                                )}
                                                {['Pending', 'Approved'].includes(r.status) && canRequest && (
                                                    <button
                                                        onClick={() => act(r.leave_id, 'cancel',
                                                            r.status === 'Approved'
                                                                ? 'Cancel this approved leave? The affected DTR days will revert to their scheduled state.'
                                                                : 'Cancel this leave request?')}
                                                        className="px-2 py-1 text-xs font-semibold rounded-md bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">
                                                        Cancel
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                )}

                {!loading && !error && tab === 'balances' && (
                    !balanceEmployee ? (
                        <EmptyState title="Select an employee" description="Choose someone above to see their leave balances." />
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200 dark:border-slate-700">
                                    <tr className="text-sm font-semibold text-gray-600 dark:text-slate-400">
                                        <th className="p-2">Leave Type</th>
                                        <th className="p-2 text-right">Entitled</th>
                                        <th className="p-2 text-right">Carried Over</th>
                                        <th className="p-2 text-right">Used</th>
                                        <th className="p-2 text-right">Remaining</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {balances.map((b) => (
                                        <tr key={b.leave_type_id} className="border-b border-gray-100 dark:border-slate-700/60">
                                            <td className="p-2 text-sm text-gray-800 dark:text-slate-100">
                                                {b.leave_name}
                                                {!b.is_paid && <span className="ml-1 text-[10px] font-bold uppercase text-warning-600">Unpaid</span>}
                                            </td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">{Number(b.entitled_days).toFixed(2)}</td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">{Number(b.carried_over_days).toFixed(2)}</td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">{Number(b.used_days).toFixed(2)}</td>
                                            <td className={`p-2 text-sm text-right tabular-nums font-semibold ${Number(b.remaining_days) < 0 ? 'text-danger-600' : 'text-gray-900 dark:text-slate-50'}`}>
                                                {Number(b.remaining_days).toFixed(2)}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                )}
            </div>

            <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="File Leave Request">
                <LeaveRequestForm
                    employees={employees}
                    leaveTypes={leaveTypes}
                    onSave={fileRequest}
                    onCancel={() => setIsModalOpen(false)}
                />
            </Modal>
        </div>
    );
};

export default LeavePage;
