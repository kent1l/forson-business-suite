import { useState, useEffect, useCallback, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import Icon from '../components/ui/Icon';
import InfoTip from '../components/ui/InfoTip';
import Modal from '../components/ui/Modal';
import { ICONS } from '../constants';

/**
 * Creditable withholding tax: what customers have deducted from us, which of it we
 * can prove, and the register the bookkeeper files from.
 *
 * The organising idea is that withholding and the certificate proving it are two
 * separate events, often a quarter apart. Between them the company is out of pocket
 * for tax it cannot yet claim, so "Awaiting certificates" leads rather than hides in
 * a filter -- it is the only tab that represents money at risk.
 */

const peso = (n) => `₱${Number(n || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TYPE_LABELS = {
    EWT_GOODS: 'EWT · Goods',
    EWT_SERVICES: 'EWT · Services',
    VAT_GOV: 'Withholding VAT',
};

// The quarter boundaries the register is almost always run for.
const quarterRange = (date = new Date()) => {
    const q = Math.floor(date.getMonth() / 3);
    const from = new Date(date.getFullYear(), q * 3, 1);
    const to = new Date(date.getFullYear(), q * 3 + 3, 0);
    const iso = (d) => d.toISOString().split('T')[0];
    return { from: iso(from), to: iso(to) };
};

const TABS = [
    { key: 'outstanding', label: 'Awaiting certificates' },
    { key: 'certificates', label: 'Certificates on file' },
    { key: 'register', label: 'CWT register' },
];

export default function WithholdingTaxPage() {
    const [tab, setTab] = useState('outstanding');

    const [outstanding, setOutstanding] = useState([]);
    const [certificates, setCertificates] = useState([]);
    const [register, setRegister] = useState(null);
    const [loading, setLoading] = useState(false);

    const initialRange = useMemo(() => quarterRange(), []);
    const [dateFrom, setDateFrom] = useState(initialRange.from);
    const [dateTo, setDateTo] = useState(initialRange.to);

    const [isFormOpen, setIsFormOpen] = useState(false);
    const [formCustomer, setFormCustomer] = useState(null);
    const [previewCert, setPreviewCert] = useState(null);

    const loadOutstanding = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/withholding/outstanding');
            setOutstanding(res.data);
        } catch {
            toast.error('Could not load outstanding withholding.');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadCertificates = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/withholding/certificates');
            setCertificates(res.data);
        } catch {
            toast.error('Could not load certificates.');
        } finally {
            setLoading(false);
        }
    }, []);

    const loadRegister = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/withholding/register', { params: { date_from: dateFrom, date_to: dateTo } });
            setRegister(res.data);
        } catch {
            toast.error('Could not build the register.');
        } finally {
            setLoading(false);
        }
    }, [dateFrom, dateTo]);

    useEffect(() => {
        if (tab === 'outstanding') loadOutstanding();
        if (tab === 'certificates') loadCertificates();
        if (tab === 'register') loadRegister();
    }, [tab, loadOutstanding, loadCertificates, loadRegister]);

    const exportRegister = async () => {
        try {
            const res = await api.get('/withholding/register', {
                params: { date_from: dateFrom, date_to: dateTo, format: 'csv' },
                responseType: 'blob',
            });
            const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
            const a = document.createElement('a');
            a.href = url;
            a.download = `cwt-register-${dateFrom}-to-${dateTo}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch {
            toast.error('Could not export the register.');
        }
    };

    const totalUnsubstantiated = useMemo(
        () => outstanding.reduce((sum, r) => sum + Number(r.total_withheld || 0), 0),
        [outstanding]
    );

    return (
        <div className="p-6 max-w-7xl mx-auto">
            <div className="flex items-start justify-between gap-4 mb-6">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 flex items-center gap-2">
                        Withholding Tax
                        <InfoTip label="Withholding Tax">
                            Customers designated as withholding agents, and all government buyers, deduct tax from what they pay us and remit it to BIR under our TIN. That tax is creditable against our own liability &mdash; but only if we hold the BIR certificate (Form 2307 or 2306) proving it was withheld.
                        </InfoTip>
                    </h1>
                    <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
                        Tax deducted at source by customers, and the certificates that substantiate it.
                    </p>
                </div>
                <button
                    onClick={() => { setFormCustomer(null); setIsFormOpen(true); }}
                    className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors shadow-xs flex items-center gap-2 shrink-0"
                >
                    <Icon path={ICONS.plus} className="h-4 w-4" />
                    Record a certificate
                </button>
            </div>

            {/* The headline number is what we have surrendered but cannot yet claim. */}
            {outstanding.length > 0 && (
                <div className="mb-6 p-4 rounded-lg border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                        <div>
                            <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                                {peso(totalUnsubstantiated)} withheld without a certificate
                            </div>
                            <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                                Already deducted from our collections and remitted to BIR by the customer. Not claimable until the certificate is in hand.
                            </p>
                        </div>
                        <div className="text-xs text-amber-800 dark:text-amber-300">
                            {outstanding.length} customer{outstanding.length === 1 ? '' : 's'}
                        </div>
                    </div>
                </div>
            )}

            <div className="border-b border-gray-200 dark:border-slate-700 mb-4">
                <nav className="flex gap-6">
                    {TABS.map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
                                tab === t.key
                                    ? 'border-primary-600 text-primary-700 dark:text-primary-400'
                                    : 'border-transparent text-gray-500 dark:text-slate-400 hover:text-gray-800 dark:hover:text-slate-200'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </nav>
            </div>

            {loading && <div className="py-12 text-center text-sm text-gray-500 dark:text-slate-400">Loading&hellip;</div>}

            {!loading && tab === 'outstanding' && (
                <OutstandingTable rows={outstanding} onRecord={(row) => { setFormCustomer(row); setIsFormOpen(true); }} />
            )}

            {!loading && tab === 'certificates' && (
                <CertificatesTable rows={certificates} onChanged={loadCertificates} onPreview={setPreviewCert} />
            )}

            {!loading && tab === 'register' && (
                <RegisterView
                    register={register}
                    dateFrom={dateFrom} dateTo={dateTo}
                    onFromChange={setDateFrom} onToChange={setDateTo}
                    onExport={exportRegister}
                />
            )}

            <AttachmentViewer certificate={previewCert} onClose={() => setPreviewCert(null)} />

            <CertificateForm
                isOpen={isFormOpen}
                onClose={() => setIsFormOpen(false)}
                presetCustomer={formCustomer}
                onSaved={() => { setIsFormOpen(false); loadOutstanding(); if (tab === 'certificates') loadCertificates(); }}
            />
        </div>
    );
}

// ─────────────────────────────────────────────────────────────────────────────

function OutstandingTable({ rows, onRecord }) {
    if (rows.length === 0) {
        return (
            <div className="py-16 text-center">
                <p className="text-sm text-gray-500 dark:text-slate-400">
                    Every peso withheld from us is covered by a certificate.
                </p>
            </div>
        );
    }

    return (
        <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg">
            <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/60">
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        <th className="px-4 py-3 font-medium">Customer</th>
                        <th className="px-4 py-3 font-medium">TIN</th>
                        <th className="px-4 py-3 font-medium text-right">Invoices</th>
                        <th className="px-4 py-3 font-medium text-right">Base</th>
                        <th className="px-4 py-3 font-medium text-right">Withheld</th>
                        <th className="px-4 py-3 font-medium text-right">Oldest</th>
                        <th className="px-4 py-3"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {rows.map(row => (
                        <tr key={row.customer_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-3">
                                <div className="font-medium text-gray-900 dark:text-slate-100">{row.customer_name}</div>
                                {row.customer_type === 'GOVERNMENT' && (
                                    <span className="text-xs text-gray-500 dark:text-slate-400">Government</span>
                                )}
                            </td>
                            <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-slate-400">{row.tin || '—'}</td>
                            <td className="px-4 py-3 text-right tabular-nums">{row.invoice_count}</td>
                            <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-slate-400">{peso(row.total_base)}</td>
                            <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900 dark:text-slate-100">{peso(row.total_withheld)}</td>
                            <td className="px-4 py-3 text-right">
                                <AgeBadge days={row.oldest_age_days} />
                            </td>
                            <td className="px-4 py-3 text-right">
                                <button
                                    onClick={() => onRecord(row)}
                                    className="text-xs font-medium text-primary-700 dark:text-primary-400 hover:underline"
                                >
                                    Record certificate
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

/**
 * BIR requires the certificate to be issued within 20 days of the close of the
 * quarter it covers. Past roughly a quarter, an unissued certificate is at real risk
 * of never arriving, which is why the badge escalates rather than just counting days.
 */
function AgeBadge({ days }) {
    const n = Number(days || 0);
    const tone = n > 90
        ? 'bg-danger-100 text-danger-800 dark:bg-danger-950/50 dark:text-danger-300'
        : n > 45
            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
            : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300';
    return <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium tabular-nums ${tone}`}>{n}d</span>;
}

function CertificatesTable({ rows, onChanged, onPreview }) {
    const cancel = async (row) => {
        if (!confirm(`Cancel certificate ${row.certificate_no || `#${row.certificate_id}`}? The withholding it covers will go back on the chase list.`)) return;
        try {
            await api.put(`/withholding/certificates/${row.certificate_id}`, { status: 'CANCELLED' });
            toast.success('Certificate cancelled.');
            onChanged();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Could not cancel the certificate.');
        }
    };

    if (rows.length === 0) {
        return <div className="py-16 text-center text-sm text-gray-500 dark:text-slate-400">No certificates recorded yet.</div>;
    }

    return (
        <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg">
            <table className="min-w-full text-sm">
                <thead className="bg-gray-50 dark:bg-slate-800/60">
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                        <th className="px-4 py-3 font-medium">Certificate</th>
                        <th className="px-4 py-3 font-medium">Customer</th>
                        <th className="px-4 py-3 font-medium">Period</th>
                        <th className="px-4 py-3 font-medium text-right">Withheld (per form)</th>
                        <th className="px-4 py-3 font-medium text-right">Allocated</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3"></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                    {rows.map(row => {
                        // The customer's figure and ours are recorded independently; a gap
                        // between them is the thing a reviewer is looking for.
                        const variance = Number(row.tax_withheld_total) - Number(row.allocated_withheld);
                        return (
                            <tr key={row.certificate_id} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                                <td className="px-4 py-3">
                                    <div className="font-medium text-gray-900 dark:text-slate-100">
                                        {row.certificate_no || <span className="text-gray-400">unnumbered</span>}
                                    </div>
                                    <span className="text-xs text-gray-500 dark:text-slate-400">Form {row.certificate_type}</span>
                                    {row.has_attachment && (
                                        <button
                                            type="button"
                                            onClick={() => onPreview(row)}
                                            className="ml-2 text-xs text-primary-700 dark:text-primary-400 hover:underline"
                                        >
                                            view scan
                                        </button>
                                    )}
                                </td>
                                <td className="px-4 py-3 text-gray-900 dark:text-slate-100">{row.customer_name}</td>
                                <td className="px-4 py-3 text-xs text-gray-600 dark:text-slate-400">
                                    {row.period_from && row.period_to
                                        ? `${row.period_from.split('T')[0]} → ${row.period_to.split('T')[0]}`
                                        : '—'}
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">{peso(row.tax_withheld_total)}</td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                    {peso(row.allocated_withheld)}
                                    {Math.abs(variance) > 0.005 && (
                                        <div className="text-xs text-amber-700 dark:text-amber-400">
                                            {variance > 0 ? '+' : ''}{variance.toFixed(2)} unmatched
                                        </div>
                                    )}
                                </td>
                                <td className="px-4 py-3">
                                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                                        row.status === 'CANCELLED'
                                            ? 'bg-gray-100 text-gray-600 dark:bg-slate-800 dark:text-slate-400'
                                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                                    }`}>
                                        {row.status}
                                    </span>
                                </td>
                                <td className="px-4 py-3 text-right">
                                    {row.status !== 'CANCELLED' && (
                                        <button onClick={() => cancel(row)} className="text-xs text-danger-600 dark:text-danger-400 hover:underline">
                                            Cancel
                                        </button>
                                    )}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function RegisterView({ register, dateFrom, dateTo, onFromChange, onToChange, onExport }) {
    const inputCls = 'px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';

    return (
        <div>
            <div className="flex items-end gap-3 mb-4 flex-wrap">
                <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">From</label>
                    <input type="date" value={dateFrom} onChange={e => onFromChange(e.target.value)} className={inputCls} />
                </div>
                <div>
                    <label className="block text-xs font-medium text-gray-600 dark:text-slate-400 mb-1">To</label>
                    <input type="date" value={dateTo} onChange={e => onToChange(e.target.value)} className={inputCls} />
                </div>
                <button onClick={onExport} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors flex items-center gap-2">
                    <Icon path={ICONS.download} className="h-4 w-4" />
                    Export CSV
                </button>
                <p className="text-xs text-gray-500 dark:text-slate-400 ml-auto max-w-md">
                    One row per customer per ATC code &mdash; the granularity BIR&rsquo;s Alphalist Data Entry tool expects. Periodised on when the tax was withheld, not the invoice date.
                </p>
            </div>

            {register && (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                        <SummaryTile label="Tax base" value={peso(register.totals.tax_base)} />
                        <SummaryTile label="Tax withheld" value={peso(register.totals.tax_withheld)} />
                        <SummaryTile
                            label="Not yet substantiated"
                            value={peso(register.totals.unsubstantiated_withheld)}
                            tone={register.totals.unsubstantiated_withheld > 0 ? 'warn' : 'ok'}
                        />
                    </div>

                    {register.data.length === 0 ? (
                        <div className="py-16 text-center text-sm text-gray-500 dark:text-slate-400">
                            No tax was withheld from us in this period.
                        </div>
                    ) : (
                        <div className="overflow-x-auto border border-gray-200 dark:border-slate-700 rounded-lg">
                            <table className="min-w-full text-sm">
                                <thead className="bg-gray-50 dark:bg-slate-800/60">
                                    <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">
                                        <th className="px-4 py-3 font-medium">Payor</th>
                                        <th className="px-4 py-3 font-medium">TIN</th>
                                        <th className="px-4 py-3 font-medium">ATC</th>
                                        <th className="px-4 py-3 font-medium text-right">Rate</th>
                                        <th className="px-4 py-3 font-medium text-right">Base</th>
                                        <th className="px-4 py-3 font-medium text-right">Withheld</th>
                                        <th className="px-4 py-3 font-medium text-right">Substantiated</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100 dark:divide-slate-800">
                                    {register.data.map((r, i) => (
                                        <tr key={`${r.customer_id}-${r.atc_code}-${i}`} className="hover:bg-gray-50 dark:hover:bg-slate-800/40">
                                            <td className="px-4 py-3">
                                                <div className="text-gray-900 dark:text-slate-100">{r.payor_name}</div>
                                                <span className="text-xs text-gray-500 dark:text-slate-400">{TYPE_LABELS[r.withholding_type] || r.withholding_type}</span>
                                            </td>
                                            <td className="px-4 py-3 font-mono text-xs text-gray-600 dark:text-slate-400">{r.payor_tin || '—'}</td>
                                            <td className="px-4 py-3 font-mono text-xs">{r.atc_code}</td>
                                            <td className="px-4 py-3 text-right tabular-nums">{(Number(r.rate) * 100).toFixed(0)}%</td>
                                            <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-slate-400">{peso(r.tax_base)}</td>
                                            <td className="px-4 py-3 text-right tabular-nums font-semibold">{peso(r.tax_withheld)}</td>
                                            <td className="px-4 py-3 text-right tabular-nums">
                                                <span className={Number(r.substantiated_withheld || 0) < Number(r.tax_withheld) ? 'text-amber-700 dark:text-amber-400' : ''}>
                                                    {peso(r.substantiated_withheld)}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

/**
 * On-screen viewer for a stored certificate scan.
 *
 * The file is fetched through the api client rather than linked to directly. A plain
 * <a href="/api/..."> is a browser navigation, and browser navigations do not run the
 * axios interceptor that attaches the bearer token -- the request arrives
 * unauthenticated and the route answers "Not authorized, no token". Pulling the bytes
 * as a blob keeps the request inside the authenticated client, and the object URL it
 * produces is what the viewer renders.
 *
 * Worth previewing rather than downloading: checking a 2307 means reading the payor,
 * period and amounts against the figures already on screen. Making that a trip through
 * the downloads folder turns a ten-second check into a chore, and chores get skipped.
 */
function AttachmentViewer({ certificate, onClose }) {
    const [state, setState] = useState({ status: 'idle', url: null, mime: null });

    useEffect(() => {
        if (!certificate) {
            setState({ status: 'idle', url: null, mime: null });
            return;
        }
        let objectUrl = null;
        let cancelled = false;
        setState({ status: 'loading', url: null, mime: null });

        api.get(`/withholding/certificates/${certificate.certificate_id}/attachment`, { responseType: 'blob' })
            .then(res => {
                if (cancelled) return;
                objectUrl = URL.createObjectURL(res.data);
                setState({ status: 'ready', url: objectUrl, mime: res.data.type || certificate.attachment_mime });
            })
            .catch(() => { if (!cancelled) setState({ status: 'error', url: null, mime: null }); });

        // Object URLs pin the blob in memory until revoked, and a bookkeeper opens
        // dozens of these in a filing session.
        return () => {
            cancelled = true;
            if (objectUrl) URL.revokeObjectURL(objectUrl);
        };
    }, [certificate]);

    if (!certificate) return null;

    const isPdf = (state.mime || '').includes('pdf');

    return (
        <Modal
            isOpen={!!certificate}
            onClose={onClose}
            maxWidth="max-w-4xl"
            bodyClassName="p-0"
            header={
                <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 truncate">
                        {certificate.certificate_no || `Certificate #${certificate.certificate_id}`}
                    </h2>
                    <p className="text-xs text-gray-500 dark:text-slate-400 truncate">
                        Form {certificate.certificate_type} · {certificate.customer_name}
                        {certificate.attachment_filename ? ` · ${certificate.attachment_filename}` : ''}
                    </p>
                </div>
            }
        >
            <div className="flex flex-col h-[70vh]">
                <div className="flex-1 min-h-0 bg-gray-100 dark:bg-slate-900">
                    {state.status === 'loading' && (
                        <div className="h-full flex items-center justify-center text-sm text-gray-500 dark:text-slate-400">
                            Loading scan&hellip;
                        </div>
                    )}
                    {state.status === 'error' && (
                        <div className="h-full flex items-center justify-center text-sm text-danger-600 dark:text-danger-400 px-6 text-center">
                            The scan could not be loaded.
                        </div>
                    )}
                    {state.status === 'ready' && (
                        isPdf
                            ? <iframe src={state.url} title="Certificate scan" className="w-full h-full border-0" />
                            : <div className="h-full overflow-auto flex items-start justify-center p-4">
                                  <img src={state.url} alt="Certificate scan" className="max-w-full" />
                              </div>
                    )}
                </div>
                {state.status === 'ready' && (
                    <div className="p-3 border-t border-gray-200 dark:border-slate-700 flex justify-end gap-3">
                        <a
                            href={state.url}
                            target="_blank"
                            rel="noreferrer"
                            className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors"
                        >
                            Open full size
                        </a>
                        <a
                            href={state.url}
                            download={certificate.attachment_filename || `certificate-${certificate.certificate_id}`}
                            className="px-4 py-2 bg-primary-600 hover:bg-primary-700 text-white rounded-lg text-sm font-medium transition-colors shadow-xs"
                        >
                            Download
                        </a>
                    </div>
                )}
            </div>
        </Modal>
    );
}

function SummaryTile({ label, value, tone = 'neutral' }) {
    const toneCls = tone === 'warn'
        ? 'border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30'
        : 'border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900';
    return (
        <div className={`p-4 rounded-lg border ${toneCls}`}>
            <div className="text-xs text-gray-500 dark:text-slate-400">{label}</div>
            <div className="text-xl font-bold text-gray-900 dark:text-slate-100 tabular-nums mt-1">{value}</div>
        </div>
    );
}

/**
 * Recording a certificate that has arrived.
 *
 * The totals entered are the ones printed on the paper, not our own computation.
 * They are frequently different, and the difference is what the reviewer needs; the
 * lines chosen below are what we believe it covers.
 */
function CertificateForm({ isOpen, onClose, presetCustomer, onSaved }) {
    const [customers, setCustomers] = useState([]);
    const [lines, setLines] = useState([]);
    const [selectedLineIds, setSelectedLineIds] = useState([]);
    const [file, setFile] = useState(null);
    const [filePreviewUrl, setFilePreviewUrl] = useState(null);
    const [saving, setSaving] = useState(false);
    const [form, setForm] = useState({
        customer_id: '', certificate_type: '2307', certificate_no: '',
        payor_tin: '', payor_registered_name: '',
        period_from: '', period_to: '', date_received: new Date().toISOString().split('T')[0],
        tax_base_total: '', tax_withheld_total: '', notes: '',
    });

    useEffect(() => {
        if (!isOpen) return;
        setFile(null);
        setSelectedLineIds([]);
        api.get('/customers', { params: { status: 'active' } })
            .then(res => setCustomers((res.data.data || res.data).filter(c => c.is_withholding_agent)))
            .catch(() => toast.error('Could not load customers.'));
        setForm(f => ({
            ...f,
            customer_id: presetCustomer?.customer_id || '',
            payor_tin: presetCustomer?.tin || '',
            payor_registered_name: presetCustomer?.customer_name || '',
            certificate_type: presetCustomer?.customer_type === 'GOVERNMENT' ? '2307' : '2307',
        }));
    }, [isOpen, presetCustomer]);

    useEffect(() => {
        if (!file) { setFilePreviewUrl(null); return; }
        const url = URL.createObjectURL(file);
        setFilePreviewUrl(url);
        return () => URL.revokeObjectURL(url);
    }, [file]);

    // Load the unclaimed lines for whichever customer is selected, so the certificate
    // can be matched to the withholding it actually covers.
    useEffect(() => {
        if (!form.customer_id) { setLines([]); return; }
        api.get('/withholding/lines', { params: { customer_id: form.customer_id, unclaimed_only: 'true' } })
            .then(res => setLines(res.data))
            .catch(() => setLines([]));
    }, [form.customer_id]);

    const selectedTotal = useMemo(
        () => lines.filter(l => selectedLineIds.includes(l.wt_line_id))
                   .reduce((sum, l) => sum + Number(l.actual_withheld), 0),
        [lines, selectedLineIds]
    );

    const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

    const toggleLine = (id) => setSelectedLineIds(prev =>
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );

    const submit = async (e) => {
        e.preventDefault();
        if (!form.customer_id) return toast.error('Choose the customer who issued the certificate.');
        setSaving(true);
        try {
            const res = await api.post('/withholding/certificates', {
                ...form,
                tax_base_total: Number(form.tax_base_total) || 0,
                tax_withheld_total: Number(form.tax_withheld_total) || 0,
                line_ids: selectedLineIds,
            });
            if (file) {
                const fd = new FormData();
                fd.append('attachment', file);
                await api.post(`/withholding/certificates/${res.data.certificate_id}/attachment`, fd, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
            }
            toast.success('Certificate recorded.');
            onSaved();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Could not save the certificate.');
        } finally {
            setSaving(false);
        }
    };

    const inputCls = 'mt-1 w-full px-3 py-2 border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-900 dark:text-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500';
    const labelCls = 'block text-sm font-medium text-gray-700 dark:text-slate-300';

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Record a withholding tax certificate">
            <form onSubmit={submit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                        <label className={labelCls}>Customer <span className="text-danger-500">*</span></label>
                        <select value={form.customer_id} onChange={set('customer_id')} className={inputCls} required>
                            <option value="">Select customer&hellip;</option>
                            {customers.map(c => (
                                <option key={c.customer_id} value={c.customer_id}>
                                    {c.registered_name || c.company_name || `${c.first_name} ${c.last_name || ''}`.trim()}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className={`${labelCls} flex items-center gap-1`}>
                            Form
                            <InfoTip label="Form">
                                2307 certifies creditable income tax withheld (EWT). 2306 certifies VAT withheld, which government buyers deduct on top of EWT. Record whichever the customer actually issued.
                            </InfoTip>
                        </label>
                        <select value={form.certificate_type} onChange={set('certificate_type')} className={inputCls}>
                            <option value="2307">2307 &mdash; creditable income tax</option>
                            <option value="2306">2306 &mdash; VAT withheld</option>
                        </select>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                        <label className={labelCls}>Certificate No.</label>
                        <input type="text" value={form.certificate_no} onChange={set('certificate_no')} className={`${inputCls} font-mono`} />
                    </div>
                    <div>
                        <label className={labelCls}>Payor TIN</label>
                        <input type="text" value={form.payor_tin} onChange={set('payor_tin')} placeholder="123-456-789-000" className={`${inputCls} font-mono`} />
                    </div>
                    <div>
                        <label className={labelCls}>Date received</label>
                        <input type="date" value={form.date_received} onChange={set('date_received')} className={inputCls} />
                    </div>
                </div>

                <div>
                    <label className={labelCls}>Payor registered name</label>
                    <input type="text" value={form.payor_registered_name} onChange={set('payor_registered_name')} className={inputCls} />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                    <div>
                        <label className={labelCls}>Period from</label>
                        <input type="date" value={form.period_from} onChange={set('period_from')} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Period to</label>
                        <input type="date" value={form.period_to} onChange={set('period_to')} className={inputCls} />
                    </div>
                    <div>
                        <label className={labelCls}>Base (per form)</label>
                        <input type="number" step="0.01" value={form.tax_base_total} onChange={set('tax_base_total')} className={`${inputCls} text-right font-mono`} />
                    </div>
                    <div>
                        <label className={`${labelCls} flex items-center gap-1`}>
                            Withheld
                            <InfoTip label="Withheld (per form)">
                                Enter what the certificate says, even if it disagrees with our records. The gap between the two is the thing worth seeing.
                            </InfoTip>
                        </label>
                        <input type="number" step="0.01" value={form.tax_withheld_total} onChange={set('tax_withheld_total')} className={`${inputCls} text-right font-mono`} />
                    </div>
                </div>

                {lines.length > 0 && (
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label className={`${labelCls} flex items-center gap-1`}>
                                Withholding this certificate covers
                                <InfoTip label="Coverage">
                                    Tick the deductions this certificate proves. They stop appearing on the chase list once attached, and a deduction can only ever belong to one certificate.
                                </InfoTip>
                            </label>
                            <span className="text-xs text-gray-500 dark:text-slate-400 tabular-nums">
                                selected {peso(selectedTotal)}
                                {form.tax_withheld_total && Math.abs(selectedTotal - Number(form.tax_withheld_total)) > 0.005 && (
                                    <span className="text-amber-700 dark:text-amber-400"> · form says {peso(form.tax_withheld_total)}</span>
                                )}
                            </span>
                        </div>
                        <div className="max-h-48 overflow-y-auto border border-gray-200 dark:border-slate-700 rounded-lg divide-y divide-gray-100 dark:divide-slate-800">
                            {lines.map(l => (
                                <label key={l.wt_line_id} className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-800/40 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={selectedLineIds.includes(l.wt_line_id)}
                                        onChange={() => toggleLine(l.wt_line_id)}
                                        className="h-4 w-4 rounded border-gray-300 dark:border-slate-600 text-primary-600 focus:ring-primary-500"
                                    />
                                    <span className="flex-1 text-gray-900 dark:text-slate-100">{l.invoice_number}</span>
                                    <span className="text-xs text-gray-500 dark:text-slate-400">{TYPE_LABELS[l.withholding_type]} · {l.atc_code}</span>
                                    <span className="font-mono tabular-nums">{peso(l.actual_withheld)}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                <div>
                    <label className={`${labelCls} flex items-center gap-1`}>
                        Scan of the certificate
                        <InfoTip label="Scan">
                            The certificate is the only evidence supporting the credit. If BIR questions it years later and the paper cannot be produced, the credit is disallowed &mdash; so the scan is stored with the record.
                        </InfoTip>
                    </label>
                    <input
                        type="file"
                        accept="application/pdf,image/*"
                        onChange={e => setFile(e.target.files?.[0] || null)}
                        className="mt-1 w-full text-sm text-gray-600 dark:text-slate-400 file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-gray-100 dark:file:bg-slate-700 file:text-gray-700 dark:file:text-slate-200"
                    />
                    {/* Shown before saving so an unreadable photo or the wrong page is
                        caught now, rather than years later when the credit is queried. */}
                    {filePreviewUrl && (
                        <div className="mt-2 border border-gray-200 dark:border-slate-700 rounded-lg overflow-hidden bg-gray-50 dark:bg-slate-900">
                            {file?.type?.includes('pdf')
                                ? <iframe src={filePreviewUrl} title="Selected scan" className="w-full h-64 border-0" />
                                : <img src={filePreviewUrl} alt="Selected scan" className="max-h-64 mx-auto" />}
                        </div>
                    )}
                </div>

                <div>
                    <label className={labelCls}>Notes</label>
                    <textarea value={form.notes} onChange={set('notes')} rows="2" className={inputCls} />
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-gray-200 dark:border-slate-700">
                    <button type="button" onClick={onClose} className="px-4 py-2 bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg hover:bg-gray-200 dark:hover:bg-slate-600 text-sm font-medium transition-colors">
                        Cancel
                    </button>
                    <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium transition-colors shadow-xs">
                        {saving ? 'Saving…' : 'Save certificate'}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
