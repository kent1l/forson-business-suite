import { useMemo, useState } from 'react';
import { useAnalyticsMeta } from '../../../hooks/useAnalyticsMeta';
import { useSeriesPalette } from '../chartTheme';
import EmptyState from '../../ui/EmptyState';
import CoverageBadge from '../CoverageBadge';

/**
 * Rows and figures, for when there are more meaningful classes than a chart can
 * carry — and for the coverage strip, where the point is the denominator rather
 * than the shape.
 *
 * When a tile asks for per-row coverage, each row states what it was measured
 * over. A month's margin of "—" with "no cost data" beside it says something a
 * blank cell does not.
 *
 * Three things the table does that a plain list of numbers does not:
 *
 * - **A proportion bar behind the ranked column.** The eye reads "twice as long"
 *   far faster than it reads two currency figures, and the bar is drawn as a
 *   share of the largest row rather than of the total, so it stays legible when
 *   one row dominates.
 * - **Client-side re-sorting.** Only over the rows already on screen — the header
 *   says so. Re-sorting cannot fetch a different set, because the set was chosen
 *   by the server's own ranking and quietly changing it would make the 'Other'
 *   row wrong.
 * - **The rollup row is styled and pinned, never sorted away.** 'Other' is a
 *   statement about what is NOT listed, so it stays at the bottom whatever the
 *   reader sorts by.
 */
const TableTile = ({ spec, data, onSelectRow }) => {
    const { metric, format } = useAnalyticsMeta();
    const { other: otherColor, colorFor } = useSeriesPalette();
    const columns = spec.display?.columns || spec.query.metrics;
    const perRowCoverage = spec.display?.coverage?.perRow ? spec.display.coverage.rule : null;
    const showRank = !!spec.display?.rank;
    const barMetric = spec.display?.bar || null;

    // null = the server's own order, which is the order the top-N was chosen by.
    const [sort, setSort] = useState(null);
    const rows = useMemo(() => data?.rows || [], [data]);

    const { body, footer, barMax } = useMemo(() => {
        const rollup = rows.filter((r) => r.rollup);
        const listed = rows.filter((r) => !r.rollup);
        const sorted = sort
            ? [...listed].sort((a, b) => {
                const av = a.values[sort.by];
                const bv = b.values[sort.by];
                if (av === bv) return 0;
                if (av === null || av === undefined) return 1;
                if (bv === null || bv === undefined) return -1;
                return sort.dir === 'ASC' ? av - bv : bv - av;
            })
            : listed;
        const max = barMetric
            ? listed.reduce((m, r) => Math.max(m, Math.abs(Number(r.values[barMetric]) || 0)), 0)
            : 0;
        return { body: sorted, footer: rollup, barMax: max };
    }, [rows, sort, barMetric]);

    if (rows.length === 0) {
        return <EmptyState title="Nothing to show for this period" className="py-8" />;
    }

    const toggleSort = (id) => setSort((current) => {
        if (!current || current.by !== id) return { by: id, dir: 'DESC' };
        if (current.dir === 'DESC') return { by: id, dir: 'ASC' };
        return null;   // third click restores the server's ranking
    });

    const barColor = colorFor(0);
    const nameHeader = rows[0]?.dimensions?.[0]?.id === 'date' ? 'Period' : 'Name';

    const renderRow = (row, index, { isRollup = false } = {}) => {
        const clickable = onSelectRow && !isRollup;
        const share = barMetric && barMax > 0
            ? Math.min(Math.abs(Number(row.values[barMetric]) || 0) / barMax, 1)
            : 0;
        return (
            <tr
                key={`${row.key.join('|')}-${index}`}
                className={[
                    clickable ? 'cursor-pointer hover:bg-neutral-50 dark:hover:bg-slate-700/40' : '',
                    isRollup ? 'text-neutral-500 dark:text-slate-400' : '',
                ].filter(Boolean).join(' ')}
                onClick={clickable ? () => onSelectRow(row) : undefined}
            >
                {showRank && (
                    <td className="tnum py-2 pr-2 text-right text-[11px] text-neutral-400 dark:text-slate-500">
                        {isRollup ? '' : index + 1}
                    </td>
                )}
                <td className="relative py-2 pr-3 text-neutral-800 dark:text-slate-200">
                    {barMetric ? (
                        <span
                            aria-hidden="true"
                            className="absolute inset-y-1 left-0 rounded-sm"
                            style={{
                                width: `${share * 100}%`,
                                background: isRollup ? otherColor : barColor,
                                opacity: 0.14,
                            }}
                        />
                    ) : null}
                    <span className="relative block max-w-[18rem] truncate" title={row.label[0] || ''}>
                        {row.label[0] || '(None)'}
                    </span>
                    {isRollup && row.rollupCount > 0 ? (
                        <span className="relative block text-[11px] text-neutral-400 dark:text-slate-500">
                            {row.rollupCount.toLocaleString()} more, added together
                        </span>
                    ) : null}
                    {perRowCoverage && row.coverage?.[perRowCoverage] ? (
                        <CoverageBadge coverage={row.coverage[perRowCoverage]} className="relative mt-0.5" />
                    ) : null}
                </td>
                {columns.map((id) => (
                    <td key={id} className="tnum py-2 pl-3 text-right whitespace-nowrap">
                        {format(id, row.values[id])}
                    </td>
                ))}
            </tr>
        );
    };

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-neutral-200 text-[11px] uppercase tracking-wide text-neutral-500 dark:border-slate-700 dark:text-slate-400">
                        {showRank && <th className="py-2 pr-2 text-right font-medium">#</th>}
                        <th className="py-2 pr-3 text-left font-medium">{nameHeader}</th>
                        {columns.map((id) => {
                            const active = sort && sort.by === id;
                            return (
                                <th key={id} className="py-2 pl-3 text-right font-medium whitespace-nowrap">
                                    <button
                                        type="button"
                                        onClick={() => toggleSort(id)}
                                        title={`Sort the rows shown by ${metric(id)?.label || id}`}
                                        className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-neutral-700 dark:hover:text-slate-200"
                                    >
                                        {metric(id)?.label || id}
                                        <span aria-hidden="true" className={active ? '' : 'opacity-0'}>
                                            {active && sort.dir === 'ASC' ? '▲' : '▼'}
                                        </span>
                                    </button>
                                </th>
                            );
                        })}
                    </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-slate-700/60">
                    {body.map((row, i) => renderRow(row, i))}
                    {footer.map((row, i) => renderRow(row, i, { isRollup: true }))}
                </tbody>
                <tfoot>
                    <tr className="border-t-2 border-neutral-200 text-neutral-900 dark:border-slate-600 dark:text-slate-100">
                        <td
                            className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide"
                            colSpan={showRank ? 2 : 1}
                        >
                            Total
                        </td>
                        {columns.map((id) => (
                            <td key={id} className="tnum py-2 pl-3 text-right font-semibold whitespace-nowrap">
                                {format(id, data?.totals?.values?.[id])}
                            </td>
                        ))}
                    </tr>
                </tfoot>
            </table>
        </div>
    );
};

export default TableTile;
