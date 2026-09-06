import { useState, useEffect, useMemo, useCallback } from 'react';
import api from '../api';
import toast from 'react-hot-toast';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import LoadingState from '../components/ui/LoadingState';
import EmptyState from '../components/ui/EmptyState';
import { formatCurrency } from '../utils/currency';
import { ICONS } from '../constants';

/**
 * Concessions granted — the bookkeeper's posting sheet, and the view worth
 * watching for fraud.
 *
 * FBS keeps no general ledger, so a concession cannot post itself to an account.
 * What it does instead is carry a gl_treatment tag, and this page is where those
 * are totalled: contra-revenue on one side, bad-debt expense on the other, in
 * figures the bookkeeper enters by hand into the books kept outside the system.
 *
 * The other half of its job is detection. Concessions are the one credit in A/R
 * that a member of staff can create without money changing hands, so who grants
 * them, to whom, and how often is exactly the pattern that has to be visible.
 * Nothing here accuses anybody — it just makes the shape of the month legible.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};

const GL_LABELS = {
    CONTRA_REVENUE: 'Sales Discounts (contra-revenue)',
    BAD_DEBT_EXPENSE: 'Bad Debts Expense',
};

const STATUS_STYLES = {
    POSTED: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
    PENDING_CLEARANCE: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    REVERSED: 'bg-slate-100 text-slate-600 dark:bg-slate-700/50 dark:text-slate-300',
    VOIDED: 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300',
};

const StatCard = ({ label, value, tone = 'default', hint }) => (
    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4">
        <div className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 flex items-center gap-1">
            {label}
            {hint && <InfoTip label={label}>{hint}</InfoTip>}
        </div>
        <div className={`mt-1 text-2xl font-bold font-mono ${
            tone === 'amber' ? 'text-amber-600 dark:text-amber-400'
                : tone === 'rose' ? 'text-rose-600 dark:text-rose-400'
                : 'text-gray-900 dark:text-slate-100'
        }`}>
            {value}
        </div>
    </div>
);

const ARConcessionsPage = () => {
    const [dateFrom, setDateFrom] = useState(monthStartIso);
    const [dateTo, setDateTo] = useState(todayIso);
    const [summary, setSummary] = useState(null);
    const [documents, setDocuments] = useState([]);
    const [loading, setLoading] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = { date_from: dateFrom, date_to: `${dateTo} 23:59:59` };
            const [summaryRes, listRes] = await Promise.all([
                api.get('/ar/adjustments/summary', { params }),
                api.get('/ar/adjustments', { params }),
            ]);
            setSummary(summaryRes.data || null);
            setDocuments(Array.isArray(listRes.data) ? listRes.data : (listRes.data?.data || []));
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Could not load concessions.');
            setSummary(null);
            setDocuments([]);
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo]);

    useEffect(() => { load(); }, [load]);

    const totals = summary?.totals || {};

    // A cashier granting concessions to a customer whose record is themselves, or
    // one customer taking a large share of everything forgiven, is worth a second
    // look. Surfaced as an observation, never as a verdict.
    const concentration = useMemo(() => {
        const total = Number(totals.total) || 0;
        const top = (summary?.by_customer || [])[0];
        if (!top || total <= 0) return null;
        const share = (Number(top.total) / total) * 100;
        return share >= 40 ? { name: top.customer_name, share, amount: Number(top.total) } : null;
    }, [summary, totals.total]);

    return (
        <div className="p-4 md:p-6 space-y-6">
            <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                        Concessions Granted
                        <InfoTip label="Concessions Granted">
                            Balance forgiven so an account could be settled or closed: settlement discounts taken
                            during a collection, and write-downs taken without one. None of it is money, so none of
                            it appears in any collections figure. This page is where the bookkeeper reads off the
                            month&rsquo;s totals by accounting treatment.
                        </InfoTip>
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                        Posted concessions only. Reversed and voided documents drop out of every total below, but
                        stay on the customer&rsquo;s statement.
                    </p>
                </div>

                <div className="flex items-end gap-3">
                    <div>
                        <label className="block text-xs font-semibold uppercase text-gray-500 dark:text-slate-400 mb-1">From</label>
                        <input
                            type="date"
                            value={dateFrom}
                            onChange={(e) => setDateFrom(e.target.value)}
                            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-slate-100"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-semibold uppercase text-gray-500 dark:text-slate-400 mb-1">To</label>
                        <input
                            type="date"
                            value={dateTo}
                            onChange={(e) => setDateTo(e.target.value)}
                            className="px-3 py-2 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-gray-900 dark:text-slate-100"
                        />
                    </div>
                    <button
                        type="button"
                        onClick={load}
                        className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700"
                    >
                        Refresh
                    </button>
                </div>
            </div>

            {loading ? (
                <LoadingState label="Loading concessions…" />
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        <StatCard label="Total conceded" value={formatCurrency(totals.total || 0)} tone="amber" />
                        <StatCard label="Documents" value={totals.count ?? 0} />
                        <StatCard
                            label="Contra-revenue"
                            value={formatCurrency(totals.contra_revenue || 0)}
                            hint="Discounts given to secure settlement. Posted against a Sales Discounts account — the sale keeps its full value, and output VAT is untouched."
                        />
                        <StatCard
                            label="Bad debt expense"
                            value={formatCurrency(totals.bad_debt_expense || 0)}
                            tone="rose"
                            hint="Balances judged uncollectible and written off. No allowance account is maintained, so these are direct write-offs."
                        />
                    </div>

                    {concentration && (
                        <div className="rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/20 p-4 flex items-start gap-3">
                            <Icon path={ICONS.warning} className="w-5 h-5 shrink-0 text-amber-600 dark:text-amber-400" />
                            <div className="text-sm text-amber-900 dark:text-amber-200">
                                <span className="font-semibold">{concentration.name}</span> accounts for{' '}
                                <span className="font-mono font-semibold">{concentration.share.toFixed(0)}%</span> of everything
                                conceded in this period ({formatCurrency(concentration.amount)}). Worth understanding before the
                                books close — it may be entirely legitimate.
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* The posting sheet. Grouped the way the bookkeeper enters it. */}
                        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
                                <h2 className="text-sm font-bold text-gray-800 dark:text-slate-100">By reason and treatment</h2>
                                <p className="text-xs text-gray-500 dark:text-slate-400">What the bookkeeper posts, and where.</p>
                            </div>
                            {(summary?.by_reason || []).length === 0 ? (
                                <EmptyState title="Nothing conceded in this period" />
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="text-xs uppercase bg-gray-50 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300">
                                        <tr>
                                            <th className="px-4 py-2 text-left">Reason</th>
                                            <th className="px-4 py-2 text-left">Posts to</th>
                                            <th className="px-4 py-2 text-right">Count</th>
                                            <th className="px-4 py-2 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700/60">
                                        {summary.by_reason.map(r => (
                                            <tr key={r.reason_code} className="text-gray-800 dark:text-slate-200">
                                                <td className="px-4 py-2.5 font-medium">{r.reason_label}</td>
                                                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                                                    {GL_LABELS[r.gl_treatment] || r.gl_treatment}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono">{r.count}</td>
                                                <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(r.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>

                        {/* Who granted them, and who authorized. */}
                        <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                            <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700">
                                <h2 className="text-sm font-bold text-gray-800 dark:text-slate-100">By employee</h2>
                                <p className="text-xs text-gray-500 dark:text-slate-400">
                                    Who keyed the concession, and who stood behind it when they lacked the permission.
                                </p>
                            </div>
                            {(summary?.by_employee || []).length === 0 ? (
                                <EmptyState title="No concessions to attribute" />
                            ) : (
                                <table className="w-full text-sm">
                                    <thead className="text-xs uppercase bg-gray-50 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300">
                                        <tr>
                                            <th className="px-4 py-2 text-left">Granted by</th>
                                            <th className="px-4 py-2 text-left">Authorized by</th>
                                            <th className="px-4 py-2 text-right">Count</th>
                                            <th className="px-4 py-2 text-right">Total</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700/60">
                                        {summary.by_employee.map((e, i) => (
                                            <tr key={`${e.granted_by}-${e.authorized_by}-${i}`} className="text-gray-800 dark:text-slate-200">
                                                <td className="px-4 py-2.5 font-medium">{e.granted_by_username || `#${e.granted_by}`}</td>
                                                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                                                    {e.authorized_by_username || <span className="italic">held the permission</span>}
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono">{e.count}</td>
                                                <td className="px-4 py-2.5 text-right font-mono font-semibold">{formatCurrency(e.total)}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>

                    <div className="rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden">
                        <div className="px-4 py-3 border-b border-gray-200 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <h2 className="text-sm font-bold text-gray-800 dark:text-slate-100">Every document in this period</h2>
                                <p className="text-xs text-gray-500 dark:text-slate-400">
                                    Including reversed and voided ones, so nothing granted can disappear from view.
                                </p>
                            </div>
                        </div>
                        {documents.length === 0 ? (
                            <EmptyState
                                title="No concessions in this period"
                                description="Nothing was forgiven between these dates."
                            />
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="text-xs uppercase bg-gray-50 dark:bg-slate-700/40 text-gray-600 dark:text-slate-300">
                                        <tr>
                                            <th className="px-4 py-2 text-left">Document</th>
                                            <th className="px-4 py-2 text-left">Date</th>
                                            <th className="px-4 py-2 text-left">Customer</th>
                                            <th className="px-4 py-2 text-left">Reason</th>
                                            <th className="px-4 py-2 text-left">Granted / authorized</th>
                                            <th className="px-4 py-2 text-center">Invoices</th>
                                            <th className="px-4 py-2 text-center">Status</th>
                                            <th className="px-4 py-2 text-right">Amount</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-200 dark:divide-slate-700/60">
                                        {documents.map(d => (
                                            <tr key={d.adjustment_id} className="text-gray-800 dark:text-slate-200">
                                                <td className="px-4 py-2.5 font-mono text-xs font-semibold">
                                                    {d.adjustment_no}
                                                    {d.reverses_adjustment_id && (
                                                        <span className="ml-1 text-[10px] uppercase text-slate-500">reversal</span>
                                                    )}
                                                </td>
                                                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                                                    {d.entry_date ? new Date(d.entry_date).toLocaleDateString() : '—'}
                                                </td>
                                                <td className="px-4 py-2.5">{d.customer_name}</td>
                                                <td className="px-4 py-2.5 text-xs">{d.reason_label}</td>
                                                <td className="px-4 py-2.5 text-xs text-gray-500 dark:text-slate-400">
                                                    {d.granted_by_username || '—'}
                                                    {d.authorized_by_username && <> &rarr; {d.authorized_by_username}</>}
                                                </td>
                                                <td className="px-4 py-2.5 text-center font-mono text-xs">{d.invoice_count}</td>
                                                <td className="px-4 py-2.5 text-center">
                                                    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                                                        STATUS_STYLES[d.status] || STATUS_STYLES.REVERSED
                                                    }`}>
                                                        {d.status.replace('_', ' ')}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-2.5 text-right font-mono font-semibold">
                                                    {formatCurrency(d.total_amount)}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default ARConcessionsPage;
