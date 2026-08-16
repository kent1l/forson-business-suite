/**
 * Idempotency and attribution on POST /sales/staging.
 *
 * Two genuine cash sales for the same amount seconds apart are legitimately
 * identical, so the server cannot dedupe on its own. Once the mobile client
 * started queuing and retrying writes, that became a real exposure: a reply
 * lost on a flaky LAN, where the sale had actually staged, would put a
 * duplicate in front of the cashier on the next attempt.
 */

const request = require('supertest');
const express = require('express');

jest.setTimeout(10000);

jest.mock('../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

const testUser = { employee_id: 7, username: 'cashier', permission_level_id: 4, permissions: ['pos:use'] };

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => { req.user = { ...testUser }; next(); },
    hasPermission: () => (req, res, next) => next(),
    userHasPermission: () => true,
}));

const db = require('../db');
const stagedSaleRouter = require('../routes/stagedSaleRoutes');

const app = express();
app.use(express.json());
app.use('/', stagedSaleRouter);

const makeClient = (overrides = {}) => ({
    query: jest.fn().mockResolvedValue({ rows: [] }),
    release: jest.fn(),
    ...overrides,
});

const validBody = (over = {}) => ({
    customer_id: 102,
    payment_method_id: 1,
    lines: [{ part_id: 5158, quantity: 1, sale_price: 100, discount_amount: 0 }],
    ...over,
});

const CLIENT_REF = 'deadbeef-1111-2222-3333-444455556666';

beforeEach(() => jest.clearAllMocks());

describe('POST /sales/staging', () => {
    test('takes the staging employee from the token, never the body', async () => {
        const client = makeClient();
        client.query.mockImplementation((sql) =>
            /INSERT INTO staged_sale /i.test(sql)
                ? Promise.resolve({ rows: [{ staged_sale_id: 99 }] })
                : Promise.resolve({ rows: [] }));
        db.getClient.mockResolvedValueOnce(client);

        await request(app).post('/sales/staging').send(validBody({ employee_id: 999 }));

        const insert = client.query.mock.calls.find((c) => /INSERT INTO staged_sale /i.test(c[0]));
        // This field drives per-employee activity and revenue figures, so a
        // caller must not be able to set it.
        expect(insert[1][1]).toBe(7);
    });

    test('still stages normally when no client_ref is supplied', async () => {
        const client = makeClient();
        client.query.mockImplementation((sql) =>
            /INSERT INTO staged_sale /i.test(sql)
                ? Promise.resolve({ rows: [{ staged_sale_id: 42 }] })
                : Promise.resolve({ rows: [] }));
        db.getClient.mockResolvedValueOnce(client);

        const res = await request(app).post('/sales/staging').send(validBody());

        expect(res.statusCode).toBe(201);
        expect(res.body.staged_sale_id).toBe(42);
        // The web client sends no reference and must keep working unchanged.
        const insert = client.query.mock.calls.find((c) => /INSERT INTO staged_sale /i.test(c[0]));
        expect(insert[1][7]).toBeNull();
    });

    test('rejects a client_ref that is not a UUID', async () => {
        const res = await request(app).post('/sales/staging').send(validBody({ client_ref: 'nope' }));
        expect(res.statusCode).toBe(400);
        expect(db.getClient).not.toHaveBeenCalled();
    });

    test('a retry resolves to the sale the first attempt staged', async () => {
        const client = makeClient();
        client.query.mockImplementation((sql) =>
            /SELECT staged_sale_id FROM staged_sale WHERE client_ref/i.test(sql)
                ? Promise.resolve({ rows: [{ staged_sale_id: 12 }] })
                : Promise.resolve({ rows: [] }));
        db.getClient.mockResolvedValueOnce(client);

        const res = await request(app).post('/sales/staging').send(validBody({ client_ref: CLIENT_REF }));

        expect(res.statusCode).toBe(200);
        expect(res.body.staged_sale_id).toBe(12);
        expect(res.body.duplicate).toBe(true);
        // Nothing new may be written.
        expect(client.query.mock.calls.some((c) => /INSERT INTO staged_sale /i.test(c[0]))).toBe(false);
    });

    test('a concurrent double-flush losing the insert race is still a success', async () => {
        // Both attempts can pass the lookup and race to insert; the unique index
        // is what actually enforces this, so a 23505 means the other one won.
        const client = makeClient();
        client.query.mockImplementation((sql) => {
            if (/SELECT staged_sale_id FROM staged_sale WHERE client_ref/i.test(sql)) {
                return Promise.resolve({ rows: [] });
            }
            if (/INSERT INTO staged_sale /i.test(sql)) {
                return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }));
            }
            return Promise.resolve({ rows: [] });
        });
        db.getClient.mockResolvedValueOnce(client);
        db.query.mockResolvedValueOnce({ rows: [{ staged_sale_id: 12 }] });

        const res = await request(app).post('/sales/staging').send(validBody({ client_ref: CLIENT_REF }));

        expect(res.statusCode).toBe(200);
        expect(res.body.staged_sale_id).toBe(12);
        expect(client.query).toHaveBeenCalledWith('ROLLBACK');
    });

    test('a unique violation with no client_ref is still a real error', async () => {
        const client = makeClient();
        client.query.mockImplementation((sql) =>
            /INSERT INTO staged_sale /i.test(sql)
                ? Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }))
                : Promise.resolve({ rows: [] }));
        db.getClient.mockResolvedValueOnce(client);

        const res = await request(app).post('/sales/staging').send(validBody());

        expect(res.statusCode).toBe(500);
    });

    test('missing required fields are still refused', async () => {
        const res = await request(app).post('/sales/staging').send({ customer_id: 1, lines: [] });
        expect(res.statusCode).toBe(400);
    });
});
