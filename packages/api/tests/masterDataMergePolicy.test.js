const fs = require('fs');
const path = require('path');
const db = require('../db');
const policy = require('../services/masterDataMergePolicy');

const migration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261005_02_master_data_merge_phase1.sql'), 'utf8');

describe('master-data merge schema and policy', () => {
    let client;

    beforeAll(async () => {
        client = await db.getClient();
        await client.query('BEGIN');
        await client.query(migration);
    });

    afterAll(async () => {
        if (client) {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    test('every live foreign key has one explicit policy and lock namespace', async () => {
        const { rows } = await client.query(`
            SELECT parent.relname AS entity_type, child.relname AS table_name,
                   attribute.attname AS column_name
            FROM pg_constraint fk
            JOIN pg_class child ON child.oid = fk.conrelid
            JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
            JOIN pg_class parent ON parent.oid = fk.confrelid
            JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
            JOIN pg_attribute attribute ON attribute.attrelid = child.oid AND attribute.attnum = fk.conkey[1]
            WHERE fk.contype = 'f' AND cardinality(fk.conkey) = 1
              AND child_schema.nspname = 'public' AND parent_schema.nspname = 'public'
              AND parent.relname IN ('supplier', 'customer', 'brand', 'group')
            ORDER BY 1, 2, 3`);
        const actual = rows.map(row => `${row.entity_type}.${row.table_name}.${row.column_name}`).sort();
        const expected = Object.entries(policy).flatMap(([entity, rule]) =>
            rule.references.map(([table, column]) => `${entity}.${table}.${column}`)).sort();
        expect(actual).toEqual(expected);
        expect(new Set(Object.values(policy).map(rule => rule.namespace)).size).toBe(4);
    });

    test('merged rows must be inactive and child writes cannot name retired masters', async () => {
        const { rows } = await client.query(`
            SELECT conrelid::regclass::text AS table_name, pg_get_constraintdef(oid) AS definition
            FROM pg_constraint WHERE conname IN
                ('chk_supplier_merge_state', 'chk_customer_merge_state', 'chk_brand_merge_state', 'chk_group_merge_state')`);
        expect(rows).toHaveLength(4);
        for (const row of rows) expect(row.definition).toMatch(/NOT is_active/i);
        const { rows: guards } = await client.query(`
            SELECT tgrelid::regclass::text AS table_name, tgname
            FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE 'master_merge_guard_%'`);
        for (const [entity, rule] of Object.entries(policy)) {
            for (const [table, column, action] of rule.references) {
                if (action === 'provenance' || action === 'workflow') continue;
                expect(guards).toContainEqual({ table_name: table, tgname: `master_merge_guard_${column}` });
            }
            const { rows: namespace } = await client.query('SELECT public.master_data_merge_namespace($1) AS id', [entity]);
            expect(namespace[0].id).toBe(rule.namespace);
        }
    });

    test('retirement blocks new ownership and merged-master edits', async () => {
        const suffix = String(Date.now());
        const { rows: [canonical] } = await client.query(
            'INSERT INTO supplier (supplier_name, supplier_code) VALUES ($1, $2) RETURNING supplier_id',
            [`Merge test canonical ${suffix}`, `MT-C-${suffix}`]);
        const { rows: [source] } = await client.query(
            'INSERT INTO supplier (supplier_name, supplier_code) VALUES ($1, $2) RETURNING supplier_id',
            [`Merge test source ${suffix}`, `MT-S-${suffix}`]);
        await client.query(
            'UPDATE supplier SET is_merged = TRUE, is_active = FALSE, merged_into_supplier_id = $1 WHERE supplier_id = $2',
            [canonical.supplier_id, source.supplier_id]);

        await client.query('SAVEPOINT rejected_reference');
        await expect(client.query(
            'INSERT INTO supplier_alias (supplier_id, alias_name) VALUES ($1, $2)',
            [source.supplier_id, `old name ${suffix}`])).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT rejected_reference');

        await client.query('SAVEPOINT rejected_edit');
        await expect(client.query(
            'UPDATE supplier SET is_active = TRUE WHERE supplier_id = $1',
            [source.supplier_id])).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT rejected_edit');
    });
});
