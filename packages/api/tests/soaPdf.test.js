const request = require('supertest');
const express = require('express');
const db = require('../db');
const { generateStatementOfAccountPDF } = require('../helpers/pdf/soaPdf');
const arRoutes = require('../routes/arRoutes');
const fs = require('fs');

// Set jest timeout for Puppeteer PDF rendering
jest.setTimeout(30000);

// Mock authMiddleware to bypass auth during test runs
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { user_id: 1, employee_id: 1, username: 'admin', permissions: ['ar:view', 'ar:manage'] };
        next();
    },
    hasPermission: () => (req, res, next) => next()
}));

const app = express();
app.use(express.json());
app.use('/api', arRoutes);

describe('Phase 5: SOA PDF & Customer Ledger API Suite', () => {
    let testCustomerId;

    beforeAll(async () => {
        const uniqueEmail = `soa_${Date.now()}@test.com`;
        // Insert test customer
        const custRes = await db.query(`
            INSERT INTO customer (company_name, first_name, last_name, email, phone, credit_limit)
            VALUES ('SOA Test Corp', 'John', 'Doe', $1, '09171234567', 50000.00)
            RETURNING customer_id
        `, [uniqueEmail]);
        testCustomerId = custRes.rows[0].customer_id;

        // Insert dummy ar_ledger entries via append_ar_ledger_entry function
        const client = await db.getClient();
        try {
            await client.query('BEGIN');
            await client.query(`
                SELECT append_ar_ledger_entry(
                    $1, NULL, NULL, NULL,
                    'INVOICE_POSTED'::ar_ledger_entry_type,
                    1000.00, NULL, 'INV-1001', 'Initial invoice #1001', NULL
                )
            `, [testCustomerId]);

            await client.query(`
                SELECT append_ar_ledger_entry(
                    $1, NULL, NULL, NULL,
                    'PAYMENT_SETTLED'::ar_ledger_entry_type,
                    -400.00, NULL, 'PAY-2001', 'Partial payment #2001', NULL
                )
            `, [testCustomerId]);
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
                // Ignore immutability guard block in test teardown
            }
            await db.query(`DELETE FROM customer_wallet WHERE customer_id = $1`, [testCustomerId]).catch(() => {});
            await db.query(`DELETE FROM customer WHERE customer_id = $1`, [testCustomerId]).catch(() => {});
        }
    });

    test('generateStatementOfAccountPDF helper generates PDF file cleanly', async () => {
        const dummyCustomer = {
            company_name: 'SOA Test Corp',
            first_name: 'John',
            last_name: 'Doe',
            email: 'soa@test.com',
            phone: '09171234567',
            credit_limit: 50000,
            wallet_balance: 100
        };

        const dummyLedger = [
            { date: new Date(), reference: 'INV-1001', description: 'Invoice 1001', debit_amount: 1000, credit_amount: null, running_balance: 1000 },
            { date: new Date(), reference: 'PAY-2001', description: 'Payment 2001', debit_amount: null, credit_amount: 400, running_balance: 600 }
        ];

        const pdfPath = await generateStatementOfAccountPDF(dummyCustomer, dummyLedger, { current: 600 }, {
            openingBalance: 0,
            totalInvoiced: 1000,
            totalSettled: 400,
            closingBalance: 600
        });

        expect(pdfPath).toBeDefined();
        expect(fs.existsSync(pdfPath)).toBe(true);

        if (fs.existsSync(pdfPath)) {
            fs.unlinkSync(pdfPath);
        }
    }, 30000);

    test('GET /api/ar/customers/:customerId/ledger returns calculated running balance', async () => {
        const res = await request(app)
            .get(`/api/ar/customers/${testCustomerId}/ledger`);

        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('customer');
        expect(res.body.customer.customer_id).toBe(testCustomerId);
        expect(res.body.total_invoiced).toBe(1000);
        expect(res.body.total_settled).toBe(400);
        expect(res.body.closing_balance).toBe(600);
        expect(Array.isArray(res.body.ledger_rows)).toBe(true);
        expect(res.body.ledger_rows.length).toBe(2);
    });

    test('GET /api/ar/customers/:customerId/soa/pdf streams PDF document', async () => {
        const res = await request(app)
            .get(`/api/ar/customers/${testCustomerId}/soa/pdf`)
            .buffer()
            .parse((res, callback) => {
                res.data = [];
                res.on('data', chunk => res.data.push(chunk));
                res.on('end', () => callback(null, Buffer.concat(res.data)));
            });

        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('application/pdf');
        expect(res.body.length).toBeGreaterThan(1000);
    }, 30000);
});
