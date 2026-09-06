'use strict';

/**
 * The gate in front of a settlement discount on POST /payments.
 *
 * These cases are checked before the transaction opens, which is the point: a
 * concession without a reason, or without authorization, must never get as far
 * as creating a customer_payment row that then has to be rolled back.
 */

jest.mock('../db', () => ({
    query: jest.fn(),
    getClient: jest.fn(),
}));

const request = require('supertest');
const express = require('express');
const db = require('../db');

let mockCurrentUser;

jest.mock('../middleware/authMiddleware', () => {
    const actual = jest.requireActual('../middleware/authMiddleware');
    return {
        ...actual,
        protect: (req, _res, next) => { req.user = mockCurrentUser; next(); },
        hasPermission: () => (req, res, next) => (
            req.user.permissions.includes('ar:receive_payment') || Number(req.user.permission_level_id) === 10
                ? next()
                : res.status(403).json({ message: 'Forbidden' })
        ),
    };
});

const CASHIER = { employee_id: 42, username: 'cashier', permission_level_id: 2, permissions: ['ar:receive_payment', 'ar:view'] };
const MANAGER = { employee_id: 7, username: 'manager', permission_level_id: 5, permissions: ['ar:receive_payment', 'ar:view', 'ar:discount_grant'] };

let app;

beforeAll(() => {
    app = express();
    app.use(express.json());
    app.use('/api', require('../routes/paymentRoutes'));
});

beforeEach(() => {
    mockCurrentUser = CASHIER;
    db.getClient.mockReset();
    // A client that refuses to do anything but roll back. Every case below is
    // decided before the transaction has work to do, so reaching BEGIN is the
    // signal that the request got past the gate -- which is what two of these
    // tests are asserting.
    db.getClient.mockResolvedValue({
        query: async (sql) => {
            if (sql === 'ROLLBACK') return { rows: [] };
            throw new Error('reached the transaction');
        },
        release: () => {},
    });
});

const body = (extra = {}) => ({
    customer_id: 99,
    amount: 12000,
    method_id: 1,
    allocations: [{ invoice_id: 991, amount_allocated: 12000 }],
    ...extra,
});

describe('POST /payments — settlement discount gating', () => {
    it('refuses a concession with no reason code', async () => {
        const res = await request(app).post('/api/payments').send(body({
            discounts: [{ invoice_id: 991, amount: 800 }],
            discount: { notes: 'agreed with owner' },
        }));

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/reason code/i);
    });

    it('refuses a concession from a cashier with no authorization', async () => {
        const res = await request(app).post('/api/payments').send(body({
            discounts: [{ invoice_id: 991, amount: 800 }],
            discount: { reason_code: 'PROMPT_SETTLEMENT' },
        }));

        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/authorization/i);
    });

    it('lets a permission holder through without a token', async () => {
        mockCurrentUser = MANAGER;
        const res = await request(app).post('/api/payments').send(body({
            discounts: [{ invoice_id: 991, amount: 800 }],
            discount: { reason_code: 'PROMPT_SETTLEMENT' },
        }));

        // Got past the gate, which is as far as this test can see.
        expect(res.status).toBe(500);
        expect(res.body.message).toBe('reached the transaction');
    });

    it('leaves an ordinary collection with no discount untouched', async () => {
        const res = await request(app).post('/api/payments').send(body());

        expect(res.status).toBe(500);
        expect(res.body.message).toBe('reached the transaction');
    });

    it('drops a row the clerk never filled in', async () => {
        const res = await request(app).post('/api/payments').send(body({
            discounts: [{ invoice_id: 991, amount: '' }, { invoice_id: 992, amount: null }],
        }));

        expect(res.status).toBe(500);
        expect(res.body.message).toBe('reached the transaction');
    });

    it('refuses a negative concession instead of quietly dropping it', async () => {
        // The bypass this guards: a negative line deflates the total an
        // authorization is checked against while contributing nothing to the
        // document, so a token approved for centavos could write off thousands.
        const res = await request(app).post('/api/payments').send(body({
            discounts: [{ invoice_id: 991, amount: 50000 }, { invoice_id: 992, amount: -49999.99 }],
            discount: { reason_code: 'PROMPT_SETTLEMENT' },
        }));

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/greater than zero/);
    });

    it('refuses a zero concession that was actually entered', async () => {
        const res = await request(app).post('/api/payments').send(body({
            discounts: [{ invoice_id: 991, amount: 0 }],
        }));

        expect(res.status).toBe(400);
        expect(res.body.message).toMatch(/greater than zero/);
    });
});
