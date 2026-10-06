const fs = require('fs');
const path = require('path');
const db = require('../db');
const MasterDataMergeService = require('../services/masterDataMergeService');
const mergePolicy = require('../services/masterDataMergePolicy');
const { audit: auditMasterDataMerge } = require('../scripts/auditMasterDataMerge');

const migration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261005_02_master_data_merge_phase1.sql'), 'utf8');
const draftGuardMigration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261005_03_master_data_merge_draft_guard.sql'), 'utf8');
const previewHistoryMigration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261005_04_master_data_merge_preview_history.sql'), 'utf8');
const revertMigration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261005_05_master_data_merge_revert.sql'), 'utf8');
const immutableOwnersMigration = fs.readFileSync(path.resolve(__dirname, '../../../database/migrations/20261005_06_master_data_merge_immutable_owners.sql'), 'utf8');

describe('MasterDataMergeService against PostgreSQL', () => {
    let client;
    let actorId;

    beforeAll(async () => {
        client = await db.getClient();
        await client.query('BEGIN');
        await client.query(migration);
        await client.query(draftGuardMigration);
        await client.query(previewHistoryMigration);
        await client.query(revertMigration);
        await client.query(revertMigration);
        await client.query(immutableOwnersMigration);
        const { rows } = await client.query('SELECT employee_id FROM employee ORDER BY employee_id LIMIT 1');
        actorId = rows[0]?.employee_id;
        if (!actorId) {
            const { rows: [actor] } = await client.query(
                "INSERT INTO employee (first_name, last_name) VALUES ('Merge', 'Integration') RETURNING employee_id");
            actorId = actor.employee_id;
        }
    });

    afterAll(async () => {
        if (client) {
            await client.query('ROLLBACK');
            client.release();
        }
    });

    let revertFixtureNumber = 0;
    const expectNoSourceOwnership = async (entity, sourceId) => {
        for (const [table, column, action] of mergePolicy[entity].references) {
            if (action === 'provenance' || action === 'workflow') continue;
            const { rows: [row] } = await client.query(
                `SELECT COUNT(*)::int AS count FROM public."${table}" WHERE "${column}" = $1`, [sourceId]);
            expect({ entity, table, column, count: row.count }).toMatchObject({ count: 0 });
        }
    };
    const mergedBrandFixture = async label => {
        const suffix = `${Date.now()}${++revertFixtureNumber}`;
        const code = prefix => `${prefix}${String(revertFixtureNumber).padStart(5, '0')}`;
        const { rows: [keep] } = await client.query(
            'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING brand_id',
            [`${label} keep ${suffix}`, code('BK')]);
        const { rows: [source] } = await client.query(
            'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING brand_id',
            [`${label} source ${suffix}`, code('BS')]);
        const { rows: [group] } = await client.query(
            'INSERT INTO "group" (group_name, group_code) VALUES ($1, $2) RETURNING group_id',
            [`${label} group ${suffix}`, code('BG')]);
        const { rows: [part] } = await client.query(
            'INSERT INTO part (brand_id, group_id, detail) VALUES ($1, $2, $3) RETURNING part_id',
            [source.brand_id, group.group_id, `${label} part ${suffix}`]);
        const service = new MasterDataMergeService(db, 'brand');
        const request = { keepId: keep.brand_id, mergeIds: [source.brand_id] };
        const review = await service.review(client, request);
        const result = await service.executeWithClient(client,
            { ...request, previewFingerprint: review.fingerprint }, actorId);
        return { keep, source, part, service, result };
    };

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
        await expectNoSourceOwnership('brand', source.brand_id);
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
        expect(recorded.revertEligible).toBe(true);
        const { rows: [snapshot] } = await client.query(
            "SELECT COUNT(*)::int AS count FROM master_data_merge_snapshot WHERE operation_id = $1 AND table_name = 'part'",
            [result.operationId]);
        expect(snapshot.count).toBe(1);
        const { rows: [outbox] } = await client.query(
            "SELECT COUNT(*)::int AS count FROM meili_sync_outbox WHERE entity_id = $1 AND event_type = 'upsert_part'",
            [part.part_id]);
        expect(outbox.count).toBeGreaterThan(0);
        const reverted = await service.revertWithClient(client, result.operationId, actorId, 'Duplicate was distinct');
        expect(reverted.restoredIds).toEqual([source.brand_id]);
        const { rows: [restoredPart] } = await client.query('SELECT brand_id FROM part WHERE part_id = $1', [part.part_id]);
        expect(restoredPart.brand_id).toBe(source.brand_id);
        const { rows: [restoredSource] } = await client.query(
            'SELECT is_merged, is_active, merged_into_brand_id FROM brand WHERE brand_id = $1', [source.brand_id]);
        expect(restoredSource).toMatchObject({ is_merged: false, is_active: true, merged_into_brand_id: null });
        const { rows: [revertedOperation] } = await client.query(
            'SELECT status, revert_reason FROM master_data_merge_operation WHERE operation_id = $1', [result.operationId]);
        expect(revertedOperation).toMatchObject({ status: 'reverted', revert_reason: 'Duplicate was distinct' });
        await expect(service.revertWithClient(client, result.operationId, actorId, 'Again'))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    test('read-only rollout audit checks the migrated schema and policy registry', async () => {
        const report = await auditMasterDataMerge(client);
        expect(report.policyDrift).toEqual([]);
        expect(report.findings).toHaveProperty('activeDraftsWithRetiredIds');
        expect(report.findings['customer.walletMismatches']).toEqual(expect.any(Array));
        expect(['pending', 'applied']).toContain(report.migrations['20261005_05_master_data_merge_revert.sql']);
        expect(['pending', 'applied']).toContain(report.migrations['20261005_06_master_data_merge_immutable_owners.sql']);
    });

    test('rollout audit reports document collisions in pending duplicate suggestions', async () => {
        await client.query('SAVEPOINT audit_suggestion_collisions');
        try {
            const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            const { rows: suppliers } = await client.query(
                'INSERT INTO supplier (supplier_name) VALUES ($1), ($2) RETURNING supplier_id',
                [`Audit supplier one ${suffix}`, `Audit supplier two ${suffix}`]);
            for (const [index, supplier] of suppliers.entries()) {
                await client.query('INSERT INTO goods_receipt (grn_number, supplier_id, received_by, ' +
                    'supplier_invoice_no, physical_receipt_no) VALUES ($1, $2, $3, $4, $5)',
                [`AUDIT-GRN-${index}-${suffix}`, supplier.supplier_id, actorId,
                    `AUDIT-INV-${suffix}`, `AUDIT-PR-${suffix}`]);
            }
            await client.query('INSERT INTO supplier_duplicate_suggestion ' +
                '(supplier_id, duplicate_supplier_id, confidence_score, detection_method) ' +
                "VALUES ($1, $2, 1, 'test')", suppliers.map(row => row.supplier_id));
            const { rows: customers } = await client.query(
                'INSERT INTO customer (first_name) VALUES ($1), ($2) RETURNING customer_id',
                [`Audit customer one ${suffix}`, `Audit customer two ${suffix}`]);
            for (const customer of customers) await client.query(
                "INSERT INTO withholding_tax_certificate (customer_id, certificate_type, certificate_no) " +
                "VALUES ($1, '2307', $2)", [customer.customer_id, `AUDIT-CERT-${suffix}`]);
            await client.query('INSERT INTO customer_duplicate_suggestion ' +
                '(customer_id, duplicate_customer_id, confidence_score, detection_method) ' +
                "VALUES ($1, $2, 1, 'test')", customers.map(row => row.customer_id));
            const report = await auditMasterDataMerge(client);
            expect(report.findings['supplier.supplier_invoice_no.pendingSuggestionCollisions']).toHaveLength(1);
            expect(report.findings['supplier.physical_receipt_no.pendingSuggestionCollisions']).toHaveLength(1);
            expect(report.findings['customer.pendingSuggestionCertificateCollisions']).toHaveLength(1);
        } finally {
            await client.query('ROLLBACK TO SAVEPOINT audit_suggestion_collisions');
        }
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
        const result = await service.executeWithClient(client, { ...request, previewFingerprint: review.fingerprint }, actorId);
        await expectNoSourceOwnership('supplier', source.supplier_id);
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
        await service.revertWithClient(client, result.operationId, actorId, 'Restore supplier drafts');
        const { rows: restoredDrafts } = await client.query(
            'SELECT draft_data FROM draft_transaction WHERE draft_id = ANY($1::int[]) ORDER BY draft_id',
            [[po.draft_id, grn.draft_id]]);
        expect(restoredDrafts[0].draft_data.selectedSupplier).toBe(String(source.supplier_id));
        expect(restoredDrafts[1].draft_data.freightCosts[0].supplier_id).toBe(source.supplier_id);
        await client.query('DELETE FROM draft_transaction WHERE draft_id = ANY($1::int[])',
            [[po.draft_id, grn.draft_id]]);
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
        const result = await service.executeWithClient(client, { ...request, previewFingerprint: review.fingerprint }, actorId);
        await expectNoSourceOwnership('customer', source.customer_id);
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
        await service.revertWithClient(client, result.operationId, actorId, 'Restore wallets and tags');
        const { rows: restoredWallets } = await client.query(
            'SELECT customer_id, balance FROM customer_wallet WHERE customer_id = ANY($1::int[]) ORDER BY customer_id',
            [[keep.customer_id, source.customer_id]]);
        expect(restoredWallets.map(row => Number(row.balance))).toEqual([10, 5]);
        const { rows: [restoredTag] } = await client.query('SELECT customer_id FROM customer_tag WHERE tag_id = $1', [tag.tag_id]);
        expect(restoredTag.customer_id).toBe(source.customer_id);
    });

    test('customer merge handles no wallets, overlapping aliases and tags, and a saved sale draft', async () => {
        const suffix = String(Date.now() + 9);
        const { rows: [keep] } = await client.query(
            'INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Saved keep ${suffix}`]);
        const { rows: [source] } = await client.query(
            'INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Saved source ${suffix}`]);
        const { rows: [tag] } = await client.query(
            'INSERT INTO tag (tag_name) VALUES ($1) RETURNING tag_id', [`Saved tag ${suffix}`]);
        for (const customerId of [keep.customer_id, source.customer_id]) {
            await client.query('INSERT INTO customer_tag (customer_id, tag_id) VALUES ($1, $2)',
                [customerId, tag.tag_id]);
        }
        await client.query('INSERT INTO customer_alias (customer_id, alias_name) VALUES ($1, $2)',
            [keep.customer_id, `OVERLAP ${suffix}`]);
        await client.query('INSERT INTO customer_alias (customer_id, alias_name) VALUES ($1, $2)',
            [source.customer_id, `overlap ${suffix}`]);
        const { rows: [draft] } = await client.query(
            "INSERT INTO draft_transaction (employee_id, transaction_type, draft_name, draft_data, expires_at) " +
            "VALUES ($1, 'SALE', $2, $3::jsonb, NOW() + INTERVAL '7 days') RETURNING draft_id",
            [actorId, `Saved sale ${suffix}`, JSON.stringify({ cart: { customerId: String(source.customer_id), items: [] } })]);
        const service = new MasterDataMergeService(db, 'customer');
        const request = { keepId: keep.customer_id, mergeIds: [source.customer_id] };
        const review = await service.review(client, request);
        expect(review.blockers).toEqual([]);
        const result = await service.executeWithClient(client,
            { ...request, previewFingerprint: review.fingerprint }, actorId);
        await expectNoSourceOwnership('customer', source.customer_id);
        const { rows: [updated] } = await client.query('SELECT draft_data FROM draft_transaction WHERE draft_id = $1',
            [draft.draft_id]);
        expect(updated.draft_data.cart.customerId).toBe(String(keep.customer_id));
        const { rows: [aliasCount] } = await client.query(
            'SELECT COUNT(*)::int AS count FROM customer_alias WHERE customer_id = $1 AND lower(alias_name) = lower($2)',
            [keep.customer_id, `overlap ${suffix}`]);
        expect(aliasCount.count).toBe(1);
        const { rows: [tagCount] } = await client.query(
            'SELECT COUNT(*)::int AS count FROM customer_tag WHERE customer_id = $1 AND tag_id = $2',
            [keep.customer_id, tag.tag_id]);
        expect(tagCount.count).toBe(1);
        const { rows: [walletCount] } = await client.query(
            'SELECT COUNT(*)::int AS count FROM customer_wallet WHERE customer_id = ANY($1::int[])',
            [[keep.customer_id, source.customer_id]]);
        expect(walletCount.count).toBe(0);
        await service.revertWithClient(client, result.operationId, actorId, 'Restore saved sale');
        await client.query('DELETE FROM draft_transaction WHERE draft_id = $1', [draft.draft_id]);
    });

    test('supplier merge moves every registered operational relationship', async () => {
        await client.query('SAVEPOINT full_supplier_registry');
        try {
            const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            const { rows: [keep] } = await client.query(
                'INSERT INTO supplier (supplier_name) VALUES ($1) RETURNING supplier_id', [`Registry keep ${suffix}`]);
            const { rows: [source] } = await client.query(
                'INSERT INTO supplier (supplier_name) VALUES ($1) RETURNING supplier_id', [`Registry source ${suffix}`]);
            const id = source.supplier_id;
            const { rows: [grn] } = await client.query(
                'INSERT INTO goods_receipt (grn_number, supplier_id, freight_supplier_id, received_by) ' +
                'VALUES ($1, $2, $2, $3) RETURNING grn_id', [`REG-GRN-${suffix}`, id, actorId]);
            await client.query('INSERT INTO goods_receipt_freight (grn_id, supplier_id, amount) VALUES ($1, $2, 0)',
                [grn.grn_id, id]);
            await client.query('INSERT INTO purchase_order (po_number, supplier_id, employee_id, total_amount) ' +
                'VALUES ($1, $2, $3, 0)', [`REG-PO-${suffix}`, id, actorId]);
            await client.query('INSERT INTO supplier_bill (supplier_id, total_amount) VALUES ($1, 0)', [id]);
            await client.query("INSERT INTO ap_ledger (supplier_id, entry_type, amount, balance_after) " +
                "VALUES ($1, 'BILL_POSTED', 0, 0)", [id]);
            await client.query('INSERT INTO ap_payment (supplier_id, amount) VALUES ($1, 0)', [id]);
            await client.query("INSERT INTO cheque_clearance_log (action, supplier_id) VALUES ('RECEIVED', $1)", [id]);
            const service = new MasterDataMergeService(db, 'supplier');
            const request = { keepId: keep.supplier_id, mergeIds: [id] };
            const review = await service.review(client, request);
            expect(review.blockers).toEqual([]);
            for (const [table, column, action] of mergePolicy.supplier.references) {
                if (action === 'move') expect(review.impact[`${table}.${column}`]).toBeGreaterThan(0);
            }
            const result = await service.executeWithClient(client,
                { ...request, previewFingerprint: review.fingerprint }, actorId);
            await expectNoSourceOwnership('supplier', id);
            await client.query('SAVEPOINT reject_ap_ledger_edit');
            await expect(client.query('UPDATE ap_ledger SET amount = 2 WHERE supplier_id = $1',
                [keep.supplier_id])).rejects.toThrow('immutable');
            await client.query('ROLLBACK TO SAVEPOINT reject_ap_ledger_edit');
            await service.revertWithClient(client, result.operationId, actorId, 'Restore all supplier relationships');
            const { rows: [restored] } = await client.query(
                'SELECT COUNT(*)::int AS count FROM ap_ledger WHERE supplier_id = $1', [id]);
            expect(restored.count).toBe(1);
        } finally {
            await client.query('ROLLBACK TO SAVEPOINT full_supplier_registry');
        }
    });

    test('customer merge moves every registered operational relationship', async () => {
        await client.query('SAVEPOINT full_customer_registry');
        try {
            const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
            const { rows: [keep] } = await client.query(
                'INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Registry keep ${suffix}`]);
            const { rows: [source] } = await client.query(
                'INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Registry source ${suffix}`]);
            const id = source.customer_id;
            const { rows: [invoice] } = await client.query(
                'INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount) ' +
                'VALUES ($1, $2, $3, 0) RETURNING invoice_id', [`REG-INV-${suffix}`, id, actorId]);
            await client.query('INSERT INTO customer_payment (customer_id, employee_id, amount) VALUES ($1, $2, 0)',
                [id, actorId]);
            await client.query('INSERT INTO staged_sale (customer_id, employee_id, total_amount) VALUES ($1, $2, 0)',
                [id, actorId]);
            await client.query('INSERT INTO ar_adjustment (adjustment_no, customer_id, adjustment_type, ' +
                'reason_code, total_amount, granted_by) VALUES ($1, $2, $3, $4, 1, $5)',
            [`REG-ADJ-${suffix}`, id, 'SETTLEMENT_DISCOUNT', 'PROMPT_SETTLEMENT', actorId]);
            await client.query("INSERT INTO ar_adjustment_authorization_log (action, requested_by, customer_id) " +
                "VALUES ('AUTHORIZED', $1, $2)", [actorId, id]);
            await client.query("INSERT INTO ar_ledger (customer_id, entry_type, amount, balance_after) " +
                "VALUES ($1, 'INVOICE_POSTED', 0, 0)", [id]);
            await client.query('INSERT INTO withholding_tax_line (invoice_id, customer_id, withholding_type, ' +
                'treatment, rate_snapshot, tax_base, expected_withheld, actual_withheld) ' +
                "VALUES ($1, $2, 'EWT_GOODS', 'INCOME_TAX_CREDITABLE', 0, 0, 0, 0)", [invoice.invoice_id, id]);
            await client.query("INSERT INTO withholding_tax_certificate (customer_id, certificate_type) " +
                "VALUES ($1, '2307')", [id]);
            await client.query("INSERT INTO cheque_clearance_log (action, customer_id) VALUES ('RECEIVED', $1)", [id]);
            const service = new MasterDataMergeService(db, 'customer');
            const request = { keepId: keep.customer_id, mergeIds: [id] };
            const review = await service.review(client, request);
            expect(review.blockers).toEqual([]);
            for (const [table, column, action] of mergePolicy.customer.references) {
                if (action === 'move') expect(review.impact[`${table}.${column}`]).toBeGreaterThan(0);
            }
            const result = await service.executeWithClient(client,
                { ...request, previewFingerprint: review.fingerprint }, actorId);
            await expectNoSourceOwnership('customer', id);
            await client.query('SAVEPOINT reject_ar_ledger_edit');
            await expect(client.query('UPDATE ar_ledger SET amount = 2 WHERE customer_id = $1',
                [keep.customer_id])).rejects.toThrow('immutable');
            await client.query('ROLLBACK TO SAVEPOINT reject_ar_ledger_edit');
            await service.revertWithClient(client, result.operationId, actorId, 'Restore all customer relationships');
            const { rows: [restoredLedger] } = await client.query(
                'SELECT COUNT(*)::int AS count FROM ar_ledger WHERE customer_id = $1', [id]);
            const { rows: [restoredAdjustment] } = await client.query(
                'SELECT COUNT(*)::int AS count FROM ar_adjustment WHERE customer_id = $1', [id]);
            expect(restoredLedger.count).toBe(1);
            expect(restoredAdjustment.count).toBe(1);
        } finally {
            await client.query('ROLLBACK TO SAVEPOINT full_customer_registry');
        }
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
        const result = await service.executeWithClient(client, { ...request, previewFingerprint: review.fingerprint }, actorId);
        await expectNoSourceOwnership('group', source.group_id);
        const { rows: [retired] } = await client.query(
            'SELECT is_active, is_merged, merged_into_group_id FROM "group" WHERE group_id = $1',
            [source.group_id]);
        expect(retired).toEqual({ is_active: false, is_merged: true, merged_into_group_id: keep.group_id });
        await service.revertWithClient(client, result.operationId, actorId, 'Restore group');
        const { rows: [restored] } = await client.query(
            'SELECT is_active, is_merged, merged_into_group_id FROM "group" WHERE group_id = $1',
            [source.group_id]);
        expect(restored).toEqual({ is_active: true, is_merged: false, merged_into_group_id: null });
    });

    test('revert refuses an edited relationship and keeps the merge intact', async () => {
        const { keep, source, part, service, result } = await mergedBrandFixture('Edited relationship');
        await client.query('UPDATE part SET detail = $1 WHERE part_id = $2', ['Changed after merge', part.part_id]);
        await expect(service.revertWithClient(client, result.operationId, actorId, 'Undo edited merge'))
            .rejects.toMatchObject({ statusCode: 409 });
        const { rows: [current] } = await client.query('SELECT brand_id FROM part WHERE part_id = $1', [part.part_id]);
        const { rows: [master] } = await client.query('SELECT is_merged FROM brand WHERE brand_id = $1', [source.brand_id]);
        expect(current.brand_id).toBe(keep.brand_id);
        expect(master.is_merged).toBe(true);
    });

    test('revert refuses a later merge involving the canonical record', async () => {
        const { keep, service, result } = await mergedBrandFixture('Later merge');
        const { rows: [third] } = await client.query(
            'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING brand_id',
            [`Later merge third ${Date.now()}`, `BT${Date.now().toString().slice(-6)}`]);
        const request = { keepId: keep.brand_id, mergeIds: [third.brand_id] };
        const review = await service.review(client, request);
        await service.executeWithClient(client, { ...request, previewFingerprint: review.fingerprint }, actorId);
        await expect(service.revertWithClient(client, result.operationId, actorId, 'Undo first merge'))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    test('revert refuses new alias activity that could conflict with restored names', async () => {
        const { keep, service, result } = await mergedBrandFixture('Later alias');
        await client.query('INSERT INTO brand_alias (brand_id, alias_name) VALUES ($1, $2)',
            [keep.brand_id, `New alias ${Date.now()}`]);
        await expect(service.revertWithClient(client, result.operationId, actorId, 'Alias changed'))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    test('revert refuses expired windows and incomplete snapshots', async () => {
        const { service, result } = await mergedBrandFixture('Expired merge');
        await client.query("UPDATE master_data_merge_operation SET undo_expires_at = NOW() - INTERVAL '1 minute' WHERE operation_id = $1",
            [result.operationId]);
        await expect(service.revertWithClient(client, result.operationId, actorId, 'Too late'))
            .rejects.toMatchObject({ statusCode: 409 });
        await client.query("UPDATE master_data_merge_operation SET undo_expires_at = NOW() + INTERVAL '1 hour' WHERE operation_id = $1",
            [result.operationId]);
        await client.query('DELETE FROM master_data_merge_snapshot WHERE operation_id = $1 AND table_name = $2',
            [result.operationId, 'part']);
        await expect(service.revertWithClient(client, result.operationId, actorId, 'Missing snapshot'))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    test('snapshot cleanup keeps the compact audit after retention', async () => {
        const { service, result } = await mergedBrandFixture('Expired retention');
        await client.query(
            "UPDATE master_data_merge_operation SET undo_expires_at = NOW() - INTERVAL '91 days' WHERE operation_id = $1",
            [result.operationId]);
        expect(await service.purgeExpiredMergeSnapshotsWithClient(client)).toBeGreaterThan(0);
        const { rows: [operation] } = await client.query(
            'SELECT status FROM master_data_merge_operation WHERE operation_id = $1', [result.operationId]);
        const { rows: [remaining] } = await client.query(
            'SELECT COUNT(*)::int AS count FROM master_data_merge_snapshot WHERE operation_id = $1',
            [result.operationId]);
        expect(operation.status).toBe('expired');
        expect(remaining.count).toBe(0);
    });

    test('revert refuses new wallet activity', async () => {
        const suffix = String(Date.now() + 8);
        const { rows: [keep] } = await client.query('INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Wallet later keep ${suffix}`]);
        const { rows: [source] } = await client.query('INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Wallet later source ${suffix}`]);
        await client.query("SELECT append_wallet_transaction($1, 'ADVANCE_DEPOSIT'::wallet_transaction_type, 5)", [source.customer_id]);
        const service = new MasterDataMergeService(db, 'customer');
        const request = { keepId: keep.customer_id, mergeIds: [source.customer_id] };
        const review = await service.review(client, request);
        const result = await service.executeWithClient(client, { ...request, previewFingerprint: review.fingerprint }, actorId);
        await client.query("SELECT append_wallet_transaction($1, 'ADVANCE_DEPOSIT'::wallet_transaction_type, 2)", [keep.customer_id]);
        await expect(service.revertWithClient(client, result.operationId, actorId, 'Wallet changed'))
            .rejects.toMatchObject({ statusCode: 409 });
    });

    test('revert removes a canonical wallet created only by the merge', async () => {
        const suffix = String(Date.now() + 9);
        const { rows: [keep] } = await client.query('INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Wallet empty keep ${suffix}`]);
        const { rows: [source] } = await client.query('INSERT INTO customer (first_name) VALUES ($1) RETURNING customer_id', [`Wallet empty source ${suffix}`]);
        await client.query("SELECT append_wallet_transaction($1, 'ADVANCE_DEPOSIT'::wallet_transaction_type, 8)", [source.customer_id]);
        const service = new MasterDataMergeService(db, 'customer');
        const request = { keepId: keep.customer_id, mergeIds: [source.customer_id] };
        const review = await service.review(client, request);
        const result = await service.executeWithClient(client, { ...request, previewFingerprint: review.fingerprint }, actorId);
        await service.revertWithClient(client, result.operationId, actorId, 'Restore original wallet ownership');
        const { rows: wallets } = await client.query('SELECT customer_id, balance FROM customer_wallet WHERE customer_id = ANY($1::int[])',
            [[keep.customer_id, source.customer_id]]);
        expect(wallets).toHaveLength(1);
        expect(wallets[0].customer_id).toBe(source.customer_id);
        expect(Number(wallets[0].balance)).toBe(8);
    });

    test('revert rolls back every restoration if catalog enqueue fails', async () => {
        const { keep, source, part, service, result } = await mergedBrandFixture('Late revert failure');
        await client.query('SAVEPOINT late_revert_failure');
        await client.query("ALTER TABLE meili_sync_outbox ADD CONSTRAINT test_reject_master_revert_event " +
            "CHECK (payload->>'source' IS DISTINCT FROM 'masterDataMergeService.revert') NOT VALID");
        await expect(service.revertWithClient(client, result.operationId, actorId, 'Try revert'))
            .rejects.toMatchObject({ code: '23514' });
        await client.query('ROLLBACK TO SAVEPOINT late_revert_failure');
        const { rows: [current] } = await client.query('SELECT brand_id FROM part WHERE part_id = $1', [part.part_id]);
        const { rows: [master] } = await client.query('SELECT is_merged FROM brand WHERE brand_id = $1', [source.brand_id]);
        expect(current.brand_id).toBe(keep.brand_id);
        expect(master.is_merged).toBe(true);
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
