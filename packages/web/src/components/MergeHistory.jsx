import { useState } from 'react';

export default function MergeHistory({ operations = [], onRevert }) {
    const [selected, setSelected] = useState(null);
    const [reason, setReason] = useState('');
    const [working, setWorking] = useState(false);

    const submit = async operationId => {
        if (!reason.trim() || working) return;
        setWorking(true);
        try {
            await onRevert(operationId, reason.trim());
            setSelected(null);
            setReason('');
        } catch {
            // The parent shows the API refusal; keep the reason available to edit.
        } finally { setWorking(false); }
    };

    return <section className="rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900">
        <h2 className="font-semibold">Merge history</h2>
        {!operations.length ? <p className="mt-3 text-sm text-slate-500">No merges recorded yet.</p> :
            <div className="mt-3 space-y-3">{operations.map(op => <article key={op.operation_id} className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                <div className="flex flex-wrap justify-between gap-2"><strong>{op.sources?.map(source => source.name || `#${source.id}`).join(', ') || op.source_ids.join(', ')} → {op.canonical?.name || `#${op.canonical_id}`}</strong><span>{op.status}</span></div>
                <p className="mt-1 text-slate-500">{new Date(op.completed_at || op.started_at).toLocaleString()} · {op.actor_name || `Employee #${op.actor_employee_id}`}</p>
                <p className="mt-1 text-slate-500">{Object.entries(op.impact?.references || {}).filter(([, count]) => Number(count) > 0).map(([key, count]) => `${key}: ${count}`).join(' · ') || 'No linked records'}</p>
                {op.blockers?.length > 0 && <p className="mt-1 text-rose-700">Blockers: {op.blockers.map(blocker => `${blocker.reason || blocker.field}${blocker.recordIds?.length ? ` (records ${blocker.recordIds.join(', ')})` : ''}`).join(' · ')}</p>}
                {op.status === 'reverted' && <p className="mt-1 text-slate-500">Reverted by {op.reverted_by_name || `employee #${op.reverted_by_employee_id}`} · {op.revert_reason}</p>}
                {op.revertEligible && onRevert ? selected === op.operation_id ? <div className="mt-3 space-y-2">
                    <label className="block font-medium">Reason for reverting<textarea value={reason} onChange={event => setReason(event.target.value)} rows={2} maxLength={1000} className="mt-1 w-full rounded-lg border border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-800" /></label>
                    <p className="text-xs text-slate-500">The system checks later edits and wallet activity before restoring anything.</p>
                    <div className="flex gap-2"><button type="button" disabled={!reason.trim() || working} onClick={() => submit(op.operation_id)} className="rounded-lg bg-rose-700 px-3 py-2 font-semibold text-white disabled:opacity-40">{working ? 'Checking…' : 'Confirm revert'}</button><button type="button" disabled={working} onClick={() => { setSelected(null); setReason(''); }} className="rounded-lg border px-3 py-2">Cancel</button></div>
                </div> : <button type="button" onClick={() => { setSelected(op.operation_id); setReason(''); }} className="mt-2 rounded-lg border border-rose-400 px-3 py-1.5 font-semibold text-rose-700">Review revert</button> :
                    <p className="mt-1 text-xs text-slate-500">{op.status === 'blocked' ? 'No merge was executed.' : 'Revert unavailable.'}</p>}
            </article>)}</div>}
    </section>;
}
