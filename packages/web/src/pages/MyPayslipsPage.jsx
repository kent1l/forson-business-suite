import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import StatusBadge from '../components/ui/StatusBadge';
import LoadingState from '../components/ui/LoadingState';
import EmptyState from '../components/ui/EmptyState';
import { useAuth } from '../contexts/AuthContext';
import { isPayReauthUnlocked, unlockPayReauth } from '../utils/payReauth';

/**
 * Employee self-service: your own payslips and a clock in/out control.
 *
 * Everything here is scoped server-side to the authenticated employee — no
 * endpoint on this page takes an employee id — so it is safe to expose to every
 * role.
 */

const peso = (v) => `₱${Number(v || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PunchCard = () => {
    const [state, setState] = useState(null);
    const [busy, setBusy] = useState(false);

    const load = useCallback(async () => {
        try {
            const { data } = await api.get('/dtr/punch/state');
            setState(data);
        } catch {
            setState(null);
        }
    }, []);

    useEffect(() => { load(); }, [load]);

    const punch = async () => {
        setBusy(true);
        try {
            await api.post('/dtr/punch', { direction: state.next_direction });
            toast.success(state.next_direction === 'IN' ? 'Clocked in' : 'Clocked out');
            load();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to record punch');
        } finally {
            setBusy(false);
        }
    };

    if (!state) return null;

    return (
        <div className="bg-white dark:bg-slate-800 p-5 rounded-xl border border-gray-200 dark:border-slate-700 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div>
                <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-100">Time Clock</h2>
                <p className="text-xs text-gray-500 dark:text-slate-400">
                    {state.last_punch_at
                        ? `Last ${state.last_direction === 'IN' ? 'clock in' : 'clock out'} today at `
                          + new Date(state.last_punch_at).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' })
                        : 'No punches recorded today.'}
                </p>
            </div>
            <button onClick={punch} disabled={busy}
                className={`px-5 py-2.5 rounded-lg font-semibold text-white disabled:opacity-50 ${
                    state.next_direction === 'IN' ? 'bg-success-600 hover:bg-success-700' : 'bg-primary-600 hover:bg-primary-700'
                }`}>
                {busy ? 'Recording…' : state.next_direction === 'IN' ? 'Clock In' : 'Clock Out'}
            </button>
        </div>
    );
};

/**
 * Re-gates My Pay behind the user's password.
 *
 * Payslips are the one HR tab with money on it, and a browser left signed in
 * for a while -- an office PC, a tab someone forgot to close -- is exactly
 * when someone other than the account owner might poke around. Confirming
 * the password unlocks the tab for PAY_REAUTH_WINDOW_MS; after that, or on
 * the next page load, it asks again.
 */
const PayPasswordGate = ({ onUnlock }) => {
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState('');

    const submit = async (e) => {
        e.preventDefault();
        if (!password || submitting) return;
        setSubmitting(true);
        setError('');
        try {
            await api.post('/employees/verify-password', { password });
            unlockPayReauth();
            onUnlock();
        } catch (err) {
            setError(err.response?.status === 401 ? 'Incorrect password' : 'Could not verify password. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="max-w-sm mx-auto mt-12 bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 text-center">
            <h1 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-1">Confirm your password</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-5">
                For your privacy, we ask again before showing pay details.
            </p>
            <form onSubmit={submit} className="text-left">
                <input
                    type="password"
                    autoFocus
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); if (error) setError(''); }}
                    placeholder="Password"
                    className={`w-full px-3 py-2.5 rounded-lg border text-sm bg-white dark:bg-slate-900 text-gray-800 dark:text-slate-100 ${
                        error ? 'border-danger-500' : 'border-gray-300 dark:border-slate-600'
                    }`}
                />
                {error && <p className="text-xs text-danger-600 mt-1">{error}</p>}
                <button type="submit" disabled={!password || submitting}
                    className="w-full mt-4 px-4 py-2.5 rounded-lg font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50">
                    {submitting ? 'Checking…' : 'Unlock'}
                </button>
            </form>
        </div>
    );
};

const MyPayslipsPage = () => {
    const { hasPermission } = useAuth();
    const [payslips, setPayslips] = useState([]);
    const [loading, setLoading] = useState(true);
    const [unlocked, setUnlocked] = useState(isPayReauthUnlocked);

    const canPunch = hasPermission('dtr:punch');

    useEffect(() => {
        if (!unlocked) return;
        api.get('/payroll/me/payslips')
            .then(({ data }) => setPayslips(Array.isArray(data) ? data : []))
            .catch(() => toast.error('Failed to load your payslips'))
            .finally(() => setLoading(false));
    }, [unlocked]);

    const download = async (payslipId) => {
        const toastId = toast.loading('Preparing payslip…');
        try {
            const res = await api.get(`/payroll/me/payslips/${payslipId}/pdf`, { responseType: 'blob' });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
            window.open(url, '_blank');
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            toast.success('Payslip ready', { id: toastId });
        } catch {
            toast.error('Failed to open payslip', { id: toastId });
        }
    };

    if (!unlocked) {
        return <PayPasswordGate onUnlock={() => setUnlocked(true)} />;
    }

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100 mb-6">My Pay</h1>

            {canPunch && <PunchCard />}

            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700">
                <h2 className="text-sm font-semibold text-gray-800 dark:text-slate-100 mb-3">Payslips</h2>
                {loading && <LoadingState label="Loading your payslips…" />}
                {!loading && payslips.length === 0 && (
                    <EmptyState title="No payslips yet"
                        description="Your payslips appear here once a payroll run covering you is approved." />
                )}
                {!loading && payslips.length > 0 && (
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-sm">
                            <thead className="border-b border-gray-200 dark:border-slate-700">
                                <tr className="text-xs font-semibold text-gray-600 dark:text-slate-400 uppercase">
                                    <th className="p-2">Period</th>
                                    <th className="p-2">Pay Date</th>
                                    <th className="p-2 text-right">Days</th>
                                    <th className="p-2 text-right">Gross</th>
                                    <th className="p-2 text-right">Deductions</th>
                                    <th className="p-2 text-right">Net Pay</th>
                                    <th className="p-2 text-right"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {payslips.map((p) => (
                                    <tr key={p.payslip_id} className="border-b border-gray-100 dark:border-slate-700/60">
                                        <td className="p-2 tabular-nums text-gray-800 dark:text-slate-100">
                                            {p.period_start} → {p.period_end}
                                        </td>
                                        <td className="p-2 tabular-nums text-gray-600 dark:text-slate-300">{p.pay_date}</td>
                                        <td className="p-2 text-right tabular-nums text-gray-600 dark:text-slate-300">
                                            {Number(p.days_paid).toFixed(2)}
                                        </td>
                                        <td className="p-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{peso(p.gross_pay)}</td>
                                        <td className="p-2 text-right tabular-nums text-gray-600 dark:text-slate-300">{peso(p.total_deductions)}</td>
                                        <td className="p-2 text-right tabular-nums font-semibold text-gray-900 dark:text-slate-50">{peso(p.net_pay)}</td>
                                        <td className="p-2 text-right whitespace-nowrap">
                                            <StatusBadge tone={p.status === 'Posted' || p.status === 'Paid' ? 'success' : 'primary'} label={p.status} />
                                            <button onClick={() => download(p.payslip_id)}
                                                className="ml-2 text-xs font-semibold text-primary-600 hover:text-primary-800">
                                                PDF
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>
    );
};

export default MyPayslipsPage;
