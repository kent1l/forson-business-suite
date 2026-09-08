import { useCallback, useEffect, useState } from 'react';
import api from '../../api';
import Icon from '../ui/Icon';
import { ICONS } from '../../constants';
import { useAnalyticsMeta } from '../../hooks/useAnalyticsMeta';
import CoverageBadge from './CoverageBadge';

/**
 * The insights panel (PRD §14), deferred by owner decision until the coverage
 * layer had been used on real data.
 *
 * Everything on screen here comes from a rule declared in
 * `services/analytics/registry/insights.js`. **Nothing is generated.** The server
 * sends a template and typed values; this component substitutes one into the
 * other and formats each value the same way the tiles do, from /meta. That is
 * why a figure inside a sentence reads identically to the same figure on the
 * tile below it — they go through one formatter.
 *
 * Two things here are requirements rather than decoration:
 *
 * - **Every insight names the figures it was worked out from.** A sentence a
 *   reader cannot check is an opinion, and prose is trusted more than a number
 *   is, so the citation is not optional.
 * - **Severity is never carried by colour alone.** Each insight shows an icon
 *   and the severity in words, because a red left border means nothing to a
 *   reader who cannot see red.
 */

const SEVERITY = {
    critical: {
        label: 'Needs attention',
        icon: ICONS.alert,
        bar: 'bg-danger-500',
        chip: 'text-danger-700 dark:text-danger-400',
    },
    warning: {
        label: 'Worth knowing',
        icon: ICONS.warning,
        bar: 'bg-warning-500',
        chip: 'text-warning-700 dark:text-warning-400',
    },
    info: {
        label: 'For information',
        icon: ICONS.info,
        bar: 'bg-primary-500',
        chip: 'text-primary-700 dark:text-primary-400',
    },
};

const PLACEHOLDER = /\{(\w+)\}/g;

const InsightsPanel = ({ boardId, boardState, onNavigate, onSelectBoard }) => {
    const { metric, format, formatBy } = useAnalyticsMeta();
    const [insights, setInsights] = useState([]);
    const [loading, setLoading] = useState(true);
    const [dismissed, setDismissed] = useState(() => new Set());

    const preset = boardState?.dateRange?.preset;
    const compare = boardState?.compare;

    const load = useCallback(() => {
        let live = true;
        setLoading(true);
        api.get(`/analytics/insights/${boardId}`, { params: { preset, compare: compare ? 1 : 0 } })
            .then((res) => { if (live) setInsights(res.data?.insights || []); })
            // An insights failure must never take a board down with it: the tiles
            // below carry the actual figures, and this is commentary on them.
            .catch(() => { if (live) setInsights([]); })
            .finally(() => { if (live) setLoading(false); });
        return () => { live = false; };
    }, [boardId, preset, compare]);

    useEffect(load, [load]);

    // Dismissals are per board and reset when the period changes: an insight
    // dismissed for last month should not stay hidden for this one.
    useEffect(() => { setDismissed(new Set()); }, [boardId, preset]);

    const visible = insights.filter((i) => !dismissed.has(i.id));
    if (loading || visible.length === 0) return null;

    /** Substitute the rule's values into its template, formatting each one. */
    const render = (insight) => {
        const parts = [];
        let last = 0;
        for (const match of insight.template.matchAll(PLACEHOLDER)) {
            if (match.index > last) parts.push(insight.template.slice(last, match.index));
            const slot = insight.values[match[1]];
            const text = slot
                ? (slot.metric ? format(slot.metric, slot.value) : formatBy(slot.format, slot.value))
                : match[0];
            parts.push(
                <strong key={`${match[1]}-${match.index}`} className="font-semibold tabular-nums">
                    {text}
                </strong>
            );
            last = match.index + match[0].length;
        }
        if (last < insight.template.length) parts.push(insight.template.slice(last));
        return parts;
    };

    const act = (insight) => {
        if (insight.action?.board && onSelectBoard) onSelectBoard(insight.action.board);
        else if (insight.action?.page && onNavigate) onNavigate(insight.action.page, {});
    };

    return (
        <section
            aria-label="Insights"
            className="mb-4 rounded-xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800"
        >
            <header className="mb-3 flex items-baseline justify-between gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-slate-400">
                    What stands out
                </h2>
                <p className="text-[11px] text-neutral-400 dark:text-slate-500">
                    Worked out from fixed rules, not written by an AI
                </p>
            </header>

            <ul className="space-y-2">
                {visible.map((insight) => {
                    const severity = SEVERITY[insight.severity] || SEVERITY.info;
                    const coverage = insight.cites
                        .map((id) => metric(id)?.trust)
                        .filter(Boolean)
                        .map((rule) => insight.coverage?.[rule])
                        .find(Boolean);
                    return (
                        <li
                            key={insight.id}
                            className="relative flex gap-3 overflow-hidden rounded-lg bg-neutral-50 py-2.5 pl-4 pr-2 dark:bg-slate-900/40"
                        >
                            <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${severity.bar}`} />
                            <Icon path={severity.icon} className={`mt-0.5 h-4 w-4 shrink-0 ${severity.chip}`} />

                            <div className="min-w-0 flex-1">
                                <p className="text-sm text-neutral-800 dark:text-slate-200">
                                    {/* The severity in words, so it does not depend on the colour bar. */}
                                    <span className={`mr-1.5 text-[11px] font-semibold uppercase tracking-wide ${severity.chip}`}>
                                        {severity.label}
                                    </span>
                                    {render(insight)}
                                </p>

                                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                                    {/* The citation. An insight a reader cannot check is an opinion. */}
                                    <span className="text-[11px] text-neutral-500 dark:text-slate-400">
                                        From {insight.cites.map((id) => metric(id)?.label || id).join(', ')}
                                    </span>
                                    {coverage ? <CoverageBadge coverage={coverage} /> : null}
                                    {insight.action ? (
                                        <button
                                            type="button"
                                            onClick={() => act(insight)}
                                            className="text-[11px] font-medium text-primary-600 underline hover:no-underline dark:text-primary-400"
                                        >
                                            {insight.action.label || 'Open'}
                                        </button>
                                    ) : null}
                                </div>
                            </div>

                            <button
                                type="button"
                                aria-label="Dismiss this insight"
                                onClick={() => setDismissed((prev) => new Set(prev).add(insight.id))}
                                className="h-6 w-6 shrink-0 rounded text-neutral-400 hover:bg-neutral-200 hover:text-neutral-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                            >
                                <Icon path={ICONS.close} className="mx-auto h-3.5 w-3.5" />
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
};

export default InsightsPanel;
