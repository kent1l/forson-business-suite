const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({
    query: jest.fn().mockResolvedValue({ rows: [] })
}));

jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => { req.user = { employee_id: 10 }; next(); },
    hasPermission: () => (req, res, next) => next()
}));

const db = require('../db');

/**
 * A refund reverses tax in the period it was issued, not the period of the
 * invoice it refunds. Without that, a refund against an old invoice silently
 * rewrote an already-reported period's VAT figures, and these reports disagreed
 * with the dashboard, which has always filtered on refund_date.
 */
describe('tax report routes attribute refunds to the refund period', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api', require('../routes/taxReportRoutes'));
    });

    beforeEach(() => {
        jest.clearAllMocks();
        db.query.mockResolvedValue({ rows: [] });
    });

    const refundDateFilter = "(cn.refund_date AT TIME ZONE 'Asia/Manila')::date BETWEEN $1 AND $2";

    const creditNoteQueries = () =>
        db.query.mock.calls
            .map(call => call[0])
            .filter(sql => typeof sql === 'string' && sql.includes('credit_note'));

    test.each([
        ['/api/tax-reports/summary'],
        ['/api/tax-reports/detailed'],
        ['/api/tax-reports/export'],
        ['/api/tax-reports/rates-usage'],
    ])('%s bounds credit notes by refund_date', async (path) => {
        db.query.mockResolvedValue({ rows: [{ total_count: 0 }] });

        const res = await request(app)
            .get(path)
            .query({ startDate: '2026-08-01', endDate: '2026-08-31' });

        expect(res.status).toBe(200);

        const queries = creditNoteQueries();
        expect(queries.length).toBeGreaterThan(0);
        queries.forEach(sql => expect(sql).toContain(refundDateFilter));
    });

    test('rates-usage covers every refund when asked for all-time data', async () => {
        const res = await request(app).get('/api/tax-reports/rates-usage');

        expect(res.status).toBe(200);
        const queries = creditNoteQueries();
        expect(queries.length).toBeGreaterThan(0);
        queries.forEach(sql => expect(sql).not.toContain('refund_date'));
    });
});
