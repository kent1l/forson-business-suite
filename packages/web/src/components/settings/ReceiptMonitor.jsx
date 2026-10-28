import { useEffect, useRef, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import Icon from '../ui/Icon';
import StatusBadge from '../ui/StatusBadge';
import { ICONS } from '../../constants';
import { useAuth } from '../../contexts/AuthContext';
import InvoiceDetailsModal from '../refunds/InvoiceDetailsModal';

const labels = { ISSUED: 'Issued', SPOILED: 'Spoiled', VOIDED: 'Voided', NO_RECORD: 'No system record' };
const tones = { ISSUED: 'success', SPOILED: 'warning', VOIDED: 'danger', NO_RECORD: 'neutral' };
const sourceLabels = { INVOICE: 'Invoice', CUSTOMER_PAYMENT: 'Payment', COLLECTION_GROUP: 'Collection group' };
const roleLabels = { PRIMARY: 'Current assignment', HISTORICAL: 'Previous assignment', 'LEGACY MATCH': 'Legacy match' };
const permissions = {
    INVOICE: { view: 'invoicing:create', link: 'invoice:edit_receipt_no' },
    CUSTOMER_PAYMENT: { view: 'ar:view', link: 'ar:receive_payment' },
    COLLECTION_GROUP: { view: 'ar:view', link: 'ar:receive_payment' },
};
const inputClass = 'w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-xs outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:[color-scheme:dark]';
const buttonClass = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 transition hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700';
const linkClass = 'inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300 dark:hover:bg-primary-900/30';
const primaryClass = 'inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40';
const dateText = value => value ? new Date(value).toLocaleString(undefined, { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' }) : '—';
const numberText = value => BigInt(value || 0).toLocaleString();
const emptyData = { items: [], total: '0' };

export default function ReceiptMonitor({ seriesList, onSpoil, onCorrect, onConfigureSeries, refresh }) {
    const { hasPermission } = useAuth();
    const [seriesId, setSeriesId] = useState('');
    const [page, setPage] = useState('1');
    const [data, setData] = useState(emptyData);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('ALL');
    const [search, setSearch] = useState('');
    const [from, setFrom] = useState('');
    const [to, setTo] = useState('');
    const [sort, setSort] = useState({ field: 'recorded_at', direction: 'desc' });
    const [numberSort, setNumberSort] = useState({ field: 'reference', direction: 'asc' });
    const [history, setHistory] = useState(null);
    const [followUp, setFollowUp] = useState(null);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [revision, setRevision] = useState(0);
    const [link, setLink] = useState(null);
    const [sourceType, setSourceType] = useState('INVOICE');
    const [sourceId, setSourceId] = useState('');
    const [preview, setPreview] = useState(null);
    const [invoice, setInvoice] = useState(null);
    const [verified, setVerified] = useState(false);
    const requestId = useRef(0);
    const isSpoilage = status === 'SPOILED';
    const pageSize = isSpoilage ? 10 : 25;
    const selectedSeries = seriesList.find(s => String(s.series_id) === seriesId);
    const reload = () => setRevision(n => n + 1);
    const changeSeries = value => {
        requestId.current++;
        setSeriesId(value); setPage('1'); setData(emptyData);
    };
    const changeStatus = value => { if ((value === 'SPOILED') !== isSpoilage) setSearch(''); setStatus(value); setPage('1'); setData(emptyData); };
    useEffect(() => {
        if (!seriesId && !isSpoilage) { setData(emptyData); setLoading(false); setError(''); return; }
        let active = true;
        setLoading(true); setError(''); setData(emptyData);
        const endpoint = isSpoilage ? '/settings/physical-document-spoilage' : '/settings/physical-document-monitor';
        const params = isSpoilage
            ? { series_id: seriesId || undefined, page, pageSize, search: search || undefined,
                date_from: from || undefined, date_to: to || undefined, sortBy: sort.field, sortOrder: sort.direction }
            : { series_id: seriesId, page, status, search: search || undefined, sortBy: numberSort.field, sortOrder: numberSort.direction };
        api.get(endpoint, { params }).then(({ data: result }) => {
            if (!active) return;
            const items = result.items || result.data || [];
            const total = String(result.total || 0);
            const lastPage = (BigInt(total) + BigInt(pageSize - 1)) / BigInt(pageSize) || 1n;
            if (BigInt(page) > lastPage) setPage(String(lastPage));
            else setData({ ...result, items, total });
        }).catch(err => { if (active) setError(err.response?.data?.message || 'Failed to load receipt records.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [seriesId, page, status, isSpoilage, pageSize, search, from, to, sort, numberSort, refresh, revision]);
    useEffect(() => { requestId.current++; setHistory(null); setFollowUp(null); setLink(null); setPreview(null); }, [seriesId]);
    useEffect(() => () => { requestId.current++; }, []);

    const showHistory = async row => {
        const current = ++requestId.current;
        try {
            const reference = row.reference || row.canonical_full_reference;
            const response = await api.get('/settings/physical-document-monitor/history', { params: { series_id: row.series_id || seriesId, reference } });
            if (requestId.current === current) setHistory({ reference, events: response.data });
        } catch (err) { if (requestId.current === current) toast.error(err.response?.data?.message || 'Failed to load history.'); }
    };
    const saveFollowUp = async e => {
        e.preventDefault(); setSaving(true);
        try {
            await api.post('/settings/physical-document-monitor/follow-up', { series_id: Number(seriesId), reference: followUp.reference,
                reason, resolve: !!followUp.follow_up_id, expected_event_id: followUp.follow_up_id });
            toast.success(followUp.follow_up_id ? 'Follow-up resolved.' : 'Follow-up recorded.'); setFollowUp(null); setReason(''); reload();
        } catch (err) { toast.error(err.response?.data?.message || 'Failed to save follow-up.'); reload(); }
        finally { setSaving(false); }
    };
    const openTransaction = async (row, source = null) => {
        const current = ++requestId.current;
        setLink(row); setPreview(null); setVerified(false); setReason('');
        const type = source?.type || (hasPermission('invoicing:create') ? 'INVOICE' : 'CUSTOMER_PAYMENT');
        setSourceType(type); setSourceId(source ? String(source.id) : '');
        if (!source) return;
        try {
            const { data: result } = await api.get('/settings/physical-document-monitor/transaction', { params: { source_type: type, source_id: source.id } });
            if (requestId.current === current) setPreview(result);
        } catch (err) { if (requestId.current === current) toast.error(err.response?.data?.message || 'Failed to load transaction.'); }
    };
    const inspect = async e => {
        e.preventDefault();
        const current = ++requestId.current;
        setPreview(null); setVerified(false);
        try {
            const { data: result } = await api.get('/settings/physical-document-monitor/transaction', { params: { source_type: sourceType, source_id: sourceId } });
            if (requestId.current === current) setPreview(result);
        } catch (err) { if (requestId.current === current) toast.error(err.response?.data?.message || 'Failed to load transaction.'); }
    };
    const reconcile = async e => {
        e.preventDefault(); if (!preview || !verified || saving) return;
        setSaving(true);
        try {
            await api.post('/settings/physical-document-monitor/reconcile', { series_id: Number(seriesId), reference: link.reference,
                source_type: preview.source_type, source_id: preview.source_id, reason, verified,
                expected_reference: preview.physical_receipt_no, expected_registry_id: preview.physical_document_registry_id,
                expected_version: preview.physical_receipt_version });
            toast.success('Receipt linked with audit history.'); setLink(null); setPreview(null); reload();
        } catch (err) { toast.error(err.response?.data?.message || 'Unable to link receipt.'); setPreview(null); setVerified(false); reload(); }
        finally { setSaving(false); }
    };
    const canView = type => hasPermission(permissions[type]?.view);
    const canLink = type => canView(type) && hasPermission(permissions[type]?.link);
    const sortSpoilage = field => {
        setSort(current => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }));
        setPage('1');
    };
    const sortNumbers = field => {
        setNumberSort(current => ({ field, direction: current.field === field && current.direction === 'asc' ? 'desc' : 'asc' }));
        setPage('1');
    };
    const clearFilters = () => { setSearch(''); setFrom(''); setTo(''); changeSeries(''); };
    const showResults = (seriesId || isSpoilage) && !data.needs_bounds && !loading && !error;

    return <section className="space-y-4 text-sm text-gray-900 dark:text-slate-100" aria-label="Receipt series monitor">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
                <div className="rounded-xl bg-primary-50 p-2.5 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"><Icon path={ICONS.receipt} className="h-5 w-5" /></div>
                <div><h3 className="font-bold">Receipt activity</h3><p className="mt-1 text-xs leading-relaxed text-gray-500 dark:text-slate-400">Review booklet numbers, investigate gaps and manage spoiled paper.</p></div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={reload} disabled={loading || (!seriesId && !isSpoilage)} className={buttonClass}><Icon path={ICONS.refresh} className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />Refresh</button>
                <button type="button" onClick={() => onSpoil(seriesId ? { series_id: seriesId } : null)} className={`${primaryClass} text-xs`}><Icon path={ICONS.plus} className="h-4 w-4" />Mark Spoiled Number</button>
            </div>
        </div>

        <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">Series
                    <select value={seriesId} onChange={e => changeSeries(e.target.value)} className={inputClass}>
                        <option value="">{isSpoilage ? 'All series' : 'Select a series'}</option>
                        {seriesList.map(s => <option key={s.series_id} value={s.series_id}>{s.name} ({s.prefix})</option>)}
                    </select>
                </label>
                <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">Status
                    <select value={status} onChange={e => changeStatus(e.target.value)} className={inputClass}>
                        <option value="ALL">All numbers</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                    </select>
                </label>
            </div>
            {!isSpoilage && <div className="mt-4 flex items-end gap-2 border-t border-gray-200 pt-4 dark:border-slate-700">
                <label className="min-w-0 flex-1 space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">Search receipt numbers
                    <input type="search" placeholder="Reference or serial number..." maxLength={100} value={search} onChange={e => { setSearch(e.target.value); setPage('1'); }} className={inputClass} />
                </label>
                {search && <button type="button" className={linkClass} onClick={() => { setSearch(''); setPage('1'); }}>Clear search</button>}
            </div>}
            {isSpoilage ? <div className="mt-4 grid gap-3 border-t border-gray-200 pt-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] dark:border-slate-700">
                <label className="space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">Search spoiled receipts
                    <input type="search" placeholder="Search reference, actor, reason..." value={search} onChange={e => { setSearch(e.target.value); setPage('1'); }} className={inputClass} />
                </label>
                <label className="min-w-0 space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">From date
                    <input type="date" value={from} max={to || undefined} onChange={e => { setFrom(e.target.value); setPage('1'); }} className={inputClass} />
                </label>
                <label className="min-w-0 space-y-1.5 text-xs font-semibold text-gray-600 dark:text-slate-300">To date
                    <input type="date" value={to} min={from || undefined} onChange={e => { setTo(e.target.value); setPage('1'); }} className={inputClass} />
                </label>
                <button type="button" onClick={clearFilters} className={`${linkClass} self-end py-2.5`}>Clear filters</button>
            </div> : selectedSeries?.min_serial != null && selectedSeries?.max_serial != null && <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-slate-400">
                <span className="font-mono text-gray-700 dark:text-slate-200">{selectedSeries.prefix}-{selectedSeries.min_serial} – {selectedSeries.prefix}-{selectedSeries.max_serial}</span>
                <span>{numberText(BigInt(selectedSeries.max_serial) - BigInt(selectedSeries.min_serial) + 1n)} numbers in this series</span>
            </div>}
        </div>

        {!isSpoilage && <div className="flex items-start gap-2 rounded-lg bg-blue-50/70 px-3 py-2.5 text-xs leading-relaxed text-blue-800 dark:bg-blue-950/30 dark:text-blue-200"><Icon path={ICONS.info} className="mt-0.5 h-4 w-4 shrink-0" /><p><strong>No system record</strong> means the paper needs investigation. Check the original paper before deciding whether it was used.</p></div>}
        {!seriesId && !isSpoilage && <EmptyState icon={ICONS.numbers} title="Choose a series to review its numbers" description="See every number in a booklet, including gaps and earlier receipt assignments.">
            <button type="button" className={linkClass} onClick={() => changeStatus('SPOILED')}>Review spoiled paper across all series<Icon path={ICONS.chevronRight} className="h-3.5 w-3.5" /></button>
        </EmptyState>}
        {data.needs_bounds && !loading && <EmptyState icon={ICONS.adjust} title="This series needs a numbered range" description="Set both the minimum and maximum serial in Series to monitor this booklet.">
            <div className="flex flex-wrap justify-center gap-2">{onConfigureSeries && <button type="button" className={buttonClass} onClick={onConfigureSeries}>Configure series</button>}<button type="button" className={linkClass} onClick={() => changeStatus('SPOILED')}>View spoiled records for this series</button></div>
        </EmptyState>}
        {loading && <div role="status" className="rounded-xl border border-gray-200 p-5 dark:border-slate-700"><p className="mb-4 text-xs text-gray-500 dark:text-slate-400">Loading receipt records...</p><div aria-hidden="true" className="animate-pulse space-y-4">{[1, 2, 3, 4].map(n => <div key={n} className="h-8 rounded bg-gray-100 dark:bg-slate-800" />)}</div></div>}
        {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger-200 bg-danger-50 p-4 text-sm text-danger-800 dark:border-danger-900 dark:bg-danger-950/30 dark:text-danger-300"><span>{error}</span><button type="button" onClick={reload} className={buttonClass}>Retry</button></div>}

        {showResults && <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-slate-700">
                <h4 className="text-xs font-semibold">{isSpoilage ? 'Spoiled paper records' : status === 'ALL' ? 'Booklet numbers' : labels[status]}</h4>
                <span className="text-xs text-gray-500 dark:text-slate-400">{numberText(data.total)} {isSpoilage ? 'spoiled receipts' : 'matching numbers'}{isSpoilage && !seriesId ? ' · All series' : ''}</span>
            </div>
            <p className="border-b border-gray-100 px-4 py-2 text-[11px] text-gray-400 sm:hidden dark:border-slate-800 dark:text-slate-500">Scroll to see all columns and actions</p>
            <div className="overflow-x-auto">
                {isSpoilage ? <SpoilageTable rows={data.items} sort={sort} onSort={sortSpoilage} onHistory={showHistory} onCorrect={onCorrect} /> : <table className="w-full min-w-[780px] text-left text-xs">
                    <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400"><tr>{[['reference', 'Reference'], ['status', 'Status']].map(([field, label]) => <SortableHeading key={field} field={field} label={label} sort={numberSort} onSort={sortNumbers} />)}<th scope="col" className="px-4 py-3 font-semibold">Transactions</th><th scope="col" className="px-4 py-3 font-semibold">Actions</th></tr></thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{data.items.map(row => {
                        const sources = [...(row.sources || []), ...(row.candidates || []).filter(tx => !(row.sources || []).some(source => source.type === tx.type && source.id === tx.id)).map(tx => ({ ...tx, role: 'LEGACY MATCH' }))];
                        const unique = sources.filter((source, index) => sources.findIndex(other => other.type === source.type && other.id === source.id && other.role === source.role) === index);
                        const unregistered = !row.state || row.state === 'UNOCCUPIED';
                        return <tr key={row.reference} className="align-top transition hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
                            <td className="px-4 py-4"><span className="whitespace-nowrap font-mono text-sm font-semibold">{row.reference}</span>{row.follow_up_id && <div className="mt-2 max-w-52 rounded-md bg-warning-50 px-2 py-1.5 text-[11px] leading-relaxed text-warning-800 dark:bg-warning-900/20 dark:text-warning-300">Follow-up: {row.follow_up_reason}</div>}</td>
                            <td className="px-4 py-4"><StatusBadge tone={tones[row.status]} label={labels[row.status]} className="inline-block whitespace-nowrap" /></td>
                            <td className="px-4 py-3">{unique.length ? <div className="space-y-2">{unique.map(source => <div key={`${source.type}-${source.id}-${source.role}`}>
                                {canView(source.type) ? <button type="button" className={linkClass} onClick={() => openTransaction(row, source)}>{sourceLabels[source.type]} #{source.id}<Icon path={ICONS.chevronRight} className="h-3 w-3" /></button> : <span>{sourceLabels[source.type]} #{source.id}</span>}
                                <div className="pl-2 text-[10px] text-gray-400 dark:text-slate-500">{roleLabels[source.role] || source.role}</div>
                            </div>)}</div> : <span className="block py-1.5 text-gray-400 dark:text-slate-500">No linked transaction</span>}</td>
                            <td className="w-52 px-4 py-3"><div className="flex flex-wrap gap-1">
                                <ReceiptAction label="View history" icon={ICONS.history} onClick={() => showHistory(row)} />
                                {row.status === 'SPOILED' && <ReceiptAction label="Correct spoilage" icon={ICONS.edit} onClick={() => onCorrect({ ...row, canonical_full_reference: row.reference })} />}
                                {row.status === 'NO_RECORD' && <>
                                    <ReceiptAction label="Mark spoiled" icon={ICONS.warning} onClick={() => onSpoil({ series_id: seriesId, reference: row.reference })} />
                                    {!row.follow_up_id && <ReceiptAction label="Flag for follow-up" icon={ICONS.bookmark} onClick={() => { setFollowUp(row); setReason(''); }} />}
                                </>}
                                {unregistered && Object.keys(permissions).some(canLink) && <ReceiptAction label="Verify and link transaction" icon={ICONS.link} onClick={() => openTransaction(row)} />}
                                {row.follow_up_id && <ReceiptAction label="Resolve follow-up" icon={ICONS.check} onClick={() => { setFollowUp(row); setReason(''); }} />}
                            </div></td>
                        </tr>;
                    })}{!data.items.length && <tr><td colSpan={4} className="px-4 py-12 text-center text-gray-500 dark:text-slate-400">No numbers match the current filters.</td></tr>}</tbody>
                </table>}
            </div>
            <MonitorPagination page={page} pageSize={pageSize} total={data.total} onChange={setPage} noun={isSpoilage ? 'spoiled receipts' : 'numbers'} />
        </div>}

        <Modal isOpen={!!history} onClose={() => setHistory(null)} title={`Receipt history: ${history?.reference || ''}`} maxWidth="max-w-lg">
            <div className="text-sm text-gray-800 dark:text-slate-200">{history?.events.length ? <ol className="space-y-5 border-l border-gray-200 pl-5 dark:border-slate-600">{history.events.map(event => <li key={event.event_id} className="relative"><span className="absolute -left-[25px] top-1.5 h-2 w-2 rounded-full bg-primary-500" /><strong className="capitalize">{event.event_type.toLowerCase().replaceAll('_', ' ')}</strong><p className="mt-1 text-xs text-gray-500 dark:text-slate-400">{dateText(event.created_at)} · {event.actor_name || 'System'}</p><p className="mt-2 leading-relaxed">{event.reason}{event.notes && <span className="mt-1 block text-xs text-gray-500 dark:text-slate-400">{event.notes}</span>}</p></li>)}</ol> : <p className="text-gray-500 dark:text-slate-400">No audit events found. Older transactions may predate the registry.</p>}</div>
        </Modal>
        <Modal isOpen={!!followUp} onClose={() => !saving && setFollowUp(null)} title={`${followUp?.follow_up_id ? 'Resolve follow-up for' : 'Flag'} ${followUp?.reference || ''}`}>
            <form onSubmit={saveFollowUp} className="space-y-4 text-sm text-gray-800 dark:text-slate-200">
                <p className="text-xs leading-relaxed text-gray-500 dark:text-slate-400">{followUp?.follow_up_id ? 'Record the outcome of your investigation. The receipt status stays the same.' : 'Describe what needs checking. This flag does not reserve the receipt number.'}</p>
                <label className="block space-y-1.5 text-xs font-semibold">Reason<input required minLength={5} maxLength={100} value={reason} onChange={e => setReason(e.target.value)} className={inputClass} /></label>
                <div className="flex justify-end gap-2 border-t border-gray-100 pt-4 dark:border-slate-700"><button type="button" disabled={saving} onClick={() => setFollowUp(null)} className={buttonClass}>Cancel</button><button disabled={saving || reason.trim().length < 5} className={primaryClass}>{saving ? 'Saving...' : followUp?.follow_up_id ? 'Resolve follow-up' : 'Save follow-up'}</button></div>
            </form>
        </Modal>
        <Modal isOpen={!!link} onClose={() => { if (!saving) { requestId.current++; setLink(null); setPreview(null); } }} title={`Transaction for ${link?.reference || ''}`} maxWidth="max-w-xl">
            <div className="space-y-5 text-sm text-gray-800 dark:text-slate-200">
                <form onSubmit={inspect} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <label className="space-y-1.5 text-xs font-semibold">Transaction type<select value={sourceType} className={inputClass} onChange={e => { requestId.current++; setSourceType(e.target.value); setPreview(null); setVerified(false); }}>{Object.keys(permissions).filter(canView).map(type => <option key={type} value={type}>{sourceLabels[type]}</option>)}</select></label>
                    <label className="space-y-1.5 text-xs font-semibold">Transaction ID<input type="number" min="1" required className={inputClass} value={sourceId} onChange={e => { requestId.current++; setSourceId(e.target.value); setPreview(null); setVerified(false); }} /></label>
                    <button className={`${buttonClass} py-2.5`}>Inspect transaction</button>
                </form>
                {preview && <>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 rounded-xl bg-gray-50 p-4 text-xs dark:bg-slate-900/60">
                        <dt className="text-gray-500 dark:text-slate-400">Customer</dt><dd className="font-semibold">{preview.customer_name}</dd>
                        <dt className="text-gray-500 dark:text-slate-400">Transaction</dt><dd>{preview.number || `#${preview.source_id}`} · {preview.status || 'Recorded'} · {preview.amount}</dd>
                        <dt className="text-gray-500 dark:text-slate-400">Date</dt><dd>{dateText(preview.date)}</dd>
                        <dt className="text-gray-500 dark:text-slate-400">Recorded receipt</dt><dd>{preview.physical_receipt_no || 'No paper reference recorded'} ({preview.recording_method || 'Legacy'})</dd>
                    </dl>
                    {preview.source_type === 'INVOICE' && canView('INVOICE') && <button type="button" className={linkClass} onClick={() => { setInvoice({ invoice_id: preview.source_id, invoice_number: preview.number, status: preview.status, total_amount: preview.amount, customer_name: preview.customer_name }); setLink(null); }}>View invoice / receipt correction and void actions<Icon path={ICONS.chevronRight} className="h-4 w-4" /></button>}
                    {canLink(preview.source_type) && !preview.physical_document_registry_id && (!link?.state || link.state === 'UNOCCUPIED') && <form onSubmit={reconcile} className="space-y-4 border-t border-gray-200 pt-4 dark:border-slate-700">
                        <p className="text-xs leading-relaxed text-gray-500 dark:text-slate-400">Verify the original paper and transaction before linking. Conflicting references, duplicate claims, grouped payments, Notebook records and overlapping series must be corrected in their existing workflows.</p>
                        <label className="flex items-start gap-2 rounded-lg bg-primary-50 p-3 text-xs leading-relaxed dark:bg-primary-900/20"><input type="checkbox" className="mt-0.5 accent-primary-600" checked={verified} onChange={e => setVerified(e.target.checked)} />I verified that this paper belongs to this transaction.</label>
                        <label className="block space-y-1.5 text-xs font-semibold">Reconciliation reason<input required minLength={5} maxLength={100} className={inputClass} value={reason} onChange={e => setReason(e.target.value)} /></label>
                        <div className="flex justify-end"><button disabled={saving || !verified || reason.trim().length < 5} className={primaryClass}>{saving ? 'Linking...' : 'Link verified receipt'}</button></div>
                    </form>}
                </>}
            </div>
        </Modal>
        {invoice && <InvoiceDetailsModal isOpen onClose={() => { setInvoice(null); reload(); }} invoice={invoice} onActionSuccess={reload} />}
    </section>;
}

function EmptyState({ icon, title, description, children }) {
    return <div className="rounded-xl border border-dashed border-gray-300 px-5 py-10 text-center dark:border-slate-600">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-slate-800 dark:text-slate-500"><Icon path={icon} className="h-5 w-5" /></div>
        <p className="text-sm font-semibold">{title}</p><p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-gray-500 dark:text-slate-400">{description}</p><div className="mt-4">{children}</div>
    </div>;
}

function SpoilageTable({ rows, sort, onSort, onHistory, onCorrect }) {
    return <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="border-b border-gray-200 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-500 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400"><tr>
            {[[ 'reference', 'Reference' ], [ 'series', 'Series' ], [ 'recorded_at', 'Recorded At' ], [ 'actor', 'Actor' ], [ 'reason', 'Reason / Notes' ]].map(([field, label]) => <SortableHeading key={field} field={field} label={label} sort={sort} onSort={onSort} />)}<th scope="col" className="px-4 py-3 font-semibold">Actions</th>
        </tr></thead>
        <tbody className="divide-y divide-gray-100 dark:divide-slate-800">{rows.length ? rows.map(row => <tr key={row.registry_id} className="align-top transition hover:bg-gray-50/70 dark:hover:bg-slate-800/40">
            <td className="px-4 py-4"><span className="whitespace-nowrap font-mono text-sm font-semibold text-warning-800 dark:text-warning-300">{row.canonical_full_reference}</span><div className="mt-2"><StatusBadge tone="warning" label="Spoiled" /></div></td>
            <td className="px-4 py-4"><span className="font-medium">{row.series_name}</span><span className="mt-1 block font-mono text-[11px] text-gray-400 dark:text-slate-500">{row.prefix}</span></td>
            <td className="px-4 py-4 text-gray-500 dark:text-slate-400">{dateText(row.spoiled_at)}</td>
            <td className="px-4 py-4">{row.actor_name || 'System / Cashier'}</td>
            <td className="min-w-48 max-w-72 px-4 py-4"><p className="break-words font-medium">{row.spoilage_reason || 'Spoiled'}</p>{row.spoilage_notes && <p className="mt-1 break-words leading-relaxed text-gray-500 dark:text-slate-400">{row.spoilage_notes}</p>}</td>
            <td className="px-4 py-3"><div className="flex items-center gap-1"><ReceiptAction label="View history" icon={ICONS.history} onClick={() => onHistory(row)} /><ReceiptAction label="Correct / Unspoil" icon={ICONS.edit} onClick={() => onCorrect(row)} /></div></td>
        </tr>) : <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-500 dark:text-slate-400">No spoiled receipts match the current filters.</td></tr>}</tbody>
    </table>;
}

function MonitorPagination({ page, pageSize, total, onChange, noun }) {
    const [jump, setJump] = useState(page);
    useEffect(() => { setJump(page); }, [page]);
    const totalPages = (BigInt(total) + BigInt(pageSize - 1)) / BigInt(pageSize) || 1n;
    const start = BigInt(total) ? (BigInt(page) - 1n) * BigInt(pageSize) + 1n : 0n;
    const end = BigInt(page) * BigInt(pageSize) < BigInt(total) ? BigInt(page) * BigInt(pageSize) : BigInt(total);
    return <div className="flex flex-col gap-3 border-t border-gray-200 bg-gray-50/50 px-4 py-3 text-xs text-gray-500 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between dark:border-slate-700 dark:bg-slate-800/30 dark:text-slate-400">
        <span>Showing {numberText(start)}–{numberText(end)} of {numberText(total)} {noun}</span>
        <div className="flex flex-wrap items-center gap-2"><button type="button" className={buttonClass} disabled={BigInt(page) <= 1n} onClick={() => onChange(String(BigInt(page) - 1n))}><Icon path={ICONS.chevronLeft} className="h-3 w-3" />Previous</button><span className="px-1">Page {numberText(page)} of {numberText(totalPages)}</span><button type="button" className={buttonClass} disabled={BigInt(page) >= totalPages} onClick={() => onChange(String(BigInt(page) + 1n))}>Next<Icon path={ICONS.chevronRight} className="h-3 w-3" /></button>
            {totalPages > 1n && <form className="flex items-center gap-1" onSubmit={e => { e.preventDefault(); if (/^\d+$/.test(jump)) { const target = BigInt(jump); onChange(String(target < 1n ? 1n : target > totalPages ? totalPages : target)); } }}><input aria-label="Go to page" inputMode="numeric" pattern="[0-9]+" required value={jump} onChange={e => setJump(e.target.value)} className="w-16 rounded-lg border border-gray-300 bg-white px-2 py-2 text-xs dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" /><button className={buttonClass}>Go</button></form>}
        </div>
    </div>;
}

function ReceiptAction({ label, icon, onClick }) {
    return <button type="button" aria-label={label} title={label} onClick={onClick}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-primary-700 transition hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:text-primary-300 dark:hover:bg-primary-900/30">
        <span aria-hidden="true"><Icon path={icon} className="h-4 w-4" /></span>
    </button>;
}

function SortableHeading({ field, label, sort, onSort }) {
    const active = sort.field === field;
    return <th scope="col" className="px-4 py-3 font-semibold" aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" aria-label={`Sort by ${label}`} onClick={() => onSort(field)} className="inline-flex items-center gap-1.5 whitespace-nowrap rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">{label}<span aria-hidden="true" className={active ? 'text-primary-600 dark:text-primary-400' : 'text-gray-300 dark:text-slate-600'}>{active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}</span></button>
    </th>;
}
