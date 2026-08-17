import { useEffect } from 'react';
import { runCatalogSync } from './catalogSync';

/**
 * Refreshes the local catalogue whenever the server comes back into reach.
 *
 * No foreground listener of its own: useServerReachability already re-probes
 * when the app returns to the foreground, so reacting to `isOnline` picks that
 * up for free rather than racing a second trigger against it.
 */
export function useCatalogSync(isOnline: boolean) {
    useEffect(() => {
        if (!isOnline) return;
        runCatalogSync();
    }, [isOnline]);
}

export default useCatalogSync;
