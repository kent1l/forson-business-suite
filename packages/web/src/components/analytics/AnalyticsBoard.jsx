import { useCallback, useEffect, useMemo, useState } from 'react';
import api from '../../api';
import useLocalStorage from '../../hooks/useLocalStorage';
import { useAnalyticsMeta } from '../../hooks/useAnalyticsMeta';
import LoadingState from '../ui/LoadingState';
import ErrorState from '../ui/ErrorState';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import { AnalyticsBatchProvider } from './AnalyticsBatchContext';
import AnalyticsTile from './AnalyticsTile';

/**
 * Owns board *state* — the date range, the active filters, whether comparison is
 * on — and renders the grid. The board *spec* comes from the server, because
 * permission filtering has to happen there anyway and a client-side copy of that
 * rule is the copy that goes wrong.
 *
 * State is per user in localStorage, so someone who works in "last 90 days"
 * finds the page as they left it.
 */
const AnalyticsBoard = ({ boardId, onNavigate }) => {
    const { presets, meta } = useAnalyticsMeta();
    const [board, setBoard] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [preset, setPreset] = useLocalStorage(`forson_analytics_${boardId}_preset`, 'last_30_days');
    const [compareOn, setCompareOn] = useLocalStorage(`forson_analytics_${boardId}_compare`, true);
    const [filters, setFilters] = useState({});

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        api.get(`/analytics/boards/${boardId}`)
            .then((res) => {
                setBoard(res.data);
                setPreset((current) => current || res.data.defaultPreset);
            })
            .catch((err) => setError(err?.response?.data?.message || 'Could not load this board.'))
            .finally(() => setLoading(false));
    }, [boardId, setPreset]);

    useEffect(load, [load]);

    const onAddFilter = useCallback((dimension, value) => {
        setFilters((prev) => {
            const existing = prev[dimension] || [];
            return existing.includes(value)
                ? prev
                : { ...prev, [dimension]: [...existing, value] };
        });
    }, []);

    const clearFilters = useCallback(() => setFilters({}), []);

    const boardState = useMemo(() => ({
        dateRange: { preset },
        filters,
        compare: !!compareOn,
        onAddFilter,
    }), [preset, filters, compareOn, onAddFilter]);

    const activeFilterCount = Object.values(filters).reduce((n, v) => n + v.length, 0);
    const canExport = !!meta?.permissions?.export;
    // A board of positions as of now has nothing for a date picker to change.
    // Showing one anyway would teach the reader that the figures moved with it.
    const periodless = board?.period === 'none';

    if (loading) return <LoadingState label="Loading board…" />;
    if (error) return <ErrorState title="Could not load this board" description={error} onRetry={load} />;
    if (!board) return null;

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center gap-3">
                {periodless ? (
                    <span className="flex items-center gap-2 text-sm text-neutral-500 dark:text-slate-400">
                        <Icon path={ICONS.calendar} className="h-4 w-4 text-neutral-400" />
                        Everything here is the position as of now.
                    </span>
                ) : (
                    <>
                        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-slate-300">
                            <Icon path={ICONS.calendar} className="h-4 w-4 text-neutral-400" />
                            <select
                                value={preset}
                                onChange={(e) => setPreset(e.target.value)}
                                className="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm text-neutral-800 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                            >
                                {presets.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                            </select>
                        </label>

                        <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-slate-300">
                            <input
                                type="checkbox"
                                checked={!!compareOn}
                                onChange={(e) => setCompareOn(e.target.checked)}
                                className="h-4 w-4 rounded border-neutral-300 text-primary-600"
                            />
                            Compare with the previous period
                        </label>
                    </>
                )}

                {activeFilterCount > 0 && (
                    <button
                        type="button"
                        onClick={clearFilters}
                        className="rounded-md border border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:bg-neutral-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                        Clear {activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'}
                    </button>
                )}
            </div>

            <AnalyticsBatchProvider>
                <div className="grid grid-cols-12 gap-4">
                    {board.tiles.map((tile) => (
                        <AnalyticsTile
                            key={tile.id}
                            spec={tile}
                            boardState={boardState}
                            onNavigate={onNavigate}
                            canExport={canExport}
                        />
                    ))}
                </div>
            </AnalyticsBatchProvider>
        </div>
    );
};

export default AnalyticsBoard;
