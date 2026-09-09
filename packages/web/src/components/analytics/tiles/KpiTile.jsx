import { useAnalyticsMeta } from '../../../hooks/useAnalyticsMeta';

/**
 * A single figure. Deliberately not a one-bar chart: a lone value has no
 * magnitudes to compare, so a bar adds ink and no information.
 *
 * The comparison is stated in words ("vs previous 30 days"), never as a bare
 * arrow — an arrow tells you the direction of a change without telling you what
 * it is a change from.
 */
const directionClass = (delta, direction) => {
    if (delta === null || delta === undefined || delta === 0 || direction === 'neutral') {
        return 'text-neutral-500 dark:text-slate-400';
    }
    const good = direction === 'lower_is_better' ? delta < 0 : delta > 0;
    return good ? 'text-success-600 dark:text-success-500' : 'text-danger-600 dark:text-danger-500';
};

const KpiTile = ({ spec, data }) => {
    const { metric, format, formatCompact } = useAnalyticsMeta();
    const metricId = spec.display?.value || spec.query.metrics[0];
    const def = metric(metricId);
    const row = data?.totals;
    const value = row?.values?.[metricId] ?? null;
    const hero = spec.display?.emphasis === 'hero';

    const compare = row?.compare;
    const showCompare = spec.display?.compare?.show !== false && compare?.available;
    const delta = compare?.delta?.[metricId] ?? null;
    const deltaPct = compare?.deltaPct?.[metricId] ?? null;

    const components = spec.display?.components;
    const componentIds = components?.metrics || def?.components?.map((c) => c.metric) || [];

    return (
        <div>
            <p className={`tnum font-semibold text-neutral-900 dark:text-slate-50 ${hero ? 'text-4xl' : 'text-2xl'}`}>
                {hero ? formatCompact(metricId, value) : format(metricId, value)}
            </p>

            {showCompare && (
                <p className={`mt-1 text-xs ${directionClass(delta, def?.direction)}`}>
                    <span className="tnum font-medium">
                        {delta > 0 ? '+' : ''}{format(metricId, delta)}
                    </span>
                    {deltaPct !== null && (
                        <span className="tnum"> ({deltaPct > 0 ? '+' : ''}{deltaPct.toFixed(1)}%)</span>
                    )}
                    <span className="text-neutral-500 dark:text-slate-400"> {data?.meta?.compare?.label}</span>
                </p>
            )}

            {spec.display?.compare?.show && compare && !compare.available && (
                // Twelve months of history means most year-on-year comparisons have
                // nothing behind them. Saying so beats a -100% that reads as collapse.
                <p className="mt-1 text-xs text-neutral-400 dark:text-slate-500">
                    No comparable earlier period
                </p>
            )}

            {spec.display?.asOf === 'now' && (
                <p className="mt-1 text-xs text-neutral-400 dark:text-slate-500">
                    As of now — not affected by the date range
                </p>
            )}

            {componentIds.length > 0 && components?.show === 'always' && (
                <p className="mt-2 tnum text-xs text-neutral-500 dark:text-slate-400">
                    {componentIds.map((id, i) => {
                        const raw = row?.values?.[id] ?? row?.components?.[id] ?? null;
                        const sign = def?.components?.find((c) => c.metric === id)?.sign ?? 1;
                        return (
                            <span key={id}>
                                {i > 0 ? (sign === -1 ? ' − ' : ' + ') : ''}
                                {formatCompact(id, raw)} {metric(id)?.label?.toLowerCase()}
                            </span>
                        );
                    })}
                </p>
            )}
        </div>
    );
};

export default KpiTile;
