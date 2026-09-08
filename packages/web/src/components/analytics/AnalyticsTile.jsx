import toast from 'react-hot-toast';
import api from '../../api';
import { useAnalyticsMeta } from '../../hooks/useAnalyticsMeta';
import useAnalyticsQuery, { buildRequestBody, resolveParams } from '../../hooks/useAnalyticsQuery';
import TileShell from './TileShell';
import NoDataYet from './NoDataYet';
import KpiTile from './tiles/KpiTile';
import LineTile from './tiles/LineTile';
import BarTile from './tiles/BarTile';
import TableTile from './tiles/TableTile';
import HeatmapTile from './tiles/HeatmapTile';

const TILE_TYPES = {
    kpi: KpiTile, line: LineTile, bar: BarTile, table: TableTile, heatmap: HeatmapTile,
};

/**
 * The whole dispatch. A board spec names a type and a metric; everything else —
 * label, format, direction, description, coverage explanation — is looked up
 * from /meta. That is what makes adding a metric to a board one registry entry
 * and one board entry, with no new React component.
 *
 * An unknown tile type renders nothing rather than crashing: a newer server can
 * ship a type this build has never heard of, and a blank tile beats a blank page.
 */
const AnalyticsTile = ({ spec, boardState, onNavigate, canExport }) => {
    const { metric, readiness } = useAnalyticsMeta();

    const primaryId = spec.display?.value || spec.query.metrics[0];
    const primary = metric(primaryId);
    // Every metric on the tile has to be available, not just the headline one:
    // a composite is only as ready as its least-ready component.
    const ready = spec.query.metrics.every((id) => {
        const gate = metric(id)?.readiness;
        return !gate || readiness[gate];
    });

    const { data, meta, loading, error, refetch } = useAnalyticsQuery(spec.query, {
        boardState,
        skip: !ready,
    });

    const Body = TILE_TYPES[spec.type];
    if (!Body) return null;

    const coverageRule = spec.display?.coverage?.show && !spec.display?.coverage?.perRow
        ? spec.display.coverage.rule
        : null;
    const coverage = coverageRule ? data?.coverage?.[coverageRule] : null;

    const drilldown = spec.drilldown;
    const navigateTo = (page, params) => {
        if (onNavigate) onNavigate(page, params);
    };

    // The actions-menu drilldown belongs to the whole tile, so it resolves with
    // no row: a `$row.*` macro yields null rather than whatever was hovered.
    const onDrilldown = drilldown?.kind === 'page' && onNavigate
        ? () => navigateTo(drilldown.page, resolveParams(drilldown.params, boardState, null))
        : null;

    // A click on a row either narrows the board or leaves it. The 'Other' row
    // does neither: it is a summary of what is not listed, so there is nothing
    // to filter to and nothing to open.
    const onSelectRow = drilldown?.kind === 'filter'
        ? (row) => { if (row && !row.rollup) boardState.onAddFilter?.(drilldown.dimension, row.key?.[0]); }
        : (drilldown?.kind === 'page' && onNavigate
            // The row is passed through so a drilldown can resolve `$row.label`
            // and land on the part the reader actually clicked.
            ? (row) => { if (!row?.rollup) navigateTo(drilldown.page, resolveParams(drilldown.params, boardState, row)); }
            : null);

    const onExportCsv = canExport && spec.type !== 'kpi'
        ? async () => {
            try {
                const res = await api.post(
                    '/analytics/query',
                    { ...buildRequestBody(spec.query, boardState), format: 'csv' },
                    { responseType: 'blob' }
                );
                const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv' }));
                const link = document.createElement('a');
                link.href = url;
                link.download = `${spec.id}.csv`;
                link.click();
                URL.revokeObjectURL(url);
            } catch {
                toast.error('Could not export this tile.');
            }
        }
        : null;

    return (
        <TileShell
            title={spec.title ?? primary?.label ?? primaryId}
            help={spec.help ?? primary?.description}
            span={spec.span}
            centerBody={spec.display?.emphasis === 'hero'}
            loading={ready && loading}
            error={ready ? error : null}
            onRetry={refetch}
            coverage={coverage}
            truncated={meta?.truncated}
            rollup={meta?.rollup}
            cached={meta?.cached}
            cacheAgeMs={meta?.cacheAgeMs}
            actions={{
                onRefresh: ready ? refetch : null,
                onExportCsv,
                onDrilldown,
                drilldownLabel: drilldown?.kind === 'page' ? 'Open in page' : null,
                onFixData: onNavigate ? () => navigateTo('cost_data_health', {}) : null,
            }}
        >
            {ready
                ? <Body spec={spec} data={data} meta={meta} onSelectRow={onSelectRow} />
                : <NoDataYet metric={primary} />}
        </TileShell>
    );
};

export default AnalyticsTile;
