'use strict';

// Real PostgreSQL, isolated temporary objects, rolled back on success or failure.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../../.env'), quiet: true });
const { Client } = require('pg');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { normalizeReceiptIdentifier } = require('../helpers/paperlessMatching');

async function main() {
    const hostIndex = process.argv.indexOf('--host');
    const client = new Client({
        host: hostIndex >= 0 ? process.argv[hostIndex + 1] : process.env.DB_HOST,
        port: process.env.DB_PORT, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
    });
    await client.connect();
    try {
        await client.query('BEGIN');
        await client.query('CREATE TEMP TABLE goods_receipt (supplier_id int, physical_receipt_no text, status text)');
        const migration = fs.readFileSync(path.resolve(__dirname,
            '../../../database/migrations/20261018_01_goods_receipt_check_only_normalization.sql'), 'utf8')
            .replaceAll('public.', 'pg_temp.');
        await client.query(migration);
        await client.query(migration); // Idempotent, without changing stored values.
        for (const value of ['dr / 00042', 'DR_42', 'ＤＲ－０００４２', 'café-001', 'AB001CD002',
            '0000', 'SI-123', 'SI-1234', 'TRA-052367', 'N/A', 'none', 'NULL', '', '  ', '-', null]) {
            const { rows: [row] } = await client.query('SELECT pg_temp.goods_receipt_match_key($1) AS key', [value]);
            assert.equal(row.key, value === null ? null : normalizeReceiptIdentifier(value), String(value));
        }
        const raw = '  dr / 00042  ';
        await client.query("INSERT INTO pg_temp.goods_receipt VALUES (1, $1, 'Active')", [raw]);
        assert.equal((await client.query('SELECT physical_receipt_no FROM pg_temp.goods_receipt')).rows[0].physical_receipt_no, raw);
        await client.query('SAVEPOINT duplicate_check');
        await assert.rejects(client.query("INSERT INTO pg_temp.goods_receipt VALUES (1, 'DR_42', 'Active')"),
            err => err.code === '23505' && err.constraint === 'uq_goods_receipt_supplier_physical_receipt_normalized');
        await client.query('ROLLBACK TO SAVEPOINT duplicate_check');
        await client.query("INSERT INTO pg_temp.goods_receipt VALUES (2, 'DR_42', 'Active')");
        await client.query("UPDATE pg_temp.goods_receipt SET status = 'Voided' WHERE supplier_id = 1");
        await client.query("INSERT INTO pg_temp.goods_receipt VALUES (1, 'DR_42', 'Active')");
        console.log('PASS: migration idempotence, SQL/JS normalization parity, raw-value preservation, normalized uniqueness, supplier scope, and void release');
    } finally {
        await client.query('ROLLBACK').catch(() => {});
        await client.end();
    }
}
main().catch(err => { console.error(err.message); process.exitCode = 1; });
