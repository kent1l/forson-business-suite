const request = require('supertest');
const express = require('express');

jest.mock('../db', () => {
    const queryFn = jest.fn();
    return {
        query: queryFn,
        getClient: jest.fn().mockResolvedValue({ query: queryFn, release: jest.fn() })
    };
});

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => { req.user = { employee_id: 10, permissions: [] }; next(); },
    hasPermission: () => (req, res, next) => next()
}));

const db = require('../db');

/**
 * A discount larger than the line it sits on drives the line total negative, and
 * the tax split then produces a negative base and a negative tax amount.
 * validateTaxCalculation only checks that the lines sum to the invoice totals,
 * which a consistently-negative line satisfies, so nothing downstream catches it.
 * Both entry points reject it before opening a transaction.
 */
describe('discount cannot exceed its line subtotal', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api', require('../routes/invoiceRoutes'));
        app.use('/api', require('../routes/stagedSaleRoutes'));
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('POST /api/invoices rejects an over-large discount without opening a transaction', async () => {
        const res = await request(app)
            .post('/api/invoices')
            .send({
                customer_id: 1,
                employee_id: 10,
                lines: [{ part_id: 5, quantity: 2, sale_price: 100, discount_amount: 250 }]
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/exceeds the line subtotal/i);
        expect(db.getClient).not.toHaveBeenCalled();
        expect(db.query).not.toHaveBeenCalled();
    });

    test('POST /api/sales/staging rejects an over-large discount without opening a transaction', async () => {
        const res = await request(app)
            .post('/api/sales/staging')
            .send({
                customer_id: 1,
                lines: [{ part_id: 5, quantity: 2, sale_price: 100, discount_amount: 250 }]
            });

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/exceeds the line subtotal/i);
        expect(db.getClient).not.toHaveBeenCalled();
    });

    test('a discount equal to the line subtotal is allowed through the guard', async () => {
        // Fully discounted lines are legitimate (a giveaway, a warranty
        // replacement), so the guard must not reject the boundary itself.
        const res = await request(app)
            .post('/api/invoices')
            .send({
                customer_id: 1,
                employee_id: 10,
                lines: [{ part_id: 5, quantity: 2, sale_price: 100, discount_amount: 200 }]
            });

        expect(res.body.message).not.toMatch(/exceeds the line subtotal/i);
    });
});
