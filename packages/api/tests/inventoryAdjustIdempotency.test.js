/**
 * Replay safety on POST /inventory/adjust.
 *
 * An adjustment is a signed delta appended to inventory_transaction, and stock
 * on hand is the SUM of that table. So a retried request does not overwrite
 * anything -- it moves the stock a second time, and leaves two individually
 * plausible audit rows with no way to tell which was the duplicate. That is why
 * the mobile outbox refused to queue adjustments until the client_ref index
 * existed.
 *
 * The assertion that matters most here is the INSERT count. A test that only
 * checked status codes would pass while stock silently doubled.
 */

const request = require('supertest');
const express = require('express');

jest.setTimeout(10000);

jest.mock('../db', () => ({ query: jest.fn() }));

jest.mock('../meilisearch', () => ({
    meiliClient: { index: () => ({ search: jest.fn().mockResolvedValue({ hits: [] }) }) },
}));

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => { req.user = { employee_id: 7, username: 'clerk' }; next(); },
    hasPermission: () => (req, res, next) => next(),
    userHasPermission: () => true,
}));

const db = require('../db');
const inventoryRouter = require('../routes/inventoryRoutes');

const app = express();
app.use(express.json());
app.use('/', inventoryRouter);

const CLIENT_REF = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const existingRow = { inv_trans_id: 99, part_id: 5, quantity: '3.0000', client_ref: CLIENT_REF };

/** Requests that reach the INSERT, as opposed to lookups and settings reads. */
const insertCalls = () =>
    db.query.mock.calls.filter(([sql]) => /INSERT INTO inventory_transaction/i.test(sql));

const settingsRow = { rows: [{ setting_value: '720' }] };

beforeEach(() => {
    jest.clearAllMocks();
});

test('a first adjustment is written and returned as created', async () => {
    db.query.mockImplementation((sql) => {
        if (/FROM settings/i.test(sql)) return Promise.resolve(settingsRow);
        if (/SELECT \* FROM inventory_transaction/i.test(sql)) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [existingRow] });
    });

    const res = await request(app)
        .post('/inventory/adjust')
        .send({ part_id: 5, quantity: 3, client_ref: CLIENT_REF });

    expect(res.status).toBe(201);
    expect(res.body.duplicate).toBeUndefined();
    expect(insertCalls()).toHaveLength(1);
});

test('a replay returns the original row and writes nothing', async () => {
    db.query.mockImplementation((sql) => {
        if (/FROM settings/i.test(sql)) return Promise.resolve(settingsRow);
        if (/SELECT \* FROM inventory_transaction/i.test(sql)) return Promise.resolve({ rows: [existingRow] });
        return Promise.resolve({ rows: [] });
    });

    const res = await request(app)
        .post('/inventory/adjust')
        .send({ part_id: 5, quantity: 3, client_ref: CLIENT_REF });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(res.body.inv_trans_id).toBe(99);
    // The whole point: stock must not move a second time.
    expect(insertCalls()).toHaveLength(0);
});

test('two flushes racing past the lookup still yield one row', async () => {
    // Both requests see an empty lookup, both attempt the insert, and the
    // unique index rejects the loser -- which is a success, not an error.
    let lookupCount = 0;
    db.query.mockImplementation((sql) => {
        if (/FROM settings/i.test(sql)) return Promise.resolve(settingsRow);
        if (/SELECT \* FROM inventory_transaction/i.test(sql)) {
            lookupCount += 1;
            // Empty on the pre-check, populated on the post-violation re-read.
            return Promise.resolve({ rows: lookupCount === 1 ? [] : [existingRow] });
        }
        return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }));
    });

    const res = await request(app)
        .post('/inventory/adjust')
        .send({ part_id: 5, quantity: 3, client_ref: CLIENT_REF });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
});

test('a unique violation without a client_ref is still a real error', async () => {
    db.query.mockImplementation((sql) => {
        if (/FROM settings/i.test(sql)) return Promise.resolve(settingsRow);
        return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }));
    });

    const res = await request(app).post('/inventory/adjust').send({ part_id: 5, quantity: 3 });
    expect(res.status).toBe(500);
});

test('web callers that send no client_ref are unaffected', async () => {
    db.query.mockImplementation((sql) => {
        if (/FROM settings/i.test(sql)) return Promise.resolve(settingsRow);
        return Promise.resolve({ rows: [existingRow] });
    });

    const res = await request(app).post('/inventory/adjust').send({ part_id: 5, quantity: -2 });

    expect(res.status).toBe(201);
    // No client_ref means no lookup to do; it goes straight to the insert.
    expect(insertCalls()).toHaveLength(1);
});

test('a malformed client_ref is refused before any write', async () => {
    db.query.mockResolvedValue({ rows: [] });
    const res = await request(app)
        .post('/inventory/adjust')
        .send({ part_id: 5, quantity: 3, client_ref: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(insertCalls()).toHaveLength(0);
});

describe('quantity validation gives a queued adjustment a readable reason', () => {
    beforeEach(() => db.query.mockResolvedValue({ rows: [] }));

    test('missing and zero are distinguishable', async () => {
        const missing = await request(app).post('/inventory/adjust').send({ part_id: 5 });
        const zero = await request(app).post('/inventory/adjust').send({ part_id: 5, quantity: 0 });

        expect(missing.status).toBe(400);
        expect(zero.status).toBe(400);
        expect(missing.body.message).not.toBe(zero.body.message);
    });

    test('a fractional adjustment is legitimate', async () => {
        db.query.mockImplementation((sql) => {
            if (/FROM settings/i.test(sql)) return Promise.resolve(settingsRow);
            return Promise.resolve({ rows: [existingRow] });
        });
        const res = await request(app).post('/inventory/adjust').send({ part_id: 5, quantity: 0.5 });
        expect(res.status).toBe(201);
    });
});

test('an adjustment older than the window is refused and never written', async () => {
    db.query.mockImplementation((sql) => {
        if (/FROM settings/i.test(sql)) return Promise.resolve(settingsRow);
        return Promise.resolve({ rows: [] });
    });

    const res = await request(app).post('/inventory/adjust').send({
        part_id: 5,
        quantity: 3,
        captured_at: new Date(Date.now() - 20 * 60 * 60000).toISOString(),
    });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ADJUSTMENT_TOO_OLD');
    expect(insertCalls()).toHaveLength(0);
});

test('an offline capture is annotated so the gap survives in the audit trail', async () => {
    db.query.mockImplementation((sql) => {
        if (/FROM settings/i.test(sql)) return Promise.resolve(settingsRow);
        if (/SELECT \* FROM inventory_transaction/i.test(sql)) return Promise.resolve({ rows: [] });
        return Promise.resolve({ rows: [existingRow] });
    });

    await request(app).post('/inventory/adjust').send({
        part_id: 5,
        quantity: 3,
        notes: 'recount',
        captured_at: new Date(Date.now() - 90 * 60000).toISOString(),
    });

    const [, params] = insertCalls()[0];
    expect(params[2]).toMatch(/recount Captured offline 90 minutes before sync\./);
    expect(params[6]).not.toBeNull();  // captured_at persisted
});
