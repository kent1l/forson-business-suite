import { createContext, useContext, useCallback, useMemo, useRef } from 'react';
import api from '../../api';

/**
 * Collects every tile's query during a render and flushes them as one request.
 *
 * This is not a micro-optimisation. `protect` performs a JWT verify AND a joined
 * query against employee/role_permission/permission on every request, so a
 * 12-tile board rendered as 12 requests costs 12 extra auth queries and 12 pool
 * checkouts before any analytics work begins — on a database the point-of-sale
 * counter is also using.
 *
 * Identical specs are deduped, which is what lets several KPI tiles share one
 * query and pick their own figure out of the shared answer.
 */
const BatchContext = createContext(null);

const MAX_PER_BATCH = 12;

export const AnalyticsBatchProvider = ({ children }) => {
    const pending = useRef(new Map());   // cacheKey -> { body, resolvers: [] }
    const scheduled = useRef(false);
    const inFlight = useRef(new Set());

    const flush = useCallback(async () => {
        scheduled.current = false;
        const batch = [...pending.current.entries()];
        pending.current = new Map();
        if (batch.length === 0) return;

        // The server caps a batch, and one board can legitimately exceed it.
        // A tile asking for fresh data goes in its own group, so one Refresh
        // click does not bypass the cache for the whole board.
        const chunks = [];
        for (const fresh of [false, true]) {
            const group = batch.filter(([, entry]) => !!entry.fresh === fresh);
            for (let i = 0; i < group.length; i += MAX_PER_BATCH) {
                chunks.push({ fresh, entries: group.slice(i, i + MAX_PER_BATCH) });
            }
        }

        await Promise.all(chunks.map(async ({ fresh, entries: chunk }) => {
            const controller = new AbortController();
            inFlight.current.add(controller);
            try {
                const { data } = await api.post(
                    fresh ? '/analytics/batch?fresh=1' : '/analytics/batch',
                    { queries: chunk.map(([key, entry]) => ({ key, ...entry.body })) },
                    { signal: controller.signal }
                );
                chunk.forEach(([key, entry]) => {
                    const result = data.results?.[key];
                    if (!result) {
                        entry.reject(new Error('The server returned no result for this tile.'));
                    } else if (result.error) {
                        const err = new Error(result.error.message);
                        err.status = result.error.status;
                        err.details = result.error.details;
                        entry.reject(err);
                    } else {
                        entry.resolve(result);
                    }
                });
            } catch (err) {
                if (!controller.signal.aborted) chunk.forEach(([, entry]) => entry.reject(err));
            } finally {
                inFlight.current.delete(controller);
            }
        }));
    }, []);

    const enqueue = useCallback((cacheKey, body, { fresh = false } = {}) => new Promise((resolve, reject) => {
        const existing = pending.current.get(cacheKey);
        if (existing) {
            // Two tiles asking the same question get the same answer, once.
            const prevResolve = existing.resolve;
            const prevReject = existing.reject;
            existing.resolve = (v) => { prevResolve(v); resolve(v); };
            existing.reject = (e) => { prevReject(e); reject(e); };
            return;
        }
        pending.current.set(cacheKey, { body, fresh, resolve, reject });
        if (!scheduled.current) {
            scheduled.current = true;
            // A microtask, so every tile mounted in this render lands in one batch.
            queueMicrotask(flush);
        }
    }), [flush]);

    const abortAll = useCallback(() => {
        inFlight.current.forEach((c) => c.abort());
        inFlight.current.clear();
    }, []);

    const value = useMemo(() => ({ enqueue, abortAll }), [enqueue, abortAll]);
    return <BatchContext.Provider value={value}>{children}</BatchContext.Provider>;
};

export const useAnalyticsBatch = () => {
    const ctx = useContext(BatchContext);
    if (!ctx) throw new Error('useAnalyticsBatch must be used inside an AnalyticsBatchProvider');
    return ctx;
};

export default AnalyticsBatchProvider;
