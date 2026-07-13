const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    connectionString: 'postgresql://postgres:your_secret_password_here@localhost:5432/forson_business_suite'
});

async function run() {
    try {
        console.log('Running 20260710_add_refund_tax_tracking.sql...');
        const migration1 = fs.readFileSync(path.join(__dirname, '../database/migrations/20260710_add_refund_tax_tracking.sql'), 'utf-8');
        await pool.query(migration1);
        console.log('Added refund tax tracking schema.');

        console.log('Running 20250918_backfill_tax_data.sql...');
        const migration2 = fs.readFileSync(path.join(__dirname, '../database/migrations/20250918_backfill_tax_data.sql'), 'utf-8');
        await pool.query(migration2);
        console.log('Backfill updated and executed.');
        
    } catch (e) {
        console.error('Migration failed:', e);
    } finally {
        await pool.end();
    }
}
run();
