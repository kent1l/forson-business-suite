import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import api from '../api';

/**
 * The metric catalogue, fetched once and shared.
 *
 * This is the mechanism behind "adding a metric to a board is one registry entry
 * and one board-spec entry". A tile spec never carries a label, a format, a
 * unit, a direction or a colour — it carries a metric id, and everything else is
 * looked up here from what the server declared. A board spec that repeated any
 * of it would be a second place to change a definition, and the second place is
 * the one that goes stale.
 */
const AnalyticsMetaContext = createContext(null);

const FALLBACK_FORMAT = { numeric: true, decimals: 2, prefix: '', suffix: '' };

export const AnalyticsMetaProvider = ({ children }) => {
    const [meta, setMeta] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const load = useCallback(() => {
        setLoading(true);
        setError(null);
        api.get('/analytics/meta')
            .then((res) => setMeta(res.data))
            .catch((err) => setError(err?.response?.data?.message || 'Could not load the metric catalogue.'))
            .finally(() => setLoading(false));
    }, []);

    useEffect(load, [load]);

    const value = useMemo(() => {
        const byId = new Map((meta?.metrics || []).map((m) => [m.id, m]));
        const dimensionsById = new Map((meta?.dimensions || []).map((d) => [d.id, d]));
        return {
            meta,
            loading,
            error,
            reload: load,
            metric: (id) => byId.get(id) || null,
            dimension: (id) => dimensionsById.get(id) || null,
            readiness: meta?.readiness || {},
            // The server's own wording for "why is this blank", keyed by probe.
            readinessMessage: (id) => (meta?.readinessInfo || {})[id]?.message || null,
            presets: meta?.presets || [],
            trustRule: (id) => (meta?.trustRules || []).find((r) => r.id === id) || null,
            format: (metricId, value) => formatValue(meta, metricId, value),
            formatCompact: (metricId, value) => formatValue(meta, metricId, value, { compact: true }),
            // For the few values that are not a metric — an insight's "up"/"down",
            // or a percentage derived in a rule rather than declared as a metric.
            formatBy: (formatId, value) => formatByFormat(meta, formatId, value),
        };
    }, [meta, loading, error, load]);

    return <AnalyticsMetaContext.Provider value={value}>{children}</AnalyticsMetaContext.Provider>;
};

export const useAnalyticsMeta = () => {
    const ctx = useContext(AnalyticsMetaContext);
    if (!ctx) throw new Error('useAnalyticsMeta must be used inside an AnalyticsMetaProvider');
    return ctx;
};

/**
 * Formatting is driven entirely by the metric's declared format.
 *
 * `null` renders as an em dash and never as 0. Throughout this module null means
 * "not measured", which is a different statement from zero and must not be shown
 * as one — a margin of "—" reads as "we do not know", a margin of "₱0.00" reads
 * as "we made nothing".
 */
export function formatValue(meta, metricId, value, { compact = false } = {}) {
    const metric = (meta?.metrics || []).find((m) => m.id === metricId);
    return formatByFormat(meta, metric?.format, value, { compact });
}

/** The same rules, addressed by format id rather than by metric id. */
export function formatByFormat(meta, formatId, value, { compact = false } = {}) {
    if (value === null || value === undefined) return '—';
    const format = (meta?.formats || {})[formatId] || FALLBACK_FORMAT;
    if (!format.numeric) return String(value);

    const n = Number(value);
    if (!Number.isFinite(n)) return '—';

    if (compact && format.compactable && Math.abs(n) >= 1000) {
        const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'K']];
        const [divisor, suffix] = units.find(([d]) => Math.abs(n) >= d);
        const scaled = n / divisor;
        return `${format.prefix}${scaled.toFixed(Math.abs(scaled) >= 100 ? 0 : 1)}${suffix}${format.suffix}`;
    }

    return `${format.prefix}${n.toLocaleString(undefined, {
        minimumFractionDigits: format.decimals,
        maximumFractionDigits: format.decimals,
    })}${format.suffix}`;
}

export default useAnalyticsMeta;
