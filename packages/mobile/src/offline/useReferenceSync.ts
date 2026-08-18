import { useEffect } from 'react';
import { runReferenceSync } from './referenceSync';

/**
 * Refreshes the cached POS reference lists (payment methods, active
 * customers, tax rates) whenever the server comes back into reach, and
 * periodically while it stays reachable -- same trigger shape as
 * useCatalogSync, for the same reason: an edge-only trigger would leave a
 * continuously-connected phone stuck with whatever it saw at login, so a
 * customer added or deactivated on a desktop terminal wouldn't reach it
 * until something knocked it offline first.
 */
const PERIODIC_SYNC_MS = 5 * 60 * 1000;

export function useReferenceSync(isOnline: boolean) {
    useEffect(() => {
        if (!isOnline) return;
        runReferenceSync();
        const timer = setInterval(runReferenceSync, PERIODIC_SYNC_MS);
        return () => clearInterval(timer);
    }, [isOnline]);
}

export default useReferenceSync;
