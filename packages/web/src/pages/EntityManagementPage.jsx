import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';
import Modal from '../components/ui/Modal';

const CONFIG = {
    brand: { label: 'Brands', singular: 'brand', id: 'brand_id', name: 'brand_name', code: 'brand_code', permission: 'brands:manage' },
    group: { label: 'Groups', singular: 'group', id: 'group_id', name: 'group_name', code: 'group_code', permission: 'groups:manage' },
};

const searchText = (row, cfg) => [row[cfg.name], row[cfg.code], row[`duplicate_${cfg.name}`], row[`duplicate_${cfg.code}`]]
    .filter(Boolean).join(' ').toLocaleLowerCase();

export default function EntityManagementPage({ entity = 'brand', onNavigate }) {
    const cfg = CONFIG[entity];
    const { hasPermission } = useAuth();
    const [items, setItems] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [drafts, setDrafts] = useState({});
    const [selected, setSelected] = useState(new Set());
    const [query, setQuery] = useState('');
    const [threshold, setThreshold] = useState('0.55');
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [mergeDialog, setMergeDialog] = useState(null);
    const [previewing, setPreviewing] = useState(false);
    const [executingMerge, setExecutingMerge] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [entities, pending] = await Promise.all([api.get(`/${entity}s`), api.get(`/${entity}s/duplicate-suggestions`)]);
            setItems(entities.data || []);
            setSuggestions(pending.data.suggestions || []);
            setDrafts({});
            setSelected(new Set());
        } catch (error) {
            toast.error(error.response?.data?.message || `Could not load ${cfg.label.toLowerCase()}`);
        } finally {
            setLoading(false);
        }
    }, [cfg.label, entity]);

    useEffect(() => {
        if (!hasPermission(cfg.permission)) {
            onNavigate('parts');
            return;
        }
        load();
    }, [cfg.permission, hasPermission, load, onNavigate]);

    const activeItems = useMemo(() => items.filter(item => !item.is_merged), [items]);
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filteredItems = useMemo(() => activeItems.filter(item => !normalizedQuery || searchText(item, cfg).includes(normalizedQuery)), [activeItems, cfg, normalizedQuery]);
    const filteredSuggestions = useMemo(() => suggestions.filter(item => !normalizedQuery || searchText(item, cfg).includes(normalizedQuery)), [cfg, normalizedQuery, suggestions]);
    const selectedIds = useMemo(() => [...selected], [selected]);
    const selectedChangedCount = useMemo(() => selectedIds.filter(id => Boolean(drafts[id])).length, [drafts, selectedIds]);
    const allFilteredSelected = filteredItems.length > 0 && filteredItems.every(item => selected.has(item[cfg.id]));

    const edit = (item, field, value) => setDrafts(current => ({ ...current, [item[cfg.id]]: { ...(current[item[cfg.id]] || item), [field]: value } }));
    const toggle = (id) => setSelected(current => {
        const next = new Set(current);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });
    const toggleAllFiltered = () => setSelected(current => {
        const next = new Set(current);
        if (allFilteredSelected) filteredItems.forEach(item => next.delete(item[cfg.id]));
        else filteredItems.forEach(item => next.add(item[cfg.id]));
        return next;
    });

    const save = async (ids) => {
        const updates = ids.map(id => ({ [cfg.id]: id, ...drafts[id] })).filter(row => drafts[row[cfg.id]]);
        if (!updates.length) return;
        try {
            if (updates.length === 1) await api.put(`/${entity}s/${updates[0][cfg.id]}`, updates[0]);
            else await api.put(`/${entity}s/bulk`, { updates });
            toast.success(`${updates.length} ${cfg.singular}${updates.length === 1 ? '' : 's'} updated`);
            await load();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Unable to save changes');
        }
    };

    const scan = async () => {
        setScanning(true);
        try {
            const { data } = await api.post(`/${entity}s/scan-duplicates`, { threshold: Number(threshold) });
            const jev = data.jev?.enabled
                ? ` Jev evaluated ${data.jev.evaluated} candidate${data.jev.evaluated === 1 ? '' : 's'}${data.jev.cached ? ` and reused ${data.jev.cached} cached decision${data.jev.cached === 1 ? '' : 's'}` : ''}.`
                : ' Jev is not configured; local matching was used.';
            toast.success(`Scan complete: ${data.createdOrUpdated} candidate pair${data.createdOrUpdated === 1 ? '' : 's'}.${jev}`);
            await load();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Duplicate scan failed');
        } finally {
            setScanning(false);
        }
    };

    const requestPreview = async (dialog) => {
        const mergeIds = dialog.ids.filter(id => id !== dialog.keepId);
        const requestKey = `${dialog.keepId}:${mergeIds.join(',')}`;
        setPreviewing(true);
        try {
            const { data } = await api.post(`/${entity}s/merge-preview`, { keepId: dialog.keepId, mergeIds });
            setMergeDialog(current => current?.requestKey === requestKey ? { ...current, preview: data } : current);
        } catch (error) {
            toast.error(error.response?.data?.message || 'Unable to preview this merge');
            setMergeDialog(current => current?.requestKey === requestKey ? { ...current, preview: null } : current);
        } finally {
            setPreviewing(false);
        }
    };

    const openMergeDialog = (ids, suggestionIds = []) => {
        const uniqueIds = [...new Set(ids.map(Number))];
        if (uniqueIds.length < 2) return;
        const dialog = { ids: uniqueIds, suggestionIds, keepId: uniqueIds[0], preview: null, confirmed: false };
        dialog.requestKey = `${dialog.keepId}:${dialog.ids.filter(id => id !== dialog.keepId).join(',')}`;
        setMergeDialog(dialog);
        requestPreview(dialog);
    };

    const chooseCanonical = (keepId) => {
        if (!mergeDialog || keepId === mergeDialog.keepId) return;
        const next = { ...mergeDialog, keepId, preview: null, confirmed: false };
        next.requestKey = `${next.keepId}:${next.ids.filter(id => id !== next.keepId).join(',')}`;
        setMergeDialog(next);
        requestPreview(next);
    };

    const executeMerge = async () => {
        if (!mergeDialog?.preview) return;
        setExecutingMerge(true);
        try {
            const mergeIds = mergeDialog.ids.filter(id => id !== mergeDialog.keepId);
            const { data } = await api.post(`/${entity}s/merge`, { keepId: mergeDialog.keepId, mergeIds, suggestionIds: mergeDialog.suggestionIds });
            const count = data.result?.partsReassigned ?? mergeDialog.preview.impact?.parts_reassigned ?? 0;
            toast.success(`${mergeIds.length} ${cfg.singular}${mergeIds.length === 1 ? '' : 's'} merged; ${count} part${count === 1 ? '' : 's'} reassigned`);
            setMergeDialog(null);
            await load();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Merge failed');
        } finally {
            setExecutingMerge(false);
        }
    };

    const dismiss = async (id) => {
        try {
            await api.post(`/${entity}s/duplicate-suggestions/${id}/dismiss`);
            await load();
        } catch (error) {
            toast.error(error.response?.data?.message || 'Unable to dismiss suggestion');
        }
    };

    const mergeCandidates = mergeDialog?.ids.map(id => items.find(item => item[cfg.id] === id)).filter(Boolean) || [];

    return <div className="mx-auto max-w-7xl space-y-6 pb-8">
        <header className="rounded-2xl bg-gradient-to-br from-slate-950 via-slate-900 to-primary-950 px-6 py-7 text-white shadow-lg">
            <div className="flex flex-wrap items-start justify-between gap-5"><div className="max-w-2xl"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary-200">Master data health</p><h1 className="mt-2 text-3xl font-bold tracking-tight">{cfg.label} manager</h1><p className="mt-2 text-sm leading-6 text-slate-300">Find, clean up, and safely consolidate duplicate {cfg.label.toLowerCase()}. Historical SKU prefixes always stay intact.</p></div><button type="button" onClick={load} className="rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-white">Refresh data</button></div>
        </header>

        <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:grid-cols-[1fr_auto] lg:items-end dark:border-slate-700 dark:bg-slate-900">
            <div><h2 className="font-semibold text-slate-900 dark:text-white">Find possible duplicates</h2><p className="mt-1 max-w-2xl text-sm text-slate-500">Similarity finds a small candidate set; Jev filters candidates when enabled. Nothing merges until you approve it.</p></div>
            <div className="flex flex-wrap items-end gap-3"><label className="text-xs font-medium uppercase tracking-wide text-slate-500">Similarity threshold<input aria-label="Similarity threshold" type="number" min="0.1" max="0.99" step="0.01" value={threshold} onChange={event => setThreshold(event.target.value)} className="mt-1 block w-28 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-white" /></label><button type="button" onClick={scan} disabled={scanning} className="rounded-lg bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-60">{scanning ? 'Scanning…' : 'Scan for duplicates'}</button></div>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 p-5 dark:border-slate-700"><div><h2 className="font-semibold text-slate-900 dark:text-white">Directory</h2><p className="mt-1 text-sm text-slate-500">Select two or more records to combine them in one reviewed merge.</p></div><div className="flex flex-wrap items-center gap-2"><button type="button" disabled={selectedChangedCount === 0} onClick={() => save(selectedIds)} className="rounded-lg border border-primary-600 px-3 py-2 text-sm font-semibold text-primary-700 transition hover:bg-primary-50 disabled:cursor-not-allowed disabled:opacity-40 dark:text-primary-300 dark:hover:bg-primary-950">Save changes {selectedChangedCount ? `(${selectedChangedCount})` : ''}</button><button type="button" disabled={selectedIds.length < 2} onClick={() => openMergeDialog(selectedIds)} className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-primary-600 dark:hover:bg-primary-500">Merge selected {selectedIds.length > 1 ? `(${selectedIds.length})` : ''}</button></div></div>
            <div className="border-b border-slate-100 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/30"><label className="relative block max-w-xl"><span className="sr-only">Search {cfg.label.toLowerCase()}</span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg><input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${cfg.label.toLowerCase()} by name or code…`} className="w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-9 text-sm text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 dark:border-slate-700 dark:bg-slate-800 dark:text-white" />{query && <button type="button" onClick={() => setQuery('')} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-white" aria-label="Clear search">×</button>}</label><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500"><span>{filteredItems.length} of {activeItems.length} {cfg.label.toLowerCase()} shown</span>{selectedIds.length > 0 && <span className="flex items-center gap-2 rounded-full bg-primary-100 px-3 py-1 font-semibold text-primary-800 dark:bg-primary-950 dark:text-primary-200">{selectedIds.length} selected <button type="button" onClick={() => setSelected(new Set())} className="underline underline-offset-2 hover:text-primary-950 dark:hover:text-white">Clear</button></span>}</div></div>
            {loading ? <p className="p-10 text-center text-sm text-slate-500">Loading directory…</p> : <div className="overflow-x-auto"><table className="w-full min-w-[700px] text-sm"><thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:bg-slate-800"><tr><th className="w-12 p-4"><input aria-label={allFilteredSelected ? 'Deselect all visible records' : 'Select all visible records'} type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" /></th><th className="p-4">Name</th><th className="p-4">Code</th><th className="p-4 text-right">Linked parts</th><th className="w-24 p-4 text-right"><span className="sr-only">Save</span></th></tr></thead><tbody className="divide-y divide-slate-100 dark:divide-slate-800">{filteredItems.map(item => { const draft = drafts[item[cfg.id]] || item; const changed = Boolean(drafts[item[cfg.id]]); return <tr key={item[cfg.id]} className={selected.has(item[cfg.id]) ? 'bg-primary-50/60 dark:bg-primary-950/20' : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'}><td className="p-4"><input aria-label={`Select ${item[cfg.name]}`} type="checkbox" checked={selected.has(item[cfg.id])} onChange={() => toggle(item[cfg.id])} className="h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" /></td><td className="p-3"><input value={draft[cfg.name] || ''} onChange={event => edit(item, cfg.name, event.target.value)} className="w-full rounded-lg border border-transparent bg-transparent px-2.5 py-2 font-medium text-slate-900 outline-none transition focus:border-primary-400 focus:bg-white focus:ring-4 focus:ring-primary-500/10 dark:text-white dark:focus:bg-slate-800" /></td><td className="p-3"><input value={draft[cfg.code] || ''} maxLength="10" onChange={event => edit(item, cfg.code, event.target.value.toUpperCase())} className="w-28 rounded-lg border border-transparent bg-transparent px-2.5 py-2 font-mono text-xs font-semibold tracking-wide text-slate-700 outline-none transition focus:border-primary-400 focus:bg-white focus:ring-4 focus:ring-primary-500/10 dark:text-slate-200 dark:focus:bg-slate-800" /></td><td className="p-4 text-right font-medium tabular-nums text-slate-700 dark:text-slate-200">{item.part_count}</td><td className="p-4 text-right"><button type="button" disabled={!changed} onClick={() => save([item[cfg.id]])} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-primary-700 transition hover:bg-primary-100 disabled:cursor-not-allowed disabled:text-slate-400 dark:text-primary-300 dark:hover:bg-primary-950">Save</button></td></tr>; })}{filteredItems.length === 0 && <tr><td colSpan="5" className="p-10 text-center text-sm text-slate-500">No {cfg.label.toLowerCase()} match this search. {query && <button type="button" onClick={() => setQuery('')} className="font-semibold text-primary-700 hover:underline dark:text-primary-300">Clear search</button>}</td></tr>}</tbody></table></div>}
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"><div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-700"><div><h2 className="font-semibold text-slate-900 dark:text-white">Review queue</h2><p className="mt-1 text-sm text-slate-500">Suggestions are advisory. Choose the canonical record before every merge.</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800 dark:bg-amber-950 dark:text-amber-200">{filteredSuggestions.length} pending</span></div>{filteredSuggestions.length === 0 ? <p className="p-10 text-center text-sm text-slate-500">{query ? 'No pending suggestions match this search.' : 'No pending suggestions. Run a scan when you are ready.'}</p> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{filteredSuggestions.map(suggestion => { const leftId = suggestion[cfg.id]; const rightId = suggestion[`duplicate_${cfg.id}`]; const score = Math.round(Number(suggestion.confidence_score) * 100); return <article key={suggestion.suggestion_id} className="flex flex-wrap items-center justify-between gap-5 p-5"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900 dark:text-white"><span>{suggestion[cfg.name]}</span><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{suggestion[cfg.code]}</code><span className="text-slate-400">↔</span><span>{suggestion[`duplicate_${cfg.name}`]}</span><code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-800 dark:text-slate-300">{suggestion[`duplicate_${cfg.code}`]}</code></div><p className="mt-2 text-sm text-slate-500"><span className="font-semibold text-slate-700 dark:text-slate-300">{score}% match</span> · {suggestion.detection_method} · Select either record as canonical in the review step.</p></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => openMergeDialog([leftId, rightId], [suggestion.suggestion_id])} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white transition hover:bg-primary-700">Review merge</button><button type="button" onClick={() => dismiss(suggestion.suggestion_id)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800">Dismiss</button></div></article>; })}</div>}</section>

        <Modal isOpen={Boolean(mergeDialog)} onClose={() => !executingMerge && setMergeDialog(null)} title={`Merge ${mergeDialog?.ids.length || 0} ${cfg.label.toLowerCase()}`} maxWidth="max-w-2xl" bodyClassName="p-0">{mergeDialog && <div className="flex max-h-[70vh] flex-col"><div className="space-y-5 overflow-y-auto p-6"><div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-100"><strong>Review required.</strong> Choose the record to keep. All other selected records will be retired, their linked parts moved to the canonical record, and their names/codes retained as aliases.</div><div><h3 className="font-semibold text-slate-900 dark:text-white">Choose the canonical {cfg.singular}</h3><p className="mt-1 text-sm text-slate-500">This record keeps its name and code. You can merge any number of selected records into it.</p><div className="mt-3 space-y-2">{mergeCandidates.map(candidate => <label key={candidate[cfg.id]} className={`flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-4 transition ${mergeDialog.keepId === candidate[cfg.id] ? 'border-primary-500 bg-primary-50 dark:border-primary-500 dark:bg-primary-950/30' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'}`}><span className="flex items-center gap-3"><input type="radio" name="canonical-entity" checked={mergeDialog.keepId === candidate[cfg.id]} onChange={() => chooseCanonical(candidate[cfg.id])} className="h-4 w-4 border-slate-300 text-primary-600 focus:ring-primary-500" /><span><span className="block font-semibold text-slate-900 dark:text-white">{candidate[cfg.name]}</span><span className="mt-0.5 block font-mono text-xs text-slate-500">{candidate[cfg.code]} · {candidate.part_count} linked parts</span></span></span>{mergeDialog.keepId === candidate[cfg.id] && <span className="rounded-full bg-primary-600 px-2 py-1 text-xs font-bold text-white">Keep</span>}</label>)}</div></div><div className="rounded-xl bg-slate-50 p-4 dark:bg-slate-800/70"><h3 className="font-semibold text-slate-900 dark:text-white">Merge impact</h3>{previewing ? <p className="mt-2 text-sm text-slate-500">Calculating linked-part changes…</p> : mergeDialog.preview ? <dl className="mt-3 grid grid-cols-2 gap-3 text-sm"><div><dt className="text-slate-500">Canonical record</dt><dd className="mt-1 font-semibold text-slate-900 dark:text-white">{mergeDialog.preview.keep?.[cfg.name]}</dd></div><div><dt className="text-slate-500">Parts reassigned</dt><dd className="mt-1 text-xl font-bold tabular-nums text-slate-900 dark:text-white">{mergeDialog.preview.impact?.parts_reassigned || 0}</dd></div></dl> : <p className="mt-2 text-sm text-rose-600">Preview unavailable. Resolve the issue before merging.</p>}</div><label className="flex cursor-pointer items-start gap-3 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" checked={mergeDialog.confirmed} onChange={event => setMergeDialog(current => ({ ...current, confirmed: event.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500" /><span>I reviewed the canonical record and the reassignment impact.</span></label></div><div className="flex flex-wrap justify-end gap-3 border-t border-slate-200 bg-white px-6 py-4 dark:border-slate-700 dark:bg-slate-900"><button type="button" onClick={() => setMergeDialog(null)} disabled={executingMerge} className="rounded-lg px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-300 dark:hover:bg-slate-800">Cancel</button><button type="button" onClick={executeMerge} disabled={!mergeDialog.preview || !mergeDialog.confirmed || previewing || executingMerge} className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50">{executingMerge ? 'Merging…' : `Merge ${mergeDialog.ids.length - 1} into canonical`}</button></div></div>}</Modal>
    </div>;
}
