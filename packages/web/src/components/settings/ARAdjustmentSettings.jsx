import { useState, useEffect, useCallback } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import InfoTip from '../ui/InfoTip';
import LoadingState from '../ui/LoadingState';

/**
 * Admin configuration for post-invoice A/R concessions.
 *
 * Reason codes are rows rather than a hardcoded list precisely so this screen can
 * exist: the owner retires a reason or adds their own vocabulary without a
 * migration. Two fields are deliberately not editable here — the reason_code
 * itself, which historical documents reference, and its accounting treatment,
 * because re-tagging a reason would silently restate every concession already
 * posted under it. Retire the reason and add a new one instead.
 */
const ARAdjustmentSettings = ({ settings, handleChange }) => {
    const [reasons, setReasons] = useState([]);
    const [loading, setLoading] = useState(true);
    const [savingCode, setSavingCode] = useState(null);

    const load = useCallback(() => {
        setLoading(true);
        api.get('/ar/adjustment-reasons', { params: { include_inactive: '1' } })
            .then(res => setReasons(res.data || []))
            .catch(() => toast.error('Could not load adjustment reasons.'))
            .finally(() => setLoading(false));
    }, []);

    useEffect(load, [load]);

    const patch = (code, changes) =>
        setReasons(prev => prev.map(r => (r.reason_code === code ? { ...r, ...changes } : r)));

    const save = async (reason) => {
        setSavingCode(reason.reason_code);
        try {
            const { data } = await api.put(`/ar/adjustment-reasons/${reason.reason_code}`, {
                label: reason.label,
                description: reason.description,
                applies_to: reason.applies_to,
                max_amount: reason.max_amount === '' || reason.max_amount === null ? null : reason.max_amount,
                requires_note: reason.requires_note,
                is_active: reason.is_active,
                sort_order: reason.sort_order,
            });
            patch(reason.reason_code, data);
            toast.success(`${data.label} saved.`);
        } catch (err) {
            toast.error(err?.response?.data?.message || 'Failed to save the reason.');
        } finally {
            setSavingCode(null);
        }
    };

    const inputClass = 'w-full px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100';

    return (
        <div className="space-y-8">
            <section>
                <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-1">
                    A/R Concessions
                </h3>
                <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                    Settlement discounts and balance write-downs granted after an invoice has been issued.
                    A concession relieves what a customer owes without any money being received, so it never
                    appears as a payment method and is never counted as collections.
                </p>

                <div className="space-y-4 max-w-2xl">
                    <label className="flex items-start gap-3">
                        <input
                            type="checkbox"
                            name="ENABLE_AR_ADJUSTMENTS"
                            checked={settings?.ENABLE_AR_ADJUSTMENTS !== 'false'}
                            onChange={(e) => handleChange({
                                target: { name: 'ENABLE_AR_ADJUSTMENTS', value: e.target.checked ? 'true' : 'false' },
                            })}
                            className="mt-1 h-4 w-4 rounded border-gray-300 text-primary-600"
                        />
                        <span>
                            <span className="block text-sm font-medium text-gray-800 dark:text-slate-200">
                                Allow post-invoice adjustments
                            </span>
                            <span className="block text-xs text-gray-500 dark:text-slate-400">
                                Turning this off hides the feature everywhere. Adjustments already posted stay on the ledger.
                            </span>
                        </span>
                    </label>

                    <div>
                        <label className="block text-sm font-medium text-gray-800 dark:text-slate-200 mb-1">
                            Confirmation threshold (%)
                            <InfoTip label="Confirmation threshold">
                                A concession worth more than this share of an invoice&rsquo;s balance asks the user to
                                press the button a second time. It is a guard against a mis-keyed amount, not an
                                approval step — who may grant a concession is decided by the
                                <span className="font-mono"> ar:discount_grant </span> permission under Roles &amp; Permissions.
                            </InfoTip>
                        </label>
                        <input
                            type="number"
                            name="AR_ADJUSTMENT_CONFIRM_PERCENT"
                            min="0"
                            max="100"
                            value={settings?.AR_ADJUSTMENT_CONFIRM_PERCENT ?? '10'}
                            onChange={handleChange}
                            className={`${inputClass} max-w-[8rem]`}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-800 dark:text-slate-200 mb-1">
                            Manager authorization validity (seconds)
                            <InfoTip label="Authorization validity">
                                How long an inline manager authorization stays usable before it has to be entered
                                again. Short is safer: it stops an authorization given for one customer being reused
                                later in the day.
                            </InfoTip>
                        </label>
                        <input
                            type="number"
                            name="AR_ADJUSTMENT_AUTH_TTL_SECONDS"
                            min="30"
                            max="3600"
                            value={settings?.AR_ADJUSTMENT_AUTH_TTL_SECONDS ?? '180'}
                            onChange={handleChange}
                            className={`${inputClass} max-w-[8rem]`}
                        />
                    </div>
                </div>
            </section>

            <section>
                <h4 className="text-base font-semibold text-gray-800 dark:text-slate-100 mb-1">Reason codes</h4>
                <p className="text-sm text-gray-600 dark:text-slate-400 mb-4">
                    Every concession must state a reason. The accounting treatment is fixed per reason so the
                    bookkeeper can post the month from one report.
                </p>

                {loading ? (
                    <LoadingState label="Loading reasons…" />
                ) : (
                    <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                        <table className="w-full text-sm">
                            <thead className="text-xs uppercase bg-gray-100 dark:bg-slate-700/50 text-gray-600 dark:text-slate-300">
                                <tr>
                                    <th className="px-3 py-2.5 text-left">Label</th>
                                    <th className="px-3 py-2.5 text-left">Used for</th>
                                    <th className="px-3 py-2.5 text-left">Posts to</th>
                                    <th className="px-3 py-2.5 text-right">Cap</th>
                                    <th className="px-3 py-2.5 text-center">Note required</th>
                                    <th className="px-3 py-2.5 text-center">Active</th>
                                    <th className="px-3 py-2.5"></th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-200 dark:divide-slate-700/60">
                                {reasons.map(r => (
                                    <tr key={r.reason_code} className="text-gray-800 dark:text-slate-200">
                                        <td className="px-3 py-2">
                                            <input
                                                type="text"
                                                value={r.label}
                                                onChange={(e) => patch(r.reason_code, { label: e.target.value })}
                                                className={inputClass}
                                            />
                                            <span className="block mt-1 font-mono text-[11px] text-gray-400 dark:text-slate-500">
                                                {r.reason_code}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <select
                                                value={r.applies_to}
                                                onChange={(e) => patch(r.reason_code, { applies_to: e.target.value })}
                                                className={inputClass}
                                            >
                                                <option value="BOTH">Both</option>
                                                <option value="SETTLEMENT">Discount at collection</option>
                                                <option value="WRITE_DOWN">Write-down only</option>
                                            </select>
                                        </td>
                                        <td className="px-3 py-2 text-xs text-gray-600 dark:text-slate-400 whitespace-nowrap">
                                            {r.gl_treatment === 'BAD_DEBT_EXPENSE' ? 'Bad Debts Expense' : 'Sales Discounts'}
                                        </td>
                                        <td className="px-3 py-2">
                                            <input
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                placeholder="None"
                                                value={r.max_amount ?? ''}
                                                onChange={(e) => patch(r.reason_code, { max_amount: e.target.value })}
                                                className={`${inputClass} text-right w-24`}
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <input
                                                type="checkbox"
                                                checked={!!r.requires_note}
                                                onChange={(e) => patch(r.reason_code, { requires_note: e.target.checked })}
                                                className="h-4 w-4 rounded border-gray-300 text-primary-600"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-center">
                                            <input
                                                type="checkbox"
                                                checked={!!r.is_active}
                                                onChange={(e) => patch(r.reason_code, { is_active: e.target.checked })}
                                                className="h-4 w-4 rounded border-gray-300 text-primary-600"
                                            />
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <button
                                                type="button"
                                                onClick={() => save(r)}
                                                disabled={savingCode === r.reason_code}
                                                className="px-3 py-1.5 rounded text-xs font-semibold text-white bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-slate-700"
                                            >
                                                {savingCode === r.reason_code ? 'Saving…' : 'Save'}
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>
        </div>
    );
};

export default ARAdjustmentSettings;
