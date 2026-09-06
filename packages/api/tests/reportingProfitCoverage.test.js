/**
 * Guards the fix for the overstated-profit bug.
 *
 * Both profit-bearing reports used to subtract `cost_at_sale` without excluding
 * lines where it is 0. Because most parts carry no weighted average cost, 83% of
 * lines record cost as 0, so those reports returned the full sale price of those
 * lines as profit -- 86.2% margin over the last 12 months against a measurable
 * 33.0%. These tests assert the filter is present and that the response tells the
 * caller how much of the period it actually measured.
 */

const request = require('supertest');
const express = require('express');

jest.mock('../db', () => ({ query: jest.fn(), getClient: jest.fn() }));
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => { req.user = { employee_id: 1, username: 'tester' }; next(); },
    hasPermission: () => (req, res, next) => next(),
}));

const db = require('../db');
const reportingRouter = require('../routes/reportingRoutes');

const app = express();
app.use(express.json());
app.use('/api', reportingRouter);

const COSTED_FILTER = /cost_at_sale IS NOT NULL AND \w+\.cost_at_sale > 0/;

describe('GET /api/reports/profitability-by-product', () => {
    beforeEach(() => jest.clearAllMocks());

    const runReport = async (rows) => {
        db.query.mockResolvedValueOnce({ rows });
        return request(app).get('/api/reports/profitability-by-product')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' });
    };

    // helpers/partNumberSoftDelete.js probes information_schema on module load, so the
    // report's own query is not necessarily the first call. Select it by shape.
    const reportSql = () => db.query.mock.calls
        .map((c) => c[0])
        .find((t) => typeof t === 'string' && /total_profit/.test(t));

    test('excludes uncosted lines from cost and profit', async () => {
        await runReport([]);
        const sql = reportSql();
        expect(sql).toMatch(COSTED_FILTER);
        // The filter must apply to cost AND profit, not just one of them.
        const filterCount = (sql.match(/cost_at_sale > 0/g) || []).length;
        expect(filterCount).toBeGreaterThanOrEqual(3);
    });

    test('reports profit as null, not zero, when nothing in a row carried a cost', async () => {
        const res = await runReport([{
            internal_sku: 'X-1', display_name: 'Uncosted part',
            total_revenue: '5000.00', total_cost: '0', costed_revenue: '0',
            total_profit: '0', costed_line_count: '0', total_line_count: '12',
        }]);

        expect(res.status).toBe(200);
        const row = res.body[0];
        expect(row.total_profit).toBeNull();
        expect(row.total_cost).toBeNull();
        expect(row.cost_coverage_level).toBe('none');
        // Revenue is still real and must survive.
        expect(row.total_revenue).toBe('5000.00');
    });

    test('keeps profit and reports coverage when some lines carried a cost', async () => {
        const res = await runReport([{
            internal_sku: 'X-2', display_name: 'Partly costed part',
            total_revenue: '10000.00', total_cost: '3000.00', costed_revenue: '4000.00',
            total_profit: '1000.00', costed_line_count: '4', total_line_count: '10',
        }]);

        const row = res.body[0];
        expect(row.total_profit).toBe('1000.00');
        expect(row.cost_coverage_ratio).toBeCloseTo(0.4);
        expect(row.cost_coverage_level).toBe('low');
    });

    test('sorts rows with no measurable profit last', async () => {
        await runReport([]);
        expect(reportSql()).toMatch(/ORDER BY \(COUNT\(\*\) FILTER/);
    });

    test('requires a date range', async () => {
        const res = await request(app).get('/api/reports/profitability-by-product');
        expect(res.status).toBe(400);
    });

    test('returns 500 when the database fails', async () => {
        db.query.mockRejectedValueOnce(new Error('DB failure'));
        const res = await request(app).get('/api/reports/profitability-by-product')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' });
        expect(res.status).toBe(500);
    });
});

describe('GET /api/reports/sales-summary', () => {
    beforeEach(() => jest.clearAllMocks());

    const mockClient = (summaryRow) => {
        const client = {
            query: jest.fn()
                // The route fires details, summary and count concurrently; resolve by shape.
                .mockImplementation((text) => {
                    if (/gross_sales/.test(text)) return Promise.resolve({ rows: [summaryRow] });
                    if (/COUNT\(\*\)::int AS total/.test(text)) return Promise.resolve({ rows: [{ total: 0 }] });
                    return Promise.resolve({ rows: [] });
                }),
            release: jest.fn(),
        };
        db.getClient.mockResolvedValueOnce(client);
        return client;
    };

    const SUMMARY_ROW = {
        gross_sales: '100000.00', total_refunds: '0.00',
        gross_vat: '0.00', total_refund_vat: '0.00',
        total_cost_of_goods_sold: '6000.00', total_cost_of_goods_returned: '0.00',
        total_invoices: '50',
        costed_sales: '9000.00', all_line_sales: '100000.00',
        costed_line_count: '9', total_line_count: '100',
    };

    test('excludes uncosted lines from cost of goods sold', async () => {
        const client = mockClient(SUMMARY_ROW);
        await request(app).get('/api/reports/sales-summary')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' });

        const summarySql = client.query.mock.calls.map((c) => c[0]).find((t) => /gross_sales/.test(t));
        expect(summarySql).toMatch(COSTED_FILTER);
        // Refund costing leans on part.wac_cost, which has the same zero-means-unknown problem.
        expect(summarySql).toMatch(/wac_cost IS NOT NULL AND \w+\.wac_cost > 0/);
    });

    test('measures profit over costed sales, not all sales', async () => {
        mockClient(SUMMARY_ROW);
        const res = await request(app).get('/api/reports/sales-summary')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' });

        expect(res.status).toBe(200);
        // costed_sales 9000 - cost 6000 = 3000. The pre-fix behaviour would have
        // reported 100000 - 6000 = 94000.
        expect(res.body.summary.profit).toBe(3000);
        expect(res.body.summary.profit).not.toBe(94000);
        expect(res.body.summary.profitBasis).toBe('costed_lines');
    });

    test('still reports total sales across every line', async () => {
        mockClient(SUMMARY_ROW);
        const res = await request(app).get('/api/reports/sales-summary')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' });
        expect(res.body.summary.totalSales).toBe(100000);
    });

    test('attaches coverage so the caller can disclose the measured share', async () => {
        mockClient(SUMMARY_ROW);
        const res = await request(app).get('/api/reports/sales-summary')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' });

        const { coverage } = res.body.summary;
        expect(coverage.valueRatio).toBeCloseTo(0.09);
        expect(coverage.costedLines).toBe(9);
        expect(coverage.totalLines).toBe(100);
        expect(coverage.level).toBe('low');
    });

    test('reports profit as null when nothing in the period carried a cost', async () => {
        mockClient({
            ...SUMMARY_ROW,
            total_cost_of_goods_sold: '0.00', costed_sales: '0.00', costed_line_count: '0',
        });
        const res = await request(app).get('/api/reports/sales-summary')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' });

        expect(res.body.summary.profit).toBeNull();
        expect(res.body.summary.coverage.level).toBe('none');
    });
});
