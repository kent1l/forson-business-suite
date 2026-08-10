const request = require('supertest');
const express = require('express');
const db = require('../db');
const invoiceRoutes = require('../routes/invoiceRoutes');
const paymentRoutes = require('../routes/paymentRoutes');
const paperlessService = require('../services/paperlessService');

// Mock authMiddleware
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { user_id: 1, employee_id: 1, username: 'admin', permissions: ['ar:view', 'ar:manage', 'ar:receive_payment', 'invoices:create', 'invoices:update'] };
        next();
    },
    hasPermission: () => (req, res, next) => next()
}));

const app = express();
app.use(express.json());
app.use('/api', invoiceRoutes);
app.use('/api', paymentRoutes);

describe('Paperless Matching & Cross-Table Physical Receipt Uniqueness Suite', () => {
    let testCustomerId;
    let testInvoiceId;
    let uniqueReceiptNo;

    beforeAll(async () => {
        const uniqueSuffix = Date.now();
        uniqueReceiptNo = `OR-UNIQ-${uniqueSuffix}`;

        const custRes = await db.query(`
            INSERT INTO customer (company_name, first_name, last_name, email, phone, credit_limit)
            VALUES ('Receipt Uniqueness Corp', 'Alex', 'Smith', $1, '09170002222', 50000.00)
            RETURNING customer_id
        `, [`uniq_${uniqueSuffix}@test.com`]);
        testCustomerId = custRes.rows[0].customer_id;

        const invRes = await db.query(`
            INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status, physical_receipt_no)
            VALUES ($1, $2, 1, 3000.00, 3000.00, 0, 0, 'Unpaid', $3)
            RETURNING invoice_id
        `, [`INV-UNIQ-${uniqueSuffix}`, testCustomerId, uniqueReceiptNo]);
        testInvoiceId = invRes.rows[0].invoice_id;
    });

    afterAll(async () => {
        if (testCustomerId) {
            await db.query(`DELETE FROM ar_ledger WHERE customer_id = $1`, [testCustomerId]).catch(() => {});
            await db.query(`DELETE FROM invoice_payment_allocation WHERE invoice_id = $1`, [testInvoiceId]).catch(() => {});
            await db.query(`DELETE FROM customer_payment WHERE customer_id = $1`, [testCustomerId]).catch(() => {});
            await db.query(`DELETE FROM invoice WHERE customer_id = $1`, [testCustomerId]).catch(() => {});
            await db.query(`DELETE FROM customer WHERE customer_id = $1`, [testCustomerId]).catch(() => {});
        }
    });

    test('paperlessService.normalizeToHyphen normalizes arbitrary prefixes', () => {
        expect(paperlessService.normalizeToHyphen('CI_2451')).toBe('CI-2451');
        expect(paperlessService.normalizeToHyphen('OR 88491')).toBe('OR-88491');
        expect(paperlessService.normalizeToHyphen('DR_1002')).toBe('DR-1002');
        expect(paperlessService.normalizeToHyphen('INV-202608-0001')).toBe('INV-202608-0001');
        expect(paperlessService.normalizeToHyphen('PMT_202608_0005')).toBe('PMT-202608_0005');
    });

    test('is_physical_receipt_no_taken returns true for existing receipt and false for available receipt', async () => {
        const takenRes = await db.query(`SELECT public.is_physical_receipt_no_taken($1) AS is_taken`, [uniqueReceiptNo]);
        expect(takenRes.rows[0].is_taken).toBe(true);

        const freeRes = await db.query(`SELECT public.is_physical_receipt_no_taken($1) AS is_taken`, [`FREE-NO-${Date.now()}`]);
        expect(freeRes.rows[0].is_taken).toBe(false);
    });

    test('POST /api/payments rejects duplicate physical_receipt_no with 409 Conflict', async () => {
        const res = await request(app)
            .post('/api/payments')
            .send({
                customer_id: testCustomerId,
                amount: 1000.00,
                method_id: 1,
                payment_method: 'cash',
                physical_receipt_no: uniqueReceiptNo, // Already belongs to testInvoiceId
                allocations: [{ invoice_id: testInvoiceId, amount_allocated: 1000.00 }]
            });

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/already registered in the system/i);
    });

    test('PUT /api/invoices/:id/physical-receipt-no rejects duplicate receipt with 409 Conflict', async () => {
        // Create second invoice without physical_receipt_no
        const inv2 = await db.query(`
            INSERT INTO invoice (invoice_number, customer_id, employee_id, total_amount, subtotal_ex_tax, tax_total, amount_paid, status)
            VALUES ($1, $2, 1, 1000.00, 1000.00, 0, 0, 'Unpaid')
            RETURNING invoice_id
        `, [`INV-UNIQ2-${Date.now()}`, testCustomerId]);

        const inv2Id = inv2.rows[0].invoice_id;

        const res = await request(app)
            .put(`/api/invoices/${inv2Id}/physical-receipt-no`)
            .send({ physical_receipt_no: uniqueReceiptNo });

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/already exists/i);

        await db.query(`DELETE FROM invoice WHERE invoice_id = $1`, [inv2Id]);
    });
});
