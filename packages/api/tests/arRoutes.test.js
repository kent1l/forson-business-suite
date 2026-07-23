const request = require('supertest');
const express = require('express');

jest.setTimeout(10000);

// Mock db module
jest.mock('../db', () => {
    const queryFn = jest.fn();
    return {
        query: queryFn
    };
});

// Mock auth middleware
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { user_id: 1, employee_id: 1, username: 'testuser' };
        next();
    },
    hasPermission: () => (req, res, next) => next()
}));

const db = require('../db');
const arRouter = require('../routes/arRoutes');

const app = express();
app.use(express.json());
app.use('/api', arRouter);

describe('Accounts Receivable (A/R) Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/ar/aging-summary', () => {
        test('should return aging buckets array with name and value', async () => {
            const mockAging = [
                { name: 'Current', value: '500.00' },
                { name: '1-30 Days', value: '200.00' }
            ];

            db.query.mockResolvedValueOnce({ rows: mockAging });

            const res = await request(app).get('/api/ar/aging-summary');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(5);
            expect(res.body[0].name).toBe('Current');
            expect(res.body[0].value).toBe(500.00);
            expect(res.body[1].name).toBe('1-30 Days');
            expect(res.body[1].value).toBe(200.00);
        });

        test('should handle database error gracefully', async () => {
            db.query.mockRejectedValueOnce(new Error('DB failure'));

            const res = await request(app).get('/api/ar/aging-summary');

            expect(res.status).toBe(500);
            expect(res.body.message).toMatch(/Failed to fetch aging summary/i);
        });
    });

    describe('GET /api/ar/customer-summary', () => {
        test('should return customer ledger list with balance summaries', async () => {
            const mockCustomers = [
                {
                    customer_id: 10,
                    first_name: 'Jane',
                    last_name: 'Doe',
                    company_name: 'Doe Enterprises',
                    total_balance_due: '600.00',
                    invoice_count: 2
                }
            ];

            db.query.mockResolvedValueOnce({ rows: mockCustomers });

            const res = await request(app).get('/api/ar/customer-summary');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].first_name).toBe('Jane');
            expect(res.body[0].total_balance_due).toBe('600.00');
        });
    });

    describe('GET /api/ar/customer-invoices/:customerId', () => {
        test('should return invoices for specified customer', async () => {
            const mockInvoices = [
                {
                    invoice_id: 1,
                    invoice_number: 'INV-202607-0001',
                    total_amount: '600.00',
                    balance_due: '600.00',
                    payment_status: 'Unpaid'
                }
            ];

            db.query.mockResolvedValueOnce({ rows: mockInvoices });

            const res = await request(app).get('/api/ar/customer-invoices/10');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].invoice_number).toBe('INV-202607-0001');
        });
    });
});
