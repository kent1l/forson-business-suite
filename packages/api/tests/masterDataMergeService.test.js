const fs = require('fs');
const path = require('path');
const db = require('../db');
const MasterDataMergeService = require('../services/masterDataMergeService');

const migration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261005_02_master_data_merge_phase1.sql'), 'utf8');
const draftGuardMigration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261005_03_master_data_merge_draft_guard.sql'), 'utf8');
const previewHistoryMigration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261005_04_master_data_merge_preview_history.sql'), 'utf8');

describe('MasterDataMergeService against PostgreSQL', () => {
    let client;
    let actorId;

    beforeAll(async () => {
        client = await db.getClient();
        await client.query('BEGIN');
        await client.query(migration);
        await client.query(draftGuardMigration);
        await client.query(previewHistoryMigration);
        const { rows } = await client.query('SELECT employee_id FROM employee ORDER BY employee_id LIMIT 1');
        actorId = rows[0]?.employee_id;
        if (!actorId) throw new Error('Integration database needs an employee actor.');
    });

    afterAll(async () => {
        if (client) {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    test('brand merge moves parts and aliases, records snapshots, and queues catalog sync', async () => {
        const suffix = Date.now().toString();
        const { rows: [keep] } = await client.query(
            'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING brand_id',
            [`Merge keep ${suffix}`, `MK${suffix.slice(-5)}`]);
        const { rows: [source] } = await client.query(
            'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING brand_id',
            [`Merge source ${suffix}`, `MS${suffix.slice(-5)}`]);
        const { rows: [group] } = await client.query(
            'INSERT INTO "group" (group_name, group_code) VALUES ($1, $2) RETURNING group_id',
            [`Merge group ${suffix}`, `MG${suffix.slice(-5)}`]);
        const { rows: [part] } = await client.query(
            'INSERT INTO part (brand_id, group_id, detail) VALUES ($1, $2, $3) RETURNING part_id',
            [source.brand_id, group.group_id, `Merge part ${suffix}`]);
        await client.query('INSERT INTO brand_alias (brand_id, alias_name) VALUES ($1, $2)',
            [source.brand_id, `Old alias ${suffix}`]);
        await client.query('INSERT INTO brand_alias (brand_id, alias_name) VALUES ($1, $2)',
            [source.brand_id, `OVERLAP ${suffix}`]);
        await client.query('INSERT INTO brand_alias (brand_id, alias_name) VALUES ($1, $2)',
            [keep.brand_id, `overlap ${suffix}`]);
        const service = new MasterDataMergeService(db, 'brand');
        const request = { keepId: keep.brand_id, mergeIds: [source.brand_id], suggestionIds: [] };
        const review = await service.review(client, request);
        expect(review.blockers).toEqual([]);
        const result = await service.executeWithClient(client,
            { ...request, previewFingerprint: review.fingerprint }, actorId);
        expect(result.partsReassigned).toBe(1);
        const { rows: [moved] } = await client.query('SELECT brand_id FROM part WHERE part_id = $1', [part.part_id]);
        expect(moved.brand_id).toBe(keep.brand_id);
        const { rows: aliases } = await client.query(
            'SELECT alias_name FROM brand_alias WHERE brand_id = $1 ORDER BY alias_name', [keep.brand_id]);
        expect(aliases.map(row => row.alias_name)).toEqual(expect.arrayContaining([
            `Old alias ${suffix}`, `Merge source ${suffix}`]));
        expect(aliases.filter(row => row.alias_name.toLowerCase() === `overlap ${suffix}`)).toHaveLength(1);
        const { rows: [operation] } = await client.query(
            'SELECT status FROM master_data_merge_operation WHERE operation_id = $1', [result.operationId]);
        expect(operation.status).toBe('active');
        const history = await service.history(50, client);
        const recorded = history.find(entry => entry.operation_id === result.operationId);
        expect(recorded.canonical.name).toBe(`Merge keep ${suffix}`);
        expect(recorded.sources[0].name).toBe(`Merge source ${suffix}`);
        expect(recorded.actor_name).toBeTruthy();
        expect(recorded.revertEligible).toBe(false);
        const { rows: [snapshot] } = await client.query(
            "SELECT COUNT(*)::int AS count FROM master_data_merge_snapshot WHERE operation_id = $1 AND table_name = 'part'",
            [result.operationId]);
        expect(snapshot.count).toBe(1);
        const { rows: [outbox] } = await client.query(
            "SELECT COUNT(*)::int AS count FROM meili_sync_outbox WHERE entity_id = $1 AND event_type = 'upsert_part'",
            [part.part_id]);
        expect(outbox.count).toBeGreaterThan(0);
    });

    test('supplier preview blocks both receipt-number collisions without retiring sources', async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'merge-integration-test-secret';
        const suffix = String(Date.now() + 1);
        const { rows: [keep] } = await client.query(
            'INSERT INTO supplier (supplier_name) VALUES ($1) RETURNING supplier_id', [`Receipt keep ${suffix}`]);
        const { rows: [source] } = await client.query(
            'INSERT INTO supplier (supplier_name) VALUES ($1) RETURNING supplier_id', [`Receipt source ${suffix}`]);
        for (const [supplierId, name] of [[keep.supplier_id, 'K'], [source.supplier_id, 'S']]) {
            await client.query(
                'INSERT INTO goods_receipt (grn_number, supplier_id, received_by, supplier_invoice_no, physical_receipt_no) ' +
                'VALUES ($1, $2, $3, $4, $5)',
                [`MR-${name}-${suffix}`, supplierId, actorId, `SI-${suffix}`, `PR-${suffix}`]);
        }
        const service = new MasterDataMergeService(db, 'supplier');
        const request = { keepId: keep.supplier_id, mergeIds: [source.supplier_id] };
        const review = await service.review(client, request);
        expect(review.blockers.map(item => item.field)).toEqual(expect.arrayContaining([
            'supplier_invoice_no', 'physical_receipt_no']));
        const preview = await service.preview(request, actorId, client);
        expect(preview.conflicts).toHaveLength(2);
        const blockedHistory = (await service.history(50, client)).find(entry =>
            entry.status === 'blocked' && entry.canonical_id === keep.supplier_id);
        expect(blockedHistory.blockers).toHaveLength(2);
        expect(blockedHistory.sources[0].name).toBe(`Receipt source ${suffix}`);
        await expect(service.executeWithClient(client,
            { ...request, previewFingerprint: review.fingerprint }, actorId))
            .rejects.toMatchObject({ statusCode: 409 });
        const { rows: [unchanged] } = await client.query(
            'SELECT is_merged, is_active FROM supplier WHERE supplier_id = $1', [source.supplier_id]);
        expect(unchanged).toMatchObject({ is_merged: false, is_active: true });
    });

    test('supplier merge rewrites typed PO and goods-receipt drafts', async () => {
        const suffix = String(Date.now() + 2);
        const { rows: [keep] } = await client.query(
            'INSERT INTO supplier (supplier_name) VALUES ($1) RETURNING supplier_id', [`Draft keep ${suffix}`]);
        const { rows: [source] } = await client.query(
            'INSERT INTO supplier (supplier_name) VALUES ($1) RETURNING supplier_id', [`Draft source ${suffix}`]);
        const { rows: [po] } = await client.query(
            "INSERT INTO draft_transaction (employee_id, transaction_type, draft_name, draft_data, expires_at) " +
            "VALUES ($1, 'PO', $2, $3::jsonb, NOW() + INTERVAL '7 days') RETURNING draft_id",
            [actorId, `Merge PO ${suffix}`, JSON.stringify({ selectedSupplier: String(source.supplier_id), lines: [] })]);
        const { rows: [grn] } = await client.query(
            "INSERT INTO draft_transaction (employee_id, transaction_type, draft_name, draft_data, expires_at) " +
            "VALUES ($1, 'GOODS-RECEIPT', $2, $3::jsonb, NOW() + INTERVAL '7 days') RETURNING draft_id",
            [actorId, `Merge GRN ${suffix}`, JSON.stringify({ selectedSupplier: String(source.supplier_id),
                freightCosts: [{ supplier_id: source.supplier_id }] })]);
        const service = new MasterDataMergeService(db, 'supplier');
        const request = { keepId: keep.supplier_id, mergeIds: [source.supplier_id] };
        const review = await service.review(client, request);
        expect(review.drafts.affected).toHaveLength(2);
        await service.executeWithClient(client, { ...request, previewFingerprint: review.fingerprint }, actorId);
        const { rows } = await client.query(
            'SELECT draft_data FROM draft_transaction WHERE draft_id = ANY($1::int[]) ORDER BY draft_id',
            [[po.draft_id, grn.draft_id]]);
        expect(rows[0].draft_data.selectedSupplier).toBe(String(keep.supplier_id));
        expect(rows[1].draft_data.freightCosts[0].supplier_id).toBe(keep.supplier_id);
        await client.query('SAVEPOINT stale_draft');
        await expect(client.query(
            "INSERT INTO draft_transaction (employee_id, transaction_type, draft_name, draft_data, expires_at) " +
            "VALUES ($1, 'PO', $2, $3::jsonb, NOW() + INTERVAL '7 days')",
            [actorId, `Stale PO ${suffix}`, JSON.stringify({ selectedSupplier: source.supplier_id })]))
            .rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT stale_draft');
    });

    test('customer merge unions tags and reconciled wallet ledgers', async () => {
        const suffix = String(Date.now() + 3);
        const { rows: [keep] } = await client.query(
            'INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Wallet keep ${suffix}`]);
        const { rows: [source] } = await client.query(
            'INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Wallet source ${suffix}`]);
        const { rows: [tag] } = await client.query(
            'INSERT INTO tag (tag_name) VALUES ($1) RETURNING tag_id', [`Merge tag ${suffix}`]);
        await client.query('INSERT INTO customer_tag (customer_id, tag_id) VALUES ($1, $2)',
            [source.customer_id, tag.tag_id]);
        for (const [customerId, amount] of [[keep.customer_id, 10], [source.customer_id, 5]]) {
            await client.query(
                "SELECT append_wallet_transaction($1, 'ADVANCE_DEPOSIT'::wallet_transaction_type, $2)",
                [customerId, amount]);
        }
        const service = new MasterDataMergeService(db, 'customer');
        const request = { keepId: keep.customer_id, mergeIds: [source.customer_id] };
        const review = await service.review(client, request);
        expect(review.blockers).toEqual([]);
        await service.executeWithClient(client, { ...request, previewFingerprint: review.fingerprint }, actorId);
        const { rows: [wallet] } = await client.query(
            'SELECT balance FROM customer_wallet WHERE customer_id = $1', [keep.customer_id]);
        expect(Number(wallet.balance)).toBe(15);
        const { rows: tx } = await client.query(
            'SELECT customer_id, balance_after FROM customer_wallet_transaction WHERE customer_id = $1 ORDER BY created_at, transaction_id',
            [keep.customer_id]);
        expect(tx).toHaveLength(2);
        expect(Number(tx[1].balance_after)).toBe(15);
        const { rows: [tagOwner] } = await client.query('SELECT customer_id FROM customer_tag WHERE tag_id = $1', [tag.tag_id]);
        expect(tagOwner.customer_id).toBe(keep.customer_id);
    });

    test('customer preview blocks certificate collisions and inconsistent wallet balances', async () => {
        const suffix = String(Date.now() + 4);
        const { rows: [keep] } = await client.query(
            'INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Certificate keep ${suffix}`]);
        const { rows: [source] } = await client.query(
            'INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Certificate source ${suffix}`]);
        for (const customerId of [keep.customer_id, source.customer_id]) {
            await client.query(
                'INSERT INTO withholding_tax_certificate (customer_id, certificate_type, certificate_no) ' +
                'VALUES ($1, $2, $3)', [customerId, '2307', `CERT-${suffix}`]);
        }
        await client.query('INSERT INTO customer_wallet (customer_id, balance) VALUES ($1, 3)', [source.customer_id]);
        const service = new MasterDataMergeService(db, 'customer');
        const review = await service.review(client, { keepId: keep.customer_id, mergeIds: [source.customer_id] });
        expect(review.blockers.map(item => item.reason)).toEqual(expect.arrayContaining([
            'duplicate_customer_certificate', 'wallet_ledger_mismatch']));
    });

    test('unknown draft payloads block and stale review fingerprints cannot execute', async () => {
        const suffix = String(Date.now() + 5);
        const { rows: [keep] } = await client.query(
            'INSERT INTO supplier (supplier_name) VALUES ($1) RETURNING supplier_id', [`Unknown keep ${suffix}`]);
        const { rows: [source] } = await client.query(
            'INSERT INTO supplier (supplier_name) VALUES ($1) RETURNING supplier_id', [`Unknown source ${suffix}`]);
        const service = new MasterDataMergeService(db, 'supplier');
        const request = { keepId: keep.supplier_id, mergeIds: [source.supplier_id] };
        const initial = await service.review(client, request);
        await client.query(
            "INSERT INTO draft_transaction (employee_id, transaction_type, draft_name, draft_data, expires_at) " +
            "VALUES ($1, 'UNKNOWN', $2, $3::jsonb, NOW() + INTERVAL '7 days')",
            [actorId, `Unknown merge ${suffix}`, JSON.stringify({ version: 2, supplierReference: source.supplier_id })]);
        const next = await service.review(client, request);
        expect(next.blockers).toEqual(expect.arrayContaining([
            expect.objectContaining({ reason: 'unknown_draft_payload' })]));
        await expect(service.executeWithClient(client,
            { ...request, previewFingerprint: initial.fingerprint }, actorId))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    test('group merge handles its quoted table and retires the source', async () => {
        const suffix = String(Date.now() + 6);
        const { rows: [keep] } = await client.query(
            'INSERT INTO "group" (group_name, group_code) VALUES ($1, $2) RETURNING group_id',
            [`Group keep ${suffix}`, `GK${suffix.slice(-5)}`]);
        const { rows: [source] } = await client.query(
            'INSERT INTO "group" (group_name, group_code) VALUES ($1, $2) RETURNING group_id',
            [`Group source ${suffix}`, `GS${suffix.slice(-5)}`]);
        const service = new MasterDataMergeService(db, 'group');
        const request = { keepId: keep.group_id, mergeIds: [source.group_id] };
        const review = await service.review(client, request);
        await service.executeWithClient(client, { ...request, previewFingerprint: review.fingerprint }, actorId);
        const { rows: [retired] } = await client.query(
            'SELECT is_active, is_merged, merged_into_group_id FROM "group" WHERE group_id = $1',
            [source.group_id]);
        expect(retired).toEqual({ is_active: false, is_merged: true, merged_into_group_id: keep.group_id });
    });

    test('a late catalog-sync failure rolls relationship moves and retirement back together', async () => {
        const suffix = String(Date.now() + 7);
        const { rows: [keep] } = await client.query(
            'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING brand_id',
            [`Rollback keep ${suffix}`, `RK${suffix.slice(-5)}`]);
        const { rows: [source] } = await client.query(
            'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING brand_id',
            [`Rollback source ${suffix}`, `RS${suffix.slice(-5)}`]);
        const { rows: [group] } = await client.query(
            'INSERT INTO "group" (group_name, group_code) VALUES ($1, $2) RETURNING group_id',
            [`Rollback group ${suffix}`, `RG${suffix.slice(-5)}`]);
        const { rows: [part] } = await client.query(
            'INSERT INTO part (brand_id, group_id, detail) VALUES ($1, $2, $3) RETURNING part_id',
            [source.brand_id, group.group_id, `Rollback part ${suffix}`]);
        const service = new MasterDataMergeService(db, 'brand');
        const request = { keepId: keep.brand_id, mergeIds: [source.brand_id] };
        const review = await service.review(client, request);
        await client.query('SAVEPOINT late_failure');
        await client.query(
            "ALTER TABLE meili_sync_outbox ADD CONSTRAINT test_reject_master_merge_event " +
            "CHECK (payload->>'source' IS DISTINCT FROM 'masterDataMergeService') NOT VALID");
        await expect(service.executeWithClient(client,
            { ...request, previewFingerprint: review.fingerprint }, actorId)).rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT late_failure');
        const { rows: [unchangedPart] } = await client.query('SELECT brand_id FROM part WHERE part_id = $1', [part.part_id]);
        const { rows: [unchangedSource] } = await client.query(
            'SELECT is_active, is_merged FROM brand WHERE brand_id = $1', [source.brand_id]);
        expect(unchangedPart.brand_id).toBe(source.brand_id);
        expect(unchangedSource).toEqual({ is_active: true, is_merged: false });
    });
});
