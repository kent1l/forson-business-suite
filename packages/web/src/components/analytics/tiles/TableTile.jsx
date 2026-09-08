import { useAnalyticsMeta } from '../../../hooks/useAnalyticsMeta';
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
 */
const TableTile = ({ spec, data, onSelectRow }) => {
    const { metric, format } = useAnalyticsMeta();
    const rows = data?.rows || [];
    const columns = spec.display?.columns || spec.query.metrics;
    const perRowCoverage = spec.display?.coverage?.perRow ? spec.display.coverage.rule : null;

    if (rows.length === 0) {
        return <EmptyState title="Nothing to show for this period" className="py-8" />;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-neutral-200 text-[11px] uppercase tracking-wide text-neutral-500 dark:border-slate-700 dark:text-slate-400">
                        <th className="py-2 pr-3 text-left font-medium">
                            {rows[0]?.dimensions?.[0]?.id === 'date' ? 'Period' : 'Name'}
                        </th>
                        {columns.map((id) => (
                            <th key={id} className="py-2 pl-3 text-right font-medium whitespace-nowrap">
                                {metric(id)?.label || id}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100 dark:divide-slate-700/60">
                    {rows.map((row, i) => (
                        <tr
                            key={`${row.key.join('|')}-${i}`}
                            className={onSelectRow ? 'cursor-pointer hover:bg-neutral-50 dark:hover:bg-slate-700/40' : ''}
                            onClick={onSelectRow ? () => onSelectRow(row) : undefined}
                        >
                            <td className="py-2 pr-3 text-neutral-800 dark:text-slate-200">
                                <span className="block max-w-[15rem] truncate" title={row.label[0] || ''}>
                                    {row.label[0] || '(None)'}
                                </span>
                                {perRowCoverage && row.coverage?.[perRowCoverage] ? (
                                    <CoverageBadge coverage={row.coverage[perRowCoverage]} className="mt-0.5" />
                                ) : null}
                            </td>
                            {columns.map((id) => (
                                <td key={id} className="tnum py-2 pl-3 text-right text-neutral-800 dark:text-slate-200 whitespace-nowrap">
                                    {format(id, row.values[id])}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr className="border-t-2 border-neutral-200 text-neutral-900 dark:border-slate-600 dark:text-slate-100">
                        <td className="py-2 pr-3 text-xs font-semibold uppercase tracking-wide">Total</td>
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
