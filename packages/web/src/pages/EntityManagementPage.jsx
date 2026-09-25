import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../api';
import { useAuth } from '../contexts/AuthContext';

const CONFIG = {
    brand: { label: 'Brands', singular: 'brand', id: 'brand_id', name: 'brand_name', code: 'brand_code', permission: 'brands:manage' },
    group: { label: 'Groups', singular: 'group', id: 'group_id', name: 'group_name', code: 'group_code', permission: 'groups:manage' },
};

export default function EntityManagementPage({ entity = 'brand', onNavigate }) {
    const cfg = CONFIG[entity];
    const { hasPermission } = useAuth();
    const [items, setItems] = useState([]);
    const [suggestions, setSuggestions] = useState([]);
    const [drafts, setDrafts] = useState({});
    const [selected, setSelected] = useState(new Set());
    const [threshold, setThreshold] = useState('0.55');
    const [loading, setLoading] = useState(true);
    const [scanning, setScanning] = useState(false);
    const [mergingId, setMergingId] = useState(null);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const [entities, pending] = await Promise.all([
                api.get(`/${entity}s`), api.get(`/${entity}s/duplicate-suggestions`),
            ]);
            setItems(entities.data || []);
            setSuggestions(pending.data.suggestions || []);
            setDrafts({});
            setSelected(new Set());
        } catch (error) {
            toast.error(error.response?.data?.message || `Could not load ${cfg.label.toLowerCase()}`);
        } finally { setLoading(false); }
    }, [cfg.label, entity]);

    useEffect(() => { if (!hasPermission(cfg.permission)) { onNavigate('parts'); return; } load(); }, [cfg.permission, hasPermission, load, onNavigate]);

    const visible = useMemo(() => items.filter(item => !item.is_merged), [items]);
    const edit = (item, field, value) => setDrafts(current => ({ ...current, [item[cfg.id]]: { ...(current[item[cfg.id]] || item), [field]: value } }));
    const toggle = (id) => setSelected(current => { const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next; });

    const save = async (ids) => {
        const updates = ids.map(id => ({ [cfg.id]: id, ...drafts[id] })).filter(row => row[cfg.name] || row[cfg.code]);
        if (!updates.length) return;
        try {
            if (updates.length === 1) await api.put(`/${entity}s/${updates[0][cfg.id]}`, updates[0]);
            else await api.put(`/${entity}s/bulk`, { updates });
            toast.success(`${updates.length} ${cfg.singular}${updates.length === 1 ? '' : 's'} updated`);
            await load();
        } catch (error) { toast.error(error.response?.data?.message || 'Unable to save changes'); }
    };

    const scan = async () => {
        setScanning(true);
        try {
            const { data } = await api.post(`/${entity}s/scan-duplicates`, { threshold: Number(threshold) });
            const jev = data.jev?.enabled
                ? ` Jev reviewed ${data.jev.evaluated} local candidate${data.jev.evaluated === 1 ? '' : 's'}.`
                : ' Jev is not configured; local matching was used.';
            toast.success(`Scan complete: ${data.createdOrUpdated} candidate pair${data.createdOrUpdated === 1 ? '' : 's'}.${jev}`);
            await load();
        } catch (error) { toast.error(error.response?.data?.message || 'Duplicate scan failed'); }
        finally { setScanning(false); }
    };

    const merge = async (suggestion, keepId) => {
        const otherId = keepId === suggestion[cfg.id] ? suggestion[`duplicate_${cfg.id}`] : suggestion[cfg.id];
        setMergingId(suggestion.suggestion_id);
        try {
            const { data: preview } = await api.post(`/${entity}s/merge-preview`, { keepId, mergeIds: [otherId] });
            const count = preview.impact?.parts_reassigned || 0;
            if (!window.confirm(`Merge into ${preview.keep[cfg.name]}? ${count} part${count === 1 ? '' : 's'} will be reassigned. Existing SKU prefixes will not change.`)) return;
            await api.post(`/${entity}s/merge`, { keepId, mergeIds: [otherId], suggestionIds: [suggestion.suggestion_id] });
            toast.success(`${cfg.singular[0].toUpperCase() + cfg.singular.slice(1)} merged; ${count} part${count === 1 ? '' : 's'} reassigned`);
            await load();
        } catch (error) { toast.error(error.response?.data?.message || 'Merge failed'); }
        finally { setMergingId(null); }
    };

    const dismiss = async (id) => {
        try { await api.post(`/${entity}s/duplicate-suggestions/${id}/dismiss`); await load(); }
        catch (error) { toast.error(error.response?.data?.message || 'Unable to dismiss suggestion'); }
    };

    return (
        <div className="mx-auto max-w-7xl space-y-6">
            <header className="flex flex-wrap items-start justify-between gap-4">
                <div><h1 className="text-2xl font-bold text-slate-900 dark:text-white">{cfg.label} management</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Clean master data before duplicate-prevention gates are enabled. Merges keep historical SKU prefixes intact.</p></div>
                <button type="button" onClick={load} className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800">Refresh</button>
            </header>

            <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 className="font-semibold">Duplicate scan</h2><p className="mt-1 text-sm text-slate-500">Uses PostgreSQL trigram similarity, then Jev duplicate scoring when TypeSafe AI credentials are configured. The scan remains advisory and never merges records automatically.</p></div><div className="flex items-end gap-2"><label className="text-sm">Threshold<input aria-label="Similarity threshold" type="number" min="0.1" max="0.99" step="0.01" value={threshold} onChange={e => setThreshold(e.target.value)} className="ml-2 w-20 rounded border border-slate-300 px-2 py-2 dark:border-slate-700 dark:bg-slate-800" /></label><button type="button" onClick={scan} disabled={scanning} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-60">{scanning ? 'Scanning…' : 'Scan duplicates'}</button></div></div>
            </section>

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-5 dark:border-slate-700"><div><h2 className="font-semibold">Directory</h2><p className="text-sm text-slate-500">Edit names/codes individually or select several changed rows for a bulk save.</p></div><button type="button" disabled={!selected.size} onClick={() => save([...selected])} className="rounded-lg border border-primary-600 px-3 py-2 text-sm font-semibold text-primary-700 disabled:opacity-40 dark:text-primary-300">Save selected ({selected.size})</button></div>
                {loading ? <p className="p-8 text-center text-sm text-slate-500">Loading…</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead className="bg-slate-50 text-left text-slate-500 dark:bg-slate-800"><tr><th className="p-3" /><th className="p-3">Name</th><th className="p-3">Code</th><th className="p-3 text-right">Parts</th><th className="p-3" /></tr></thead><tbody>{visible.map(item => { const draft = drafts[item[cfg.id]] || item; const changed = !!drafts[item[cfg.id]]; return <tr key={item[cfg.id]} className="border-t border-slate-100 dark:border-slate-800"><td className="p-3"><input type="checkbox" checked={selected.has(item[cfg.id])} onChange={() => toggle(item[cfg.id])} /></td><td className="p-3"><input value={draft[cfg.name] || ''} onChange={e => edit(item, cfg.name, e.target.value)} className="w-full rounded border border-slate-300 bg-transparent px-2 py-1.5 dark:border-slate-700" /></td><td className="p-3"><input value={draft[cfg.code] || ''} maxLength="10" onChange={e => edit(item, cfg.code, e.target.value.toUpperCase())} className="w-24 rounded border border-slate-300 bg-transparent px-2 py-1.5 dark:border-slate-700" /></td><td className="p-3 text-right tabular-nums">{item.part_count}</td><td className="p-3"><button type="button" disabled={!changed} onClick={() => save([item[cfg.id]])} className="text-primary-700 disabled:text-slate-400 dark:text-primary-300">Save</button></td></tr>; })}</tbody></table></div>}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900"><div className="border-b border-slate-200 p-5 dark:border-slate-700"><h2 className="font-semibold">Duplicate suggestions</h2><p className="text-sm text-slate-500">Review every merge manually. The scan never changes records automatically.</p></div>{suggestions.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">No pending suggestions.</p> : <div className="divide-y divide-slate-100 dark:divide-slate-800">{suggestions.map(s => <article key={s.suggestion_id} className="flex flex-wrap items-center justify-between gap-4 p-5"><div><div className="font-medium">{s[cfg.name]} <span className="text-slate-400">({s[cfg.code]})</span> <span className="mx-2 text-slate-400">↔</span> {s[`duplicate_${cfg.name}`]} <span className="text-slate-400">({s[`duplicate_${cfg.code}`]})</span></div><p className="mt-1 text-sm text-slate-500">{Math.round(Number(s.confidence_score) * 100)}% match · {s.detection_method}</p></div><div className="flex flex-wrap gap-2"><button type="button" disabled={mergingId === s.suggestion_id} onClick={() => merge(s, s[cfg.id])} className="rounded border border-primary-600 px-3 py-1.5 text-sm text-primary-700 dark:text-primary-300">Keep first</button><button type="button" disabled={mergingId === s.suggestion_id} onClick={() => merge(s, s[`duplicate_${cfg.id}`])} className="rounded border border-primary-600 px-3 py-1.5 text-sm text-primary-700 dark:text-primary-300">Keep second</button><button type="button" onClick={() => dismiss(s.suggestion_id)} className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-600 dark:border-slate-700 dark:text-slate-300">Dismiss</button></div></article>)}</div>}</section>
        </div>
    );
}
