const request = require('supertest');
const express = require('express');

jest.mock('../db', () => {
    const query = jest.fn();
    return {
        query,
        getClient: jest.fn().mockResolvedValue({ query, release: jest.fn() })
    };
});

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { employee_id: 10 };
        next();
    },
    hasPermission: () => (req, res, next) => next(),
    userHasPermission: jest.fn()
}));

const db = require('../db');

describe('invoice void after a refund', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api', require('../routes/invoiceRoutes'));
    });

    beforeEach(() => jest.clearAllMocks());

    it('rejects the void and makes no stock or ledger reversal when a credit note exists', async () => {
        const client = await db.getClient();
        client.query
            .mockResolvedValueOnce({}) // BEGIN
            .mockResolvedValueOnce({ rows: [{
                invoice_number: 'INV-99', customer_id: 4, status: 'Partially Refunded'
            }] })
            .mockResolvedValueOnce({ rows: [{ has_refunds: true }] })
            .mockResolvedValueOnce({}); // ROLLBACK

        const res = await request(app).delete('/api/invoices/99');

        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/issued credit notes/);
        expect(client.query.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO inventory_transaction'))).toBe(false);
        expect(client.query.mock.calls.some(([sql]) => typeof sql === 'string' && sql.includes('append_ar_ledger_entry'))).toBe(false);
    });
});
