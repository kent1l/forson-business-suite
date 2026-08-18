import * as SQLite from 'expo-sqlite';

/**
 * The on-device mirror of the parts catalogue.
 *
 * The store has no power backup for the server, so a blackout takes the API
 * and every desktop terminal down at once while the phones stay up. This
 * database is what keeps part lookup working through that: it holds the
 * catalogue fields staff search on, and nothing volatile. Stock on hand is
 * deliberately absent -- a number that was true hours ago is worse than an
 * honest blank, because it invites someone to sell what isn't there.
 *
 * Everything here is server-derived and read-only. No local write ever
 * originates in this database (that is the outbox's job), which is what makes
 * dropping and re-syncing a safe response to any inconsistency.
 */

const DB_NAME = 'catalog.db';

/**
 * Bumping this wipes and re-bootstraps the catalogue. Safe precisely because
 * the data is fully re-derivable from the server, so a migration framework for
 * what is ultimately a cache would be unearned complexity.
 */
export const CATALOG_SCHEMA_VERSION = 1;

export type CatalogPart = {
    part_id: number;
    internal_sku: string | null;
    detail: string | null;
    display_name: string | null;
    brand_name: string | null;
    group_name: string | null;
    last_cost: number | null;
    wac_cost: number | null;
    last_sale_price: number | null;
    tax_rate_id: number | null;
    is_tax_inclusive_price: boolean;
    measurement_unit: string | null;
    is_active: boolean;
    merged_into_part_id: number | null;
    part_numbers: string;
    applications: string;
    barcodes: string[];
};

/** A part row exactly as the sync endpoints return it. */
export type CatalogSyncPart = Omit<CatalogPart, 'is_active' | 'is_tax_inclusive_price'> & {
    is_active: boolean;
    is_tax_inclusive_price: boolean;
    date_modified: string | null;
};

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS catalog_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  schema_version INTEGER NOT NULL,
  sync_cursor INTEGER NOT NULL DEFAULT 0,
  bootstrap_done_at TEXT,
  last_synced_at TEXT
);

CREATE TABLE IF NOT EXISTS parts (
  part_id INTEGER PRIMARY KEY,
  internal_sku TEXT,
  detail TEXT,
  display_name TEXT,
  brand_name TEXT,
  group_name TEXT,
  last_cost REAL,
  wac_cost REAL,
  last_sale_price REAL,
  tax_rate_id INTEGER,
  is_tax_inclusive_price INTEGER,
  measurement_unit TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  merged_into_part_id INTEGER,
  part_numbers_text TEXT,
  applications_text TEXT,
  date_modified TEXT
);

-- One row per barcode rather than an array on the part, so a scan resolves
-- through a primary-key lookup instead of a scan over every part.
CREATE TABLE IF NOT EXISTS barcodes (
  barcode TEXT PRIMARY KEY,
  part_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_barcodes_part ON barcodes (part_id);

-- Search-as-you-type across five text columns at ten thousand rows: LIKE
-- '%term%' cannot use an index for a leading wildcard and degrades into a full
-- scan, which is exactly the latency this whole feature exists to remove.
CREATE VIRTUAL TABLE IF NOT EXISTS parts_fts USING fts5(
  part_id UNINDEXED,
  internal_sku,
  display_name,
  part_numbers_text,
  applications_text,
  brand_name,
  group_name
);
`;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const CATALOG_TABLES = ['parts_fts', 'barcodes', 'parts', 'catalog_meta'];

const dropAll = async (db: SQLite.SQLiteDatabase) => {
    for (const table of CATALOG_TABLES) {
        await db.execAsync(`DROP TABLE IF EXISTS ${table};`);
    }
};

const initialise = async (db: SQLite.SQLiteDatabase) => {
    await db.execAsync(SCHEMA);

    const meta = await db.getFirstAsync<{ schema_version: number }>(
        'SELECT schema_version FROM catalog_meta WHERE id = 1'
    );

    if (!meta) {
        await db.runAsync(
            'INSERT INTO catalog_meta (id, schema_version, sync_cursor) VALUES (1, ?, 0)',
            [CATALOG_SCHEMA_VERSION]
        );
        return;
    }

    if (meta.schema_version !== CATALOG_SCHEMA_VERSION) {
        await dropAll(db);
        await db.execAsync(SCHEMA);
        await db.runAsync(
            'INSERT INTO catalog_meta (id, schema_version, sync_cursor) VALUES (1, ?, 0)',
            [CATALOG_SCHEMA_VERSION]
        );
    }
};

export const openCatalogDb = (): Promise<SQLite.SQLiteDatabase> => {
    if (!dbPromise) {
        dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
            await initialise(db);
            return db;
        }).catch((e) => {
            // Leaving a rejected promise cached would wedge the catalogue for
            // the rest of the session; clearing it lets the next call retry.
            dbPromise = null;
            throw e;
        });
    }
    return dbPromise;
};

export type CatalogMeta = {
    sync_cursor: number;
    bootstrap_done_at: string | null;
    last_synced_at: string | null;
};

export const readCatalogMeta = async (): Promise<CatalogMeta> => {
    const db = await openCatalogDb();
    const row = await db.getFirstAsync<CatalogMeta>(
        'SELECT sync_cursor, bootstrap_done_at, last_synced_at FROM catalog_meta WHERE id = 1'
    );
    return row ?? { sync_cursor: 0, bootstrap_done_at: null, last_synced_at: null };
};

/** Drops every catalogue table and rebuilds it empty, forcing a fresh bootstrap. */
export const resetCatalogDb = async (): Promise<void> => {
    const db = await openCatalogDb();
    await dropAll(db);
    await db.execAsync(SCHEMA);
    await db.runAsync(
        'INSERT INTO catalog_meta (id, schema_version, sync_cursor) VALUES (1, ?, 0)',
        [CATALOG_SCHEMA_VERSION]
    );
};

export const countParts = async (): Promise<number> => {
    const db = await openCatalogDb();
    const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM parts');
    return row?.n ?? 0;
};
