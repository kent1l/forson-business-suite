const request = require('supertest');
const express = require('express');
const db = require('../db');
const MasterDataMergeService = require('../services/masterDataMergeService');
const customerRoutes = require('../routes/customerRoutes');
const arRoutes = require('../routes/arRoutes');
const walletRoutes = require('../routes/walletRoutes');

jest.setTimeout(60000);

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { user_id: 1, employee_id: 1, username: 'admin', permissions: ['ar:view', 'customers:view', 'customers:edit'] };
        next();
    },
    hasPermission: () => (req, res, next) => next(),
}));

const app = express();
app.use(express.json());
app.use('/api', customerRoutes);
app.use('/api', arRoutes);
app.use('/api', walletRoutes);

describe('Merged Customer SOA & Directory Resolution', () => {
    const originalSecret = process.env.JWT_SECRET;
    let actorId;
    let canonicalId;
    let duplicateId;
    let invoiceId;
    let operationId;
    let sharedToken;
    let duplicateSurname;

    beforeAll(async () => {
        process.env.JWT_SECRET = process.env.JWT_SECRET || 'soa-merge-test-secret';
        const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
        sharedToken = `AdelaMerge${suffix}`;
        duplicateSurname = `Flanas${suffix}`;

        const { rows: [actor] } = await db.query('SELECT employee_id FROM employee ORDER BY employee_id LIMIT 1');
        if (actor) {
            actorId = actor.employee_id;
        } else {
            const { rows: [createdActor] } = await db.query(
                "INSERT INTO employee (first_name, last_name) VALUES ('MergeSoa', 'Tester') RETURNING employee_id"
            );
            actorId = createdActor.employee_id;
        }

        const { rows: [canonical] } = await db.query(
            `INSERT INTO customer (customer_code, first_name, last_name, is_active)
             VALUES ($1, $2, $3, TRUE) RETURNING customer_id`,
            [`TMK-${suffix}`, sharedToken, `Planas${suffix}`]
        );
        canonicalId = canonical.customer_id;

        const { rows: [duplicate] } = await db.query(
            `INSERT INTO customer (customer_code, first_name, last_name, is_active)
             VALUES ($1, $2, $3, TRUE) RETURNING customer_id`,
            [`TMD-${suffix}`, sharedToken, duplicateSurname]
        );
        duplicateId = duplicate.customer_id;

        const { rows: [inv] } = await db.query(
            `INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, amount_paid, status)
             VALUES ($1, $2, $3, 4500.00, 4500.00, 'Paid') RETURNING invoice_id`,
            [`TMINV-${suffix}`, duplicateId, actorId]
        );
        invoiceId = inv.invoice_id;

        const service = new MasterDataMergeService(db, 'customer');
        const preview = await service.preview({ keepId: canonicalId, mergeIds: [duplicateId] }, actorId);
        const result = await service.execute({
            keepId: canonicalId,
            mergeIds: [duplicateId],
            suggestionIds: [],
            previewFingerprint: preview.previewFingerprint,
            previewToken: preview.previewToken,
            acknowledgeHistoricalDocuments: true,
        }, actorId);
        operationId = result.operationId;
    });

    afterAll(async () => {
        try {
            if (operationId) {
                const service = new MasterDataMergeService(db, 'customer');
                await service.revert(operationId, actorId, 'Merged customer SOA test cleanup').catch(() => {});
                await db.query('DELETE FROM master_data_merge_operation WHERE operation_id = $1', [operationId]).catch(() => {});
            }
            if (invoiceId) {
                await db.query('DELETE FROM invoice WHERE invoice_id = $1', [invoiceId]).catch(() => {});
            }
            if (canonicalId && duplicateId) {
                await db.query('DELETE FROM customer_alias WHERE customer_id = ANY($1::int[])', [[canonicalId, duplicateId]]).catch(() => {});
                await db.query('DELETE FROM customer WHERE customer_id = ANY($1::int[])', [[canonicalId, duplicateId]]).catch(() => {});
            }
        } finally {
            if (originalSecret === undefined) delete process.env.JWT_SECRET;
            else process.env.JWT_SECRET = originalSecret;
        }
    });

    test('GET /api/customers/with-balances excludes merged customer and finds canonical via alias', async () => {
        const res = await request(app).get(`/api/customers/with-balances?paginated=1&search=${encodeURIComponent(sharedToken)}`);
        expect(res.status).toBe(200);
        expect(res.body.data.map(r => r.customer_id)).toEqual([canonicalId]);
        expect(Number(res.body.data[0].total_invoiced)).toBe(4500);

        const aliasRes = await request(app).get(`/api/customers/with-balances?paginated=1&search=${encodeURIComponent(duplicateSurname)}`);
        expect(aliasRes.status).toBe(200);
        expect(aliasRes.body.data.map(r => r.customer_id)).toEqual([canonicalId]);
    });

    test('GET /api/ar/customer-summary excludes merged customer across all balance scopes and searches aliases', async () => {
        for (const scope of ['all', 'settled']) {
            const res = await request(app).get(`/api/ar/customer-summary?paginated=1&balanceScope=${scope}&search=${encodeURIComponent(sharedToken)}`);
            expect(res.status).toBe(200);
            expect(res.body.data.map(r => r.customer_id)).toEqual([canonicalId]);
        }

        const aliasRes = await request(app).get(`/api/ar/customer-summary?paginated=1&balanceScope=all&search=${encodeURIComponent(duplicateSurname)}`);
        expect(aliasRes.status).toBe(200);
        expect(aliasRes.body.data.map(r => r.customer_id)).toEqual([canonicalId]);
    });

    test('GET /api/ar/customers/:mergedId/ledger resolves to canonical customer', async () => {
        const res = await request(app).get(`/api/ar/customers/${duplicateId}/ledger`);
        expect(res.status).toBe(200);
        expect(res.headers['x-canonical-customer-id']).toBe(String(canonicalId));
        expect(res.body.resolved_from_customer_id).toBe(duplicateId);
        expect(res.body.customer.customer_id).toBe(canonicalId);
        expect(res.body.statement_number).toMatch(new RegExp(`^SOA-${canonicalId}-\\d{8}$`));
    });

    test('GET /api/ar/customers/:mergedId/soa/pdf resolves to canonical customer and streams PDF', async () => {
        const res = await request(app)
            .get(`/api/ar/customers/${duplicateId}/soa/pdf?include_receipts=false`)
            .buffer()
            .parse((response, callback) => {
                response.data = [];
                response.on('data', chunk => response.data.push(chunk));
                response.on('end', () => callback(null, Buffer.concat(response.data)));
            });

        expect(res.status).toBe(200);
        expect(res.headers['x-canonical-customer-id']).toBe(String(canonicalId));
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.body.length).toBeGreaterThan(1000);
    });
});
