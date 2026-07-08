const { Pool } = require('pg');
require('dotenv').config({ path: '../../.env' });

async function populateQueue() {
    const pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT) || 5432,
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD || 'postgres',
        database: process.env.DB_NAME || 'forson_business_suite',
    });

    try {
        console.log('Populating dedupe_scan_queue with existing parts...');
        
        const result = await pool.query(`
            INSERT INTO public.dedupe_scan_queue (part_id, status)
            SELECT part_id, 'pending' FROM public.part
            ON CONFLICT (part_id) DO NOTHING
        `);

        console.log(`Inserted ${result.rowCount} parts into the dedupe scan queue.`);
    } catch (err) {
        console.error('Error populating queue:', err);
    } finally {
        await pool.end();
    }
}

populateQueue();
