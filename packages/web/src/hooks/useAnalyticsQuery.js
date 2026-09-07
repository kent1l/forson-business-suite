import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAnalyticsBatch } from '../components/analytics/AnalyticsBatchContext';

/**
 * Resolve a tile's query spec against the board's current state and fetch it
 * through the batch.
 *
 * `$dateRange.from`, `$filters.brand` and friends are a closed macro vocabulary
 * resolved here — a substitution table, not an expression language. A board spec
 * cannot become a place where arbitrary code runs.
 */
const resolveMacro = (token, boardState) => {
    if (typeof token !== 'string' || !token.startsWith('$')) return token;
    const path = token.slice(1).split('.');
    if (path[0] === 'dateRange') return boardState.dateRange?.[path[1]] ?? null;
    if (path[0] === 'filters') return boardState.filters?.[path[1]] ?? null;
    if (path[0] === 'grain') return boardState.grain ?? null;
    return null;
};

export const resolveParams = (params, boardState) => {
    const out = {};
    for (const [key, value] of Object.entries(params || {})) {
        out[key] = Array.isArray(value)
            ? value.map((v) => resolveMacro(v, boardState))
            : resolveMacro(value, boardState);
    }
    return out;
};

/**
 * Merge a tile's declared query with the board's date range, filters and
 * comparison. The tile owns what it measures; the board owns when and over what.
 */
export const buildRequestBody = (querySpec, boardState) => {
    const body = {
        metrics: querySpec.metrics,
        dimensions: querySpec.dimensions || [],
        grain: resolveGrain(querySpec, boardState),
        dateRange: boardState.dateRange,
        filters: { ...(boardState.filters || {}), ...resolveParams(querySpec.filters, boardState) },
        sort: querySpec.sort || null,
        limit: querySpec.limit || null,
    };
    // A tile opts into comparison; the board can only turn one off, never on, so
    // a snapshot tile is never asked for a comparison it cannot answer.
    if (querySpec.compare && boardState.compare) body.compare = querySpec.compare;
    return body;
};

/**
 * How fine a trend to draw for a given period.
 *
 * A tile that hard-codes `grain: 'month'` plots two points when the board is on
 * "last 30 days" — a line between two dots, which says nothing. A tile declares
 * `grain: 'auto'` and gets a grain that suits the range instead. `minGrain`
 * stops a tile that is only legible at a coarse grain (a per-period summary
 * table) from expanding into thirty daily rows.
 */
const COARSENESS = ['day', 'week', 'month', 'quarter'];

const AUTO_GRAIN = {
    today: 'day',
    yesterday: 'day',
    last_7_days: 'day',
    last_30_days: 'day',
    this_month: 'day',
    last_month: 'day',
    last_90_days: 'week',
    this_quarter: 'week',
    year_to_date: 'month',
    last_12_months: 'month',
};

export const resolveGrain = (querySpec, boardState) => {
    if (querySpec.grain !== 'auto') return querySpec.grain ?? null;
    const auto = AUTO_GRAIN[boardState.dateRange?.preset] || 'month';
    const floor = querySpec.minGrain;
    if (!floor) return auto;
    return COARSENESS.indexOf(auto) >= COARSENESS.indexOf(floor) ? auto : floor;
};

const stableKey = (body) => JSON.stringify(body, Object.keys(body).sort());

export default function useAnalyticsQuery(querySpec, { boardState, skip = false } = {}) {
    const { enqueue } = useAnalyticsBatch();
    const [state, setState] = useState({ data: null, loading: !skip, error: null });
    const [nonce, setNonce] = useState(0);
    const live = useRef(true);

    const body = useMemo(
        () => (querySpec ? buildRequestBody(querySpec, boardState) : null),
        [querySpec, boardState]
    );
    const cacheKey = useMemo(() => (body ? stableKey(body) : null), [body]);

    useEffect(() => {
        live.current = true;
        return () => { live.current = false; };
    }, []);

    useEffect(() => {
        if (skip || !body) {
            setState({ data: null, loading: false, error: null });
            return undefined;
        }
        let current = true;
        setState((s) => ({ ...s, loading: true, error: null }));
        enqueue(`${cacheKey}#${nonce}`, body, { fresh: nonce > 0 })
            .then((data) => { if (current && live.current) setState({ data, loading: false, error: null }); })
            .catch((err) => {
                if (!current || !live.current) return;
                setState({
                    data: null,
                    loading: false,
                    error: err?.response?.data?.message || err?.message || 'Could not load this tile.',
                });
            });
        // A date-range change while a request is in flight must not repaint the
        // tile with the answer to the old question.
        return () => { current = false; };
    }, [enqueue, cacheKey, body, skip, nonce]);

    const refetch = useCallback(() => setNonce((n) => n + 1), []);

    return {
        data: state.data,
        meta: state.data?.meta || null,
        loading: state.loading,
        error: state.error,
        refetch,
    };
}
