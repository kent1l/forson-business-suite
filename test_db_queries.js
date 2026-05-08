const { Pool } = require('pg');
const DuplicateFinder = require('./packages/api/services/duplicateFinder');

const pool = new Pool({
  host: process.env.PGHOST || 'localhost',
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD || 'postgres',
  database: process.env.PGDATABASE || 'forson',
  port: process.env.PGPORT || 5432,
});

async function run() {
    console.log("Connecting to DB...");
    const result = await pool.query(`
            WITH duplicated_skus AS (
                SELECT internal_sku
                FROM part
                WHERE merged_into_part_id IS NULL AND internal_sku IS NOT NULL AND internal_sku != ''
                GROUP BY internal_sku
                HAVING COUNT(*) > 1
            )
            SELECT p.*,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object('part_number', pn.part_number))
                        FROM part_number pn
                        WHERE pn.part_id = p.part_id AND pn.deleted_at IS NULL),
                   '[]'::json) as part_numbers_array
            FROM parts_view p
            JOIN duplicated_skus ds ON p.internal_sku = ds.internal_sku
            WHERE p.merged_into_part_id IS NULL
              AND ($1 = '' OR p.display_name ILIKE $1 OR p.internal_sku ILIKE $1)
            ORDER BY p.internal_sku, p.part_id
            LIMIT $2
    `, ['%%', 250]);
    console.log("Query 1 success, rows:", result.rows.length);

    const result2 = await pool.query(`
            WITH duplicated_pns AS (
                SELECT part_number
                FROM part_number
                WHERE deleted_at IS NULL AND part_number IS NOT NULL AND part_number != ''
                GROUP BY part_number
                HAVING COUNT(DISTINCT part_id) > 1
            )
            SELECT DISTINCT p.*,
                   COALESCE(
                       (SELECT json_agg(jsonb_build_object('part_number', pn_inner.part_number))
                        FROM part_number pn_inner
                        WHERE pn_inner.part_id = p.part_id AND pn_inner.deleted_at IS NULL),
                   '[]'::json) as part_numbers_array,
                   dpn.part_number as matching_part_number
            FROM parts_view p
            JOIN part_number pn ON p.part_id = pn.part_id AND pn.deleted_at IS NULL
            JOIN duplicated_pns dpn ON pn.part_number = dpn.part_number
            WHERE p.merged_into_part_id IS NULL
              AND ($1 = '' OR p.display_name ILIKE $1 OR p.internal_sku ILIKE $1)
            ORDER BY dpn.part_number, p.part_id
            LIMIT $2
    `, ['%%', 250]);
    console.log("Query 2 success, rows:", result2.rows.length);

    pool.end();
}
run().catch(console.error);
