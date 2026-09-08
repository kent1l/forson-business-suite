// The rollup is the one place in the module where rows the reader never sees are
// added into a row they do. If the fold is wrong, the chart adds up to the wrong
// number and looks entirely plausible doing it -- so these tests take the SQL the
// builder produced, feed it the rows Postgres would return, and check what comes
// out the far end.

jest.mock('../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

const { parseQueryRequest } = require('../services/analytics/requestValidator');
const { buildQuery } = require('../services/analytics/queryBuilder');
const { coerceRows } = require('../services/analytics/executor');
const { shapeResponse } = require('../services/analytics/responseShaper');

const adminReq = { user: { employee_id: 1, permission_level_id: 10, permissions: [] } };
const RANGE = { from: '2026-08-01', to: '2026-08-31' };

const run = (body, rows) => {
    const spec = parseQueryRequest(body, adminReq);
    const { plan } = buildQuery(spec);
    return shapeResponse({ rows: coerceRows(rows, plan.columnMap), plan, spec });
};

describe('analytics rollup — what the reader is told about the tail', () => {
    const BODY = {
        metrics: ['sales.line_revenue'],
        dimensions: ['brand'],
        dateRange: RANGE,
        topN: { n: 2, by: 'sales.line_revenue' },
    };
    const ROWS = [
        { bucket: 0, is_other: false, rollup_count: 1, dim_0: 7, dim_0_label: 'CALTEX', m_0: '1000.00' },
        { bucket: 0, is_other: false, rollup_count: 1, dim_0: 9, dim_0_label: 'MRF', m_0: '600.00' },
        { bucket: 0, is_other: true, rollup_count: 374, dim_0: null, dim_0_label: 'Other', m_0: '2400.00' },
    ];

    test('the fold is flagged, sized, and last', () => {
        const out = run(BODY, ROWS);
        expect(out.rows.map((r) => r.rollup)).toEqual([false, false, true]);
        expect(out.rows[2].rollupCount).toBe(374);
        expect(out.rows[2].label[0]).toBe('Other');
        expect(out.meta.rollup).toEqual({ n: 2, by: 'sales.line_revenue', folded: 374 });
    });

    test('the total is the whole period, because the tail is one of the rows', () => {
        // The point of folding server-side: 1000 + 600 + 2400 is the period, where
        // a client-side "Other" built from a truncated result would have been the
        // remainder of whatever fitted.
        const out = run(BODY, ROWS);
        expect(out.totals.values['sales.line_revenue']).toBe(4000);
    });

    test('a rolled-up result is not truncated — nothing was dropped', () => {
        const out = run(BODY, ROWS);
        expect(out.meta.truncated).toBe(false);
    });

    test('a NULL key on a kept row is a real category, not the fold', () => {
        // '(No brand)' arrives with dim_0 NULL exactly as the tail does. Only the
        // flag separates them, which is why the flag exists.
        const out = run(BODY, [
            { bucket: 0, is_other: false, rollup_count: 1, dim_0: null, dim_0_label: '(No brand)', m_0: '900.00' },
            ...ROWS.slice(2),
        ]);
        expect(out.rows[0].rollup).toBe(false);
        expect(out.rows[0].label[0]).toBe('(No brand)');
        expect(out.rows[1].rollup).toBe(true);
    });

    test('a brand genuinely called Other is not treated as the fold', () => {
        const out = run(BODY, [
            { bucket: 0, is_other: false, rollup_count: 1, dim_0: 42, dim_0_label: 'Other', m_0: '900.00' },
        ]);
        expect(out.rows[0].rollup).toBe(false);
        expect(out.meta.rollup.folded).toBe(0);
    });

    test('a trusted metric with nothing measurable in the tail stays null, not zero', () => {
        // SUM over an all-NULL group is NULL, and it has to survive the fold:
        // "no cost was recorded for any of those 374 brands" is not "they made
        // nothing".
        const spec = parseQueryRequest({
            metrics: ['margin.gross_profit'],
            dimensions: ['brand'],
            dateRange: RANGE,
            topN: { n: 1, by: 'margin.gross_profit' },
        }, adminReq);
        const { plan } = buildQuery(spec);
        const cov = plan.coverageRules[0].columns;
        const rows = coerceRows([
            {
                bucket: 0, is_other: false, rollup_count: 1, dim_0: 7, dim_0_label: 'CALTEX', m_0: '500.00',
                [cov.num]: '500', [cov.den]: '500', [cov.numRows]: '2', [cov.denRows]: '2',
            },
            {
                bucket: 0, is_other: true, rollup_count: 40, dim_0: null, dim_0_label: 'Other', m_0: null,
                [cov.num]: '0', [cov.den]: '900', [cov.numRows]: '0', [cov.denRows]: '9',
            },
        ], plan.columnMap);
        const out = shapeResponse({ rows, plan, spec });

        expect(out.rows[1].values['margin.gross_profit']).toBeNull();
        expect(out.rows[1].coverage.costed_line.level).toBe('none');
        // The total is what WAS measured, over the coverage it was measured at.
        expect(out.totals.values['margin.gross_profit']).toBe(500);
        expect(out.totals.coverage.costed_line.valueRatio).toBeCloseTo(500 / 1400, 6);
    });

    test('without a rollup no row claims to be one', () => {
        const out = run(
            { metrics: ['sales.line_revenue'], dimensions: ['brand'], dateRange: RANGE },
            [{ bucket: 0, dim_0: 7, dim_0_label: 'CALTEX', m_0: '1000.00' }]
        );
        expect(out.rows[0]).not.toHaveProperty('rollup');
        expect(out.meta.rollup).toBeNull();
    });
});
