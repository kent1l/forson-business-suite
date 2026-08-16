const request = require('supertest');
const express = require('express');

// Mock db module
jest.mock('../db', () => {
    const queryFn = jest.fn();
    const client = {
        query: queryFn,
        release: jest.fn()
    };
    return {
        query: queryFn,
        getClient: jest.fn().mockResolvedValue(client)
    };
});

// Mock auth middleware
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { user_id: 1, employee_id: 1, username: 'admin' };
        next();
    },
    hasPermission: () => (req, res, next) => next()
}));

const db = require('../db');
const arLedgerService = require('../services/arLedgerService');
const arRoutes = require('../routes/arRoutes');

const app = express();
app.use(express.json());
app.use('/api', arRoutes);

describe('AR Ledger Service & Endpoints', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('arLedgerService.appendEntry', () => {
        test('calls append_ar_ledger_entry query with correct parameters', async () => {
            const client = await db.getClient();
            client.query.mockResolvedValueOnce({ rows: [{ ledger_id: '42' }] });

            const result = await arLedgerService.appendEntry(client, {
                customerId: 10,
                invoiceId: 101,
                entryType: 'INVOICE_POSTED',
                amount: 1500.50,
                referenceNo: 'INV-101',
                notes: 'Invoice posted',
                createdBy: 1
            });

            expect(result).toBe('42');
            expect(client.query).toHaveBeenCalledWith(
                expect.stringContaining('append_ar_ledger_entry'),
                [10, 101, null, null, 'INVOICE_POSTED', 1500.50, null, 'INV-101', 'Invoice posted', 1, null, null]
            );
        });
    });

    describe('GET /api/ar/ledger/:customerId', () => {
        test('returns ledger history and total count', async () => {
            const mockRows = [
                {
                    ledger_id: '1',
                    entry_type: 'INVOICE_POSTED',
                    amount: '1000.00',
                    balance_after: '1000.00',
                    payment_channel: null,
                    reference_no: 'INV-001',
                    notes: 'Invoice posted',
                    created_at: '2026-08-02T10:00:00Z',
                    invoice_id: 1,
                    invoice_number: 'INV-001',
                    created_by_name: 'Admin User'
                }
            ];

            db.query
                .mockResolvedValueOnce({ rows: mockRows })
                .mockResolvedValueOnce({ rows: [{ total: 1 }] });

            const res = await request(app).get('/api/ar/ledger/10');

            expect(res.status).toBe(200);
            expect(res.body.rows).toHaveLength(1);
            expect(res.body.total).toBe(1);
            expect(res.body.rows[0].entry_type).toBe('INVOICE_POSTED');
        });

        test('returns 400 for invalid customer ID', async () => {
            const res = await request(app).get('/api/ar/ledger/invalid');
            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/ar/ledger/:customerId/adjustment', () => {
        test('creates DEBIT_ADJUSTMENT successfully', async () => {
            const client = await db.getClient();
            // 1. Customer lookup
            client.query.mockResolvedValueOnce({ rows: [{ customer_id: 10 }] });
            // 2. BEGIN
            client.query.mockResolvedValueOnce({});
            // 3. append_ar_ledger_entry
            client.query.mockResolvedValueOnce({ rows: [{ ledger_id: '99' }] });
            // 4. COMMIT
            client.query.mockResolvedValueOnce({});

            const res = await request(app)
                .post('/api/ar/ledger/10/adjustment')
                .send({
                    entry_type: 'DEBIT_ADJUSTMENT',
                    amount: 250.00,
                    reference_no: 'ADJ-001',
                    notes: 'Debit adjustment for late fee'
                });

            expect(res.status).toBe(201);
            expect(res.body.message).toBe('Adjustment recorded');
            expect(res.body.ledger_id).toBe('99');
        });

        test('creates CREDIT_ADJUSTMENT with negative signed amount', async () => {
            const client = await db.getClient();
            client.query.mockResolvedValueOnce({ rows: [{ customer_id: 10 }] });
            client.query.mockResolvedValueOnce({});
            client.query.mockResolvedValueOnce({ rows: [{ ledger_id: '100' }] });
            client.query.mockResolvedValueOnce({});

            const res = await request(app)
                .post('/api/ar/ledger/10/adjustment')
                .send({
                    entry_type: 'CREDIT_ADJUSTMENT',
                    amount: 100.00,
                    notes: 'Courtesy credit'
                });

            expect(res.status).toBe(201);
            expect(client.query).toHaveBeenCalledWith(
                expect.stringContaining('append_ar_ledger_entry'),
                [10, null, null, null, 'CREDIT_ADJUSTMENT', -100.00, null, null, 'Courtesy credit', 1, null, null]
            );
        });

        test('rejects adjustment with invalid entry_type', async () => {
            const res = await request(app)
                .post('/api/ar/ledger/10/adjustment')
                .send({
                    entry_type: 'INVALID_TYPE',
                    amount: 100.00,
                    notes: 'Some notes here'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/entry_type must be/i);
        });

        test('rejects adjustment with notes less than 5 characters', async () => {
            const res = await request(app)
                .post('/api/ar/ledger/10/adjustment')
                .send({
                    entry_type: 'DEBIT_ADJUSTMENT',
                    amount: 100.00,
                    notes: '1234'
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/notes is required/i);
        });
    });
});
