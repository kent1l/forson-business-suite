require('dotenv').config({ path: '.env' });
process.env.DB_HOST = '127.0.0.1';
const db = require('./packages/api/db');
const { syncPartWithMeili } = require('./packages/api/meilisearch');

async function seed() {
    try {
        console.log("Seeding duplicates...");
        const res = await db.query('SELECT brand_id, group_id FROM part LIMIT 1');
        const { brand_id, group_id } = res.rows[0] || { brand_id: 1, group_id: 1 };
        
        const testSku = 'TEST-SKU-DUP-' + Date.now();
        
        // Insert Part 1
        const res1 = await db.query(`
            INSERT INTO part (detail, brand_id, group_id, internal_sku, created_by)
            VALUES ('Heavy Duty Brake Pad Set - Front', $1, $2, $3, 1) RETURNING part_id
        `, [brand_id, group_id, testSku + '-1']);
        const p1 = res1.rows[0].part_id;
        
        // Insert Part 2 (Slightly different detail, same SKU)
        const res2 = await db.query(`
            INSERT INTO part (detail, brand_id, group_id, internal_sku, created_by)
            VALUES ('Heavy Duty Brake Pad Set (Front)', $1, $2, $3, 1) RETURNING part_id
        `, [brand_id, group_id, testSku + '-2']);
        const p2 = res2.rows[0].part_id;

        // Insert Part 3 (Typo in detail, no SKU, but same part_number)
        const res3 = await db.query(`
            INSERT INTO part (detail, brand_id, group_id, internal_sku, created_by)
            VALUES ('Hevy Duty Brak Pad Set - Front', $1, $2, null, 1) RETURNING part_id
        `, [brand_id, group_id]);
        const p3 = res3.rows[0].part_id;
        
        // Add part numbers
        await db.query(`INSERT INTO part_number (part_id, part_number) VALUES ($1, 'BP-HD-FRONT')`, [p1]);
        await db.query(`INSERT INTO part_number (part_id, part_number) VALUES ($1, 'BP-HD-FRONT')`, [p2]);
        await db.query(`INSERT INTO part_number (part_id, part_number) VALUES ($1, 'BP-HD-FRONT')`, [p3]);

        // Refresh view to sync with meilisearch
        const viewRes = await db.query(`SELECT * FROM parts_view WHERE part_id IN ($1, $2, $3)`, [p1, p2, p3]);
        await syncPartWithMeili(viewRes.rows);

        console.log(`Inserted duplicate parts: ${p1}, ${p2}, ${p3}`);
    } catch(err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}
seed();
