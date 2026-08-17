const db = require('../db');
const { activeAliasCondition } = require('../helpers/partNumberSoftDelete');

/**
 * Shapes catalog rows for the mobile offline catalog.
 *
 * Deliberately excludes stock_on_hand. Stock is a live SUM over
 * inventory_transaction and goes stale the moment it lands on a phone; the
 * mobile catalog is a lookup mirror, not an inventory source, so a stale
 * number would be worse than no number at all.
 *
 * parts_view carries the display fields and barcodes, but the tax and unit
 * columns live only on part, so both are read here.
 */
const CATALOG_SELECT = `
    SELECT
        pv.part_id,
        pv.internal_sku,
        pv.detail,
        pv.display_name,
        pv.brand_name,
        pv.group_name,
        pv.is_active,
        pv.last_cost,
        pv.wac_cost,
        pv.last_sale_price,
        pv.merged_into_part_id,
        pv.date_modified,
        pv.barcodes,
        p.tax_rate_id,
        p.is_tax_inclusive_price,
        p.measurement_unit,
        (SELECT STRING_AGG(pn.part_number, '; ' ORDER BY pn.display_order)
           FROM part_number pn
          WHERE pn.part_id = pv.part_id AND ${activeAliasCondition('pn')}) AS part_numbers,
        (SELECT STRING_AGG(
            CONCAT(vmk.make_name, ' ', vmd.model_name, COALESCE(CONCAT(' ', veng.engine_name), '')), '; '
         ) FROM part_application pa
           JOIN application a ON pa.application_id = a.application_id
           LEFT JOIN vehicle_make vmk ON a.make_id = vmk.make_id
           LEFT JOIN vehicle_model vmd ON a.model_id = vmd.model_id
           LEFT JOIN vehicle_engine veng ON a.engine_id = veng.engine_id
          WHERE pa.part_id = pv.part_id) AS applications
    FROM public.parts_view AS pv
    JOIN public.part p ON p.part_id = pv.part_id
`;

const shapeRow = (row) => ({
    ...row,
    barcodes: row.barcodes || [],
    part_numbers: row.part_numbers || '',
    applications: row.applications || ''
});

/** Full catalog rows for a set of part ids, in no particular order. */
const buildCatalogRows = async (partIds) => {
    if (!Array.isArray(partIds) || partIds.length === 0) return [];
    const { rows } = await db.query(
        `${CATALOG_SELECT} WHERE pv.part_id = ANY($1::int[])`,
        [partIds]
    );
    return rows.map(shapeRow);
};

/** One page of the whole catalog, keyed by part_id for a stable cursor. */
const buildCatalogPage = async (afterPartId, limit) => {
    const { rows } = await db.query(
        `${CATALOG_SELECT} WHERE pv.part_id > $1 ORDER BY pv.part_id ASC LIMIT $2`,
        [afterPartId, limit]
    );
    return rows.map(shapeRow);
};

/**
 * The high-water mark of the change log, captured before a bootstrap starts so
 * anything edited mid-bootstrap is re-delivered by the first delta rather than
 * being missed.
 */
const getCurrentChangeCursor = async () => {
    const { rows } = await db.query('SELECT COALESCE(MAX(change_id), 0)::bigint AS cursor FROM catalog_change_log');
    return Number(rows[0].cursor);
};

module.exports = {
    buildCatalogRows,
    buildCatalogPage,
    getCurrentChangeCursor
};
