process.env.JWT_SECRET = process.env.JWT_SECRET || 'physical-document-checkout-test-secret';

const express = require('express');
const request = require('supertest');
const db = require('../db');
const physical = require('../services/physicalDocumentService');

let mockUser;
jest.mock('../middleware/authMiddleware', () => ({
    ...jest.requireActual('../middleware/authMiddleware'),
    protect: (req, _res, next) => { req.user = mockUser; next(); },
}));

const app = express();
app.use(express.json());
app.use('/api', require('../routes/invoiceRoutes'));

describe('POS spoiled suggestion checkout (real PostgreSQL)', () => {
    const stamp = `${Date.now()}_${process.pid}`;
    let employeeId, customerId, seriesId, partId, taxId, methodId;
    let serial = Date.now() * 10;
    const registry = async () => (await db.query(
        'SELECT canonical_full_reference, state FROM physical_document_registry WHERE series_id = $1 ORDER BY serial_number',
        [seriesId]
    )).rows;
    const invoiceCount = async () => Number((await db.query(
        'SELECT count(*) FROM invoice WHERE customer_id = $1', [customerId]
    )).rows[0].count);

    function payload() {
        const original = `SQA-${++serial}`;
        const replacement = `SQA-${++serial}`;
        return {
            customer_id: customerId, employee_id: employeeId,
            lines: [{ part_id: partId, quantity: 1, sale_price: 100, tax_rate_id: taxId }],
            payments: [{ method_id: methodId, amount_paid: 100, tendered_amount: 100 }],
            physical_receipt_no: replacement,
            physical_document: {
                recording_method: 'PAPER', series_id: seriesId, physical_receipt_no: replacement,
                suggestion_token: physical.signSuggestionToken({
                    series_id: seriesId, canonical_reference: original, employee_id: employeeId,
                }),
                exception: {
                    reason: 'SPOILED_SUGGESTION', original_suggestion: original,
                    entered_reference: replacement, spoiled_reference: original, notes: 'Paper torn',
                },
            },
        };
    }

    beforeAll(async () => {
        // These routes append immutable audit records; use an isolated test DB.
        const { rows: [employee] } = await db.query(
            `INSERT INTO employee (first_name, last_name, permission_level_id, username, password_hash, password_salt)
             SELECT 'Spoilage', 'Checkout Test', permission_level_id, $1, 'hash', 'salt'
             FROM permission_level LIMIT 1 RETURNING employee_id`, [`spoilage_${stamp}`]
        );
        employeeId = employee.employee_id;
        mockUser = { employee_id: employeeId, permission_level_id: 10, permissions: [] };
        const { rows: [customer] } = await db.query(
            "INSERT INTO customer (first_name, last_name) VALUES ('SpoilageCheckout', $1) RETURNING customer_id", [stamp]
        );
        customerId = customer.customer_id;
        const { rows: [type] } = await db.query(
            `INSERT INTO physical_document_type (code, name, short_label, controlled_category, tax_designation, is_active)
             VALUES ($1, 'Spoilage checkout', 'SQA', 'SALES_INVOICE', 'NON_VAT', true) RETURNING type_id`, [`SQA_${stamp}`]
        );
        const { rows: [series] } = await db.query(
            `INSERT INTO physical_document_series (type_id, code, name, prefix, initial_serial)
             VALUES ($1, $2, 'Spoilage checkout', 'SQA', 1) RETURNING series_id`, [type.type_id, `SQA_${stamp}`]
        );
        seriesId = series.series_id;
        const { rows: [brand] } = await db.query(
            'INSERT INTO brand (brand_name, brand_code) VALUES ($1, $2) RETURNING brand_id', [`Spoilage ${stamp}`, `SQ${String(Date.now()).slice(-8)}`]
        );
        const { rows: [group] } = await db.query(
            'INSERT INTO "group" (group_name, group_code) VALUES ($1, $2) RETURNING group_id', [`Spoilage ${stamp}`, `SQ${String(Date.now()).slice(-8)}`]
        );
        const { rows: [tax] } = await db.query(
            'INSERT INTO tax_rate (rate_name, rate_percentage, is_default) VALUES ($1, 0, false) RETURNING tax_rate_id', [`Spoilage ${stamp}`]
        );
        taxId = tax.tax_rate_id;
        await db.query(
            "INSERT INTO physical_document_series_tax (series_id, tax_rate_id, role) VALUES ($1, $2, 'DEFAULT_FALLBACK')", [seriesId, taxId]
        );
        const { rows: [part] } = await db.query(
            `INSERT INTO part (internal_sku, detail, brand_id, group_id, tax_rate_id)
             VALUES ($1, 'Spoilage checkout part', $2, $3, $4) RETURNING part_id`, [`SQA-${stamp}`, brand.brand_id, group.group_id, taxId]
        );
        partId = part.part_id;
        const { rows: [method] } = await db.query(
            `INSERT INTO payment_methods (name, code, type, enabled, config)
             VALUES ($1, $2, 'cash', true, '{"settlement_type":"instant"}') RETURNING method_id`, [`Spoilage cash ${stamp}`, `sqa_${stamp}`]
        );
        methodId = method.method_id;
    });

    test('issues the unused replacement and spoils only the original, with accurate audit details', async () => {
        const sale = payload();
        const doc = sale.physical_document;
        const res = await request(app).post('/api/invoices').send(sale);
        expect(res.status).toBe(201);
        expect(res.body.physical_receipt_no).toBe(doc.physical_receipt_no);
        expect(await registry()).toEqual([
            { canonical_full_reference: doc.exception.spoiled_reference, state: 'SPOILED' },
            { canonical_full_reference: doc.physical_receipt_no, state: 'ISSUED' },
        ]);
        const { rows: [event] } = await db.query(
            "SELECT * FROM physical_document_event WHERE series_id = $1 AND event_type = 'SPOILED'", [seriesId]
        );
        expect(event).toMatchObject({
            original_suggestion: doc.exception.spoiled_reference,
            submitted_reference: doc.physical_receipt_no,
            reason: 'SPOILED_SUGGESTION', notes: 'Paper torn', actor_id: employeeId,
        });
        const { rows: [link] } = await db.query(
            `SELECT r.canonical_full_reference FROM physical_document_source_link l
             JOIN physical_document_registry r USING (registry_id) WHERE l.invoice_id = $1 AND l.role = 'PRIMARY'`, [res.body.invoice_id]
        );
        expect(link.canonical_full_reference).toBe(doc.physical_receipt_no);
    });

    test.each(['ISSUED', 'SPOILED', 'VOIDED'])('rejects an already %s replacement with the number and reason, without spoiling the original', async state => {
        const sale = payload();
        const doc = sale.physical_document;
        await db.query(
            'INSERT INTO physical_document_registry (series_id, canonical_full_reference, serial_number, state) VALUES ($1, $2, $3, $4)',
            [seriesId, doc.physical_receipt_no, serial, state]
        );
        const before = await registry();
        const count = await invoiceCount();
        const res = await request(app).post('/api/invoices').send(sale);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe(state === 'SPOILED' ? 'RECEIPT_NUMBER_SPOILED' : 'RECEIPT_NUMBER_TAKEN');
        expect(res.body.message).toContain(`${doc.physical_receipt_no} is already ${state.toLowerCase()}`);
        expect(res.body.message).toContain('Choose an unused receipt number.');
        expect(await registry()).toEqual(before);
        expect(await invoiceCount()).toBe(count);
    });

    test('rolls back spoilage, replacement and audit events if a later checkout validation fails', async () => {
        const sale = payload();
        sale.payments[0].amount_paid = 101;
        const before = await registry();
        const count = await invoiceCount();
        const { rows: [eventsBefore] } = await db.query('SELECT count(*) FROM physical_document_event WHERE series_id = $1', [seriesId]);
        const res = await request(app).post('/api/invoices').send(sale);
        expect(res.status).toBe(400);
        expect(res.body.message).toBe('Total payments exceed invoice amount.');
        expect(await registry()).toEqual(before);
        expect(await invoiceCount()).toBe(count);
        const { rows: [eventsAfter] } = await db.query('SELECT count(*) FROM physical_document_event WHERE series_id = $1', [seriesId]);
        expect(eventsAfter.count).toBe(eventsBefore.count);
    });
});
