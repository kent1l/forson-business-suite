let mockCurrentUser = {
    employee_id: 1,
    username: 'admin',
    permission_level_id: 1,
    permissions: ['invoicing:create', 'ar:receive_payment', 'pos:use', 'settings:edit', 'ar:view'],
};

jest.mock('../middleware/authMiddleware', () => {
    const actual = jest.requireActual('../middleware/authMiddleware');
    return {
        ...actual,
        protect: (req, _res, next) => {
            req.user = mockCurrentUser;
            next();
        },
        hasPermission: (required) => (req, res, next) => {
            const reqPerms = Array.isArray(required) ? required : [required];
            const hasAny = reqPerms.some(p => mockCurrentUser.permissions.includes(p));
            if (hasAny) {
                return next();
            }
            return res.status(403).json({ message: 'Forbidden' });
        },
        userHasPermission: (user, perm) => {
            return user?.permissions?.includes(perm);
        },
    };
});

const request = require('supertest');
const express = require('express');
const db = require('../db');
const physicalDocumentRoutes = require('../routes/physicalDocumentRoutes');
const invoiceRoutes = require('../routes/invoiceRoutes');
const stagedSaleRoutes = require('../routes/stagedSaleRoutes');
const paymentRoutes = require('../routes/paymentRoutes');
const physicalDocumentService = require('../services/physicalDocumentService');

// Create test app with mocked auth
const app = express();
app.use(express.json());

app.use('/api', physicalDocumentRoutes);
app.use('/api', invoiceRoutes);
app.use('/api', stagedSaleRoutes);
app.use('/api', paymentRoutes);

describe('Physical Document System - Phase 2 & 3 API & Cashier Posting Integration', () => {
    let testSeriesId;
    let testTypeId;
    let testCustomerId;

    beforeAll(async () => {
        // Ensure test customer exists
        const existing = await db.query(`SELECT customer_id FROM public.customer WHERE is_active = true LIMIT 1`);
        if (existing.rows.length > 0) {
            testCustomerId = existing.rows[0].customer_id;
        } else {
            const custRes = await db.query(
                `INSERT INTO public.customer (first_name, last_name, is_active)
                 VALUES ('Test', 'Customer', true)
                 RETURNING customer_id`
            );
            testCustomerId = custRes.rows[0].customer_id;
        }

        // Activate SALES_INVOICE_VAT type for testing
        const typeRes = await db.query(
            `UPDATE public.physical_document_type 
             SET is_active = true 
             WHERE code = 'SALES_INVOICE_VAT' 
             RETURNING type_id`
        );
        testTypeId = typeRes.rows[0].type_id;

        // Create active test series
        const seriesRes = await db.query(
            `INSERT INTO public.physical_document_series 
             (type_id, code, name, prefix, method, initial_serial, min_serial, max_serial, is_active)
             VALUES ($1, 'TEST_SI_API_SERIES', 'Test SI API Series', 'TS', 'HIGHEST_PLUS_ONE', 1000, 1000, 9999, true)
             ON CONFLICT (code) DO UPDATE SET is_active = true, last_issued_serial = NULL, high_water_serial = NULL
             RETURNING series_id`,
            [testTypeId]
        );
        testSeriesId = seriesRes.rows[0].series_id;

        // Context eligibility for POS and CASHIER_APPROVAL
        await db.query(
            `INSERT INTO public.physical_document_series_context (series_id, context, workstation_id, is_active)
             VALUES ($1, 'POS', 'default', true), ($1, 'CASHIER_APPROVAL', 'default', true), ($1, 'COLLECTION', 'default', true)
             ON CONFLICT (series_id, context, COALESCE(workstation_id, '')) DO NOTHING`,
            [testSeriesId]
        );

        // Map tax rate (Zero-rate and VAT)
        await db.query(
            `INSERT INTO public.physical_document_series_tax (series_id, tax_rate_id, role)
             VALUES ($1, 1, 'DEFAULT_FALLBACK'), ($1, 2, 'ALLOWED_RESOLVED')
             ON CONFLICT (series_id, tax_rate_id) DO NOTHING`,
            [testSeriesId]
        );
    });

    test('GET /api/physical-documents/options returns eligible series and effective policy', async () => {
        const res = await request(app)
            .get('/api/physical-documents/options?context=POS&workstation_id=default')
            .expect(200);

        expect(res.body).toHaveProperty('policy');
        expect(res.body).toHaveProperty('series');
        expect(Array.isArray(res.body.series)).toBe(true);
        const testSeries = res.body.series.find(s => s.series_id === testSeriesId);
        expect(testSeries).toBeDefined();
        expect(testSeries.prefix).toBe('TS');
    });

    test('GET /api/physical-documents/suggestion returns next serial and valid signed token', async () => {
        const res = await request(app)
            .get(`/api/physical-documents/suggestion?series_id=${testSeriesId}&context=POS`)
            .expect(200);

        expect(res.body.series_id).toBe(testSeriesId);
        expect(res.body.serial).toBe(1000);
        expect(res.body.canonical_reference).toBe('TS-1000');
        expect(res.body.suggestion_token).toBeTruthy();

        // Verify token cryptographically
        const verified = physicalDocumentService.verifySuggestionToken(res.body.suggestion_token);
        expect(verified).not.toBeNull();
        expect(verified.series_id).toBe(testSeriesId);
        expect(verified.canonical_reference).toBe('TS-1000');
    });

    test('POST /api/physical-documents/validate verifies prefix, format, and availability', async () => {
        // Valid suggestion
        const validRes = await request(app)
            .post('/api/physical-documents/validate')
            .send({
                series_id: testSeriesId,
                physical_receipt_no: 'ts 1000',
            })
            .expect(200);
        expect(validRes.body.valid).toBe(true);
        expect(validRes.body.canonical).toBe('TS-1000');
        expect(validRes.body.serial).toBe(1000);

        // Prefix mismatch
        const prefixRes = await request(app)
            .post('/api/physical-documents/validate')
            .send({
                series_id: testSeriesId,
                physical_receipt_no: 'DR-1000',
            })
            .expect(200);
        expect(prefixRes.body.valid).toBe(false);
        expect(prefixRes.body.code).toBe('PREFIX_MISMATCH');
    });

    test('POST /api/sales/staging rejects partsman physical receipt assignment', async () => {
        const res = await request(app)
            .post('/api/sales/staging')
            .send({
                customer_id: testCustomerId,
                lines: [{ part_id: 1, quantity: 1, sale_price: 100 }],
                physical_receipt_no: 'TS-1000',
            })
            .expect(422);

        expect(res.body.code).toBe('PARTSMAN_RECEIPT_ASSIGNMENT_PROHIBITED');
    });

    test('POST /api/settings/physical-document-series/:id/adjust-sequence audits sequence adjustment', async () => {
        const { rows } = await db.query(`SELECT version FROM physical_document_series WHERE series_id = $1`, [testSeriesId]);
        const currentVersion = rows[0].version;

        const res = await request(app)
            .post(`/api/settings/physical-document-series/${testSeriesId}/adjust-sequence`)
            .send({
                expected_version: currentVersion,
                high_water_serial: 1050,
                last_issued_serial: 1050,
                reason: 'Stock jump to new booklet #2',
                notes: 'Audited sequence jump',
            })
            .expect(200);

        expect(res.body.series.high_water_serial).toBe('1050');
        expect(res.body.next_preview.serial).toBe(1051);
        expect(res.body.next_preview.canonical_reference).toBe('TS-1051');

        // Check event logged
        const { rows: events } = await db.query(
            `SELECT * FROM physical_document_event WHERE series_id = $1 AND event_type = 'SEQUENCE_ADJUSTED' ORDER BY created_at DESC LIMIT 1`,
            [testSeriesId]
        );
        expect(events.length).toBe(1);
        expect(events[0].reason).toBe('Stock jump to new booklet #2');
    });

    test('POST /api/settings/physical-document-spoilage records spoilage and correct releases it', async () => {
        // Spoil TS-1052
        const spoilRes = await request(app)
            .post('/api/settings/physical-document-spoilage')
            .send({
                series_id: testSeriesId,
                physical_receipt_no: 'TS-1052',
                reason: 'Printer jammed and tore paper',
            })
            .expect(201);

        expect(spoilRes.body.state).toBe('SPOILED');
        expect(spoilRes.body.canonical_full_reference).toBe('TS-1052');
        const regId = spoilRes.body.registry_id;

        // Verify taken as spoiled
        const checkRes = await request(app)
            .post('/api/physical-documents/validate')
            .send({
                series_id: testSeriesId,
                physical_receipt_no: 'TS-1052',
            })
            .expect(200);
        expect(checkRes.body.valid).toBe(false);
        expect(checkRes.body.code).toBe('RECEIPT_NUMBER_SPOILED');

        // Correct spoilage -> UNOCCUPIED
        const correctRes = await request(app)
            .post(`/api/settings/physical-document-spoilage/${regId}/correct`)
            .send({
                reason: 'Printer did not tear, booklet inspected and intact',
            })
            .expect(200);

        expect(correctRes.body.registry.state).toBe('UNOCCUPIED');

        // Verify now available
        const checkAfter = await request(app)
            .post('/api/physical-documents/validate')
            .send({
                series_id: testSeriesId,
                physical_receipt_no: 'TS-1052',
            })
            .expect(200);
        expect(checkAfter.body.valid).toBe(true);
    });

    test('POST /api/payments/collection-group groups multiple payment tenders under a single physical collection receipt', async () => {
        // Create collection series
        const colTypeRes = await db.query(`SELECT type_id FROM physical_document_type WHERE code = 'COLLECTION_RECEIPT'`);
        const colTypeId = colTypeRes.rows[0].type_id;
        await db.query(`UPDATE physical_document_type SET is_active = true WHERE type_id = $1`, [colTypeId]);

        const colSeriesRes = await db.query(
            `INSERT INTO physical_document_series (type_id, code, name, prefix, method, initial_serial, is_active)
             VALUES ($1, 'TEST_CR_SERIES', 'Test Collection Receipt Series', 'CRTEST', 'HIGHEST_PLUS_ONE', 500, true)
             ON CONFLICT (code) DO UPDATE SET is_active = true
             RETURNING series_id`,
            [colTypeId]
        );
        const colSeriesId = colSeriesRes.rows[0].series_id;

        const res = await request(app)
            .post('/api/payments/collection-group')
            .send({
                customer_id: testCustomerId,
                request_id: `test-crg-${Date.now()}`,
                physical_document: {
                    recording_method: 'PAPER',
                    series_id: colSeriesId,
                    physical_receipt_no: 'CRTEST-500',
                },
                payments: [
                    { amount: 300, method_id: 1, payment_method: 'cash', reference_number: 'CASH-1' },
                    { amount: 700, method_id: 2, payment_method: 'cheque', reference_number: 'CHK-999', cheque_date: '2026-11-15' },
                ],
                allocations: [],
            });

        // If no allocations passed, 400 is expected
        expect(res.status).toBe(400);

        // Now test with dummy allocation
        const invRes = await db.query(
            `INSERT INTO public.invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, terms, payment_terms_days, due_date)
             VALUES ($1, $2, 1, 1000, 1000, 0, 0, 'Unpaid', 'COD', 0, CURRENT_TIMESTAMP)
             RETURNING invoice_id`,
            [`TEST-INV-CRG-${Date.now()}`, testCustomerId]
        );
        const testInvoiceId = invRes.rows[0].invoice_id;

        const validGroupRes = await request(app)
            .post('/api/payments/collection-group')
            .send({
                customer_id: testCustomerId,
                request_id: `test-crg-${Date.now()}`,
                physical_document: {
                    recording_method: 'PAPER',
                    series_id: colSeriesId,
                    physical_receipt_no: 'CRTEST-500',
                },
                payments: [
                    { amount: 300, method_id: 1, payment_method: 'cash', reference_number: 'CASH-1' },
                    { amount: 700, method_id: 2, payment_method: 'cheque', reference_number: 'CHK-999', cheque_date: '2026-11-15' },
                ],
                allocations: [
                    { invoice_id: testInvoiceId, amount_allocated: 1000 }
                ],
            })
            .expect(201);

        expect(validGroupRes.body.group_id).toBeDefined();
        expect(validGroupRes.body.physical_receipt_no).toBe('CRTEST-500');
        expect(validGroupRes.body.payments.length).toBe(2);

        // Verify only ONE registry row was created for CRTEST-500
        const { rows: regCheck } = await db.query(
            `SELECT count(*) FROM physical_document_registry WHERE series_id = $1 AND canonical_full_reference = 'CRTEST-500'`,
            [colSeriesId]
        );
        expect(parseInt(regCheck[0].count, 10)).toBe(1);

        // Verify both customer_payment rows link to the same collection_group_id
        const { rows: payCheck } = await db.query(
            `SELECT collection_group_id, physical_receipt_no FROM customer_payment WHERE collection_group_id = $1`,
            [validGroupRes.body.group_id]
        );
        expect(payCheck.length).toBe(2);
        expect(payCheck[0].physical_receipt_no).toBe('CRTEST-500');
        expect(payCheck[1].physical_receipt_no).toBe('CRTEST-500');
    });
});
