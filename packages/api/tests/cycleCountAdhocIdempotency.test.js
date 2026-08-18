/**
 * Replay safety on POST /inventory/cycle-count/unassigned-find.
 *
 * Every call inserts a new cycle_count_line, and when the variance
 * auto-approves it also appends an inventory_transaction adjustment. Neither
 * write had anything to recognise a retry by, which is exactly what kept the
 * mobile outbox from queuing ad-hoc counts at all -- a genuine offline find
 * either had to succeed on the first try over the live network or be lost.
 *
 * As with inventoryAdjustIdempotency.test.js, the assertion that matters is
 * the INSERT count on cycle_count_line, not the status code: a test that only
 * checked status would pass while a count silently doubled.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => {
    const queryFn = jest.fn();
    const client = { query: queryFn, release: jest.fn() };
    return {
        query: queryFn,
        getClient: jest.fn().mockResolvedValue(client),
    };
});

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => { req.user = { employee_id: 7, username: 'clerk' }; next(); },
    hasPermission: () => (req, res, next) => next(),
}));

const db = require('../db');
const cycleCountRouter = require('../routes/cycleCountRoutes');

const app = express();
app.use(express.json());
app.use('/', cycleCountRouter);

const CLIENT_REF = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const existingLine = { line_id: 55, batch_id: 1, part_id: 5, counted_qty: 3, status: 'MATCHED_AUTO_APPROVED', client_ref: CLIENT_REF };

let client;

/** Requests that reach the INSERT, as opposed to lookups and reference reads. */
const lineInsertCalls = () =>
    client.query.mock.calls.filter(([sql]) => /INSERT INTO cycle_count_line/i.test(sql));

beforeEach(async () => {
    jest.clearAllMocks();
    client = { query: jest.fn(), release: jest.fn() };
    db.getClient.mockResolvedValue(client);
});

/** Wires a client.query mock that answers a clean first-time submission. */
const mockCleanRun = (clientRefLookupRows = []) => {
    client.query.mockImplementation((sql) => {
        if (/^BEGIN/i.test(sql)) return Promise.resolve({});
        if (/^COMMIT/i.test(sql)) return Promise.resolve({});
        if (/^ROLLBACK/i.test(sql)) return Promise.resolve({});
        if (/SELECT \* FROM cycle_count_line WHERE client_ref/i.test(sql)) {
            return Promise.resolve({ rows: clientRefLookupRows });
        }
        if (/FROM part p/i.test(sql)) return Promise.resolve({ rows: [{ wac_cost: 10, stock_on_hand: 3 }] });
        if (/SELECT batch_id FROM cycle_count_batch/i.test(sql)) return Promise.resolve({ rows: [{ batch_id: 1 }] });
        if (/UPDATE cycle_count_batch/i.test(sql)) return Promise.resolve({});
        if (/FROM settings/i.test(sql)) return Promise.resolve({ rows: [] });
        if (/INSERT INTO cycle_count_line/i.test(sql)) return Promise.resolve({ rows: [existingLine] });
        if (/INSERT INTO part_inventory_stats/i.test(sql)) return Promise.resolve({});
        return Promise.resolve({ rows: [] });
    });
};

test('a first ad-hoc find is written and returned as fresh', async () => {
    mockCleanRun([]);

    const res = await request(app)
        .post('/inventory/cycle-count/unassigned-find')
        .send({ part_id: 5, counted_qty: 3, client_ref: CLIENT_REF });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBeUndefined();
    expect(lineInsertCalls()).toHaveLength(1);
});

test('a replay returns the original line and writes nothing', async () => {
    mockCleanRun([existingLine]);

    const res = await request(app)
        .post('/inventory/cycle-count/unassigned-find')
        .send({ part_id: 5, counted_qty: 3, client_ref: CLIENT_REF });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
    expect(res.body.line_id).toBe(55);
    // The whole point: neither the count line nor a stock adjustment moves twice.
    expect(lineInsertCalls()).toHaveLength(0);
});

test('two flushes racing past the lookup still yield one line', async () => {
    let lookupCount = 0;
    client.query.mockImplementation((sql) => {
        if (/^BEGIN/i.test(sql)) return Promise.resolve({});
        if (/^ROLLBACK/i.test(sql)) return Promise.resolve({});
        if (/SELECT \* FROM cycle_count_line WHERE client_ref/i.test(sql)) {
            lookupCount += 1;
            return Promise.resolve({ rows: lookupCount === 1 ? [] : [existingLine] });
        }
        if (/FROM part p/i.test(sql)) return Promise.resolve({ rows: [{ wac_cost: 10, stock_on_hand: 3 }] });
        if (/SELECT batch_id FROM cycle_count_batch/i.test(sql)) return Promise.resolve({ rows: [{ batch_id: 1 }] });
        if (/UPDATE cycle_count_batch/i.test(sql)) return Promise.resolve({});
        if (/FROM settings/i.test(sql)) return Promise.resolve({ rows: [] });
        if (/INSERT INTO cycle_count_line/i.test(sql)) {
            return Promise.reject(Object.assign(new Error('duplicate key'), { code: '23505' }));
        }
        return Promise.resolve({ rows: [] });
    });

    // The catch handler re-reads through the plain query() path, not the
    // transaction client, mirroring inventoryRoutes' post-violation lookup.
    db.query.mockResolvedValue({ rows: [existingLine] });

    const res = await request(app)
        .post('/inventory/cycle-count/unassigned-find')
        .send({ part_id: 5, counted_qty: 3, client_ref: CLIENT_REF });

    expect(res.status).toBe(200);
    expect(res.body.duplicate).toBe(true);
});

test('a malformed client_ref is refused before any write', async () => {
    mockCleanRun([]);

    const res = await request(app)
        .post('/inventory/cycle-count/unassigned-find')
        .send({ part_id: 5, counted_qty: 3, client_ref: 'not-a-uuid' });

    expect(res.status).toBe(400);
    expect(lineInsertCalls()).toHaveLength(0);
});

test('mobile callers that send no client_ref are unaffected', async () => {
    mockCleanRun();

    const res = await request(app)
        .post('/inventory/cycle-count/unassigned-find')
        .send({ part_id: 5, counted_qty: 3 });

    expect(res.status).toBe(200);
    // No client_ref means no lookup to do; it goes straight to the insert.
    expect(lineInsertCalls()).toHaveLength(1);
});
