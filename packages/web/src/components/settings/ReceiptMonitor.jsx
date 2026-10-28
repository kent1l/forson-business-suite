import React, { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';

export default function ReceiptMonitor({ seriesList, onSpoil, onCorrect, refresh }) {
    const [seriesId, setSeriesId] = useState('');
    const [page, setPage] = useState(1);
    const [data, setData] = useState({ items: [], total: 0 });
    const [loading, setLoading] = useState(false);
    const [status, setStatus] = useState('ALL');
    const [history, setHistory] = useState(null);
    const [followUp, setFollowUp] = useState(null);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);
    const load = useCallback(async () => {
        if (!seriesId) return;
        setLoading(true);
        try {
            const response = await api.get('/settings/physical-document-monitor', { params: { series_id: seriesId, page } });
            setData(response.data);
        } catch (err) { toast.error(err.response?.data?.message || 'Failed to load receipt series.'); }
        finally { setLoading(false); }
    }, [seriesId, page]);
    useEffect(() => { load(); }, [load, refresh]);
    const rowStatus = row => row.state && row.state !== 'UNOCCUPIED' ? row.state : (row.invoices?.length || row.payments?.length ? 'ISSUED' : 'NO_RECORD');
    const showHistory = async row => {
        try {
            const response = await api.get('/settings/physical-document-monitor/history', { params: { series_id: seriesId, reference: row.reference } });
            setHistory({ reference: row.reference, events: response.data, row });
        } catch (err) { toast.error(err.response?.data?.message || 'Failed to load history.'); }
    };
    const saveFollowUp = async e => {
        e.preventDefault(); setSaving(true);
        try {
            await api.post('/settings/physical-document-monitor/follow-up', { series_id: Number(seriesId), reference: followUp.reference, reason });
            toast.success('Follow-up recorded.'); setFollowUp(null); setReason('');
        } catch (err) { toast.error(err.response?.data?.message || 'Failed to record follow-up.'); }
        finally { setSaving(false); }
    };
    return <div className="space-y-4 text-xs">
        <p className="text-gray-600 dark:text-slate-400">Review every number in a configured range. No system record means the paper needs investigation; it does not confirm that it is unused.</p>
        <div className="flex flex-wrap gap-4">
            <label>Series <select value={seriesId} onChange={e => { setSeriesId(e.target.value); setPage(1); setData({ items: [], total: 0 }); }} className="ml-2 rounded border p-2 dark:bg-slate-800"><option value="">Select series</option>{seriesList.map(s => <option key={s.series_id} value={s.series_id}>{s.name} ({s.prefix})</option>)}</select></label>
            <label>Status on this page <select value={status} onChange={e => setStatus(e.target.value)} className="ml-2 rounded border p-2 dark:bg-slate-800"><option value="ALL">All</option><option value="ISSUED">Issued</option><option value="SPOILED">Spoiled</option><option value="VOIDED">Voided</option><option value="NO_RECORD">No system record</option></select></label>
        </div>
        {data.needs_bounds && <p>Set both the minimum and maximum serial in Series to monitor this booklet.</p>}
        {loading && <p>Loading receipt numbers...</p>}
        {seriesId && !data.needs_bounds && <><div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-slate-700"><table className="w-full text-left"><thead className="bg-gray-50 dark:bg-slate-800"><tr>{['Reference', 'Status', 'Transactions', 'Actions'].map(x => <th key={x} className="p-3">{x}</th>)}</tr></thead><tbody>
            {data.items.filter(row => status === 'ALL' || rowStatus(row) === status).map(row => {
                const state = rowStatus(row);
                const sources = [...row.sources, ...(row.invoices || []).map(id => ({ type: 'INVOICE', id })), ...(row.payments || []).map(id => ({ type: 'CUSTOMER_PAYMENT', id }))];
                const unique = sources.filter((source, index) => sources.findIndex(other => other.type === source.type && other.id === source.id) === index);
                return <tr key={row.reference} className="border-t dark:border-slate-700"><td className="p-3 font-mono">{row.reference}{row.follow_up_reason && <div className="font-sans text-amber-700">Follow-up: {row.follow_up_reason}</div>}</td><td className="p-3">{{ ISSUED: 'Issued', SPOILED: 'Spoiled', VOIDED: 'Voided', NO_RECORD: 'No system record' }[state]}</td><td className="p-3">{unique.length ? unique.map(s => `${s.type.replaceAll('_', ' ')} #${s.id}`).join(', ') : '—'}</td><td className="p-3 space-x-3"><button type="button" className="text-primary-600" onClick={() => showHistory(row)}>View history</button>{state === 'SPOILED' && <button type="button" className="text-primary-600" onClick={() => onCorrect({ ...row, canonical_full_reference: row.reference })}>Correct spoilage</button>}{state === 'NO_RECORD' && <><button type="button" className="text-primary-600" onClick={() => onSpoil({ series_id: seriesId, reference: row.reference })}>Mark spoiled</button><button type="button" className="text-primary-600" onClick={() => { setFollowUp(row); setReason(''); }}>Flag for follow-up</button></>}</td></tr>;
            })}</tbody></table></div><div className="flex items-center gap-4"><button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="disabled:opacity-40">Previous</button><span>Page {page} of {Math.max(1, Math.ceil(Number(data.total) / 25))} · {data.total} numbers</span><button type="button" disabled={page * 25 >= Number(data.total)} onClick={() => setPage(p => p + 1)} className="disabled:opacity-40">Next</button></div></>}
        <Modal isOpen={!!history} onClose={() => setHistory(null)} title={`Receipt history: ${history?.reference || ''}`}><div className="space-y-3 text-sm">{history?.events.length ? history.events.map(event => <div key={event.event_id} className="border-b pb-2"><strong>{event.event_type.replaceAll('_', ' ')}</strong> · {new Date(event.created_at).toLocaleString(undefined, { timeZone: 'Asia/Manila' })} · {event.actor_name || 'System'}<div>{event.reason}{event.notes ? ` — ${event.notes}` : ''}</div></div>) : <p>No audit events found. Older transactions may predate the registry.</p>}</div></Modal>
        <Modal isOpen={!!followUp} onClose={() => setFollowUp(null)} title={`Flag ${followUp?.reference || ''} for follow-up`}><form onSubmit={saveFollowUp} className="space-y-3 text-sm"><label className="block">Reason<input required maxLength={100} value={reason} onChange={e => setReason(e.target.value)} className="block w-full rounded border p-2 dark:bg-slate-800" /></label><button disabled={saving} className="rounded bg-primary-600 px-3 py-2 text-white">{saving ? 'Saving...' : 'Save follow-up'}</button></form></Modal>
    </div>;
}
