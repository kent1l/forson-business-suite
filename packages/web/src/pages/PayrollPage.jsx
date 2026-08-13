import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import KPICard from '../components/ui/KPICard';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../contexts/AuthContext';

const INPUT_CLASS = 'w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500';

const STATUS_TONE = {
    Draft: 'neutral',
    Computed: 'info',
    Approved: 'primary',
    Paid: 'success',
    Posted: 'success',
    Voided: 'danger',
};

// What each state can do next, mirroring the server's state machine so the UI
// never offers an action the API would reject.
const NEXT_ACTIONS = {
    Draft: [{ action: 'compute', label: 'Compute', permission: 'payroll:compute' }],
    Computed: [
        { action: 'approve', label: 'Approve', permission: 'payroll:approve' },
        { action: 'revert', label: 'Back to Draft', permission: 'payroll:compute', subtle: true },
    ],
    Approved: [{ action: 'mark-paid', label: 'Mark Paid', permission: 'payroll:post' }],
    Paid: [{ action: 'post', label: 'Post to Expenses', permission: 'payroll:post' }],
    Posted: [],
    Voided: [],
};

const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PayrollPage = () => {
    const { hasPermission } = useAuth();
    const [runs, setRuns] = useState([]);
    const [periods, setPeriods] = useState([]);
    const [selectedRun, setSelectedRun] = useState(null);
    const [payslips, setPayslips] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [newPeriodId, setNewPeriodId] = useState('');
    const [voidRun, setVoidRun] = useState(null);
    const [voidReason, setVoidReason] = useState('');
    const [warnings, setWarnings] = useState([]);

    const canView = hasPermission('payroll:view');
    const canCompute = hasPermission('payroll:compute');
    const canVoid = hasPermission('payroll:void');

    const load = useCallback(async () => {
        if (!canView) { setLoading(false); return; }
        setLoading(true);
        setError('');
        try {
            const year = new Date().getFullYear();
            const [runsRes, periodsRes] = await Promise.all([
                api.get('/payroll/runs', { params: { year } }),
                api.get('/payroll/periods', { params: { year } }),
            ]);
            setRuns(Array.isArray(runsRes.data) ? runsRes.data : (runsRes.data?.data || []));
            setPeriods(Array.isArray(periodsRes.data) ? periodsRes.data : []);
        } catch {
            setError('Failed to load payroll runs.');
        } finally {
            setLoading(false);
        }
    }, [canView]);

    useEffect(() => { load(); }, [load]);

    const openRun = async (run) => {
        setSelectedRun(run);
        setWarnings([]);
        try {
            const { data } = await api.get(`/payroll/runs/${run.run_id}/payslips`);
            setPayslips(Array.isArray(data) ? data : []);
        } catch {
            toast.error('Failed to load payslips');
            setPayslips([]);
        }
    };

    const createRun = async () => {
        if (!newPeriodId) return;
        setBusy(true);
        try {
            const { data } = await api.post('/payroll/runs', { pay_period_id: Number(newPeriodId) });
            toast.success(`Created ${data.run_no}`);
            setIsCreateOpen(false);
            setNewPeriodId('');
            await load();
            openRun(data);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to create run');
        } finally {
            setBusy(false);
        }
    };

    const runAction = async (run, action) => {
        setBusy(true);
        try {
            const { data } = await api.post(`/payroll/runs/${run.run_id}/${action}`, {});
            if (action === 'compute') {
                toast.success(`Computed ${data.payslipCount} payslip(s).`);
                // Employees skipped for missing rates or missing DTR are the most
                // common payroll surprise — surface them rather than hiding them.
                setWarnings(data.warnings || []);
            } else if (action === 'post') {
                toast.success(`Posted ${data.expenseIds?.length || 0} expense row(s).`);
            } else {
                toast.success(`Run is now ${data.status}.`);
            }
            await load();
            const refreshed = await api.get(`/payroll/runs/${run.run_id}`);
            await openRun(refreshed.data);
        } catch (err) {
            toast.error(err.response?.data?.message || `Failed to ${action}`);
        } finally {
            setBusy(false);
        }
    };

    const submitVoid = async () => {
        if (!voidReason.trim()) { toast.error('A reason is required'); return; }
        setBusy(true);
        try {
            await api.post(`/payroll/runs/${voidRun.run_id}/void`, { reason: voidReason });
            toast.success('Run voided — expense postings reversed and time records unlocked.');
            setVoidRun(null);
            setVoidReason('');
            await load();
            setSelectedRun(null);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to void run');
        } finally {
            setBusy(false);
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

    const openPeriods = periods.filter((p) => !p.run_id);

    return (
        <div>
            <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
                <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100">Payroll</h1>
                {canCompute && (
                    <button onClick={() => setIsCreateOpen(true)}
                        className="bg-primary-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-primary-700 transition">
                        New Payroll Run
                    </button>
                )}
            </div>

            {selectedRun ? (
                <div>
                    <button onClick={() => { setSelectedRun(null); setWarnings([]); }}
                        className="text-sm text-primary-600 hover:text-primary-800 mb-4">
                        ← Back to all runs
                    </button>

                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 mb-6">
                        <div className="flex flex-wrap justify-between items-start gap-4 mb-4">
                            <div>
                                <div className="flex items-center gap-3">
                                    <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-50">{selectedRun.run_no}</h2>
                                    <StatusBadge tone={STATUS_TONE[selectedRun.status]} label={selectedRun.status} />
                                </div>
                                <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                                    {selectedRun.period_start} to {selectedRun.period_end} · paid {selectedRun.pay_date}
                                </p>
                                {selectedRun.status === 'Voided' && selectedRun.void_reason && (
                                    <p className="text-xs text-danger-600 mt-1">Voided: {selectedRun.void_reason}</p>
                                )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {(NEXT_ACTIONS[selectedRun.status] || [])
                                    .filter((a) => hasPermission(a.permission))
                                    .map((a) => (
                                        <button key={a.action} disabled={busy}
                                            onClick={() => runAction(selectedRun, a.action)}
                                            className={a.subtle
                                                ? 'px-3 py-1.5 text-sm font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 disabled:opacity-50'
                                                : 'px-3 py-1.5 text-sm font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50'}>
                                            {busy ? 'Working…' : a.label}
                                        </button>
                                    ))}
                                {canVoid && !['Voided'].includes(selectedRun.status) && (
                                    <button disabled={busy} onClick={() => setVoidRun(selectedRun)}
                                        className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-danger-100 text-danger-800 hover:bg-danger-200 dark:bg-danger-900/30 dark:text-danger-400 disabled:opacity-50">
                                        Void
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                            <KPICard title="Employees" value={selectedRun.employee_count} icon="package" color="blue" />
                            <KPICard title="Gross Pay" value={Number(selectedRun.total_gross)} icon="currency" color="green" isMonetary />
                            <KPICard title="Deductions" value={Number(selectedRun.total_deductions)} icon="warning" color="amber" isMonetary />
                            <KPICard title="Net Pay" value={Number(selectedRun.total_net)} icon="currency" color="purple" isMonetary />
                        </div>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-3">
                            Employer share (not withheld from staff): {peso(selectedRun.total_employer_contrib)}.
                            Posting to expenses records gross plus employer share as the true cost of employment.
                        </p>
                    </div>

                    {warnings.length > 0 && (
                        <div className="mb-6 p-4 rounded-xl border border-warning-300 bg-warning-50 dark:bg-warning-900/20 dark:border-warning-800">
                            <h3 className="text-sm font-semibold text-warning-800 dark:text-warning-400 mb-2">
                                {warnings.length} employee(s) were skipped
                            </h3>
                            <ul className="text-xs text-warning-700 dark:text-warning-500 space-y-0.5 max-h-40 overflow-y-auto">
                                {warnings.map((w, i) => <li key={i}>• {w}</li>)}
                            </ul>
                        </div>
                    )}

                    <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700">
                        {payslips.length === 0 ? (
                            <EmptyState title="No payslips yet"
                                description={selectedRun.status === 'Draft' ? 'Compute this run to generate payslips.' : 'This run produced no payslips.'} />
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left text-sm">
                                    <thead className="border-b border-gray-200 dark:border-slate-700">
                                        <tr className="text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">
                                            <th className="p-2">Employee</th>
                                            <th className="p-2 text-right">Rate</th>
                                            <th className="p-2 text-right">Days</th>
                                            <th className="p-2 text-right">Gross</th>
                                            <th className="p-2 text-right">SSS</th>
                                            <th className="p-2 text-right">PhilHealth</th>
                                            <th className="p-2 text-right">Pag-IBIG</th>
                                            <th className="p-2 text-right">Tax</th>
                                            <th className="p-2 text-right">Loans</th>
                                            <th className="p-2 text-right">Net Pay</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {payslips.map((p) => (
                                            <tr key={p.payslip_id} className="border-b border-gray-100 dark:border-slate-700/60">
                                                <td className="p-2 font-medium text-gray-800 dark:text-slate-100">{p.employee_name}</td>
                                                <td className="p-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{peso(p.daily_rate)}</td>
                                                <td className="p-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{Number(p.days_paid).toFixed(2)}</td>
                                                <td className="p-2 text-right tabular-nums text-gray-800 dark:text-slate-100">{peso(p.gross_pay)}</td>
                                                <td className="p-2 text-right tabular-nums text-gray-600 dark:text-slate-300">
                                                    {peso(Number(p.sss_ee) + Number(p.sss_mpf_ee))}
                                                </td>
                                                <td className="p-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{peso(p.philhealth_ee)}</td>
                                                <td className="p-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{peso(p.pagibig_ee)}</td>
                                                <td className="p-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{peso(p.withholding_tax)}</td>
                                                <td className="p-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{peso(p.loans_total)}</td>
                                                <td className="p-2 text-right tabular-nums font-semibold text-gray-900 dark:text-slate-50">{peso(p.net_pay)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700">
                    {loading && <LoadingState label="Loading payroll runs…" />}
                    {!loading && error && <ErrorState description={error} onRetry={load} />}
                    {!loading && !error && runs.length === 0 && (
                        <EmptyState title="No payroll runs yet"
                            description="Create a run for a pay period to compute payslips from the daily time records." />
                    )}
                    {!loading && !error && runs.length > 0 && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left">
                                <thead className="border-b border-gray-200 dark:border-slate-700">
                                    <tr className="text-sm font-semibold text-gray-600 dark:text-slate-400">
                                        <th className="p-2">Run</th>
                                        <th className="p-2">Period</th>
                                        <th className="p-2">Status</th>
                                        <th className="p-2 text-right">Employees</th>
                                        <th className="p-2 text-right">Gross</th>
                                        <th className="p-2 text-right">Net</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {runs.map((r) => (
                                        <tr key={r.run_id} onClick={() => openRun(r)}
                                            className="border-b border-gray-100 dark:border-slate-700/60 hover:bg-gray-50 dark:hover:bg-slate-700/40 cursor-pointer">
                                            <td className="p-2 text-sm font-medium tabular-nums text-gray-800 dark:text-slate-100">{r.run_no}</td>
                                            <td className="p-2 text-sm tabular-nums text-gray-600 dark:text-slate-300">
                                                {r.period_start} → {r.period_end}
                                            </td>
                                            <td className="p-2"><StatusBadge tone={STATUS_TONE[r.status]} label={r.status} /></td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">{r.employee_count}</td>
                                            <td className="p-2 text-sm text-right tabular-nums text-gray-600 dark:text-slate-300">{peso(r.total_gross)}</td>
                                            <td className="p-2 text-sm text-right tabular-nums font-semibold text-gray-900 dark:text-slate-50">{peso(r.total_net)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            )}

            <Modal isOpen={isCreateOpen} onClose={() => setIsCreateOpen(false)} title="New Payroll Run">
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Pay Period</label>
                        <select value={newPeriodId} onChange={(e) => setNewPeriodId(e.target.value)} className={INPUT_CLASS}>
                            <option value="">Select a period…</option>
                            {openPeriods.map((p) => (
                                <option key={p.pay_period_id} value={p.pay_period_id}>
                                    {p.period_start} → {p.period_end}
                                </option>
                            ))}
                        </select>
                        {openPeriods.length === 0 && (
                            <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                                Every period this year already has a live run. Void one to redo it.
                            </p>
                        )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-slate-400">
                        Payslips are computed from the daily time records in the period, so make sure the DTR is
                        complete and corrected first.
                    </p>
                    <div className="flex justify-end gap-3">
                        <button onClick={() => setIsCreateOpen(false)}
                            className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg">Cancel</button>
                        <button onClick={createRun} disabled={!newPeriodId || busy}
                            className="px-4 py-2 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700 disabled:opacity-50">
                            Create Run
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={Boolean(voidRun)} onClose={() => setVoidRun(null)} title={`Void ${voidRun?.run_no || ''}`}>
                <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-slate-300">
                        Voiding reverses any expense postings, restores loan balances, and unlocks the time records
                        for this period. The payslips are kept as a record and cannot be edited.
                    </p>
                    <div>
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Reason (required)</label>
                        <textarea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} className={INPUT_CLASS} />
                    </div>
                    <div className="flex justify-end gap-3">
                        <button onClick={() => setVoidRun(null)}
                            className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg">Cancel</button>
                        <button onClick={submitVoid} disabled={busy || !voidReason.trim()}
                            className="px-4 py-2 bg-danger-600 text-white rounded-lg font-semibold hover:bg-danger-700 disabled:opacity-50">
                            Void Run
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default PayrollPage;
