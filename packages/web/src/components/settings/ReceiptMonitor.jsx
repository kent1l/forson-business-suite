import React, { useEffect, useRef, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import { useAuth } from '../../contexts/AuthContext';
import InvoiceDetailsModal from '../refunds/InvoiceDetailsModal';

const labels = { ISSUED: 'Issued', SPOILED: 'Spoiled', VOIDED: 'Voided', NO_RECORD: 'No system record' };
const permissions = {
    INVOICE: { view: 'invoicing:create', link: 'invoice:edit_receipt_no' },
    CUSTOMER_PAYMENT: { view: 'ar:view', link: 'ar:receive_payment' },
    COLLECTION_GROUP: { view: 'ar:view', link: 'ar:receive_payment' },
};
const inputClass = 'rounded border p-2 dark:bg-slate-800';
export default function ReceiptMonitor({ seriesList, onSpoil, onCorrect, refresh }) {
    const { hasPermission } = useAuth();
    const [seriesId, setSeriesId] = useState('');
    const [page, setPage] = useState('1');
    const [data, setData] = useState({ items: [], total: '0' });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [status, setStatus] = useState('ALL');
    const [history, setHistory] = useState(null);
    const [followUp, setFollowUp] = useState(null);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const [revision, setRevision] = useState(0);
    const [link, setLink] = useState(null);
    const [sourceType, setSourceType] = useState('INVOICE');
    const [sourceId, setSourceId] = useState('');
    const [preview, setPreview] = useState(null);
    const [verified, setVerified] = useState(false);
    const [invoice, setInvoice] = useState(null);
    const requestId = useRef(0);
    const reload = () => setRevision(n => n + 1);
    useEffect(() => {
        if (!seriesId) return;
        let active = true;
        setLoading(true); setError(''); setData({ items: [], total: '0' });
        api.get('/settings/physical-document-monitor', { params: { series_id: seriesId, page, status } }).then(({ data: result }) => {
            if (active) {
                // A concurrent action may shrink the filtered result and remove its last page.
                if (!result.items.length && BigInt(result.total) > 0n && BigInt(page) > (BigInt(result.total) + 24n) / 25n) {
                    setPage(String((BigInt(result.total) + 24n) / 25n));
                } else setData(result);
            }
        }).catch(err => { if (active) setError(err.response?.data?.message || 'Failed to load receipt series.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [seriesId, page, status, refresh, revision]);
    useEffect(() => { requestId.current++; setHistory(null); setFollowUp(null); setLink(null); setPreview(null); }, [seriesId]);
    useEffect(() => () => { requestId.current++; }, []);
    const showHistory = async row => {
        const current = ++requestId.current;
        try {
            const response = await api.get('/settings/physical-document-monitor/history', { params: { series_id: seriesId, reference: row.reference } });
            if (requestId.current === current) setHistory({ reference: row.reference, events: response.data });
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
    const pages = String((BigInt(data.total || 0) + 24n) / 25n || 1n);
    return <div className="space-y-4 text-xs">
        <p className="text-gray-600 dark:text-slate-400">Review every number in a configured range. No system record means the paper needs investigation; it does not confirm that it is unused.</p>
        <div className="flex flex-wrap gap-4">
            <label>Series <select value={seriesId} onChange={e => { requestId.current++; setSeriesId(e.target.value); setPage('1'); setData({ items: [], total: '0' }); }} className={`ml-2 ${inputClass}`}><option value="">Select series</option>{seriesList.map(s => <option key={s.series_id} value={s.series_id}>{s.name} ({s.prefix})</option>)}</select></label>
            <label>Status <select value={status} onChange={e => { setStatus(e.target.value); setPage('1'); }} className={`ml-2 ${inputClass}`}><option value="ALL">All</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        </div>
        {data.needs_bounds && <p>Set both the minimum and maximum serial in Series to monitor this booklet.</p>}
        {loading && <p role="status">Loading receipt numbers...</p>}
        {error && <p role="alert">{error} <button onClick={reload}>Retry</button></p>}
        {seriesId && !loading && !error && !data.needs_bounds && <><div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700"><table className="w-full text-left"><thead className="bg-gray-50 dark:bg-slate-800"><tr>{['Reference', 'Status', 'Transactions', 'Actions'].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>
            {data.items.map(row => {
                const sources = [...(row.sources || []), ...(row.candidates || []).filter(tx => !(row.sources || []).some(source => source.type === tx.type && source.id === tx.id)).map(tx => ({ ...tx, role: 'LEGACY MATCH' }))];
                const unique = sources.filter((source, index) => sources.findIndex(other => other.type === source.type && other.id === source.id && other.role === source.role) === index);
                const unregistered = !row.state || row.state === 'UNOCCUPIED';
                return <tr key={row.reference} className="border-t dark:border-slate-700"><td className="p-3 font-mono">{row.reference}{row.follow_up_id && <div className="font-sans text-amber-700">Follow-up: {row.follow_up_reason}</div>}</td><td className="p-3">{labels[row.status]}</td><td className="p-3">{unique.length ? unique.map(s => <div key={`${s.type}-${s.id}-${s.role}`}>
                    {canView(s.type) ? <button className="text-primary-600" onClick={() => openTransaction(row, s)}>{s.type.replaceAll('_', ' ')} #{s.id}</button> : `${s.type.replaceAll('_', ' ')} #${s.id}`} <span>({s.role})</span>
                </div>) : '—'}</td><td className="p-3 space-x-3"><button type="button" className="text-primary-600" onClick={() => showHistory(row)}>View history</button>{row.status === 'SPOILED' && <button type="button" className="text-primary-600" onClick={() => onCorrect({ ...row, canonical_full_reference: row.reference })}>Correct spoilage</button>}{row.status === 'NO_RECORD' && <><button type="button" className="text-primary-600" onClick={() => onSpoil({ series_id: seriesId, reference: row.reference })}>Mark spoiled</button><button type="button" className="text-primary-600" disabled={!!row.follow_up_id} onClick={() => { setFollowUp(row); setReason(''); }}>Flag for follow-up</button></>}
                    {unregistered && Object.keys(permissions).some(canLink) && <button className="text-primary-600" onClick={() => openTransaction(row)}>Verify and link transaction</button>}
                    {row.follow_up_id && <button className="text-primary-600" onClick={() => { setFollowUp(row); setReason(''); }}>Resolve follow-up</button>}
                </td></tr>;
            })}{!data.items.length && <tr><td colSpan={4} className="p-3">No numbers match this status.</td></tr>}</tbody></table></div><div className="flex items-center gap-4"><button type="button" disabled={BigInt(page) <= 1n} onClick={() => setPage(p => String(BigInt(p) - 1n))} className="disabled:opacity-40">Previous</button><span>Page {page} of {pages} · {data.total} numbers</span><button type="button" disabled={BigInt(page) * 25n >= BigInt(data.total)} onClick={() => setPage(p => String(BigInt(p) + 1n))} className="disabled:opacity-40">Next</button></div></>}
        <Modal isOpen={!!history} onClose={() => setHistory(null)} title={`Receipt history: ${history?.reference || ''}`}><div className="space-y-3 text-sm">{history?.events.length ? history.events.map(event => <div key={event.event_id} className="border-b pb-2"><strong>{event.event_type.replaceAll('_', ' ')}</strong> · {new Date(event.created_at).toLocaleString(undefined, { timeZone: 'Asia/Manila' })} · {event.actor_name || 'System'}<div>{event.reason}{event.notes ? ` — ${event.notes}` : ''}</div></div>) : <p>No audit events found. Older transactions may predate the registry.</p>}</div></Modal>
        <Modal isOpen={!!followUp} onClose={() => !saving && setFollowUp(null)} title={`${followUp?.follow_up_id ? 'Resolve follow-up for' : 'Flag'} ${followUp?.reference || ''}`}><form onSubmit={saveFollowUp} className="space-y-3 text-sm"><label className="block">Reason<input required minLength={5} maxLength={100} value={reason} onChange={e => setReason(e.target.value)} className={`block w-full ${inputClass}`} /></label><button disabled={saving || reason.trim().length < 5} className="rounded bg-primary-600 px-3 py-2 text-white">{saving ? 'Saving...' : followUp?.follow_up_id ? 'Resolve follow-up' : 'Save follow-up'}</button></form></Modal>
        <Modal isOpen={!!link} onClose={() => { if (!saving) { requestId.current++; setLink(null); setPreview(null); } }} title={`Transaction for ${link?.reference || ''}`}><div className="space-y-4 text-sm">
            <form onSubmit={inspect} className="flex flex-wrap gap-2"><label>Transaction type<select value={sourceType} className={`block ${inputClass}`} onChange={e => { requestId.current++; setSourceType(e.target.value); setPreview(null); setVerified(false); }}>{Object.keys(permissions).filter(canView).map(type => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label><label>Transaction ID<input type="number" min="1" required className={`block ${inputClass}`} value={sourceId} onChange={e => { requestId.current++; setSourceId(e.target.value); setPreview(null); setVerified(false); }} /></label><button className="text-primary-600">Inspect transaction</button></form>
            {preview && <><dl className="space-y-2"><dt>Customer</dt><dd>{preview.customer_name}</dd><dt>Transaction</dt><dd>{preview.number || `#${preview.source_id}`} · {preview.status || 'Recorded'} · {preview.amount}</dd><dt>Recorded receipt</dt><dd>{preview.physical_receipt_no || 'No paper reference recorded'} ({preview.recording_method || 'Legacy'})</dd></dl>
                {preview.source_type === 'INVOICE' && canView('INVOICE') && <button className="text-primary-600" onClick={() => { setInvoice({ invoice_id: preview.source_id, invoice_number: preview.number, status: preview.status, total_amount: preview.amount, customer_name: preview.customer_name }); setLink(null); }}>View invoice / receipt correction and void actions</button>}
                {canLink(preview.source_type) && !preview.physical_document_registry_id && (!link?.state || link.state === 'UNOCCUPIED') && <form onSubmit={reconcile} className="space-y-3 border-t pt-3"><p>Verify the original paper and transaction before linking. Conflicting references, duplicate claims, grouped payments, Notebook records and overlapping series must be corrected in their existing workflows.</p><label className="block"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} /> I verified that this paper belongs to this transaction.</label><label className="block">Reconciliation reason<input required minLength={5} maxLength={100} className={`block w-full ${inputClass}`} value={reason} onChange={e => setReason(e.target.value)} /></label><button disabled={saving || !verified || reason.trim().length < 5} className="rounded bg-primary-600 p-2 text-white disabled:opacity-40">{saving ? 'Linking...' : 'Link verified receipt'}</button></form>}
            </>}
        </div></Modal>
        {invoice && <InvoiceDetailsModal isOpen onClose={() => { setInvoice(null); reload(); }} invoice={invoice} onActionSuccess={reload} />}
    </div>;
}
