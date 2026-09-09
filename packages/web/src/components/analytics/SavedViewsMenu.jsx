import { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const SavedViewsMenu = ({ boardId, currentState, onApplyState }) => {
    const [views, setViews] = useState([]);
    const [activeViewId, setActiveViewId] = useState(null);
    const [isOpen, setIsOpen] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [viewName, setViewName] = useState('');
    const [isDefault, setIsDefault] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const loadViews = useCallback(async (autoApplyDefault = false) => {
        if (!boardId) return;
        setLoading(true);
        try {
            const res = await api.get('/analytics/saved-views', { params: { boardId } });
            const list = res.data || [];
            setViews(list);

            if (autoApplyDefault && list.length > 0) {
                const def = list.find((v) => v.isDefault);
                if (def && def.state) {
                    setActiveViewId(def.viewId);
                    onApplyState(def.state);
                }
            }
        } catch (err) {
            console.warn('Analytics saved views failed to load:', err.message);
        } finally {
            setLoading(false);
        }
    }, [boardId, onApplyState]);

    useEffect(() => {
        loadViews(true);
    }, [loadViews]);

    const activeView = views.find((v) => v.viewId === activeViewId);
    const isModified = activeView && currentState && (
        activeView.state?.preset !== currentState.preset
        || activeView.state?.compare !== currentState.compare
        || JSON.stringify(activeView.state?.filters || {}) !== JSON.stringify(currentState.filters || {})
    );

    const handleSelectView = (view) => {
        setActiveViewId(view.viewId);
        onApplyState(view.state);
        setIsOpen(false);
    };

    const handleSaveNew = async (e) => {
        e.preventDefault();
        if (!viewName.trim()) return;
        setError(null);
        try {
            const res = await api.post('/analytics/saved-views', {
                boardId,
                name: viewName.trim(),
                state: currentState,
                isDefault,
            });
            setViewName('');
            setIsDefault(false);
            setIsSaving(false);
            await loadViews(false);
            setActiveViewId(res.data.viewId);
        } catch (err) {
            setError(err?.response?.data?.message || 'Could not save view.');
        }
    };

    const handleUpdateActive = async () => {
        if (!activeView) return;
        try {
            await api.put(`/analytics/saved-views/${activeView.viewId}`, {
                state: currentState,
            });
            await loadViews(false);
        } catch (err) {
            console.warn('Failed to update saved view:', err.message);
        }
    };

    const handleDeleteView = async (viewId, e) => {
        e.stopPropagation();
        try {
            await api.delete(`/analytics/saved-views/${viewId}`);
            if (activeViewId === viewId) {
                setActiveViewId(null);
            }
            await loadViews(false);
        } catch (err) {
            console.warn('Failed to delete saved view:', err.message);
        }
    };

    return (
        <div className="relative inline-block text-left">
            <div className="flex items-center gap-1">
                <button
                    type="button"
                    onClick={() => setIsOpen((prev) => !prev)}
                    className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors ${
                        activeView
                            ? 'border-primary-300 bg-primary-50 text-primary-800 dark:border-primary-700 dark:bg-primary-950/40 dark:text-primary-300'
                            : 'border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'
                    }`}
                >
                    <Icon path={ICONS.bookmark} className="h-4 w-4" />
                    <span>
                        {activeView ? activeView.name : 'Saved Views'}
                        {isModified && <span className="ml-1 text-xs text-warning-600 dark:text-warning-400">*</span>}
                    </span>
                    <Icon path={ICONS.chevronDown} className="h-3.5 w-3.5 text-neutral-400" />
                </button>

                {isModified && (
                    <button
                        type="button"
                        onClick={handleUpdateActive}
                        title="Update saved view with current filters & preset"
                        className="rounded-md border border-warning-300 bg-warning-50 px-2 py-1.5 text-xs font-medium text-warning-800 hover:bg-warning-100 dark:border-warning-700 dark:bg-warning-950/40 dark:text-warning-300"
                    >
                        Save changes
                    </button>
                )}
            </div>

            {isOpen && (
                <div className="absolute left-0 z-30 mt-1 w-72 rounded-lg border border-neutral-200 bg-white p-2 shadow-lg dark:border-slate-700 dark:bg-slate-800">
                    <header className="mb-2 flex items-center justify-between border-b border-neutral-100 px-2 pb-1.5 text-xs font-semibold text-neutral-500 dark:border-slate-700 dark:text-slate-400">
                        <span>SAVED VIEWS</span>
                        <button
                            type="button"
                            onClick={() => setIsSaving((prev) => !prev)}
                            className="flex items-center gap-1 text-primary-600 hover:text-primary-700 dark:text-primary-400"
                        >
                            <Icon path={ICONS.plus} className="h-3 w-3" /> Save current
                        </button>
                    </header>

                    {isSaving && (
                        <form onSubmit={handleSaveNew} className="mb-2 rounded-md bg-neutral-50 p-2 text-xs dark:bg-slate-900">
                            {error && <p className="mb-1 text-[11px] text-danger-600 dark:text-danger-400">{error}</p>}
                            <input
                                type="text"
                                required
                                placeholder="View name…"
                                value={viewName}
                                onChange={(e) => setViewName(e.target.value)}
                                className="mb-2 w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800 focus:border-primary-500 focus:outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                            />
                            <label className="mb-2 flex items-center gap-1.5 text-neutral-600 dark:text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={isDefault}
                                    onChange={(e) => setIsDefault(e.target.checked)}
                                    className="h-3.5 w-3.5 rounded border-neutral-300 text-primary-600"
                                />
                                Set as default view
                            </label>
                            <div className="flex justify-end gap-1.5">
                                <button
                                    type="button"
                                    onClick={() => setIsSaving(false)}
                                    className="rounded px-2 py-0.5 text-neutral-600 hover:bg-neutral-200 dark:text-slate-400 dark:hover:bg-slate-700"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    className="rounded bg-primary-600 px-2.5 py-0.5 font-medium text-white hover:bg-primary-700"
                                >
                                    Save
                                </button>
                            </div>
                        </form>
                    )}

                    <div className="max-h-56 overflow-y-auto">
                        {loading && <p className="p-2 text-center text-xs text-neutral-400">Loading views…</p>}
                        {!loading && views.length === 0 && !isSaving && (
                            <p className="p-2 text-center text-xs text-neutral-400">No saved views for this board yet.</p>
                        )}
                        {views.map((v) => (
                            <div
                                key={v.viewId}
                                onClick={() => handleSelectView(v)}
                                className={`flex cursor-pointer items-center justify-between rounded px-2 py-1.5 text-xs transition-colors ${
                                    v.viewId === activeViewId
                                        ? 'bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-300'
                                        : 'text-neutral-700 hover:bg-neutral-100 dark:text-slate-200 dark:hover:bg-slate-700/50'
                                }`}
                            >
                                <div className="flex items-center gap-1.5 truncate">
                                    {v.isDefault && (
                                        <span title="Default view">
                                            <Icon path={ICONS.star} className="h-3 w-3 text-warning-500" />
                                        </span>
                                    )}
                                    <span className="font-medium truncate">{v.name}</span>
                                </div>
                                <button
                                    type="button"
                                    onClick={(e) => handleDeleteView(v.viewId, e)}
                                    title="Delete view"
                                    className="text-neutral-400 hover:text-danger-600 dark:hover:text-danger-400"
                                >
                                    <Icon path={ICONS.trash} className="h-3.5 w-3.5" />
                                </button>
                            </div>
                        ))}
                    </div>

                    {activeView && (
                        <div className="mt-2 border-t border-neutral-100 pt-1 text-right dark:border-slate-700">
                            <button
                                type="button"
                                onClick={() => { setActiveViewId(null); setIsOpen(false); }}
                                className="text-[11px] text-neutral-500 hover:text-neutral-700 dark:text-slate-400 dark:hover:text-slate-200"
                            >
                                Clear view selection
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default SavedViewsMenu;
