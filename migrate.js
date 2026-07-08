const { Pool } = require('pg');
require('dotenv').config({ path: 'packages/api/.env' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://forson:forson_password@localhost:5432/forson_business_suite'
});

async function run() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ai_match_cache (
                part_id_1 INTEGER NOT NULL REFERENCES part(part_id) ON DELETE CASCADE,
                part_id_2 INTEGER NOT NULL REFERENCES part(part_id) ON DELETE CASCADE,
                is_duplicate BOOLEAN NOT NULL,
                reason TEXT,
                source VARCHAR(50) DEFAULT 'AI',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (part_id_1, part_id_2),
                CHECK (part_id_1 < part_id_2)
            );
        `);
        console.log('Table created');

        await pool.query(`
            INSERT INTO ai_match_cache (part_id_1, part_id_2, is_duplicate, reason, source, created_at)
            SELECT part_id_1, part_id_2, false, reason, source, created_at
            FROM part_exclusion
            ON CONFLICT (part_id_1, part_id_2) DO NOTHING;
        `);
        console.log('Data migrated');
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
