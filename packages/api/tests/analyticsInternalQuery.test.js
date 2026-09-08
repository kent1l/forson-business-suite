// `runInternalQuery` is the one path that skips the per-metric permission check.
// It exists so /reports/profitability-by-product can read the metric registry
// instead of keeping its own copy of the profit SQL. These tests hold the two
// properties that make skipping the check safe.

jest.mock('../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

const analytics = require('../services/analytics');
const { AnalyticsRequestError } = require('../services/analytics/errors');
const { parseQueryRequest } = require('../services/analytics/requestValidator');

// reports:view only — deliberately NOT an analytics user.
const reportsOnlyReq = {
    user: { employee_id: 3, permission_level_id: 5, permissions: ['reports:view'] },
};

describe('analytics internal query', () => {
    test('a metric needing more than analytics:view is refused, whatever the route checked', async () => {
        // The guard that stops this becoming a way around the per-metric grants.
        await expect(analytics.runInternalQuery(
            { metrics: ['finance.operating_expenses'], dateRange: { from: '2026-08-01', to: '2026-08-31' } },
            reportsOnlyReq
        )).rejects.toThrow(/cannot be read through an internal query/);
    });

    test('the trusted flag skips the per-metric check but nothing else', () => {
        const body = {
            metrics: ['margin.gross_profit'],
            dimensions: ['part'],
            dateRange: { from: '2026-08-01', to: '2026-08-31' },
        };
        // Without it, a reports-only user cannot read an analytics metric at all.
        expect(() => parseQueryRequest(body, reportsOnlyReq)).toThrow(AnalyticsRequestError);
        // With it, the metric resolves — but every other refusal still applies.
        expect(() => parseQueryRequest(body, reportsOnlyReq, { trusted: true })).not.toThrow();
        expect(() => parseQueryRequest(
            { ...body, metrics: ["'; DROP TABLE invoice;--"] },
            reportsOnlyReq,
            { trusted: true }
        )).toThrow(AnalyticsRequestError);
        expect(() => parseQueryRequest(
            { ...body, dimensions: ['nonsense'] },
            reportsOnlyReq,
            { trusted: true }
        )).toThrow(AnalyticsRequestError);
    });

    test('the public query path is unaffected — it still enforces per-metric permission', () => {
        expect(() => parseQueryRequest(
            { metrics: ['finance.operating_expenses'], dateRange: { from: '2026-08-01', to: '2026-08-31' } },
            reportsOnlyReq
        )).toThrow(AnalyticsRequestError);
    });
});
