import apiClient from '../api/client';
import { cacheList } from './referenceCache';

/**
 * Keeps payment methods, active customers, and tax rates warm in
 * referenceCache.ts *before* checkout needs them offline.
 *
 * pos-settlement.tsx originally only cached these on its own mount, which
 * meant the cache stayed empty until a cashier had successfully opened
 * checkout at least once while online. A phone that went offline before that
 * first visit -- the common case right after a fresh login or app restart --
 * had nothing to fall back to: no payment methods, no customers, and because
 * the tendered-amount card only renders once a payment method is selected,
 * checkout looked like it was missing fields rather than merely offline.
 *
 * Mirrors catalogSync.ts's shape (best-effort, no user-visible state) rather
 * than useCatalogSyncStore's, because these lists are small and have no
 * incremental/cursor protocol worth building -- refetching all three in full
 * is cheap enough to just repeat on every sync.
 */
export const runReferenceSync = async (): Promise<void> => {
    const [pmRes, custRes, taxRes] = await Promise.allSettled([
        apiClient.get('/payment-methods/enabled'),
        apiClient.get('/customers?status=active'),
        apiClient.get('/tax-rates'),
    ]);

    if (pmRes.status === 'fulfilled') await cacheList('payment_methods', pmRes.value.data || []);
    if (custRes.status === 'fulfilled') await cacheList('customers', custRes.value.data || []);
    if (taxRes.status === 'fulfilled') await cacheList('tax_rates', taxRes.value.data || []);
};

export default runReferenceSync;
