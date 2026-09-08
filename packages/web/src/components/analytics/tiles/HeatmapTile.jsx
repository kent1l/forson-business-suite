import { useMemo, useState } from 'react';
import { useAnalyticsMeta } from '../../../hooks/useAnalyticsMeta';
import { useSequentialPalette } from '../chartTheme';
import EmptyState from '../../ui/EmptyState';

/**
 * Magnitude across two categorical axes — the hour x weekday staffing view.
 *
 * Built from plain elements rather than a charting library. A heatmap is a grid
 * of rectangles with a colour scale; recharts has no such mark, and reaching for
 * a second charting dependency to draw one would cost more than it saves.
 *
 * Three decisions worth keeping:
 *
 * - **A cell with no data is neutral, not the palest step of the ramp.** On this
 *   chart "we were shut" and "we were open and sold almost nothing" lead to
 *   opposite staffing decisions, so they cannot be two shades of one colour.
 * - **No number in every cell.** 7 x 12 printed figures is a table wearing a
 *   chart's clothes; the value is on hover, and the caption under the grid
 *   carries it in words.
 * - **Columns run from the first to the last hour that traded**, so a shop open
 *   9-5 does not draw sixteen empty columns — but a genuinely dead hour INSIDE
 *   the trading day keeps its column, because that gap is the finding.
 */

// Monday first. The server returns the ISO weekday as the key, so the order is
// the key order and needs no lookup table of its own.
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 7];

const HeatmapTile = ({ spec, data }) => {
    const { metric, format, formatCompact } = useAnalyticsMeta();
    const { ramp, empty, stepFor } = useSequentialPalette();
    const [hovered, setHovered] = useState(null);

    const valueId = spec.display?.value || spec.query.metrics[0];
    const secondaryId = spec.display?.secondary || null;
    const rowDimId = spec.display?.rows;
    const colDimId = spec.display?.columns;
    const rows = useMemo(() => data?.rows || [], [data]);

    const grid = useMemo(() => {
        const cells = new Map();          // `${rowKey}|${colKey}` -> row
        const rowLabels = new Map();      // rowKey -> label
        const colKeys = new Set();
        let max = 0;

        for (const row of rows) {
            const rowDim = row.dimensions.find((d) => d.id === rowDimId);
            const colDim = row.dimensions.find((d) => d.id === colDimId);
            if (!rowDim || !colDim) continue;
            cells.set(`${rowDim.key}|${colDim.key}`, row);
            rowLabels.set(rowDim.key, rowDim.label);
            colKeys.add(Number(colDim.key));
            const v = Number(row.values[valueId]);
            if (Number.isFinite(v) && v > max) max = v;
        }

        // The trading window, not the whole 24 hours — but every hour inside it,
        // so a dead hour between two busy ones is visible as a gap.
        const sorted = [...colKeys].sort((a, b) => a - b);
        const columns = sorted.length
            ? Array.from({ length: sorted[sorted.length - 1] - sorted[0] + 1 }, (_, i) => sorted[0] + i)
            : [];

        const orderedRows = WEEKDAY_ORDER.filter((k) => rowLabels.has(k));
        // A row dimension that is not the weekday still renders: fall back to the
        // order the server returned rather than dropping every row.
        const rowKeys = orderedRows.length === rowLabels.size && orderedRows.length > 0
            ? orderedRows
            : [...rowLabels.keys()];

        return { cells, rowLabels, rowKeys, columns, max };
    }, [rows, rowDimId, colDimId, valueId]);

    if (rows.length === 0 || grid.columns.length === 0) {
        return <EmptyState title="No activity in this period" className="py-8" />;
    }

    const colLabel = (key) => String(key).padStart(2, '0');
    const caption = hovered
        ? `${hovered.rowLabel} ${colLabel(hovered.col)} · ${format(valueId, hovered.value)}`
            + (secondaryId && hovered.secondary !== null && hovered.secondary !== undefined
                ? ` · ${format(secondaryId, hovered.secondary)} ${(metric(secondaryId)?.label || '').toLowerCase()}`
                : '')
        : null;

    return (
        <div className="w-full">
            <div className="overflow-x-auto">
                <table className="border-separate" style={{ borderSpacing: 2 }}>
                    <thead>
                        <tr>
                            <th className="sr-only">{metric(valueId)?.label || valueId}</th>
                            {grid.columns.map((col) => (
                                <th
                                    key={col}
                                    scope="col"
                                    className="pb-1 text-[10px] font-normal tabular-nums text-neutral-400 dark:text-slate-500"
                                >
                                    {colLabel(col)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {grid.rowKeys.map((rowKey) => (
                            <tr key={rowKey}>
                                <th
                                    scope="row"
                                    className="pr-2 text-right text-[11px] font-normal text-neutral-500 dark:text-slate-400"
                                >
                                    {grid.rowLabels.get(rowKey)}
                                </th>
                                {grid.columns.map((col) => {
                                    const cell = grid.cells.get(`${rowKey}|${col}`);
                                    const value = cell ? cell.values[valueId] : null;
                                    const color = stepFor(value, grid.max) || empty;
                                    const label = `${grid.rowLabels.get(rowKey)} ${colLabel(col)}: ${
                                        cell ? format(valueId, value) : 'nothing sold'}`;
                                    return (
                                        <td key={col} className="p-0">
                                            <div
                                                title={label}
                                                aria-label={label}
                                                onMouseEnter={() => setHovered({
                                                    rowLabel: grid.rowLabels.get(rowKey),
                                                    col,
                                                    value,
                                                    secondary: secondaryId && cell ? cell.values[secondaryId] : null,
                                                })}
                                                onMouseLeave={() => setHovered(null)}
                                                className="h-7 w-8 rounded-[3px] transition-transform hover:scale-105"
                                                style={{ background: color }}
                                            />
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                {/* Colour IS the encoding here, so the scale is not optional. */}
                <div className="flex items-center gap-2 text-[11px] text-neutral-500 dark:text-slate-400">
                    <span>Nothing</span>
                    <span className="inline-block h-3 w-4 rounded-[2px] border border-neutral-200 dark:border-slate-700" style={{ background: empty }} />
                    <span className="mx-1 h-px w-2 bg-neutral-200 dark:bg-slate-700" />
                    <span>0</span>
                    {ramp.map((step) => (
                        <span key={step} className="inline-block h-3 w-4 rounded-[2px]" style={{ background: step }} />
                    ))}
                    <span className="tabular-nums">{formatCompact(valueId, grid.max)}</span>
                </div>
                <p className="min-h-[1rem] text-[11px] tabular-nums text-neutral-600 dark:text-slate-300">
                    {caption}
                </p>
            </div>
        </div>
    );
};

export default HeatmapTile;
