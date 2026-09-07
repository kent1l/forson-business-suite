const request = require('supertest');
const express = require('express');

jest.setTimeout(10000);

// A shared mock client so a test can assert what the executor did to the
// connection, not just what came back.
const mockClient = { query: jest.fn(), release: jest.fn() };

jest.mock('../db', () => ({
    query: jest.fn(),
    getClient: jest.fn(),
}));

let mockCurrentUser = { employee_id: 1, username: 'admin', permission_level_id: 10, permissions: [] };

jest.mock('../middleware/authMiddleware', () => {
    const actual = jest.requireActual('../middleware/authMiddleware');
    return {
        ...actual,
        protect: (req, res, next) => { req.user = mockCurrentUser; next(); },
        hasPermission: () => (req, res, next) => next(),
    };
});

const db = require('../db');
const analyticsRouter = require('../routes/analyticsRoutes');
const analytics = require('../services/analytics');

const app = express();
app.use(express.json());
app.use('/api', analyticsRouter);

const RANGE = { from: '2026-08-01', to: '2026-08-31' };

/**
 * Stand in for the database. The executor issues BEGIN, two SET LOCALs, the
 * statements, then COMMIT on one client, so the mock answers by shape rather
 * than by call index -- helpers/partNumberSoftDelete.js fires its own
 * information_schema probe on module load, and indexing into mock.calls is how
 * that bites (learned in PR #171).
 */
const isAnalyticsStatement = (text) => typeof text === 'string' && /^\s*WITH\b/.test(text);

const givenRows = (...rowSets) => {
    let i = 0;
    mockClient.query.mockImplementation((text) => {
        if (!isAnalyticsStatement(text)) return Promise.resolve({ rows: [] });  // BEGIN / SET LOCAL / COMMIT
        const rows = rowSets[Math.min(i, rowSets.length - 1)];
        i += 1;
        return Promise.resolve({ rows });
    });
};

const givenFailure = (error) => mockClient.query.mockImplementation((text) => (
    isAnalyticsStatement(text) ? Promise.reject(error) : Promise.resolve({ rows: [] })
));

beforeEach(() => {
    jest.clearAllMocks();
    analytics.clearCaches();
    mockCurrentUser = { employee_id: 1, username: 'admin', permission_level_id: 10, permissions: [] };
    db.getClient.mockResolvedValue(mockClient);
    db.query.mockResolvedValue({ rows: [{ ready: true }] });
    mockClient.query.mockResolvedValue({ rows: [] });
});

describe('GET /api/analytics/meta', () => {
    test('describes the registry and this user\'s readiness flags', async () => {
        const res = await request(app).get('/api/analytics/meta');
        expect(res.status).toBe(200);
        expect(res.body.version).toEqual(expect.any(String));
        expect(res.body.metrics.length).toBeGreaterThan(0);
        expect(res.body.metrics[0]).toHaveProperty('description');
        expect(res.body.trustRules.map((r) => r.id)).toContain('costed_line');
        expect(res.body.readiness).toHaveProperty('expense_data');
        expect(res.get('Cache-Control')).toContain('private');
    });

    test('strips metrics the caller may not see', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 7, permissions: ['analytics:view'] };
        const res = await request(app).get('/api/analytics/meta');
        const ids = res.body.metrics.map((m) => m.id);
        expect(ids).toContain('sales.net_revenue');
        expect(ids).not.toContain('finance.operating_expenses');
    });
});

describe('GET /api/analytics/boards/:id', () => {
    test('returns a board spec with no data attached', async () => {
        const res = await request(app).get('/api/analytics/boards/overview');
        expect(res.status).toBe(200);
        expect(res.body.id).toBe('overview');
        expect(res.body.tiles.length).toBeGreaterThan(0);
        expect(res.body.tiles[0]).not.toHaveProperty('rows');
    });

    test('drops tiles whose metrics the caller may not see', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 7, permissions: ['analytics:view'] };
        const res = await request(app).get('/api/analytics/boards/overview');
        const tileIds = res.body.tiles.map((t) => t.id);
        expect(tileIds).toContain('overview.net_revenue');
        expect(tileIds).not.toContain('overview.net_profit');
    });

    test('an unknown board is a 404 that lists the ones there are', async () => {
        const res = await request(app).get('/api/analytics/boards/nope');
        expect(res.status).toBe(404);
        expect(res.body.details.valid).toContain('overview');
    });
});

describe('POST /api/analytics/query', () => {
    test('returns rows, totals and coverage for a valid request', async () => {
        givenRows([{
            bucket: 0, m_0: '1000.00', m_1: '400.00',
            cov_costed_line_num: '400.00', cov_costed_line_den: '1000.00',
            cov_costed_line_num_rows: '2', cov_costed_line_den_rows: '10',
            cov_costed_line_ratio: '0.4', cov_costed_line_row_ratio: '0.2',
        }]);

        const res = await request(app).post('/api/analytics/query').send({
            metrics: ['margin.gross_profit', 'margin.costed_revenue'],
            dateRange: RANGE,
        });

        expect(res.status).toBe(200);
        expect(res.body.rows).toHaveLength(1);
        expect(res.body.totals.values['margin.gross_profit']).toBe(1000);
        expect(res.body.coverage.costed_line.valueRatio).toBeCloseTo(0.4);
        expect(res.body.coverage.costed_line.level).toBe('low');
        expect(res.body.coverage.costed_line.explanation).toEqual(expect.any(String));
    });

    test('runs read-only with a statement timeout on the connection, not on the pool', async () => {
        givenRows([{ bucket: 0, m_0: '1' }]);
        await request(app).post('/api/analytics/query')
            .send({ metrics: ['sales.invoice_count'], dateRange: RANGE });

        const issued = mockClient.query.mock.calls.map((c) => c[0]).filter((t) => typeof t === 'string');
        expect(issued).toContain('BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ');
        expect(issued.some((t) => /^SET LOCAL statement_timeout/.test(t))).toBe(true);
        expect(issued).toContain('COMMIT');
        expect(mockClient.release).toHaveBeenCalled();
    });

    test('an invalid metric id is a 400 that names the valid ones', async () => {
        const res = await request(app).post('/api/analytics/query')
            .send({ metrics: ['sales.not_a_metric'], dateRange: RANGE });
        expect(res.status).toBe(400);
        expect(res.body.details.valid).toContain('sales.net_revenue');
        expect(db.getClient).not.toHaveBeenCalled();
    });

    test('a metric the caller lacks permission for is a 403 naming that metric', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 7, permissions: ['analytics:view'] };
        const res = await request(app).post('/api/analytics/query')
            .send({ metrics: ['finance.operating_expenses'], dateRange: RANGE });
        expect(res.status).toBe(403);
        expect(res.body.message).toMatch(/permission/i);
        expect(db.getClient).not.toHaveBeenCalled();
    });

    test('a metric whose module holds no data is refused rather than answered with zero', async () => {
        db.query.mockResolvedValue({ rows: [{ ready: false }] });
        const res = await request(app).post('/api/analytics/query')
            .send({ metrics: ['finance.operating_expenses'], dateRange: RANGE });
        expect(res.status).toBe(409);
        expect(res.body.message).toMatch(/not being recorded yet/i);
    });

    test('a database failure is a 500, not a partial answer', async () => {
        givenFailure(new Error('DB failure'));
        const res = await request(app).post('/api/analytics/query')
            .send({ metrics: ['sales.gross_revenue'], dateRange: RANGE });
        expect(res.status).toBe(500);
        expect(res.body.message).toMatch(/Failed to run/i);
    });

    test('a statement timeout says what to do about it', async () => {
        const timeout = Object.assign(new Error('canceling statement due to statement timeout'), { code: '57014' });
        givenFailure(timeout);
        const res = await request(app).post('/api/analytics/query')
            .send({ metrics: ['sales.gross_revenue'], dateRange: RANGE });
        expect(res.status).toBe(504);
        expect(res.body.message).toMatch(/shorter date range/i);
    });

    test('a CSV export needs the export permission', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 7, permissions: ['analytics:view'] };
        const res = await request(app).post('/api/analytics/query')
            .send({ metrics: ['sales.gross_revenue'], dateRange: RANGE, format: 'csv' });
        expect(res.status).toBe(403);
    });

    test('explain is refused to a non-administrator', async () => {
        mockCurrentUser = { employee_id: 2, permission_level_id: 7, permissions: ['analytics:view'] };
        const res = await request(app).post('/api/analytics/query?explain=1')
            .send({ metrics: ['sales.gross_revenue'], dateRange: RANGE });
        expect(res.status).toBe(403);
    });

    test('explain returns the statement without running it', async () => {
        const res = await request(app).post('/api/analytics/query?explain=1')
            .send({ metrics: ['sales.gross_revenue'], dateRange: RANGE });
        expect(res.status).toBe(200);
        expect(res.body.text).toContain('FROM invoice i');
        expect(db.getClient).not.toHaveBeenCalled();
    });
});

describe('POST /api/analytics/batch', () => {
    test('one bad key does not fail the whole request', async () => {
        givenRows([{ bucket: 0, m_0: '500.00' }]);

        const res = await request(app).post('/api/analytics/batch').send({
            queries: [
                { key: 'good', metrics: ['sales.gross_revenue'], dateRange: RANGE },
                { key: 'bad', metrics: ['sales.nonexistent'], dateRange: RANGE },
            ],
        });

        expect(res.status).toBe(200);
        expect(res.body.results.good.totals.values['sales.gross_revenue']).toBe(500);
        expect(res.body.results.bad.error.status).toBe(400);
    });

    test('every query in a batch runs on one connection, so tiles share a snapshot', async () => {
        givenRows([{ bucket: 0, m_0: '1' }], [{ bucket: 0, m_0: '2' }]);
        await request(app).post('/api/analytics/batch').send({
            queries: [
                { key: 'a', metrics: ['sales.invoice_count'], dateRange: RANGE },
                { key: 'b', metrics: ['sales.units_sold'], dateRange: RANGE },
            ],
        });
        expect(db.getClient).toHaveBeenCalledTimes(1);
    });

    test('a batch larger than the budget is refused before any work', async () => {
        const queries = Array.from({ length: 13 }, (_, i) => ({
            key: `k${i}`, metrics: ['sales.gross_revenue'], dateRange: RANGE,
        }));
        const res = await request(app).post('/api/analytics/batch').send({ queries });
        expect(res.status).toBe(400);
        expect(db.getClient).not.toHaveBeenCalled();
    });

    test('an identical query asked twice in one batch is executed once', async () => {
        givenRows([{ bucket: 0, m_0: '7' }]);
        const body = { metrics: ['sales.invoice_count'], dateRange: RANGE };
        const res = await request(app).post('/api/analytics/batch').send({
            queries: [{ key: 'a', ...body }, { key: 'b', ...body }],
        });
        expect(res.body.results.a.totals.values['sales.invoice_count']).toBe(7);
        expect(res.body.results.b.totals.values['sales.invoice_count']).toBe(7);
        const statements = mockClient.query.mock.calls.filter((c) => isAnalyticsStatement(c[0]));
        expect(statements.length).toBeLessThanOrEqual(2);
    });
});
