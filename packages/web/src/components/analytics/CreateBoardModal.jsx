import { useState } from 'react';
import api from '../../api';
import { useAnalyticsMeta } from '../../hooks/useAnalyticsMeta';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';

const TILE_TYPES = [
    { id: 'kpi', label: 'KPI Card' },
    { id: 'line', label: 'Line Chart' },
    { id: 'bar', label: 'Bar Chart' },
    { id: 'table', label: 'Table' },
];

const CreateBoardModal = ({ isOpen, onClose, onCreated }) => {
    const { metrics, dimensions, presets } = useAnalyticsMeta();

    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [period, setPeriod] = useState('range');
    const [defaultPreset, setDefaultPreset] = useState('last_30_days');
    const [tiles, setTiles] = useState([
        {
            id: 'tile_1',
            type: 'kpi',
            title: '',
            metric: 'sales.net_revenue',
            dimension: '',
        },
    ]);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState(null);

    if (!isOpen) return null;

    // Filter metrics when period is 'none' (snapshots only)
    const availableMetrics = period === 'none'
        ? metrics.filter((m) => !m.comparable)
        : metrics;

    const addTile = () => {
        setTiles((prev) => [
            ...prev,
            {
                id: `tile_${prev.length + 1}`,
                type: 'kpi',
                title: '',
                metric: availableMetrics[0]?.id || 'sales.net_revenue',
                dimension: '',
            },
        ]);
    };

    const updateTile = (index, field, value) => {
        setTiles((prev) => {
            const next = [...prev];
            next[index] = { ...next[index], [field]: value };
            return next;
        });
    };

    const removeTile = (index) => {
        setTiles((prev) => prev.filter((_, i) => i !== index));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);

        if (!title.trim()) {
            setError('Please provide a board title.');
            return;
        }

        if (tiles.length === 0) {
            setError('Please add at least one tile to the board.');
            return;
        }

        // Build validated board spec payload
        const boardTiles = tiles.map((t, index) => {
            const dims = t.dimension ? [t.dimension] : [];
            const query = {
                metrics: [t.metric],
                dimensions: dims,
                grain: dims.includes('date') ? 'auto' : null,
                compare: period === 'range' && t.type === 'kpi' ? 'previous_period' : null,
            };
            if (dims.length === 1 && dims[0] !== 'date') {
                query.topN = { n: 8, by: t.metric };
            }

            return {
                id: t.id || `tile_${index + 1}`,
                type: t.type,
                title: t.title.trim() || undefined,
                span: t.type === 'kpi' ? { base: 12, md: 6, lg: 3 } : { base: 12, lg: 6 },
                query,
                display: {
                    value: t.metric,
                    compare: { show: period === 'range' && t.type === 'kpi' },
                    coverage: { show: true },
                },
            };
        });

        const slug = title.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
        const boardId = `custom_${slug}_${Date.now()}`;

        const payload = {
            id: boardId,
            title: title.trim(),
            description: description.trim() || null,
            period,
            defaultPreset,
            tiles: boardTiles,
        };

        setSubmitting(true);
        try {
            const res = await api.post('/analytics/boards', payload);
            onCreated(res.data);
            onClose();
        } catch (err) {
            setError(err?.response?.data?.message || err?.message || 'Failed to create board.');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl dark:bg-slate-800">
                <header className="mb-4 flex items-center justify-between border-b border-neutral-200 pb-3 dark:border-slate-700">
                    <h2 className="text-lg font-semibold text-neutral-800 dark:text-slate-100">
                        Create Custom Analytics Board
                    </h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-neutral-400 hover:text-neutral-600 dark:hover:text-slate-200"
                    >
                        <Icon path={ICONS.close} className="h-5 w-5" />
                    </button>
                </header>

                {error && (
                    <div className="mb-4 rounded-md bg-danger-50 p-3 text-sm text-danger-700 dark:bg-danger-900/30 dark:text-danger-400">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-slate-300">
                            Board Title
                        </label>
                        <input
                            type="text"
                            required
                            placeholder="e.g. Executive Morning Review"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-slate-300">
                            Description (Optional)
                        </label>
                        <input
                            type="text"
                            placeholder="Briefly explain what this board tracks"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-slate-300">
                                Board Period Mode
                            </label>
                            <select
                                value={period}
                                onChange={(e) => setPeriod(e.target.value)}
                                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                            >
                                <option value="range">Date Range (Trend &amp; Period comparison)</option>
                                <option value="none">Snapshot (Current position as of now)</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-xs font-semibold uppercase tracking-wider text-neutral-600 dark:text-slate-300">
                                Default Date Preset
                            </label>
                            <select
                                value={defaultPreset}
                                onChange={(e) => setDefaultPreset(e.target.value)}
                                disabled={period === 'none'}
                                className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none disabled:opacity-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                            >
                                {presets.map((p) => (
                                    <option key={p.id} value={p.id}>
                                        {p.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="border-t border-neutral-200 pt-4 dark:border-slate-700">
                        <div className="mb-3 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-neutral-800 dark:text-slate-100">
                                Board Tiles ({tiles.length})
                            </h3>
                            <button
                                type="button"
                                onClick={addTile}
                                className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
                            >
                                <Icon path={ICONS.plus} className="h-4 w-4" /> Add Tile
                            </button>
                        </div>

                        <div className="space-y-3">
                            {tiles.map((t, idx) => (
                                <div
                                    key={t.id || idx}
                                    className="rounded-lg border border-neutral-200 bg-neutral-50 p-3 dark:border-slate-700 dark:bg-slate-900/50"
                                >
                                    <div className="flex items-center justify-between gap-2 pb-2">
                                        <span className="text-xs font-semibold text-neutral-500 dark:text-slate-400">
                                            Tile #{idx + 1}
                                        </span>
                                        {tiles.length > 1 && (
                                            <button
                                                type="button"
                                                onClick={() => removeTile(idx)}
                                                className="text-neutral-400 hover:text-danger-600 dark:hover:text-danger-400"
                                            >
                                                <Icon path={ICONS.trash} className="h-4 w-4" />
                                            </button>
                                        )}
                                    </div>

                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                        <div>
                                            <label className="block text-[11px] font-medium text-neutral-600 dark:text-slate-400">
                                                Tile Type
                                            </label>
                                            <select
                                                value={t.type}
                                                onChange={(e) => updateTile(idx, 'type', e.target.value)}
                                                className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                                            >
                                                {TILE_TYPES.map((type) => (
                                                    <option key={type.id} value={type.id}>
                                                        {type.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-medium text-neutral-600 dark:text-slate-400">
                                                Metric
                                            </label>
                                            <select
                                                value={t.metric}
                                                onChange={(e) => updateTile(idx, 'metric', e.target.value)}
                                                className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                                            >
                                                {availableMetrics.map((m) => (
                                                    <option key={m.id} value={m.id}>
                                                        {m.label} ({m.id})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-[11px] font-medium text-neutral-600 dark:text-slate-400">
                                                Breakdown (Optional)
                                            </label>
                                            <select
                                                value={t.dimension}
                                                onChange={(e) => updateTile(idx, 'dimension', e.target.value)}
                                                disabled={t.type === 'kpi'}
                                                className="mt-1 w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs text-neutral-800 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                                            >
                                                <option value="">(None / Totals)</option>
                                                {period === 'range' && <option value="date">Date</option>}
                                                {dimensions.map((d) => (
                                                    <option key={d.id} value={d.id}>
                                                        {d.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <footer className="mt-6 flex justify-end gap-3 border-t border-neutral-200 pt-4 dark:border-slate-700">
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-md border border-neutral-300 px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-700"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={submitting}
                            className="rounded-md bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 dark:bg-primary-500 dark:hover:bg-primary-600"
                        >
                            {submitting ? 'Creating Board…' : 'Create Board'}
                        </button>
                    </footer>
                </form>
            </div>
        </div>
    );
};

export default CreateBoardModal;
