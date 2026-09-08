/**
 * Guards the fix for the overstated-profit bug.
 *
 * Both profit-bearing reports used to subtract `cost_at_sale` without excluding
 * lines where it is 0. Because most parts carry no weighted average cost, 83% of
 * lines record cost as 0, so those reports returned the full sale price of those
 * lines as profit -- 86.2% margin over the last 12 months against a measurable
 * 33.0%. These tests assert the filter is present and that the response tells the
 * caller how much of the period it actually measured.
 *
 * /reports/profitability-by-product no longer owns the SQL that does this: it
 * reads the analytics metric registry, so that changing what gross profit means
 * moves both pages at once (PRD §13 R2). The tests below therefore assert the
 * ENDPOINT's contract -- nulls rather than zeros, coverage on every row, the
 * costed-line filter reaching the database -- rather than the shape of a query
 * string this route no longer writes. /reports/sales-summary is untouched and
 * its tests below are unchanged.
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

const analytics = require('../services/analytics');
const { parseQueryRequest } = require('../services/analytics/requestValidator');
const { buildQuery } = require('../services/analytics/queryBuilder');

/**
 * The metrics the route asks the registry for. Declared here deliberately: it is
 * the endpoint's contract, so a future edit that stops asking for gross profit
 * should fail this file rather than pass it quietly.
 */
const ROUTE_METRICS = [
    'sales.units_sold',
    'sales.line_revenue',
    'margin.cogs',
    'margin.gross_profit',
    'margin.costed_revenue',
];

const RANGE = { from: '2026-01-01', to: '2026-01-31' };

/** The plan the route's spec produces, so a fake row can be keyed correctly. */
const routePlan = () => buildQuery(parseQueryRequest({
    metrics: ROUTE_METRICS,
    dimensions: ['part'],
    dateRange: RANGE,
    sort: { by: 'margin.gross_profit', dir: 'DESC' },
}, { user: {} }, { trusted: true })).plan;

const analyticsRow = (plan, { partId, name, values, coverage }) => ({
    bucket: 0,
    [plan.dimensionOrder[0].key]: partId,
    [plan.dimensionOrder[0].label]: name,
    ...Object.fromEntries(
        Object.entries(values).map(([metricId, v]) => [plan.metricColumns[metricId], v])
    ),
    cov_costed_line_num: coverage.num,
    cov_costed_line_den: coverage.den,
    cov_costed_line_num_rows: coverage.numRows,
    cov_costed_line_den_rows: coverage.denRows,
});

describe('GET /api/reports/profitability-by-product', () => {
    let analyticsSql;

    beforeEach(() => {
        jest.clearAllMocks();
        // The service caches by statement text, so without this the second test
        // would be answered by the first one's rows.
        analytics.clearCaches();
        analyticsSql = null;
    });

    /**
     * The analytics executor takes its own client; the route's descriptive lookup
     * uses the pool. Both are faked here, and the statement the executor was
     * handed is captured so the tests can assert what actually reached Postgres.
     */
    const givenRows = (rows, details = []) => {
        db.getClient.mockResolvedValue({
            query: jest.fn((text) => {
                if (typeof text === 'string' && /^(BEGIN|COMMIT|ROLLBACK|SET)/.test(text.trim())) {
                    return Promise.resolve({ rows: [] });
                }
                analyticsSql = text;
                return Promise.resolve({ rows });
            }),
            release: jest.fn(),
        });
        db.query.mockResolvedValue({ rows: details });
    };

    const runReport = (query = {}) => request(app)
        .get('/api/reports/profitability-by-product')
        .query({ startDate: RANGE.from, endDate: RANGE.to, ...query });

    test('the costed-line filter reaches the database', async () => {
        givenRows([]);
        await runReport();
        expect(analyticsSql).toMatch(COSTED_FILTER);
        // Cost, profit and costed revenue are three separate trusted metrics, and
        // the filter has to be on all of them, not just whichever one was noticed.
        expect((analyticsSql.match(/cost_at_sale > 0/g) || []).length).toBeGreaterThanOrEqual(3);
    });

    test('reports profit as null, not zero, when nothing in a row carried a cost', async () => {
        const plan = routePlan();
        givenRows(
            [analyticsRow(plan, {
                partId: 11,
                name: 'Uncosted part',
                values: {
                    'sales.units_sold': '12',
                    'sales.line_revenue': '5000.00',
                    // A trusted metric with nothing measurable is NULL, never 0.
                    'margin.cogs': null,
                    'margin.gross_profit': null,
                    'margin.costed_revenue': null,
                },
                coverage: { num: '0', den: '5000', numRows: '0', denRows: '12' },
            })],
            [{ part_id: 11, internal_sku: 'X-1', detail: null, brand_name: null, group_name: null, part_numbers: null }]
        );

        const res = await runReport();
        expect(res.status).toBe(200);
        const row = res.body[0];
        expect(row.total_profit).toBeNull();
        expect(row.total_cost).toBeNull();
        expect(row.cost_coverage_level).toBe('none');
        // Revenue is still real and must survive.
        expect(row.total_revenue).toBe(5000);
        expect(row.display_name).toBe('Uncosted part');
        expect(row.internal_sku).toBe('X-1');
    });

    test('keeps profit and reports coverage when some lines carried a cost', async () => {
        const plan = routePlan();
        givenRows(
            [analyticsRow(plan, {
                partId: 22,
                name: 'Partly costed part',
                values: {
                    'sales.units_sold': '30',
                    'sales.line_revenue': '10000.00',
                    'margin.cogs': '3000.00',
                    'margin.gross_profit': '1000.00',
                    'margin.costed_revenue': '4000.00',
                },
                coverage: { num: '4000', den: '10000', numRows: '4', denRows: '10' },
            })],
            [{ part_id: 22, internal_sku: 'X-2', detail: null, brand_name: 'ACME', group_name: null, part_numbers: 'A-1; A-2' }]
        );

        const row = (await runReport()).body[0];
        expect(row.total_profit).toBe(1000);
        expect(row.total_cost).toBe(3000);
        expect(row.costed_revenue).toBe(4000);
        expect(row.cost_coverage_ratio).toBeCloseTo(0.4);
        expect(row.cost_coverage_level).toBe('low');
        expect(row.costed_line_count).toBe(4);
        expect(row.total_line_count).toBe(10);
        // Descriptive columns the registry's `part` dimension does not carry.
        expect(row.brand_name).toBe('ACME');
        expect(row.part_numbers).toBe('A-1; A-2');
    });

    test('sorts rows with no measurable profit last', async () => {
        givenRows([]);
        await runReport();
        // NULLS LAST on a descending sort is what the old hand-written
        // "costed first, then profit" ORDER BY was doing by hand.
        expect(analyticsSql).toMatch(/ORDER BY .*DESC NULLS LAST/);
    });

    test('measures revenue the way Analytics does, including the legacy rows', async () => {
        givenRows([]);
        await runReport();
        // The old query read il.tax_base directly and silently dropped the 477
        // legacy lines that carry NULL. Reading the fallback is what makes this
        // report and the Analytics page agree.
        expect(analyticsSql).toContain('COALESCE(il.tax_base');
    });

    test('requires a date range', async () => {
        const res = await request(app).get('/api/reports/profitability-by-product');
        expect(res.status).toBe(400);
    });

    test('returns 500 when the database fails', async () => {
        db.getClient.mockRejectedValueOnce(new Error('DB failure'));
        const res = await runReport();
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

    test('leaves per-line cost blank rather than 0 in the exported detail rows', async () => {
        const client = mockClient(SUMMARY_ROW);
        await request(app).get('/api/reports/sales-summary')
            .query({ startDate: '2026-01-01', endDate: '2026-01-31' });

        const detailSql = client.query.mock.calls.map((c) => c[0]).find((t) => /AS line_cost/.test(t));
        // A 0.00 in a cost column of the CSV invites Total - Cost to be summed as profit,
        // which is the very calculation this fix removes from the report itself.
        expect(detailSql).toMatch(/CASE WHEN .*cost_at_sale > 0.* THEN .* END AS line_cost/s);
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
