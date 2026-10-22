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
app.use('/api', require('../routes/salesCorrectionRoutes'));
app.use('/api', require('../routes/refundRoutes'));

describe('Sales History receipt actions (real PostgreSQL)', () => {
    let employeeId, customerId, seriesId, typeId, partId, taxRateId;
    const stamp = Date.now();
    let serial = stamp * 100;
    const reason = 'Correct the paper assignment';
    const decision = (overrides = {}) => ({
        recording_method: 'PAPER', series_id: seriesId, physical_receipt_no: `RQA-${++serial}`,
        reason, paper_outcome: 'VOIDED', expected_version: 1, ...overrides,
    });
    const read = async id => (await db.query('SELECT * FROM invoice WHERE invoice_id = $1', [id])).rows[0];
    const registry = async id => (await db.query('SELECT * FROM physical_document_registry WHERE registry_id = $1', [id])).rows[0];

    async function makeInvoice({ paper = true, legacy = false, total = 0 } = {}) {
        const reference = `RQA-${++serial}`;
        const { rows: [invoice] } = await db.query(
            `INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total,
                amount_paid, status, recording_method, physical_receipt_no)
             VALUES ($1, $2, $3, $4, $4, 0, 0, 'Unpaid', $5, $6) RETURNING *`,
            [`INV-RQA-${stamp}-${serial}`, customerId, employeeId, total, paper ? 'PAPER' : 'NOTEBOOK', legacy ? reference : null]
        );
        if (paper && !legacy) {
            const client = await db.getClient();
            try {
                await client.query('BEGIN');
                const assigned = await physical.postPhysicalDocument(client, {
                    recording_method: 'PAPER', series_id: seriesId, physical_receipt_no: reference,
                    source_type: 'INVOICE', source_id: invoice.invoice_id, employee_id: employeeId,
                });
                await client.query(
                    `UPDATE invoice SET physical_receipt_no = $2, physical_document_type_id = $3,
                        physical_document_series_id = $4, physical_document_registry_id = $5 WHERE invoice_id = $1`,
                    [invoice.invoice_id, reference, typeId, seriesId, assigned.registry_id]
                );
                await client.query('COMMIT');
            } catch (err) { await client.query('ROLLBACK'); throw err; }
            finally { client.release(); }
        }
        return read(invoice.invoice_id);
    }

    beforeAll(async () => {
        // These tests write financial audit evidence. Run against an isolated DB;
        // never delete immutable ledgers or disable their protective triggers.
        const { rows: [emp] } = await db.query('SELECT employee_id FROM employee LIMIT 1');
        employeeId = emp.employee_id;
        const { rows: [cust] } = await db.query("INSERT INTO customer (first_name, last_name) VALUES ('ReceiptAction', $1) RETURNING customer_id", [String(stamp)]);
        customerId = cust.customer_id;
        const { rows: [type] } = await db.query(
            `INSERT INTO physical_document_type (code, name, short_label, controlled_category, tax_designation, is_active)
             VALUES ($1, 'Receipt action test', 'RQA', 'SALES_INVOICE', 'NON_VAT', true) RETURNING type_id`, [`RQA_${stamp}`]
        );
        typeId = type.type_id;
        const { rows: [series] } = await db.query(
            `INSERT INTO physical_document_series (type_id, code, name, prefix, initial_serial, min_serial, max_serial)
             VALUES ($1, $2, 'Receipt action test', 'RQA', 1, 1, 999999999999999) RETURNING series_id`, [typeId, `RQA_${stamp}`]
        );
        seriesId = series.series_id;
        await db.query("INSERT INTO physical_document_series_context (series_id, context) VALUES ($1, 'POS')", [seriesId]);
        const { rows: [part] } = await db.query('SELECT part_id FROM part LIMIT 1');
        partId = part.part_id;
        const { rows: [tax] } = await db.query('SELECT tax_rate_id FROM tax_rate LIMIT 1');
        taxRateId = tax.tax_rate_id;
    });
    beforeEach(() => {
        mockUser = { employee_id: employeeId, permission_level_id: 10, permissions: [] };
    });

    test.each(['UNUSED', 'SPOILED', 'VOIDED'])('editing accounts for the old paper as %s and preserves issuance pointers', async outcome => {
        const invoice = await makeInvoice();
        const beforeSeries = (await db.query('SELECT * FROM physical_document_series WHERE series_id = $1', [seriesId])).rows[0];
        const payload = decision({ paper_outcome: outcome });
        const res = await request(app).put(`/api/invoices/${invoice.invoice_id}/physical-receipt-no`).send(payload);
        expect(res.status).toBe(200);
        const updated = await read(invoice.invoice_id);
        expect(updated.physical_receipt_no).toBe(payload.physical_receipt_no);
        expect(updated.physical_document_registry_id).not.toBe(invoice.physical_document_registry_id);
        expect((await registry(invoice.physical_document_registry_id)).state).toBe({ UNUSED: 'UNOCCUPIED', SPOILED: 'SPOILED', VOIDED: 'VOIDED' }[outcome]);
        expect((await registry(updated.physical_document_registry_id)).state).toBe('ISSUED');
        const links = (await db.query('SELECT role FROM physical_document_source_link WHERE invoice_id = $1 ORDER BY link_id', [invoice.invoice_id])).rows;
        expect(links.map(link => link.role)).toEqual(['HISTORICAL', 'PRIMARY']);
        const afterSeries = (await db.query('SELECT * FROM physical_document_series WHERE series_id = $1', [seriesId])).rows[0];
        expect(afterSeries.last_issued_serial).toBe(beforeSeries.last_issued_serial);
        expect(Number(afterSeries.high_water_serial)).toBeGreaterThanOrEqual(Number(payload.physical_receipt_no.split('-')[1]));
        const available = await physical.isReferenceOccupied(null, seriesId, invoice.physical_receipt_no);
        expect(available.occupied).toBe(outcome !== 'UNUSED');
        const history = await request(app).get(`/api/invoices/${invoice.invoice_id}/receipt-control`);
        expect(history.body.history.some(event => event.reason === reason && event.original_suggestion === invoice.physical_receipt_no)).toBe(true);
    });

    test('requires reason, version and explicit paper outcome before changing anything', async () => {
        const invoice = await makeInvoice();
        for (const payload of [decision({ reason: '' }), decision({ paper_outcome: '' }), decision({ expected_version: undefined })]) {
            const res = await request(app).put(`/api/invoices/${invoice.invoice_id}/physical-receipt-no`).send(payload);
            expect([409, 422]).toContain(res.status);
            expect((await read(invoice.invoice_id)).physical_receipt_no).toBe(invoice.physical_receipt_no);
        }
    });

    test('ordinary editor cannot release an unused number, but can retain spoiled paper', async () => {
        const invoice = await makeInvoice();
        mockUser = { employee_id: employeeId, permission_level_id: 1, permissions: ['invoice:edit_receipt_no'] };
        expect((await request(app).get(`/api/invoices/${invoice.invoice_id}/receipt-control`)).status).toBe(200);
        expect((await request(app).put(`/api/invoices/${invoice.invoice_id}/physical-receipt-no`).send(decision({ paper_outcome: 'UNUSED' }))).status).toBe(403);
        expect((await request(app).put(`/api/invoices/${invoice.invoice_id}/physical-receipt-no`).send(decision({ paper_outcome: 'SPOILED' }))).status).toBe(200);
        mockUser.permissions = [];
        expect((await request(app).put(`/api/invoices/${invoice.invoice_id}/physical-receipt-no`).send(decision())).status).toBe(403);
    });

    test('duplicate replacement rolls back the old assignment, including legacy references', async () => {
        const first = await makeInvoice();
        const second = await makeInvoice({ legacy: true });
        const res = await request(app).put(`/api/invoices/${first.invoice_id}/physical-receipt-no`).send(decision({ physical_receipt_no: second.physical_receipt_no }));
        expect(res.status).toBe(409);
        expect((await registry(first.physical_document_registry_id)).state).toBe('ISSUED');
    });

    test('rejects wrong prefix, bounds and incompatible invoice taxes without changing money', async () => {
        const invoice = await makeInvoice({ total: 100 });
        expect((await request(app).put(`/api/invoices/${invoice.invoice_id}/physical-receipt-no`).send(decision({ physical_receipt_no: 'WRONG-1' }))).status).toBe(422);
        expect((await request(app).put(`/api/invoices/${invoice.invoice_id}/physical-receipt-no`).send(decision({ physical_receipt_no: 'RQA-1000000000000000' }))).status).toBe(422);
        await db.query('INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale, tax_rate_id) VALUES ($1, $2, 1, 100, 10, $3)', [invoice.invoice_id, partId, taxRateId]);
        const res = await request(app).put(`/api/invoices/${invoice.invoice_id}/physical-receipt-no`).send(decision());
        expect(res.status).toBe(422);
        expect(res.body.code).toBe('RECEIPT_TAX_INCOMPATIBLE');
        expect((await read(invoice.invoice_id)).total_amount).toBe('100.00');
        await db.query('INSERT INTO physical_document_series_tax (series_id, tax_rate_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [seriesId, taxRateId]);
        expect((await request(app).put(`/api/invoices/${invoice.invoice_id}/physical-receipt-no`).send(decision())).status).toBe(200);
    });

    test('Paper → Notebook → Paper creates a fresh occupied registry assignment', async () => {
        const invoice = await makeInvoice();
        await db.query("UPDATE physical_document_selection_policy SET allow_notebook = true WHERE context IN ('POS', 'INVOICING', 'CASHIER_APPROVAL')");
        const path = `/api/invoices/${invoice.invoice_id}/physical-receipt-no`;
        expect((await request(app).put(path).send(decision({ recording_method: 'NOTEBOOK', paper_outcome: 'UNUSED' }))).status).toBe(200);
        const notebook = await read(invoice.invoice_id);
        expect(notebook.physical_document_registry_id).toBeNull();
        expect(notebook.physical_receipt_no).toBeNull();
        expect((await request(app).put(path).send(decision({ expected_version: 2, paper_outcome: null }))).status).toBe(200);
        const assigned = await read(invoice.invoice_id);
        expect((await registry(assigned.physical_document_registry_id)).state).toBe('ISSUED');
    });

    test('concurrent edits allow one winner and reject the stale form', async () => {
        const invoice = await makeInvoice();
        const results = await Promise.all([1, 2].map(() => request(app).put(`/api/invoices/${invoice.invoice_id}/physical-receipt-no`).send(decision())));
        expect(results.map(result => result.status).sort()).toEqual([200, 409]);
        expect(results.find(result => result.status === 409).body.code).toBe('RECEIPT_VERSION_CONFLICT');
    });

    test.each(['UNUSED', 'SPOILED', 'VOIDED'])('voiding accounts for %s paper and prevents later edits', async outcome => {
        const invoice = await makeInvoice();
        const path = `/api/invoices/${invoice.invoice_id}`;
        const res = await request(app).delete(path).send(decision({ paper_outcome: outcome }));
        expect(res.status).toBe(200);
        const updated = await read(invoice.invoice_id);
        expect(updated.status).toBe('Cancelled');
        expect(updated.physical_receipt_no).toBe(outcome === 'UNUSED' ? null : invoice.physical_receipt_no);
        expect((await registry(invoice.physical_document_registry_id)).state).toBe({ UNUSED: 'UNOCCUPIED', SPOILED: 'SPOILED', VOIDED: 'VOIDED' }[outcome]);
        expect((await request(app).delete(path).send(decision({ expected_version: 2 }))).status).toBe(400);
        expect((await request(app).put(`${path}/physical-receipt-no`).send(decision({ expected_version: 2 }))).status).toBe(409);
    });

    test('legacy receipt is registered and retained when voided', async () => {
        const invoice = await makeInvoice({ legacy: true });
        expect((await request(app).delete(`/api/invoices/${invoice.invoice_id}`).send(decision({ original_series_id: seriesId }))).status).toBe(200);
        const updated = await read(invoice.invoice_id);
        expect(updated.physical_receipt_no).toBe(invoice.physical_receipt_no);
        expect((await registry(updated.physical_document_registry_id)).state).toBe('VOIDED');
    });

    test('Notebook void still requires a reason and records it', async () => {
        const invoice = await makeInvoice({ paper: false });
        const path = `/api/invoices/${invoice.invoice_id}`;
        expect((await request(app).delete(path).send(decision({ reason: '' }))).status).toBe(422);
        expect((await request(app).delete(path).send(decision({ paper_outcome: null }))).status).toBe(200);
        const history = await request(app).get(`${path}/receipt-control`);
        expect(history.body.history.some(event => event.event_type === 'INVOICE_VOIDED' && event.reason === reason)).toBe(true);
    });

    test('Correct & Restart uses the same audited paper decision', async () => {
        const invoice = await makeInvoice();
        await db.query("INSERT INTO settings (setting_key, setting_value) VALUES ('ENABLE_SALES_CORRECTIONS', 'true') ON CONFLICT (setting_key) DO UPDATE SET setting_value = 'true'");
        const created = await request(app).post('/api/sales-corrections').send({ invoice_id: invoice.invoice_id, reason_code: 'ENTRY_ERROR', reason_text: reason });
        expect(created.status).toBe(201);
        const caseId = created.body.case.correction_case_id;
        expect((await request(app).post(`/api/sales-corrections/${caseId}/approve`).send({ receipt_decision: decision({ paper_outcome: 'SPOILED' }) })).status).toBe(200);
        expect((await registry(invoice.physical_document_registry_id)).state).toBe('SPOILED');
        expect((await read(invoice.invoice_id)).status).toBe('Cancelled');
        expect((await request(app).post(`/api/sales-corrections/${caseId}/approve`).send({})).status).toBe(200);
    });

    test('manual payment settlement preserves the receipt assignment', async () => {
        const invoice = await makeInvoice({ total: 100 });
        const { rows: [method] } = await db.query("SELECT method_id FROM payment_methods WHERE code = 'cash'");
        const { rows: [payment] } = await db.query(
            "INSERT INTO invoice_payments (invoice_id, amount_paid, method_id, payment_status) VALUES ($1, 100, $2, 'pending') RETURNING payment_id", [invoice.invoice_id, method.method_id]
        );
        expect((await request(app).put(`/api/invoices/payments/${payment.payment_id}/settle`)).status).toBe(200);
        const updated = await read(invoice.invoice_id);
        expect(updated.physical_document_registry_id).toBe(invoice.physical_document_registry_id);
        expect(updated.physical_receipt_no).toBe(invoice.physical_receipt_no);
        expect((await registry(updated.physical_document_registry_id)).state).toBe('ISSUED');
    });

    test('refund retains paper identity and prevents a second financial reversal through voiding', async () => {
        const invoice = await makeInvoice({ total: 100 });
        const { rows: [line] } = await db.query(
            `INSERT INTO invoice_line (invoice_id, part_id, quantity, sale_price, cost_at_sale, discount_amount, tax_rate_snapshot)
             VALUES ($1, $2, 1, 100, 10, 0, 0) RETURNING invoice_line_id`, [invoice.invoice_id, partId]
        );
        const refunded = await request(app).post('/api/refunds').send({
            invoice_id: invoice.invoice_id, invoice_number: invoice.invoice_number, refund_payment_method: 'GCash',
            lines: [{ invoice_line_id: line.invoice_line_id, quantity: 1 }],
        });
        expect(refunded.status).toBe(201);
        expect((await read(invoice.invoice_id)).physical_receipt_no).toBe(invoice.physical_receipt_no);
        expect((await registry(invoice.physical_document_registry_id)).state).toBe('ISSUED');
        const voided = await request(app).delete(`/api/invoices/${invoice.invoice_id}`).send(decision());
        expect(voided.status).toBe(409);
        expect(voided.body.message).toMatch(/issued credit notes/);
    });

    test('date correction preserves receipt identity, version and sequence', async () => {
        const invoice = await makeInvoice();
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            await require('../services/transactionDateService').apply(client, {
                kind: 'invoice', id: invoice.invoice_id,
                newDate: new Date(Date.now() - 86400000).toISOString(), reason: 'Correct transaction date',
                employeeId, requesterHasUnrestricted: true,
            });
            await client.query('COMMIT');
        } catch (err) { await client.query('ROLLBACK'); throw err; }
        finally { client.release(); }
        const updated = await read(invoice.invoice_id);
        expect(updated.physical_receipt_no).toBe(invoice.physical_receipt_no);
        expect(updated.physical_receipt_version).toBe(invoice.physical_receipt_version);
        expect((await registry(invoice.physical_document_registry_id)).state).toBe('ISSUED');
    });
});
