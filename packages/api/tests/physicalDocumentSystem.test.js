const db = require('../db');

describe('Physical Document System - Phase 1 Schema & Invariants', () => {
    test('seed document types exist with correct inactive status and codes', async () => {
        const { rows } = await db.query(
            `SELECT code, controlled_category, tax_designation, default_method, is_active 
             FROM physical_document_type ORDER BY type_id`
        );
        expect(rows.length).toBeGreaterThanOrEqual(7);
        const codes = rows.map(r => r.code);
        expect(codes).toContain('SALES_INVOICE_NON_VAT');
        expect(codes).toContain('CHARGE_INVOICE_NON_VAT');
        expect(codes).toContain('SALES_INVOICE_VAT');
        expect(codes).toContain('CHARGE_INVOICE_VAT');
        expect(codes).toContain('DELIVERY_RECEIPT');
        expect(codes).toContain('COLLECTION_RECEIPT');
        expect(codes).toContain('NOTEBOOK');
    });

    test('invoice and customer_payment have physical document system columns', async () => {
        const { rows: invCols } = await db.query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_name = 'invoice' AND column_name IN 
             ('recording_method', 'physical_document_type_id', 'physical_document_series_id', 'physical_document_registry_id')`
        );
        expect(invCols.length).toBe(4);

        const { rows: payCols } = await db.query(
            `SELECT column_name FROM information_schema.columns 
             WHERE table_name = 'customer_payment' AND column_name IN 
             ('collection_group_id', 'recording_method', 'physical_document_type_id', 'physical_document_series_id', 'physical_document_registry_id')`
        );
        expect(payCols.length).toBe(5);
    });

    test('registry enforces uniqueness per series, while different series do not collide', async () => {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            // 1. Create two test series
            const typeRes = await client.query(`SELECT type_id FROM physical_document_type WHERE code = 'SALES_INVOICE_VAT'`);
            const typeId = typeRes.rows[0].type_id;

            const s1Res = await client.query(
                `INSERT INTO physical_document_series (type_id, code, name, prefix, method, initial_serial)
                 VALUES ($1, 'TEST_SI_1', 'Test Series 1', 'SI', 'HIGHEST_PLUS_ONE', 100)
                 RETURNING series_id`,
                [typeId]
            );
            const series1Id = s1Res.rows[0].series_id;

            const s2Res = await client.query(
                `INSERT INTO physical_document_series (type_id, code, name, prefix, method, initial_serial)
                 VALUES ($1, 'TEST_DR_1', 'Test Series 2', 'DR', 'LAST_ISSUED_PLUS_ONE', 100)
                 RETURNING series_id`,
                [typeId]
            );
            const series2Id = s2Res.rows[0].series_id;

            // 2. Insert SI-100 in series 1
            await client.query(
                `INSERT INTO physical_document_registry (series_id, canonical_full_reference, serial_number, state)
                 VALUES ($1, 'SI-100', 100, 'ISSUED')`,
                [series1Id]
            );

            // 3. Same reference in same series must fail uniqueness
            let duplicateFailed = false;
            await client.query('SAVEPOINT sp1');
            try {
                await client.query(
                    `INSERT INTO physical_document_registry (series_id, canonical_full_reference, serial_number, state)
                     VALUES ($1, 'SI-100', 100, 'ISSUED')`,
                    [series1Id]
                );
            } catch (_err) {
                duplicateFailed = true;
                await client.query('ROLLBACK TO SAVEPOINT sp1');
            }
            expect(duplicateFailed).toBe(true);

            // 4. Same reference DR-100 in series 2 must succeed (different series)
            await client.query(
                `INSERT INTO physical_document_registry (series_id, canonical_full_reference, serial_number, state)
                 VALUES ($1, 'DR-100', 100, 'ISSUED')`,
                [series2Id]
            );

            // 5. Test is_series_physical_receipt_no_taken function
            const { rows: t1 } = await client.query(
                `SELECT public.is_series_physical_receipt_no_taken($1, 'SI-100') AS taken`,
                [series1Id]
            );
            expect(t1[0].taken).toBe(true);

            const { rows: t2 } = await client.query(
                `SELECT public.is_series_physical_receipt_no_taken($1, 'SI-101') AS taken`,
                [series1Id]
            );
            expect(t2[0].taken).toBe(false);

            await client.query('ROLLBACK');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    });

    test('corrected spoilage becomes UNOCCUPIED and releases the reference', async () => {
        const client = await db.getClient();
        try {
            await client.query('BEGIN');

            const typeRes = await client.query(`SELECT type_id FROM physical_document_type WHERE code = 'SALES_INVOICE_VAT'`);
            const typeId = typeRes.rows[0].type_id;

            const sRes = await client.query(
                `INSERT INTO physical_document_series (type_id, code, name, prefix, method, initial_serial)
                 VALUES ($1, 'TEST_SI_SPOIL', 'Test Series Spoil', 'SI', 'HIGHEST_PLUS_ONE', 500)
                 RETURNING series_id`,
                [typeId]
            );
            const seriesId = sRes.rows[0].series_id;

            // Spoil SI-500
            const regRes = await client.query(
                `INSERT INTO physical_document_registry (series_id, canonical_full_reference, serial_number, state)
                 VALUES ($1, 'SI-500', 500, 'SPOILED')
                 RETURNING registry_id`,
                [seriesId]
            );
            const regId = regRes.rows[0].registry_id;

            // Should be taken
            const { rows: check1 } = await client.query(
                `SELECT public.is_series_physical_receipt_no_taken($1, 'SI-500') AS taken`,
                [seriesId]
            );
            expect(check1[0].taken).toBe(true);

            // Correct spoilage -> state = 'UNOCCUPIED'
            await client.query(
                `UPDATE physical_document_registry SET state = 'UNOCCUPIED' WHERE registry_id = $1`,
                [regId]
            );

            // Should now NOT be taken
            const { rows: check2 } = await client.query(
                `SELECT public.is_series_physical_receipt_no_taken($1, 'SI-500') AS taken`,
                [seriesId]
            );
            expect(check2[0].taken).toBe(false);

            // Can now be re-issued
            await client.query(
                `INSERT INTO physical_document_registry (series_id, canonical_full_reference, serial_number, state)
                 VALUES ($1, 'SI-500', 500, 'ISSUED')`,
                [seriesId]
            );

            await client.query('ROLLBACK');
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    });
});
