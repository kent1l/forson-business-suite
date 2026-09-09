import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useAnalyticsMeta } from '../../../hooks/useAnalyticsMeta';
import { useChartTheme, useSeriesPalette } from '../chartTheme';
import EmptyState from '../../ui/EmptyState';

/**
 * Magnitude across categories, drawn horizontally.
 *
 * Horizontal because the categories here are brand and part names — long, and
 * unreadable rotated 45 degrees under a vertical axis.
 *
 * One measure means one hue, not a rainbow: colour that varies with rank tells
 * the reader nothing the bar length has not already said, and repaints itself
 * the moment a filter changes the order.
 */
const BarTile = ({ spec, data, onSelectRow }) => {
    const { metric, format, formatCompact } = useAnalyticsMeta();
    const theme = useChartTheme();
    const { colorFor, other } = useSeriesPalette();

    const metricId = spec.display?.value || spec.query.metrics[0];
    const def = metric(metricId);
    const rows = data?.rows || [];

    if (rows.length === 0) {
        return <EmptyState title="Nothing to show for this period" className="py-8" />;
    }

    const chartData = rows.map((row) => ({
        key: row.key[0],
        // The folded tail says how much it stands for. A grey bar labelled only
        // "Other" invites the reader to ignore it; on this catalogue it is often
        // the largest bar on the chart.
        label: row.rollup && row.rollupCount > 1
            ? `Other (${row.rollupCount.toLocaleString()})`
            : (row.label[0] ?? '(None)'),
        value: row.values[metricId],
        // Read off the server's flag, never the label: a brand genuinely named
        // "Other" is a category like any other and keeps its own colour.
        rollup: !!row.rollup,
        // The analytics row itself rides along, because `onSelectRow` is the
        // same contract the table uses and its consumers read `key` and `label`
        // as arrays. Handing them this flattened chart datum instead would make
        // a `$row.label` drilldown resolve to the first CHARACTER of the label.
        row,
    }));

    const height = Math.max(180, chartData.length * 34);
    const barColor = colorFor(0);

    return (
        <div className="w-full overflow-x-auto">
            <div style={{ height }}>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData} layout="vertical" margin={{ top: 4, right: 56, bottom: 4, left: 4 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} horizontal={false} />
                        <XAxis
                            type="number" hide
                            tickFormatter={(v) => formatCompact(metricId, v)}
                        />
                        <YAxis
                            type="category" dataKey="label" width={150}
                            tick={{ fill: theme.tick, fontSize: 11 }}
                            axisLine={false} tickLine={false}
                            tickFormatter={(v) => (v.length > 24 ? `${v.slice(0, 23)}…` : v)}
                        />
                        <Tooltip
                            cursor={{ fill: theme.grid, fillOpacity: 0.25 }}
                            contentStyle={{
                                background: theme.tooltipBg, borderColor: theme.tooltipBorder,
                                borderRadius: 8, fontSize: 12,
                            }}
                            labelStyle={{ color: theme.tooltipLabel }}
                            formatter={(value) => [format(metricId, value), def?.label || metricId]}
                        />
                        <Bar
                            dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}
                            // 'Other' is not a category, so it is not something a
                            // reader can filter down into.
                            onClick={onSelectRow ? (entry) => { if (!entry.rollup) onSelectRow(entry.row); } : undefined}
                            cursor={onSelectRow ? 'pointer' : 'default'}
                            label={{
                                position: 'right', fontSize: 11, fill: theme.tick,
                                formatter: (v) => formatCompact(metricId, v),
                            }}
                        >
                            {chartData.map((entry) => (
                                <Cell key={entry.key ?? entry.label} fill={entry.rollup ? other : barColor} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};

export default BarTile;
