const request = require('supertest');
const express = require('express');
const db = require('../db');
const arRoutes = require('../routes/arRoutes');
const paymentRoutes = require('../routes/paymentRoutes');

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
app.use('/api', paymentRoutes);

describe('AR Payment Physical Receipt # & SOA Reference Integration Suite', () => {
    let testCustomerId;
    let testInvoiceId;
    let testEmployeeId;

    beforeAll(async () => {
        const uniqueSuffix = Date.now();
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
        `, [`INV-TEST-${uniqueSuffix}`, testCustomerId, testEmployeeId, `OR-TEST-${uniqueSuffix}`]);
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
            `, [testCustomerId, testInvoiceId, `OR-TEST-${uniqueSuffix}`, testEmployeeId]);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    });


    afterAll(async () => {
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
        if (testEmployeeId) {
            await db.query(`DELETE FROM employee WHERE employee_id = $1`, [testEmployeeId]).catch(() => {});
        }
    });


    test('POST /api/payments saves physical_receipt_no and internal reference to customer_payment', async () => {
        const res = await request(app)
            .post('/api/payments')
            .send({
                customer_id: testCustomerId,
                amount: 2000.00,
                method_id: 1, // Cash / Bank / Default
                payment_method: 'cash',
                reference: 'GCASH-987654321', // Internal tracking ref
                physical_receipt_no: 'OR-PMT-9988', // Printed physical receipt #
                notes: 'Test receive payment physical receipt',
                allocations: [
                    { invoice_id: testInvoiceId, amount_allocated: 2000.00 }
                ]
            });

        expect(res.status).toBe(201);
        expect(res.body.payment_id).toBeDefined();

        // Verify database contents
        const cpRes = await db.query(`
            SELECT physical_receipt_no, reference_number
            FROM customer_payment
            WHERE payment_id = $1
        `, [res.body.payment_id]);

        expect(cpRes.rows.length).toBe(1);
        expect(cpRes.rows[0].physical_receipt_no).toBe('OR-PMT-9988');
        expect(cpRes.rows[0].reference_number).toBe('GCASH-987654321');
    });

    test('GET /api/ar/customers/:customerId/ledger displays physical_receipt_no as primary_ref and reference_number as sub_ref for payment', async () => {
        const res = await request(app)
            .get(`/api/ar/customers/${testCustomerId}/ledger`);

        expect(res.status).toBe(200);
        const paymentRow = res.body.ledger_rows.find(r => r.event_type === 'PAYMENT_SETTLED');
        expect(paymentRow).toBeDefined();
        expect(paymentRow.physical_receipt_no).toBe('OR-PMT-9988');
        expect(paymentRow.primary_ref).toBe('OR-PMT-9988');
        expect(paymentRow.reference).toBe('OR-PMT-9988');
        expect(paymentRow.sub_ref).toMatch(/^PMT-\d{6}-\d{4}$/);
        expect(paymentRow.payment_ref_no).toBe('GCASH-987654321');
    });
});
