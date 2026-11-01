import { useEffect, useState } from 'react';
import api from '../../api';
import { useAuth } from '../../contexts/AuthContext';
import { fitmentSavePayload, formatQualifierSummary } from '../../utils/engineCodeFormat';

export default function FitmentEvidenceReview({ partId, rule, onChanged }) {
    const { hasPermission } = useAuth();
    const canApprove = hasPermission('applications:approve');
    const [sources, setSources] = useState([]);
    const [selected, setSelected] = useState(null);
    const [currentRule, setCurrentRule] = useState(rule);
    const [form, setForm] = useState({ title: '', url: '', excerpt: '', permitted: false });
    const [reason, setReason] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    useEffect(() => {
        let active = true;
        api.get(`/parts/${partId}/fitment-evidence`).then(({ data }) => {
            if (active) setSources(data);
        }).catch(() => { if (active) setError('Could not load evidence. Close and reopen this review.'); });
        return () => { active = false; };
    }, [partId]);
    const perform = async action => {
        setBusy(true); setError(''); setNotice('');
        try { await action(); } catch (e) { setError(e.response?.data?.message || e.message); }
        finally { setBusy(false); }
    };
    const capture = event => {
        event.preventDefault();
        perform(async () => {
            const { data } = await api.post('/applications/fitment-research', {
                part_id: partId, query: 'Staff-supplied part compatibility evidence', allow_offline_capture: true,
                evidence: [{ source_type: 'manual_note', source_title: form.title, source_url: form.url || null,
                    quoted_span: form.excerpt, rights_policy: form.permitted ? 'permitted_excerpt' : 'metadata_only',
                    claim_type: 'part_compatibility', assessment: 'supported',
                    extracted_claim: { application_id: rule.application_id, rule: fitmentSavePayload(rule) } }],
            });
            const evidence = data.evidence[0];
            setSources(prev => [...prev, evidence]); setSelected(evidence);
            setNotice('Source recorded for review. Compatibility is still unverified.');
        });
    };
    const reviewEvidence = decision => perform(async () => {
        const { data } = await api.post(`/applications/fitment-evidence/${selected.evidence_id}/approval`, {
            expected_version: selected.row_version, decision, reason,
        });
        setSelected(data); setSources(prev => prev.map(e => e.evidence_id === data.evidence_id ? data : e));
        setNotice(decision === 'approve' ? 'Evidence approved. Review compatibility separately.' : 'Evidence invalidated. Dependent compatibility must be reviewed again.');
        onChanged();
    });
    const approveRule = () => perform(async () => {
        const { data } = await api.post(`/parts/${partId}/application-rules/${rule.rule_id}/approval`, {
            expected_version: currentRule.row_version, decision: 'approve', reason, evidence_ids: [selected.evidence_id],
        });
        setCurrentRule(data); setNotice('Compatibility approved for this exact application and its recorded restrictions.');
        onChanged();
    });
    return <div className="space-y-4 text-sm">
        <p>{[rule.make, rule.model, rule.chassis, rule.engine].filter(Boolean).join(' ')} {rule.effect === 'exclude' ? '— exclusion' : ''}</p>
        <p className="text-gray-600">{formatQualifierSummary(rule) || 'No qualifiers supplied'} · Years: {rule.year_start || '?'}–{rule.year_end || '?'}. Missing details remain unspecified.</p>
        <p className="text-gray-600">Record a source for this part and exact application. An engine–vehicle association alone does not prove the part fits. Source approval and compatibility approval are separate decisions.</p>
        <form onSubmit={capture} className="space-y-2">
            <label className="block">Source title<input aria-label="Evidence source title" required value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} className="block border rounded p-2 w-full" /></label>
            <label className="block">Source URL (optional)<input type="url" value={form.url} onChange={e => setForm({ ...form, url: e.target.value })} className="block border rounded p-2 w-full" /></label>
            <label className="block">Supporting excerpt<textarea aria-label="Evidence supporting excerpt" maxLength={280} value={form.excerpt} onChange={e => setForm({ ...form, excerpt: e.target.value })} className="block border rounded p-2 w-full" /></label>
            <label className="flex gap-2"><input type="checkbox" checked={form.permitted} onChange={e => setForm({ ...form, permitted: e.target.checked })} />This source permits storing the excerpt.</label>
            <p className="text-xs text-gray-500">Without permission, only source metadata is stored.</p>
            <button disabled={busy} className="px-3 py-2 border rounded disabled:opacity-50">Record source for review</button>
        </form>
        <label className="block">Recorded sources<select value={selected?.evidence_id || ''} onChange={e => setSelected(sources.find(s => String(s.evidence_id) === e.target.value) || null)} className="block border rounded p-2 w-full">
            <option value="">Select a source</option>
            {sources.map(source => <option key={source.evidence_id} value={source.evidence_id}>{source.source_title || 'Untitled source'} — {source.approval_status}</option>)}
        </select></label>
        {selected && <div className="space-y-2 break-words">
            <p>{selected.quoted_span || 'No excerpt retained.'}</p>
            {selected.source_url && <a href={selected.source_url} target="_blank" rel="noreferrer" className="underline">Open source</a>}
            <p className="text-xs">Claim: {selected.claim_type}. Assessment: {selected.assessment}. Retrieved: {selected.retrieved_at ? new Date(selected.retrieved_at).toLocaleDateString() : 'Not supplied'}.</p>
            {canApprove && <>
                <label className="block">Review reason<input aria-label="Evidence review reason" value={reason} onChange={e => setReason(e.target.value)} className="block border rounded p-2 w-full" /></label>
                <div className="flex flex-wrap gap-2">
                    <button disabled={busy || !reason.trim() || selected.approval_status === 'approved'} onClick={() => reviewEvidence('approve')} className="px-3 py-2 border rounded disabled:opacity-50">Approve evidence</button>
                    <button disabled={busy || !reason.trim() || selected.approval_status !== 'approved'} onClick={approveRule} className="px-3 py-2 bg-primary-600 text-white rounded disabled:opacity-50">Approve compatibility</button>
                    <button disabled={busy || !reason.trim()} onClick={() => reviewEvidence('invalidate')} className="px-3 py-2 border rounded disabled:opacity-50">Invalidate evidence</button>
                </div>
            </>}
        </div>}
        {error && <p role="alert" className="text-red-700">{error}</p>}
        {notice && <p role="status">{notice}</p>}
    </div>;
}
