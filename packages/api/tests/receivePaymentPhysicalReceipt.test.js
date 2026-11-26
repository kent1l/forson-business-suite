process.env.JWT_SECRET = process.env.JWT_SECRET || 'receive-payment-physical-receipt-test-secret';

const request = require('supertest');
const express = require('express');
const db = require('../db');
const arRoutes = require('../routes/arRoutes');
const customerRoutes = require('../routes/customerRoutes');
const paymentRoutes = require('../routes/paymentRoutes');
const physicalDocumentService = require('../services/physicalDocumentService');
const receiptMonitorService = require('../services/receiptMonitorService');

let mockUser = { user_id: 1, employee_id: 1, username: 'admin', permissions: ['ar:view', 'ar:manage', 'ar:receive_payment'] };

// Mock authMiddleware to bypass auth during test runs
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = mockUser;
        next();
    },
    hasPermission: () => (req, res, next) => next()
}));

const app = express();
app.use(express.json());
app.use('/api', arRoutes);
app.use('/api', customerRoutes);
app.use('/api', paymentRoutes);

describe('AR Payment Physical Receipt # & SOA Reference Integration Suite', () => {
    let testCustomerId;
    let testInvoiceId;
    let testInvoiceReceiptNo;
    let testEmployeeId;
    let testSeriesId;
    let crvSeriesId;
    let testReceiptNo;

    beforeAll(async () => {
        const uniqueSuffix = Date.now();
        testReceiptNo = `ORPMT-${uniqueSuffix}`;
        testInvoiceReceiptNo = `OR-TEST-${uniqueSuffix}`;
        const uniqueEmail = `soareceipt_${uniqueSuffix}@test.com`;

        // Reuse an existing permission_level to avoid sequence/PK conflicts with seeded data
        const plRes = await db.query(`SELECT permission_level_id FROM permission_level LIMIT 1`);
        const permLevelId = plRes.rows[0].permission_level_id;

        // Create a test employee to satisfy the invoice FK
        const empRes = await db.query(`
            INSERT INTO employee (first_name, last_name, permission_level_id, username, password_hash, password_salt)
            VALUES ('Test', 'SOA', $1, 'testsoa_${uniqueSuffix}', 'hash', 'salt')
            RETURNING employee_id
        `, [permLevelId]);
        testEmployeeId = empRes.rows[0].employee_id;
        mockUser.employee_id = testEmployeeId;
        mockUser.user_id = testEmployeeId;

        const { rows: [series] } = await db.query(`
            INSERT INTO physical_document_series (type_id, code, name, prefix, method, initial_serial, is_active)
            SELECT type_id, $1, 'Payment reference test', 'ORPMT', 'HIGHEST_PLUS_ONE', $2, true
            FROM physical_document_type WHERE code = 'COLLECTION_RECEIPT'
            RETURNING series_id
        `, [`PAYMENT_REF_${uniqueSuffix}`, uniqueSuffix]);
        testSeriesId = series.series_id;

        const { rows: [crvSeries] } = await db.query(`
            INSERT INTO physical_document_series (type_id, code, name, prefix, method, initial_serial, min_serial, max_serial, is_active)
            SELECT type_id, $1, 'CRV regression test', 'CRV', 'HIGHEST_PLUS_ONE', $2, $2, $3, true
            FROM physical_document_type WHERE code = 'COLLECTION_RECEIPT'
            RETURNING series_id
        `, [`CRV_TEST_${uniqueSuffix}`, uniqueSuffix, uniqueSuffix + 10]);
        crvSeriesId = crvSeries.series_id;

        await db.query(`UPDATE physical_document_type SET is_active = true WHERE code = 'COLLECTION_RECEIPT'`);
        await db.query(`INSERT INTO physical_document_series_context (series_id, context, workstation_id, is_active)
            VALUES ($1, 'COLLECTION', 'default', true), ($2, 'COLLECTION', 'default', true)`, [testSeriesId, crvSeriesId]);

        const custRes = await db.query(`
            INSERT INTO customer (company_name, first_name, last_name, email, phone, credit_limit)
            VALUES ('Physical Receipt Test Corp', 'Jane', 'Doe', $1, '09170001111', 50000.00)
            RETURNING customer_id
        `, [uniqueEmail]);
        testCustomerId = custRes.rows[0].customer_id;

        const invRes = await db.query(`
            INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, physical_receipt_no)
            VALUES ($1, $2, $3, 5000.00, 5000.00, 0, 0, 'Unpaid', $4)
            RETURNING invoice_id
        `, [`INV-TEST-${uniqueSuffix}`, testCustomerId, testEmployeeId, testInvoiceReceiptNo]);
        testInvoiceId = invRes.rows[0].invoice_id;

        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            await client.query(`
                SELECT append_ar_ledger_entry(
                    $1, $2, NULL, NULL,
                    'INVOICE_POSTED'::ar_ledger_entry_type,
                    5000.00, NULL, $3, 'Invoice Charge', $4
                )
            `, [testCustomerId, testInvoiceId, testInvoiceReceiptNo, testEmployeeId]);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    });


    afterAll(async () => {
        const seriesIds = [testSeriesId, crvSeriesId].filter(Boolean);
        if (seriesIds.length > 0) {
            await db.query(`DELETE FROM physical_document_last_success WHERE last_series_id = ANY($1::int[])`, [seriesIds]).catch(() => {});
            await db.query(`DELETE FROM physical_document_event WHERE series_id = ANY($1::int[])`, [seriesIds]).catch(() => {});
            await db.query(`DELETE FROM physical_document_source_link WHERE registry_id IN (SELECT registry_id FROM physical_document_registry WHERE series_id = ANY($1::int[]))`, [seriesIds]).catch(() => {});
            await db.query(`DELETE FROM physical_document_series_context WHERE series_id = ANY($1::int[])`, [seriesIds]).catch(() => {});
        }
        if (testCustomerId) {
            try {
                await db.query(`DELETE FROM ar_ledger WHERE customer_id = $1`, [testCustomerId]);
            } catch {
                // Ignore immutability guard
            }
            await db.query(`DELETE FROM invoice_payment_allocation WHERE invoice_id = $1`, [testInvoiceId]).catch(() => {});
            await db.query(`DELETE FROM customer_payment WHERE customer_id = $1`, [testCustomerId]).catch(() => {});
            await db.query(`DELETE FROM invoice WHERE customer_id = $1`, [testCustomerId]).catch(() => {});
            await db.query(`DELETE FROM customer_wallet WHERE customer_id = $1`, [testCustomerId]).catch(() => {});
            await db.query(`DELETE FROM customer WHERE customer_id = $1`, [testCustomerId]).catch(() => {});
        }
        if (seriesIds.length > 0) {
            await db.query(`DELETE FROM physical_document_registry WHERE series_id = ANY($1::int[])`, [seriesIds]).catch(() => {});
            await db.query(`UPDATE physical_document_series SET is_active = false WHERE series_id = ANY($1::int[])`, [seriesIds]).catch(() => {});
        }
        if (testEmployeeId) {
            await db.query(`DELETE FROM employee WHERE employee_id = $1`, [testEmployeeId]).catch(() => {});
        }
    });


    test('GET /api/customers/:id/unpaid-invoices returns physical_receipt_no for each open invoice', async () => {
        const { rows: [noPaperInv] } = await db.query(`
            INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, physical_receipt_no)
            VALUES ($1, $2, $3, 1200.00, 1200.00, 0, 0, 'Unpaid', NULL)
            RETURNING invoice_id
        `, [`INV-NOPAPER-${Date.now()}`, testCustomerId, testEmployeeId]);

        try {
            const res = await request(app)
                .get(`/api/customers/${testCustomerId}/unpaid-invoices`);

            expect(res.status).toBe(200);
            expect(Array.isArray(res.body)).toBe(true);

            const paperRow = res.body.find(inv => inv.invoice_id === testInvoiceId);
            const noPaperRow = res.body.find(inv => inv.invoice_id === noPaperInv.invoice_id);

            expect(paperRow).toBeDefined();
            expect(paperRow.physical_receipt_no).toBe(testInvoiceReceiptNo);
            expect(noPaperRow).toBeDefined();
            expect(noPaperRow.physical_receipt_no).toBeNull();
        } finally {
            await db.query(`DELETE FROM invoice WHERE invoice_id = $1`, [noPaperInv.invoice_id]);
        }
    });

    test('POST /api/payments saves physical_receipt_no and internal reference to customer_payment when both physical_receipt_no and physical_document are sent', async () => {
        const res = await request(app)
            .post('/api/payments')
            .send({
                customer_id: testCustomerId,
                amount: 2000.00,
                method_id: 1, // Cash / Bank / Default
                payment_method: 'cash',
                reference: 'GCASH-987654321', // Internal tracking ref
                physical_receipt_no: testReceiptNo,
                physical_document: {
                    recording_method: 'PAPER',
                    series_id: testSeriesId,
                    physical_receipt_no: testReceiptNo,
                },
                notes: 'Test receive payment physical receipt',
                allocations: [
                    { invoice_id: testInvoiceId, amount_allocated: 2000.00 }
                ]
            });

        expect(res.status).toBe(201);
        expect(res.body.payment_id).toBeDefined();

        // Verify database contents
        const cpRes = await db.query(`
            SELECT physical_receipt_no, reference_number, physical_document_series_id, physical_document_registry_id
            FROM customer_payment
            WHERE payment_id = $1
        `, [res.body.payment_id]);

        expect(cpRes.rows.length).toBe(1);
        expect(cpRes.rows[0].physical_receipt_no).toBe(testReceiptNo);
        expect(cpRes.rows[0].reference_number).toBe('GCASH-987654321');
        expect(cpRes.rows[0].physical_document_series_id).toBe(testSeriesId);
        expect(cpRes.rows[0].physical_document_registry_id).toBeTruthy();
    });

    test('POST /api/payments accepts CRV series with suggestion_token, updates registry/monitor, and rejects true duplicates', async () => {
        const sug = await physicalDocumentService.getSuggestion(crvSeriesId, 'COLLECTION', null, testEmployeeId);
        expect(sug.canonical_reference).toMatch(/^CRV-\d+$/);

        const res = await request(app)
            .post('/api/payments')
            .send({
                customer_id: testCustomerId,
                amount: 1000.00,
                method_id: 1,
                payment_method: 'cash',
                physical_receipt_no: sug.canonical_reference,
                physical_document: {
                    recording_method: 'PAPER',
                    series_id: crvSeriesId,
                    physical_receipt_no: sug.canonical_reference,
                    suggestion_token: sug.suggestion_token,
                },
                allocations: [{ invoice_id: testInvoiceId, amount_allocated: 1000.00 }],
            });

        expect(res.status).toBe(201);
        expect(res.body.payment_id).toBeDefined();

        const regRes = await db.query(
            `SELECT state, canonical_full_reference, serial_number FROM physical_document_registry WHERE series_id = $1`,
            [crvSeriesId]
        );
        expect(regRes.rows).toEqual([
            expect.objectContaining({ state: 'ISSUED', canonical_full_reference: sug.canonical_reference })
        ]);

        const monRes = await receiptMonitorService.monitor({
            series_id: crvSeriesId,
            status: 'ALL',
            search: sug.canonical_reference,
        });
        expect(monRes.items[0]).toMatchObject({
            reference: sug.canonical_reference,
            status: 'ISSUED',
        });

        // Reusing the exact same CRV number must still return 409 Conflict
        const dupRes = await request(app)
            .post('/api/payments')
            .send({
                customer_id: testCustomerId,
                amount: 500.00,
                method_id: 1,
                payment_method: 'cash',
                physical_receipt_no: sug.canonical_reference,
                physical_document: {
                    recording_method: 'PAPER',
                    series_id: crvSeriesId,
                    physical_receipt_no: sug.canonical_reference,
                },
                allocations: [{ invoice_id: testInvoiceId, amount_allocated: 500.00 }],
            });
        expect(dupRes.status).toBe(409);
    });

    test('POST /api/payments excludes BOUNCED cheque allocations when checking invoice remaining balance', async () => {
        const { rows: [bouncedMethod] } = await db.query(
            `SELECT method_id FROM payment_methods WHERE (code IN ('cheque', 'pdc') OR type = 'cheque') AND enabled = true LIMIT 1`
        );
        const sug1 = await physicalDocumentService.getSuggestion(crvSeriesId, 'COLLECTION', null, testEmployeeId);
        const chequeRes = await request(app)
            .post('/api/payments')
            .send({
                customer_id: testCustomerId,
                amount: 2000.00,
                method_id: bouncedMethod.method_id,
                reference: 'CHK-BOUNCE-1',
                cheque_date: '2026-12-01',
                physical_receipt_no: sug1.canonical_reference,
                physical_document: {
                    recording_method: 'PAPER',
                    series_id: crvSeriesId,
                    physical_receipt_no: sug1.canonical_reference,
                    suggestion_token: sug1.suggestion_token,
                },
                allocations: [{ invoice_id: testInvoiceId, amount_allocated: 2000.00 }],
            });
        expect(chequeRes.status).toBe(201);

        await db.query(`UPDATE customer_payment SET pdc_status = 'BOUNCED' WHERE payment_id = $1`, [chequeRes.body.payment_id]);
        await db.query(`SELECT recompute_invoice_settlement($1)`, [testInvoiceId]);

        const sug2 = await physicalDocumentService.getSuggestion(crvSeriesId, 'COLLECTION', null, testEmployeeId);
        const replacementRes = await request(app)
            .post('/api/payments')
            .send({
                customer_id: testCustomerId,
                amount: 2000.00,
                method_id: 1,
                payment_method: 'cash',
                physical_receipt_no: sug2.canonical_reference,
                physical_document: {
                    recording_method: 'PAPER',
                    series_id: crvSeriesId,
                    physical_receipt_no: sug2.canonical_reference,
                    suggestion_token: sug2.suggestion_token,
                },
                allocations: [{ invoice_id: testInvoiceId, amount_allocated: 2000.00 }],
            });
        expect(replacementRes.status).toBe(201);
    });

    test('GET /api/ar/customers/:customerId/ledger displays physical_receipt_no as primary_ref and reference_number as sub_ref for payment', async () => {
        const res = await request(app)
            .get(`/api/ar/customers/${testCustomerId}/ledger`);

        expect(res.status).toBe(200);
        const paymentRow = res.body.ledger_rows.find(r => r.event_type === 'PAYMENT_SETTLED');
        expect(paymentRow).toBeDefined();
        expect(paymentRow.physical_receipt_no).toBe(testReceiptNo);
        expect(paymentRow.primary_ref).toBe(testReceiptNo);
        expect(paymentRow.reference).toBe(testReceiptNo);
        expect(paymentRow.sub_ref).toMatch(/^PMT-\d{6}-\d{4}$/);
        expect(paymentRow.payment_ref_no).toBe('GCASH-987654321');
    });
});
