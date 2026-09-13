import { useEffect, useRef, useState } from 'react';
import api from '../../api';
import toast from 'react-hot-toast';

const PODraftShelf = ({ data, supplierName, isEmpty, onLoad, onNew, onActiveChange }) => {
    const [drafts, setDrafts] = useState([]);
    const [activeId, setActiveId] = useState(null);
    const [status, setStatus] = useState('idle');
    const loadingDraft = useRef(false);

    const refresh = async () => {
        const { data: rows } = await api.get('/purchase-orders/drafts');
        setDrafts(rows || []);
        return rows || [];
    };

    useEffect(() => { refresh().catch(() => toast.error('Could not load PO drafts.')); }, []);

    useEffect(() => {
        onActiveChange?.(activeId);
    }, [activeId, onActiveChange]);

    useEffect(() => {
        if (loadingDraft.current || isEmpty(data)) return undefined;
        const timer = setTimeout(async () => {
            setStatus('saving');
            try {
                if (activeId) {
                    const currentDraft = drafts.find(draft => draft.draft_id === activeId);
                    const autoName = supplierName && /^Draft #\d+$/.test(currentDraft?.draft_name || '')
                        ? `Draft — ${supplierName}`
                        : undefined;
                    const { data: saved } = await api.put(`/purchase-orders/drafts/${activeId}`, { draft_data: data, draft_name: autoName });
                    setDrafts(current => current.map(draft => draft.draft_id === saved.draft_id ? saved : draft));
                } else {
                    const name = supplierName ? `Draft — ${supplierName}` : `Draft #${drafts.length + 1}`;
                    const { data: saved } = await api.post('/purchase-orders/drafts', { draft_name: name, draft_data: data });
                    setDrafts(current => [saved, ...current]);
                    setActiveId(saved.draft_id);
                }
                setStatus('saved');
            } catch (error) {
                setStatus('error');
                toast.error(error?.response?.data?.message || 'Could not save PO draft.');
            }
        }, 750);
        return () => clearTimeout(timer);
    }, [data, activeId, drafts.length, isEmpty, supplierName]);

    const selectDraft = (value) => {
        const id = Number(value);
        const draft = drafts.find(item => item.draft_id === id);
        if (!draft) return;
        loadingDraft.current = true;
        setActiveId(id);
        onLoad(draft.draft_data);
        setTimeout(() => { loadingDraft.current = false; }, 0);
    };

    const createNew = () => {
        if (drafts.length >= 5) return toast.error('You can keep at most 5 active PO drafts.');
        if (drafts.length > 2 && !supplierName) return toast.error('Select a supplier before opening another draft.');
        setActiveId(null);
        onNew();
    };

    const removeActive = async () => {
        if (!activeId) return;
        await api.delete(`/purchase-orders/drafts/${activeId}`);
        setDrafts(current => current.filter(draft => draft.draft_id !== activeId));
        setActiveId(null);
        onNew();
    };

    const active = drafts.find(draft => draft.draft_id === activeId);
    const expiresSoon = active && new Date(active.expires_at).getTime() < Date.now() + (2 * 86400000);

    return (
        <div className="space-y-1">
            <div className="flex items-center justify-end gap-2 text-xs">
                <select value={activeId || ''} onChange={event => selectDraft(event.target.value)} className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-gray-700 dark:text-slate-200">
                    <option value="">Current unslotted draft</option>
                    {drafts.map(draft => <option key={draft.draft_id} value={draft.draft_id}>{draft.draft_name} · {draft.draft_data?.lines?.length || 0} lines</option>)}
                </select>
                <button type="button" onClick={createNew} className="px-2 py-1.5 rounded-lg border border-gray-300 dark:border-slate-600">+ New</button>
                {activeId && <button type="button" onClick={removeActive} className="px-2 py-1.5 text-danger-600 dark:text-danger-400">Discard</button>}
                <span className="text-gray-500 dark:text-slate-400">{status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Save failed' : ''}</span>
            </div>
            {expiresSoon && <p className="text-right text-xs text-amber-700 dark:text-amber-400">⚠ This draft expires in less than 2 days.</p>}
        </div>
    );
};

export default PODraftShelf;
