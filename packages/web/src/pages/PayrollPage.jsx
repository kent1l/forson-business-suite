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
    const [newRunType, setNewRunType] = useState('REGULAR');
    const [voidRun, setVoidRun] = useState(null);
    const [voidReason, setVoidReason] = useState('');
    const [warnings, setWarnings] = useState([]);
    const [adjustments, setAdjustments] = useState([]);
    const [addingAdj, setAddingAdj] = useState(false);
    const [adjForm, setAdjForm] = useState({ employee_id: '', component_code: '', adjustment_type: 'ADD', amount: '', reason: '' });
    const [components, setComponents] = useState([]);
    const [employees, setEmployees] = useState([]);
    const [perPage, setPerPage] = useState(4);

    const canView = hasPermission('payroll:view');
    const canCompute = hasPermission('payroll:compute');
    const canVoid = hasPermission('payroll:void');
    const canOverride = hasPermission('payroll:override');

    const load = useCallback(async () => {
        if (!canView) { setLoading(false); return; }
        setLoading(true);
        setError('');
        try {
            const year = new Date().getFullYear();
            const [runsRes, periodsRes] = await Promise.all([
                api.get('/payroll/runs', { params: { year } }),
                api.get('/payroll/periods', { params: { year, run_type: newRunType } }),
            ]);
            setRuns(Array.isArray(runsRes.data) ? runsRes.data : (runsRes.data?.data || []));
            setPeriods(Array.isArray(periodsRes.data) ? periodsRes.data : []);
            // Reference data for the adjustment form; failure here must not
            // block the run list, so it is fetched separately and swallowed.
            Promise.all([
                api.get('/hr/pay-components'),
                api.get('/employees', { params: { status: 'active' } }),
            ]).then(([c, e]) => {
                setComponents(Array.isArray(c.data) ? c.data : []);
                setEmployees(Array.isArray(e.data) ? e.data : (e.data?.data || []));
            }).catch(() => {});
        } catch {
            setError('Failed to load payroll runs.');
        } finally {
            setLoading(false);
        }
        // newRunType is a dependency because /payroll/periods reports which
        // periods are still free *for that run type* — a cutoff can hold both a
        // Regular and a Job Order run, so switching the picker must refetch.
    }, [canView, newRunType]);

    useEffect(() => { load(); }, [load]);

    const openRun = async (run) => {
        setSelectedRun(run);
        setWarnings([]);
        try {
            const [slipRes, adjRes] = await Promise.all([
                api.get(`/payroll/runs/${run.run_id}/payslips`),
                api.get(`/payroll/runs/${run.run_id}/adjustments`),
            ]);
            setPayslips(Array.isArray(slipRes.data) ? slipRes.data : []);
            setAdjustments(Array.isArray(adjRes.data) ? adjRes.data : []);
        } catch {
            toast.error('Failed to load payslips');
            setPayslips([]);
            setAdjustments([]);
        }
    };

    const addAdjustment = async (e) => {
        e.preventDefault();
        try {
            await api.post(`/payroll/runs/${selectedRun.run_id}/adjustments`, {
                ...adjForm, amount: Number(adjForm.amount),
            });
            toast.success('Adjustment added — recompute the run to apply it.');
            setAdjForm({ employee_id: '', component_code: '', adjustment_type: 'ADD', amount: '', reason: '' });
            setAddingAdj(false);
            openRun(selectedRun);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to add adjustment');
        }
    };

    const removeAdjustment = async (id) => {
        try {
            await api.delete(`/payroll/runs/${selectedRun.run_id}/adjustments/${id}`);
            toast.success('Adjustment removed — recompute to apply.');
            openRun(selectedRun);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to remove adjustment');
        }
    };

    // The PDF endpoint needs the auth header, so it is fetched as a blob and
    // opened from an object URL rather than linked to directly.
    const printPayslips = async () => {
        const toastId = toast.loading('Building payslips…');
        try {
            const res = await api.get(`/payroll/runs/${selectedRun.run_id}/payslips.pdf`, {
                params: { per_page: perPage }, responseType: 'blob',
            });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            window.open(url, '_blank');
            // Revoking immediately would race the new tab; a delay is the
            // pragmatic fix and the URL is scoped to this document anyway.
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            toast.success('Payslips ready', { id: toastId });
        } catch {
            toast.error('Failed to build payslips', { id: toastId });
        }
    };

    const createRun = async () => {
        if (!newPeriodId) return;
        setBusy(true);
        try {
            const { data } = await api.post('/payroll/runs', {
                pay_period_id: Number(newPeriodId), run_type: newRunType,
            });
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
                                {payslips.length > 0 && (
                                    <>
                                        <select value={perPage} onChange={(e) => setPerPage(Number(e.target.value))}
                                            className="px-2 py-1.5 text-xs border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100"
                                            title="Payslips per A4 sheet">
                                            <option value={4}>4 per sheet</option>
                                            <option value={3}>3 per sheet</option>
                                            <option value={2}>2 per sheet</option>
                                        </select>
                                        <button onClick={printPayslips}
                                            className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">
                                            Print payslips
                                        </button>
                                    </>
                                )}
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
                                {warnings.length} notice(s) from this computation
                            </h3>
                            <ul className="text-xs text-warning-700 dark:text-warning-500 space-y-0.5 max-h-40 overflow-y-auto">
                                {warnings.map((w, i) => <li key={i}>• {w}</li>)}
                            </ul>
                        </div>
                    )}

                    {canOverride && ['Draft', 'Computed'].includes(selectedRun.status) && (
                        <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 mb-6">
                            <div className="flex items-center justify-between mb-2">
                                <div>
                                    <h3 className="text-sm font-semibold text-gray-800 dark:text-slate-100">Adjustments</h3>
                                    <p className="text-xs text-gray-500 dark:text-slate-400">
                                        One-off changes for this run only. They survive a recompute and freeze once the run is approved.
                                    </p>
                                </div>
                                {!addingAdj && (
                                    <button onClick={() => setAddingAdj(true)}
                                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">
                                        Add
                                    </button>
                                )}
                            </div>

                            {addingAdj && (
                                <form onSubmit={addAdjustment} className="space-y-2 p-3 mb-3 rounded-lg bg-gray-50 dark:bg-slate-900/50 border border-gray-200 dark:border-slate-700">
                                    <div className="grid grid-cols-2 gap-2">
                                        <select required className={INPUT_CLASS} value={adjForm.employee_id}
                                            onChange={(e) => setAdjForm({ ...adjForm, employee_id: e.target.value })}>
                                            <option value="">Employee…</option>
                                            {employees.map((e) => (
                                                <option key={e.employee_id} value={e.employee_id}>{e.first_name} {e.last_name}</option>
                                            ))}
                                        </select>
                                        <select required className={INPUT_CLASS} value={adjForm.component_code}
                                            onChange={(e) => setAdjForm({ ...adjForm, component_code: e.target.value })}>
                                            <option value="">Component…</option>
                                            {components.map((c) => (
                                                <option key={c.component_code} value={c.component_code}>{c.component_name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <select className={INPUT_CLASS} value={adjForm.adjustment_type}
                                            onChange={(e) => setAdjForm({ ...adjForm, adjustment_type: e.target.value })}>
                                            <option value="ADD">Add an extra line</option>
                                            <option value="OVERRIDE">Override the computed amount</option>
                                        </select>
                                        <input type="number" step="0.01" required placeholder="Amount" className={INPUT_CLASS}
                                            value={adjForm.amount} onChange={(e) => setAdjForm({ ...adjForm, amount: e.target.value })} />
                                    </div>
                                    <textarea required rows={2} placeholder="Reason (required)" className={INPUT_CLASS}
                                        value={adjForm.reason} onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })} />
                                    <div className="flex gap-2">
                                        <button type="submit" className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white">Save</button>
                                        <button type="button" onClick={() => setAddingAdj(false)}
                                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">Cancel</button>
                                    </div>
                                </form>
                            )}

                            {adjustments.length === 0 ? (
                                <p className="text-sm text-gray-500 dark:text-slate-400 py-3 text-center">No adjustments on this run.</p>
                            ) : (
                                <table className="w-full text-left text-sm">
                                    <tbody>
                                        {adjustments.map((a) => (
                                            <tr key={a.adjustment_id} className="border-b border-gray-100 dark:border-slate-800">
                                                <td className="py-2 text-gray-900 dark:text-slate-100">{a.employee_name}</td>
                                                <td className="py-2 text-gray-600 dark:text-slate-300">{a.component_name}</td>
                                                <td className="py-2">
                                                    <StatusBadge tone={a.adjustment_type === 'OVERRIDE' ? 'warning' : 'info'} label={a.adjustment_type} />
                                                </td>
                                                <td className="py-2 text-right tabular-nums text-gray-900 dark:text-slate-100">{peso(a.amount)}</td>
                                                <td className="py-2 text-xs text-gray-500 dark:text-slate-400 max-w-[180px] truncate">{a.reason}</td>
                                                <td className="py-2 text-right">
                                                    <button onClick={() => removeAdjustment(a.adjustment_id)}
                                                        className="text-xs text-danger-600 hover:text-danger-800">Remove</button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
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
                                            <td className="p-2 text-sm font-medium tabular-nums text-gray-800 dark:text-slate-100">
                                                {r.run_no}
                                                {/* A cutoff can hold both a regular and a job-order run,
                                                    so the type has to be visible in the list. */}
                                                {r.run_type && r.run_type !== 'REGULAR' && (
                                                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">
                                                        {r.run_type.replace(/_/g, ' ')}
                                                    </span>
                                                )}
                                            </td>
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
                        <label className="block text-xs text-gray-500 dark:text-slate-400 mb-1">Run Type</label>
                        <select value={newRunType}
                            onChange={(e) => { setNewRunType(e.target.value); setNewPeriodId(''); }}
                            className={INPUT_CLASS}>
                            <option value="REGULAR">Regular — employees</option>
                            <option value="JOB_ORDER">Job Order — contract-of-service workers</option>
                        </select>
                        <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                            {newRunType === 'JOB_ORDER'
                                ? 'Pays only workers whose class is Job Order. No statutory contributions or withholding tax, and excluded from the SSS, PhilHealth, Pag-IBIG and BIR reports.'
                                : 'Pays only employees. Job-order workers are paid in their own run.'}
                        </p>
                    </div>
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
                                Every period this year already has a live {newRunType === 'JOB_ORDER' ? 'job order' : 'regular'} run.
                                Void one to redo it.
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
