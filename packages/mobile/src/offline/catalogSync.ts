import { create } from 'zustand';
import type * as SQLite from 'expo-sqlite';
import apiClient from '../api/client';
import { openCatalogDb, readCatalogMeta, type CatalogSyncPart } from './catalogDb';

/**
 * Pulls the server's catalogue down onto the phone and keeps it current.
 *
 * The mirror image of the outbox: that queue pushes writes up when the server
 * returns, this pulls reference data down. Unlike the outbox it holds nothing
 * the user would lose, so it can fail loudly and simply retry.
 *
 * Progress is tracked in a store rather than SQLite because it is only ever
 * used to render a banner. The state that actually matters -- how far the
 * local copy has caught up -- lives in catalog_meta, beside the data it
 * describes, so the two cannot drift apart.
 */

const PAGE_SIZE = 500;

type SyncStatus = 'idle' | 'bootstrapping' | 'syncing' | 'error';

type CatalogSyncState = {
    status: SyncStatus;
    /** Rows written so far during a bootstrap; null outside one. */
    progress: number | null;
    lastError: string | null;
    lastSyncedAt: string | null;
    setState: (patch: Partial<CatalogSyncState>) => void;
};

export const useCatalogSyncStore = create<CatalogSyncState>((set) => ({
    status: 'idle',
    progress: null,
    lastError: null,
    lastSyncedAt: null,
    setState: (patch) => set(patch),
}));

type BootstrapResponse = {
    parts: CatalogSyncPart[];
    next_cursor: number;
    has_more: boolean;
    sync_cursor?: number;
};

type DeltaResponse = {
    parts: CatalogSyncPart[];
    deleted_part_ids: number[];
    next_since: number;
    has_more: boolean;
};

const toNumber = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
};

const upsertPart = async (db: SQLite.SQLiteDatabase, part: CatalogSyncPart) => {
    await db.runAsync(
        `INSERT OR REPLACE INTO parts (
            part_id, internal_sku, detail, display_name, brand_name, group_name,
            last_cost, wac_cost, last_sale_price, tax_rate_id, is_tax_inclusive_price,
            measurement_unit, is_active, merged_into_part_id,
            part_numbers_text, applications_text, date_modified
         ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
            part.part_id,
            part.internal_sku ?? null,
            part.detail ?? null,
            part.display_name ?? null,
            part.brand_name ?? null,
            part.group_name ?? null,
            toNumber(part.last_cost),
            toNumber(part.wac_cost),
            toNumber(part.last_sale_price),
            part.tax_rate_id ?? null,
            part.is_tax_inclusive_price ? 1 : 0,
            part.measurement_unit ?? null,
            part.is_active ? 1 : 0,
            part.merged_into_part_id ?? null,
            part.part_numbers ?? '',
            part.applications ?? '',
            part.date_modified ?? null,
        ]
    );

    // FTS5 has no upsert, so the old row is cleared before the new one lands.
    await db.runAsync('DELETE FROM parts_fts WHERE part_id = ?', [part.part_id]);
    await db.runAsync(
        `INSERT INTO parts_fts (
            part_id, internal_sku, display_name, part_numbers_text,
            applications_text, brand_name, group_name
         ) VALUES (?,?,?,?,?,?,?)`,
        [
            part.part_id,
            part.internal_sku ?? '',
            part.display_name ?? '',
            part.part_numbers ?? '',
            part.applications ?? '',
            part.brand_name ?? '',
            part.group_name ?? '',
        ]
    );

    await db.runAsync('DELETE FROM barcodes WHERE part_id = ?', [part.part_id]);
    for (const barcode of part.barcodes ?? []) {
        if (!barcode) continue;
        // A barcode can be reassigned between parts, so the newest owner wins
        // rather than the insert failing on the primary key.
        await db.runAsync('INSERT OR REPLACE INTO barcodes (barcode, part_id) VALUES (?, ?)', [barcode, part.part_id]);
    }
};

const deletePart = async (db: SQLite.SQLiteDatabase, partId: number) => {
    await db.runAsync('DELETE FROM parts WHERE part_id = ?', [partId]);
    await db.runAsync('DELETE FROM parts_fts WHERE part_id = ?', [partId]);
    await db.runAsync('DELETE FROM barcodes WHERE part_id = ?', [partId]);
};

/**
 * Applies one page and advances the cursor in a single transaction.
 *
 * The atomicity is the whole point: if the connection drops mid-page, neither
 * the rows nor the cursor move, so the retry re-fetches exactly that page and
 * nothing is half-applied or skipped.
 */
const applyPage = async (
    db: SQLite.SQLiteDatabase,
    parts: CatalogSyncPart[],
    deletedIds: number[],
    cursor: number,
    bootstrapDone: boolean
) => {
    await db.withTransactionAsync(async () => {
        for (const part of parts) await upsertPart(db, part);
        for (const id of deletedIds) await deletePart(db, id);
        await db.runAsync(
            `UPDATE catalog_meta
                SET sync_cursor = ?, last_synced_at = ?
                    ${bootstrapDone ? ', bootstrap_done_at = ?' : ''}
              WHERE id = 1`,
            bootstrapDone
                ? [cursor, new Date().toISOString(), new Date().toISOString()]
                : [cursor, new Date().toISOString()]
        );
    });
};

const bootstrap = async (db: SQLite.SQLiteDatabase) => {
    const { setState } = useCatalogSyncStore.getState();
    setState({ status: 'bootstrapping', progress: 0 });

    let cursor = 0;
    let written = 0;
    // Captured from the first page: the log position the snapshot corresponds
    // to. Anything edited mid-bootstrap sits above it and arrives in the first
    // delta, so the worst case is one redundant upsert, never a missed edit.
    let syncCursor = 0;

    for (;;) {
        const { data } = await apiClient.get<BootstrapResponse>('/catalog/sync/bootstrap', {
            params: { cursor, limit: PAGE_SIZE },
        });

        if (data.sync_cursor !== undefined) syncCursor = data.sync_cursor;

        await db.withTransactionAsync(async () => {
            for (const part of data.parts) await upsertPart(db, part);
        });

        written += data.parts.length;
        cursor = data.next_cursor;
        setState({ progress: written });

        if (!data.has_more) break;
    }

    // Only now is the snapshot complete, so only now does the cursor mean
    // anything. Committing it earlier would let an interrupted bootstrap look
    // like a finished one.
    await applyPage(db, [], [], syncCursor, true);
    setState({ progress: null });
    return written;
};

const incremental = async (db: SQLite.SQLiteDatabase, from: number) => {
    const { setState } = useCatalogSyncStore.getState();
    setState({ status: 'syncing' });

    let since = from;
    for (;;) {
        const { data } = await apiClient.get<DeltaResponse>('/catalog/sync', {
            params: { since, limit: PAGE_SIZE },
        });

        if (data.parts.length === 0 && data.deleted_part_ids.length === 0 && !data.has_more) {
            // Still record the cursor move so an idle catalogue doesn't re-ask
            // for the same empty window every time it reconnects.
            if (data.next_since !== since) await applyPage(db, [], [], data.next_since, false);
            break;
        }

        await applyPage(db, data.parts, data.deleted_part_ids, data.next_since, false);
        since = data.next_since;

        if (!data.has_more) break;
    }
};

// Reachability polling and a foreground return can both fire at once; without
// this the two runs would interleave over the same tables.
let running = false;

export const runCatalogSync = async (): Promise<void> => {
    if (running) return;
    running = true;

    const { setState } = useCatalogSyncStore.getState();
    try {
        const db = await openCatalogDb();
        const meta = await readCatalogMeta();

        if (!meta.bootstrap_done_at) {
            await bootstrap(db);
        } else {
            await incremental(db, meta.sync_cursor);
        }

        const fresh = await readCatalogMeta();
        setState({ status: 'idle', lastError: null, lastSyncedAt: fresh.last_synced_at, progress: null });
    } catch (e: any) {
        const message = e?.response?.data?.message || e?.message || 'Catalog sync failed';
        setState({ status: 'error', lastError: message, progress: null });
        console.warn('[catalogSync]', message);
    } finally {
        running = false;
    }
};

export default runCatalogSync;
