import { openCatalogDb, type CatalogPart } from './catalogDb';
import { buildMatchExpression } from './catalogSearchQuery';

/**
 * Reads against the local catalogue mirror.
 *
 * Rows come back shaped the way the server's search endpoints shape them, so
 * the screens render local and remote results through the same components
 * without a separate "offline" variant.
 */

type PartRow = {
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
    is_tax_inclusive_price: number;
    measurement_unit: string | null;
    is_active: number;
    merged_into_part_id: number | null;
    part_numbers_text: string | null;
    applications_text: string | null;
};

const hydrate = async (rows: PartRow[]): Promise<CatalogPart[]> => {
    if (rows.length === 0) return [];
    const db = await openCatalogDb();

    const placeholders = rows.map(() => '?').join(',');
    const barcodeRows = await db.getAllAsync<{ barcode: string; part_id: number }>(
        `SELECT barcode, part_id FROM barcodes WHERE part_id IN (${placeholders})`,
        rows.map((r) => r.part_id)
    );

    const byPart = new Map<number, string[]>();
    barcodeRows.forEach(({ barcode, part_id }) => {
        const list = byPart.get(part_id);
        if (list) list.push(barcode);
        else byPart.set(part_id, [barcode]);
    });

    return rows.map((r) => ({
        part_id: r.part_id,
        internal_sku: r.internal_sku,
        detail: r.detail,
        display_name: r.display_name,
        brand_name: r.brand_name,
        group_name: r.group_name,
        last_cost: r.last_cost,
        wac_cost: r.wac_cost,
        last_sale_price: r.last_sale_price,
        tax_rate_id: r.tax_rate_id,
        is_tax_inclusive_price: !!r.is_tax_inclusive_price,
        measurement_unit: r.measurement_unit,
        is_active: !!r.is_active,
        merged_into_part_id: r.merged_into_part_id,
        part_numbers: r.part_numbers_text ?? '',
        applications: r.applications_text ?? '',
        barcodes: byPart.get(r.part_id) ?? [],
    }));
};

const PART_COLUMNS = `
    p.part_id, p.internal_sku, p.detail, p.display_name, p.brand_name, p.group_name,
    p.last_cost, p.wac_cost, p.last_sale_price, p.tax_rate_id, p.is_tax_inclusive_price,
    p.measurement_unit, p.is_active, p.merged_into_part_id,
    p.part_numbers_text, p.applications_text
`;

export type SearchOptions = {
    activeOnly?: boolean;
    limit?: number;
};

export const searchCatalog = async (
    keyword: string,
    { activeOnly = true, limit = 50 }: SearchOptions = {}
): Promise<CatalogPart[]> => {
    const match = buildMatchExpression(keyword ?? '');
    if (!match) return [];

    const db = await openCatalogDb();
    try {
        const rows = await db.getAllAsync<PartRow>(
            `SELECT ${PART_COLUMNS}
               FROM parts_fts f
               JOIN parts p ON p.part_id = f.part_id
              -- The table name, not the alias: SQLite rejects the alias here.
              WHERE parts_fts MATCH ?
                ${activeOnly ? 'AND p.is_active = 1' : ''}
              ORDER BY rank
              LIMIT ?`,
            [match, limit]
        );
        return hydrate(rows);
    } catch (e) {
        // A malformed MATCH is the only realistic failure here and it must not
        // take the search box down with it.
        console.warn('[catalogQueries] search failed', e);
        return [];
    }
};

/** Exact barcode resolution for the scanner -- a primary-key hit, not a search. */
export const lookupBarcode = async (barcode: string): Promise<CatalogPart | null> => {
    const trimmed = (barcode ?? '').trim();
    if (!trimmed) return null;

    const db = await openCatalogDb();
    const rows = await db.getAllAsync<PartRow>(
        `SELECT ${PART_COLUMNS}
           FROM barcodes b
           JOIN parts p ON p.part_id = b.part_id
          WHERE b.barcode = ?
          LIMIT 1`,
        [trimmed]
    );
    const [part] = await hydrate(rows);
    return part ?? null;
};

export const getPartById = async (partId: number): Promise<CatalogPart | null> => {
    const db = await openCatalogDb();
    const rows = await db.getAllAsync<PartRow>(
        `SELECT ${PART_COLUMNS} FROM parts p WHERE p.part_id = ? LIMIT 1`,
        [partId]
    );
    const [part] = await hydrate(rows);
    return part ?? null;
};
