import { useEffect } from 'react';
import { runCatalogSync } from './catalogSync';

/**
 * Refreshes the local catalogue whenever the server comes back into reach, and
 * periodically while it stays reachable.
 *
 * The reconnect trigger alone only fires on an edge: useServerReachability's
 * `isOnline` is a boolean that stops changing once the phone settles into
 * "online," so a shift spent continuously connected would otherwise sync once
 * at login and never again -- a price change made on a desktop terminal
 * wouldn't reach that phone until something actually knocked it offline. The
 * interval below is what keeps a long connected session current instead of
 * relying on a connectivity blip to do it.
 *
 * No foreground listener of its own: useServerReachability already re-probes
 * when the app returns to the foreground, so reacting to `isOnline` picks that
 * up for free rather than racing a second trigger against it. Overlapping
 * calls are harmless -- runCatalogSync no-ops while a run is already in
 * flight (see the `running` guard in catalogSync.ts).
 */
const PERIODIC_SYNC_MS = 5 * 60 * 1000;

export function useCatalogSync(isOnline: boolean) {
    useEffect(() => {
        if (!isOnline) return;
        runCatalogSync();
        const timer = setInterval(runCatalogSync, PERIODIC_SYNC_MS);
        return () => clearInterval(timer);
    }, [isOnline]);
}

export default useCatalogSync;
