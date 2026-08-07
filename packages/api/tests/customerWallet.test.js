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
const walletService = require('../services/customerWalletService');
const walletRoutes = require('../routes/walletRoutes');
const paymentRoutes = require('../routes/paymentRoutes');

const app = express();
app.use(express.json());
app.use('/api', walletRoutes);
app.use('/api', paymentRoutes);

describe('Customer Wallet System & Endpoints', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('customerWalletService', () => {
        test('getWallet returns formatted customer wallet info', async () => {
            db.query.mockResolvedValueOnce({
                rows: [{ wallet_id: 5, customer_id: 12, balance: '250.00', updated_at: '2026-08-06T10:00:00Z' }]
            });

            const wallet = await walletService.getWallet(12);
            expect(wallet).toEqual({
                wallet_id: 5,
                customer_id: 12,
                balance: 250.00,
                updated_at: '2026-08-06T10:00:00Z'
            });
            expect(db.query).toHaveBeenCalledWith(expect.stringContaining('customer_wallet'), [12]);
        });

        test('appendWalletTransaction executes SQL helper function', async () => {
            const client = await db.getClient();
            client.query.mockResolvedValueOnce({ rows: [{ tx_id: 99 }] });

            const txId = await walletService.appendWalletTransaction(client, {
                customerId: 12,
                type: 'OVERPAYMENT_CREDIT',
                amount: 50.00,
                referenceType: 'PAYMENT',
                referenceId: 101,
                notes: 'Excess payment credit',
                createdBy: 1
            });

            expect(txId).toBe(99);
            expect(client.query).toHaveBeenCalledWith(
                expect.stringContaining('append_wallet_transaction'),
                [12, 'OVERPAYMENT_CREDIT', 50.00, 'PAYMENT', 101, 'Excess payment credit', 1]
            );
        });
    });

    describe('GET /api/customers/:id/wallet', () => {
        test('returns wallet data and paginated transactions', async () => {
            // Mock getWallet query
            db.query.mockResolvedValueOnce({
                rows: [{ wallet_id: 1, customer_id: 10, balance: '100.00', updated_at: '2026-08-06T10:00:00Z' }]
            });
            // Mock count query
            db.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
            // Mock transactions query
            db.query.mockResolvedValueOnce({
                rows: [{
                    transaction_id: 1,
                    transaction_type: 'OVERPAYMENT_CREDIT',
                    amount: '100.00',
                    balance_after: '100.00',
                    reference_type: 'PAYMENT',
                    reference_id: 5,
                    notes: 'Overpayment credit',
                    created_by: 1,
                    created_at: '2026-08-06T10:00:00Z'
                }]
            });

            const res = await request(app).get('/api/customers/10/wallet');

            expect(res.status).toBe(200);
            expect(res.body.wallet.balance).toBe(100);
            expect(res.body.transactions.data.length).toBe(1);
        });

        test('returns 400 for invalid customer ID', async () => {
            const res = await request(app).get('/api/customers/invalid/wallet');
            expect(res.status).toBe(400);
        });
    });

    describe('POST /api/customers/:id/wallet/adjust', () => {
        test('adjusts wallet balance successfully for valid input', async () => {
            const client = await db.getClient();
            // BEGIN
            client.query.mockResolvedValueOnce({});
            // append_wallet_transaction
            client.query.mockResolvedValueOnce({ rows: [{ tx_id: 101 }] });
            // COMMIT
            client.query.mockResolvedValueOnce({});
            // getWallet query after commit
            db.query.mockResolvedValueOnce({
                rows: [{ wallet_id: 1, customer_id: 10, balance: '150.00', updated_at: '2026-08-06T10:00:00Z' }]
            });

            const res = await request(app)
                .post('/api/customers/10/wallet/adjust')
                .send({ amount: 50.00, notes: 'Goodwill credit' });

            expect(res.status).toBe(200);
            expect(res.body.message).toContain('adjusted successfully');
            expect(res.body.transaction_id).toBe(101);
            expect(res.body.wallet.balance).toBe(150);
        });

        test('returns 400 for zero adjustment amount', async () => {
            const res = await request(app)
                .post('/api/customers/10/wallet/adjust')
                .send({ amount: 0, notes: 'Invalid' });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('cannot be zero');
        });
    });

    describe('POST /api/payments with Wallet Overpayment & Drawdown', () => {
        test('automatically credits excess payment to customer wallet as OVERPAYMENT_CREDIT', async () => {
            const client = await db.getClient();
            // BEGIN
            client.query.mockResolvedValueOnce({});
            // payment_method lookup
            client.query.mockResolvedValueOnce({ rows: [{ method_id: 1, code: 'cash', type: 'cash', config: {} }] });
            // customer_payment INSERT
            client.query.mockResolvedValueOnce({ rows: [{ payment_id: 50 }] });
            // invoice balance calculation query
            client.query.mockResolvedValueOnce({ rows: [{ total_amount: '500.00', already_allocated: '0.00' }] });
            // invoice_payment_allocation INSERT
            client.query.mockResolvedValueOnce({});
            // postInv check
            client.query.mockResolvedValueOnce({ rows: [{ total_amount: '500.00', already_allocated: '500.00' }] });
            // invoice status UPDATE
            client.query.mockResolvedValueOnce({});
            // arLedger.appendEntry (calls PostgreSQL function append_ar_ledger_entry)
            client.query.mockResolvedValueOnce({ rows: [{ ledger_id: 1 }] });
            // walletService.appendWalletTransaction (calls PostgreSQL function append_wallet_transaction)
            client.query.mockResolvedValueOnce({ rows: [{ tx_id: 200 }] });
            // COMMIT
            client.query.mockResolvedValueOnce({});

            const res = await request(app)
                .post('/api/payments')
                .send({
                    customer_id: 10,
                    amount: 600.00, // 500 allocated, 100 excess
                    payment_method: 'cash',
                    allocations: [{ invoice_id: 1, amount_allocated: 500.00 }]
                });

            expect(res.status).toBe(201);
            expect(res.body.payment_id).toBe(50);
            expect(res.body.allocated_amount).toBe(500);
            expect(res.body.overpayment_credited).toBe(100);
        });

        test('rejects store_wallet payment if wallet balance is insufficient', async () => {
            const client = await db.getClient();
            // BEGIN
            client.query.mockResolvedValueOnce({});
            // payment_method lookup
            client.query.mockResolvedValueOnce({ rows: [{ method_id: 5, code: 'store_wallet', type: 'credit', config: { settlement_type: 'on_account' } }] });
            // getWallet query (returns balance 50.00, requested 200.00)
            client.query.mockResolvedValueOnce({
                rows: [{ wallet_id: 1, customer_id: 10, balance: '50.00', updated_at: '2026-08-06T10:00:00Z' }]
            });
            // ROLLBACK
            client.query.mockResolvedValueOnce({});

            const res = await request(app)
                .post('/api/payments')
                .send({
                    customer_id: 10,
                    amount: 200.00,
                    payment_method: 'store_wallet',
                    allocations: [{ invoice_id: 1, amount_allocated: 200.00 }]
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toContain('Insufficient store wallet balance');
        });
    });

    describe('GET /api/ar/customer-liabilities', () => {
        test('returns customer receivables vs wallet balance liability overview', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ count: '1' }] });
            db.query.mockResolvedValueOnce({
                rows: [{
                    customer_id: 10,
                    company_name: 'Acme Logistics',
                    first_name: 'John',
                    last_name: 'Doe',
                    ar_balance: '1500.00',
                    wallet_balance: '300.00',
                    net_exposure: '1200.00'
                }]
            });

            const res = await request(app).get('/api/ar/customer-liabilities');

            expect(res.status).toBe(200);
            expect(res.body.data.length).toBe(1);
            expect(res.body.data[0].company_name).toBe('Acme Logistics');
            expect(res.body.data[0].net_exposure).toBe('1200.00');
        });
    });
});
