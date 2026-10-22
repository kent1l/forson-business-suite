import { useEffect, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';
import Modal from '../ui/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { formatPhysicalReceiptNumber } from '../../utils/receiptNumberFormatter';

const outcomeLabels = {
    UNUSED: 'Never used — release mistaken assignment',
    SPOILED: 'Spoiled — keep the number blocked',
    VOIDED: 'Already issued — void and keep the number blocked',
};

export default function ReceiptActionModal({ isOpen, onClose, invoiceId, mode = 'edit', correctionCaseId, initialReason = '', onSuccess }) {
    const { hasPermission } = useAuth();
    const [snapshot, setSnapshot] = useState(null);
    const [decision, setDecision] = useState({});
    const [busy, setBusy] = useState(false);
    const [loadError, setLoadError] = useState('');
    const editing = mode === 'edit';

    useEffect(() => {
        if (!isOpen || !invoiceId) return;
        let active = true;
        setSnapshot(null);
        setLoadError('');
        api.get(`/invoices/${invoiceId}/receipt-control`).then(({ data }) => {
            if (!active) return;
            setSnapshot(data);
            setDecision({
                expected_version: data.invoice.physical_receipt_version,
                reason: initialReason.slice(0, 100), paper_outcome: '',
                original_series_id: data.invoice.physical_document_series_id || '',
                recording_method: data.invoice.recording_method || (data.invoice.physical_receipt_no ? 'PAPER' : 'NOTEBOOK'),
                series_id: data.invoice.physical_document_series_id || '',
                physical_receipt_no: data.invoice.physical_receipt_no || '',
            });
        }).catch(err => active && setLoadError(err.response?.data?.message || 'Unable to load the current receipt assignment.'));
        return () => { active = false; };
    }, [isOpen, invoiceId, initialReason]);

    const change = (field, value) => setDecision(current => ({ ...current, [field]: value }));
    const original = snapshot?.invoice;
    const hasPaper = !!(original?.physical_receipt_no || original?.physical_document_registry_id);
    const eligibleSeries = (snapshot?.series || []).filter(s => s.is_active && s.type_active && s.sales_eligible
        && !['COLLECTION_RECEIPT', 'NOTEBOOK'].includes(s.controlled_category));
    const unchanged = editing && original && decision.recording_method === original.recording_method
        && Number(decision.series_id || 0) === Number(original.physical_document_series_id || 0)
        && formatPhysicalReceiptNumber(decision.physical_receipt_no) === formatPhysicalReceiptNumber(original.physical_receipt_no);
    const canSubmit = snapshot && !busy && decision.reason?.trim().length >= 5 && !unchanged
        && (!hasPaper || decision.paper_outcome)
        && (!editing || decision.recording_method === 'NOTEBOOK' || (decision.series_id && decision.physical_receipt_no?.trim()));

    const submit = async event => {
        event.preventDefault();
        if (!canSubmit) return;
        setBusy(true);
        try {
            const payload = {
                ...decision,
                original_series_id: decision.original_series_id ? Number(decision.original_series_id) : null,
                series_id: decision.recording_method === 'PAPER' && decision.series_id ? Number(decision.series_id) : null,
                physical_receipt_no: decision.recording_method === 'PAPER' ? formatPhysicalReceiptNumber(decision.physical_receipt_no) : null,
            };
            let response;
            if (editing) response = await api.put(`/invoices/${invoiceId}/physical-receipt-no`, payload);
            else if (mode === 'restart') response = await api.post(`/sales-corrections/${correctionCaseId}/approve`, { receipt_decision: payload });
            else response = await api.delete(`/invoices/${invoiceId}`, { data: payload });
            toast.success(editing ? 'Receipt assignment corrected' : mode === 'restart' ? 'Sale corrected. Start the replacement as a new sale.' : 'Invoice voided');
            onSuccess(response.data);
            onClose();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Unable to apply this receipt action.');
            if (err.response?.data?.code === 'RECEIPT_VERSION_CONFLICT') setLoadError('This receipt changed. Close and reopen this action to review its current assignment.');
        } finally { setBusy(false); }
    };
    const inputClass = 'mt-1 w-full rounded border border-gray-300 p-2 dark:border-slate-600 dark:bg-slate-800';
    return (
        <Modal isOpen={isOpen} onClose={() => !busy && onClose()} zIndexClass="z-[60]" maxWidth="max-w-lg"
            title={editing ? 'Edit Receipt No.' : mode === 'restart' ? 'Confirm Correct & Restart' : 'Void Invoice'}>
            {loadError ? <p role="alert" className="text-danger-600">{loadError}</p> : !snapshot ? <p>Loading receipt assignment…</p> : (
                <form onSubmit={submit} className="space-y-4 text-sm text-gray-900 dark:text-slate-100">
                    <p>Current receipt: <strong>{original.physical_receipt_no || 'No paper receipt recorded'}</strong></p>
                    {!editing && <p>Voiding reverses this sale’s stock and A/R effects. Its invoice and receipt history are retained.</p>}
                    {editing && <>
                        <label className="block">Recording method
                            <select className={inputClass} value={decision.recording_method} onChange={e => change('recording_method', e.target.value)}>
                                <option value="PAPER">Paper receipt</option><option value="NOTEBOOK">Notebook — no paper issued</option>
                            </select>
                        </label>
                        {decision.recording_method === 'PAPER' && <>
                            <label className="block">Corrected receipt series
                                <select required className={inputClass} value={decision.series_id} onChange={e => change('series_id', e.target.value)}>
                                    <option value="">Choose a series</option>
                                    {eligibleSeries.map(s => <option key={s.series_id} value={s.series_id}>{s.name} ({s.prefix})</option>)}
                                </select>
                            </label>
                            <label className="block">Corrected physical receipt number
                                <input required className={`${inputClass} font-mono`} value={decision.physical_receipt_no}
                                    maxLength={50} onChange={e => change('physical_receipt_no', e.target.value)}
                                    onBlur={e => change('physical_receipt_no', formatPhysicalReceiptNumber(e.target.value) || '')} />
                            </label>
                        </>}
                    </>}
                    {hasPaper && <>
                        {!original.physical_document_series_id && <label className="block">Original paper series (for legacy receipts)
                            <select className={inputClass} value={decision.original_series_id} onChange={e => change('original_series_id', e.target.value)}>
                                <option value="">Match by prefix when unambiguous</option>
                                {snapshot.series.filter(s => !['COLLECTION_RECEIPT', 'NOTEBOOK'].includes(s.controlled_category)).map(s => <option key={s.series_id} value={s.series_id}>{s.name} ({s.prefix})</option>)}
                            </select>
                        </label>}
                        <label className="block">What happened to the original paper receipt?
                            <select required className={inputClass} value={decision.paper_outcome} onChange={e => change('paper_outcome', e.target.value)}>
                                <option value="">Choose the paper outcome</option>
                                {Object.entries(outcomeLabels).filter(([key]) => key !== 'UNUSED' || hasPermission('invoice:release_receipt_no'))
                                    .map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                            </select>
                        </label>
                        {decision.paper_outcome === 'UNUSED' && <p className="text-warning-700 dark:text-warning-300">Confirm the paper was never used. Its number will become available again; the automatic sequence will not rewind.</p>}
                    </>}
                    <label className="block">Reason
                        <textarea required minLength={5} maxLength={100} rows={3} className={inputClass}
                            value={decision.reason} onChange={e => change('reason', e.target.value)} placeholder="Explain this correction or void (5–100 characters)" />
                    </label>
                    {hasPaper && decision.paper_outcome && <p role="status" className="rounded bg-gray-100 p-3 dark:bg-slate-900">
                        {original.physical_receipt_no}: {decision.paper_outcome === 'UNUSED' ? 'release unused assignment' : decision.paper_outcome === 'SPOILED' ? 'mark spoiled; number stays blocked' : 'mark voided; number stays blocked'}.
                        {editing && (decision.recording_method === 'PAPER' ? ` Assign ${formatPhysicalReceiptNumber(decision.physical_receipt_no) || 'the corrected number'}.` : ' Record as Notebook.')}
                    </p>}
                    <div className="flex justify-end gap-2">
                        <button type="button" disabled={busy} onClick={onClose} className="rounded border px-4 py-2">Cancel</button>
                        <button type="submit" disabled={!canSubmit || !!loadError} className="rounded bg-primary-600 px-4 py-2 font-semibold text-white disabled:opacity-50">
                            {busy ? 'Applying…' : editing ? 'Save receipt correction' : mode === 'restart' ? 'Approve and execute' : 'Confirm void'}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
}
