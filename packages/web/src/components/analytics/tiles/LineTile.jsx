import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useAnalyticsMeta } from '../../../hooks/useAnalyticsMeta';
import { useChartTheme, useSeriesPalette } from '../chartTheme';
import EmptyState from '../../ui/EmptyState';

/**
 * A trend over time, optionally with the previous period drawn behind it.
 *
 * The comparison series is the SAME measure in a different period, so it is
 * drawn as a muted dashed line rather than given a second categorical hue —
 * colour here would claim these are two different things.
 *
 * The two lines are aligned by ordinal, not by date: point 3 of this period sits
 * above point 3 of the last one. Aligning on the date instead produces nonsense
 * the moment the comparison is a year back.
 */
const LineTile = ({ spec, data }) => {
    const { metric, format, formatCompact } = useAnalyticsMeta();
    const theme = useChartTheme();
    const { colorFor, compare } = useSeriesPalette();

    const metricId = spec.display?.value || spec.query.metrics[0];
    const def = metric(metricId);
    const rows = data?.rows || [];
    const hasCompare = spec.display?.compare?.show !== false && data?.meta?.compare?.available;

    if (rows.length === 0) {
        return <EmptyState title="No activity in this period" icon={undefined} className="py-8" />;
    }

    const chartData = rows.map((row) => ({
        label: row.label[0],
        current: row.values[metricId],
        previous: hasCompare ? (row.compare?.values?.[metricId] ?? null) : null,
    }));

    const currentColor = colorFor(0);

    return (
        <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={theme.grid} vertical={false} />
                    <XAxis
                        dataKey="label" tick={{ fill: theme.tick, fontSize: 11 }}
                        axisLine={{ stroke: theme.grid }} tickLine={false}
                    />
                    <YAxis
                        tick={{ fill: theme.tick, fontSize: 11 }}
                        axisLine={false} tickLine={false} width={56}
                        tickFormatter={(v) => formatCompact(metricId, v)}
                    />
                    <Tooltip
                        cursor={{ stroke: theme.grid }}
                        contentStyle={{
                            background: theme.tooltipBg, borderColor: theme.tooltipBorder,
                            borderRadius: 8, fontSize: 12,
                        }}
                        labelStyle={{ color: theme.tooltipLabel }}
                        formatter={(value, name) => [format(metricId, value), name]}
                    />
                    {hasCompare && <Legend wrapperStyle={{ fontSize: 11, color: theme.tick }} />}
                    {hasCompare && (
                        <Line
                            type="monotone" dataKey="previous" name={data.meta.compare.label}
                            stroke={compare} strokeWidth={2} strokeDasharray="4 4"
                            dot={false} activeDot={{ r: 4 }} connectNulls
                        />
                    )}
                    <Line
                        type="monotone" dataKey="current" name={def?.label || metricId}
                        stroke={currentColor} strokeWidth={2}
                        dot={{ r: 3, strokeWidth: 0, fill: currentColor }}
                        activeDot={{ r: 5 }} connectNulls
                    />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default LineTile;
