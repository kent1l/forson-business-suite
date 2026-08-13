import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import Modal from '../components/ui/Modal';
import StatusBadge from '../components/ui/StatusBadge';
import LoadingState from '../components/ui/LoadingState';
import ErrorState from '../components/ui/ErrorState';
import { useAuth } from '../contexts/AuthContext';

const INPUT_CLASS = 'w-full px-3 py-2 text-sm border border-gray-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-800 text-gray-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-primary-500';
const LABEL_CLASS = 'block text-xs text-gray-500 dark:text-slate-400 mb-1';

const AGENCY_NAME = {
    SSS: 'SSS',
    PHILHEALTH: 'PhilHealth',
    PAGIBIG: 'Pag-IBIG',
    BIR_WTAX: 'BIR Withholding Tax',
};

const pct = (v) => `${(Number(v) * 100).toFixed(2)}%`;

/** SSS is edited through the rules that change in a circular, not 61 rows by hand. */
const SssEditor = ({ version, onSaved, disabled }) => {
    const [params, setParams] = useState({
        mscMin: 5000, mscMax: 35000, mscStep: 500,
        eeRate: 0.05, erRate: 0.10, regularSsCeiling: 20000,
        ecLowAmount: 10, ecHighAmount: 30, ecThreshold: 15000,
    });
    const [preview, setPreview] = useState([]);
    const [busy, setBusy] = useState(false);

    const set = (k) => (e) => setParams((p) => ({ ...p, [k]: Number(e.target.value) }));

    const runPreview = async () => {
        try {
            const { data } = await api.post('/payroll/statutory-versions/preview-sss', params);
            setPreview(data.brackets);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Preview failed');
        }
    };

    const save = async () => {
        setBusy(true);
        try {
            const { data } = await api.put(`/payroll/statutory-versions/${version.version_id}/brackets`,
                { mode: 'generate', params });
            toast.success(`Saved ${data.bracketCount} brackets.`);
            onSaved();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save');
        } finally {
            setBusy(false);
        }
    };

    const fields = [
        ['eeRate', 'Employee rate', 0.0001], ['erRate', 'Employer rate', 0.0001],
        ['mscMin', 'MSC minimum', 1], ['mscMax', 'MSC maximum', 1], ['mscStep', 'MSC step', 1],
        ['regularSsCeiling', 'Regular SS ceiling', 1],
        ['ecThreshold', 'EC threshold', 1], ['ecLowAmount', 'EC below', 1], ['ecHighAmount', 'EC at/above', 1],
    ];

    return (
        <div className="space-y-4">
            <p className="text-xs text-gray-500 dark:text-slate-400">
                The bracket table is generated from these rules. Anything above the regular SS ceiling
                goes to the WISP/provident portion.
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {fields.map(([key, label, step]) => (
                    <div key={key}>
                        <label className={LABEL_CLASS}>{label}</label>
                        <input type="number" step={step} value={params[key]} onChange={set(key)}
                            className={INPUT_CLASS} disabled={disabled} />
                    </div>
                ))}
            </div>
            <div className="flex gap-2">
                <button onClick={runPreview} className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">
                    Preview
                </button>
                <button onClick={save} disabled={disabled || busy}
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                    {busy ? 'Saving…' : 'Save brackets'}
                </button>
            </div>
            {preview.length > 0 && (
                <div className="max-h-64 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                    <table className="w-full text-xs">
                        <thead className="bg-gray-50 dark:bg-slate-900/50 sticky top-0">
                            <tr className="text-gray-600 dark:text-slate-400">
                                <th className="p-2 text-left">MSC</th>
                                <th className="p-2 text-right">EE</th>
                                <th className="p-2 text-right">ER</th>
                                <th className="p-2 text-right">EC</th>
                                <th className="p-2 text-right">WISP EE</th>
                            </tr>
                        </thead>
                        <tbody>
                            {preview.map((b) => (
                                <tr key={b.msc} className="border-t border-gray-100 dark:border-slate-800">
                                    <td className="p-2 tabular-nums text-gray-800 dark:text-slate-100">{b.msc}</td>
                                    <td className="p-2 text-right tabular-nums">{b.ee_amount}</td>
                                    <td className="p-2 text-right tabular-nums">{b.er_amount}</td>
                                    <td className="p-2 text-right tabular-nums">{b.ec_amount}</td>
                                    <td className="p-2 text-right tabular-nums">{b.mpf_ee}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

const ConfigEditor = ({ version, current, fields, onSaved, disabled }) => {
    const [form, setForm] = useState({});
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const seed = {};
        for (const [key] of fields) seed[key] = current?.[key] ?? '';
        setForm(seed);
    }, [current, fields]);

    const save = async () => {
        setBusy(true);
        try {
            const payload = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)]));
            await api.put(`/payroll/statutory-versions/${version.version_id}/brackets`, payload);
            toast.success('Saved.');
            onSaved();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
                {fields.map(([key, label, step]) => (
                    <div key={key}>
                        <label className={LABEL_CLASS}>{label}</label>
                        <input type="number" step={step} value={form[key] ?? ''}
                            onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))}
                            className={INPUT_CLASS} disabled={disabled} />
                    </div>
                ))}
            </div>
            <button onClick={save} disabled={disabled || busy}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50">
                {busy ? 'Saving…' : 'Save'}
            </button>
        </div>
    );
};

const StatutoryTablesPage = () => {
    const { hasPermission } = useAuth();
    const [versions, setVersions] = useState([]);
    const [selected, setSelected] = useState(null);
    const [detail, setDetail] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [supersedeTarget, setSupersedeTarget] = useState(null);
    const [supersedeForm, setSupersedeForm] = useState({ effective_from: '', version_label: '', source_reference: '' });

    const canConfig = hasPermission('payroll:config');

    const load = useCallback(async () => {
        if (!canConfig) { setLoading(false); return; }
        setLoading(true);
        setError('');
        try {
            const { data } = await api.get('/payroll/statutory-versions');
            setVersions(Array.isArray(data) ? data : []);
        } catch {
            setError('Failed to load statutory schedules.');
        } finally {
            setLoading(false);
        }
    }, [canConfig]);

    useEffect(() => { load(); }, [load]);

    const openVersion = async (v) => {
        setSelected(v);
        try {
            const { data } = await api.get(`/payroll/statutory-versions/${v.version_id}/brackets`);
            setDetail(data);
        } catch {
            toast.error('Failed to load schedule detail');
            setDetail(null);
        }
    };

    const submitSupersede = async () => {
        if (!supersedeForm.effective_from) { toast.error('An effective date is required'); return; }
        try {
            const { data } = await api.post(
                `/payroll/statutory-versions/${supersedeTarget.version_id}/supersede`, supersedeForm
            );
            toast.success(`Created ${data.newVersion.version_label} — edit its figures below.`);
            setSupersedeTarget(null);
            setSupersedeForm({ effective_from: '', version_label: '', source_reference: '' });
            await load();
            openVersion({ ...data.newVersion, in_use: false });
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to supersede');
        }
    };

    if (!canConfig) {
        return (
            <div className="text-center p-8">
                <h1 className="text-2xl font-bold text-danger-600">Access Denied</h1>
                <p className="text-gray-600 dark:text-slate-400 mt-2">You do not have permission to view this page.</p>
            </div>
        );
    }

    const frozen = selected?.in_use;

    return (
        <div>
            <h1 className="text-2xl font-semibold text-gray-800 dark:text-slate-100 mb-2">Statutory Schedules</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-6 max-w-3xl">
                Contribution and withholding rates, versioned by effective date. A schedule that has already
                been used by a payroll run is frozen so historical payslips stay reproducible — change those by
                superseding them with a new version.
            </p>

            {loading && <LoadingState label="Loading schedules…" />}
            {!loading && error && <ErrorState description={error} onRetry={load} />}

            {!loading && !error && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="space-y-2">
                        {versions.map((v) => (
                            <button key={v.version_id} onClick={() => openVersion(v)}
                                className={`w-full text-left p-3 rounded-xl border transition ${
                                    selected?.version_id === v.version_id
                                        ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                                        : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-gray-300'
                                }`}>
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="font-semibold text-sm text-gray-900 dark:text-slate-100">
                                        {AGENCY_NAME[v.agency]}
                                    </span>
                                    <StatusBadge tone={v.in_use ? 'primary' : 'success'}
                                        label={v.in_use ? 'In use' : 'Editable'} />
                                </div>
                                <p className="text-xs text-gray-600 dark:text-slate-400">{v.version_label}</p>
                                <p className="text-[11px] text-gray-400 dark:text-slate-500 tabular-nums mt-0.5">
                                    {v.effective_from} → {v.effective_to || 'open'}
                                </p>
                            </button>
                        ))}
                    </div>

                    <div className="lg:col-span-2">
                        {!selected ? (
                            <div className="p-8 text-center text-sm text-gray-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-xl border border-gray-200 dark:border-slate-700">
                                Select a schedule to view or edit its figures.
                            </div>
                        ) : (
                            <div className="bg-white dark:bg-slate-800 p-6 rounded-xl border border-gray-200 dark:border-slate-700 space-y-4">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-50">
                                            {AGENCY_NAME[selected.agency]}
                                        </h2>
                                        <p className="text-xs text-gray-500 dark:text-slate-400">{selected.source_reference}</p>
                                    </div>
                                    <button onClick={() => setSupersedeTarget(selected)}
                                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200">
                                        Supersede…
                                    </button>
                                </div>

                                {frozen && (
                                    <div className="p-3 rounded-lg bg-warning-50 dark:bg-warning-900/20 border border-warning-200 dark:border-warning-800">
                                        <p className="text-xs text-warning-800 dark:text-warning-400">
                                            This schedule has already paid somebody, so its figures are locked. Use
                                            <strong> Supersede</strong> to introduce new rates from a future date — the
                                            existing payslips keep computing from these numbers.
                                        </p>
                                    </div>
                                )}

                                {selected.agency === 'SSS' && (
                                    <SssEditor version={selected} onSaved={() => openVersion(selected)} disabled={frozen} />
                                )}
                                {selected.agency === 'PHILHEALTH' && (
                                    <ConfigEditor version={selected} current={detail?.brackets?.[0]} disabled={frozen}
                                        onSaved={() => openVersion(selected)}
                                        fields={[
                                            ['premium_rate', 'Premium rate (0.05 = 5%)', 0.0001],
                                            ['income_floor', 'Income floor', 1],
                                            ['income_ceiling', 'Income ceiling', 1],
                                            ['ee_share_ratio', 'Employee share ratio', 0.0001],
                                        ]} />
                                )}
                                {selected.agency === 'PAGIBIG' && (
                                    <ConfigEditor version={selected} current={detail?.brackets?.[0]} disabled={frozen}
                                        onSaved={() => openVersion(selected)}
                                        fields={[
                                            ['threshold_amount', 'Rate threshold', 1],
                                            ['ee_rate_below', 'EE rate at/below', 0.0001],
                                            ['ee_rate_above', 'EE rate above', 0.0001],
                                            ['er_rate', 'Employer rate', 0.0001],
                                            ['max_compensation', 'Maximum compensation', 1],
                                        ]} />
                                )}

                                {detail && (
                                    <div className="pt-2">
                                        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-slate-400 mb-2">
                                            Current figures
                                        </h3>
                                        <div className="max-h-72 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                                            <table className="w-full text-xs">
                                                <tbody>
                                                    {detail.agency === 'SSS' && detail.brackets.slice(0, 200).map((b) => (
                                                        <tr key={b.msc} className="border-b border-gray-100 dark:border-slate-800">
                                                            <td className="p-2 text-gray-500">MSC {b.msc}</td>
                                                            <td className="p-2 text-right tabular-nums">EE {b.ee_amount}</td>
                                                            <td className="p-2 text-right tabular-nums">ER {b.er_amount}</td>
                                                            <td className="p-2 text-right tabular-nums">WISP {b.mpf_ee}</td>
                                                        </tr>
                                                    ))}
                                                    {detail.agency === 'BIR_WTAX' && detail.brackets.map((b, i) => (
                                                        <tr key={i} className="border-b border-gray-100 dark:border-slate-800">
                                                            <td className="p-2 text-gray-500">{b.payroll_frequency} #{b.bracket_seq}</td>
                                                            <td className="p-2 text-right tabular-nums">over {b.excess_over}</td>
                                                            <td className="p-2 text-right tabular-nums">base {b.base_tax}</td>
                                                            <td className="p-2 text-right tabular-nums">{pct(b.rate_percent)}</td>
                                                        </tr>
                                                    ))}
                                                    {['PHILHEALTH', 'PAGIBIG'].includes(detail.agency)
                                                        && detail.brackets[0] && Object.entries(detail.brackets[0])
                                                            .filter(([k]) => k !== 'version_id')
                                                            .map(([k, v]) => (
                                                                <tr key={k} className="border-b border-gray-100 dark:border-slate-800">
                                                                    <td className="p-2 text-gray-500">{k}</td>
                                                                    <td className="p-2 text-right tabular-nums">{v}</td>
                                                                </tr>
                                                            ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <Modal isOpen={Boolean(supersedeTarget)} onClose={() => setSupersedeTarget(null)}
                title={`Supersede ${AGENCY_NAME[supersedeTarget?.agency] || ''}`}>
                <div className="space-y-4">
                    <p className="text-sm text-gray-600 dark:text-slate-300">
                        This closes the current schedule the day before the date you choose and creates a new one
                        with the same figures, ready to edit. Payroll runs before that date keep using the old numbers.
                    </p>
                    <div>
                        <label className={LABEL_CLASS}>Effective from</label>
                        <input type="date" className={INPUT_CLASS} value={supersedeForm.effective_from}
                            onChange={(e) => setSupersedeForm((p) => ({ ...p, effective_from: e.target.value }))} />
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Label</label>
                        <input type="text" className={INPUT_CLASS} placeholder="e.g. SSS 2027 circular"
                            value={supersedeForm.version_label}
                            onChange={(e) => setSupersedeForm((p) => ({ ...p, version_label: e.target.value }))} />
                    </div>
                    <div>
                        <label className={LABEL_CLASS}>Source reference</label>
                        <input type="text" className={INPUT_CLASS} placeholder="Circular or RR number"
                            value={supersedeForm.source_reference}
                            onChange={(e) => setSupersedeForm((p) => ({ ...p, source_reference: e.target.value }))} />
                    </div>
                    <div className="flex justify-end gap-3">
                        <button onClick={() => setSupersedeTarget(null)}
                            className="px-4 py-2 bg-gray-200 dark:bg-slate-700 text-gray-800 dark:text-slate-200 rounded-lg">Cancel</button>
                        <button onClick={submitSupersede}
                            className="px-4 py-2 bg-primary-600 text-white rounded-lg font-semibold hover:bg-primary-700">
                            Supersede
                        </button>
                    </div>
                </div>
            </Modal>
        </div>
    );
};

export default StatutoryTablesPage;
