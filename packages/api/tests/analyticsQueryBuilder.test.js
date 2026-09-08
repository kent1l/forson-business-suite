// The query builder is the one genuinely hard piece of the analytics module, and
// the class of bug it can produce is a number that looks plausible and is wrong.
// These tests snapshot the generated SQL for canonical specs, so any change to
// what a figure means shows up as a diff a reviewer has to approve.

jest.mock('../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

const { parseQueryRequest } = require('../services/analytics/requestValidator');
const { buildQuery } = require('../services/analytics/queryBuilder');
const { AnalyticsRequestError } = require('../services/analytics/errors');
const { METRICS, SOURCES, TRUST_RULES, leavesOf } = require('../services/analytics/registry');

const adminReq = { user: { employee_id: 1, permission_level_id: 10, permissions: [] } };
const viewerReq = {
    user: { employee_id: 2, permission_level_id: 7, permissions: ['analytics:view'] },
};
const RANGE = { from: '2026-08-01', to: '2026-08-31' };

const build = (body, req = adminReq) => buildQuery(parseQueryRequest(body, req));

describe('analytics query builder — generated SQL', () => {
    test('a single-source KPI aggregates in one CTE with no stitching', () => {
        const { text, values } = build({ metrics: ['sales.gross_revenue'], dateRange: RANGE });
        expect(text).toMatchSnapshot();
        expect(values).toEqual(['2026-08-01', '2026-08-31', 500]);
        expect(text).not.toContain('keys AS');
    });

    test('sales and refunds are aggregated in separate CTEs keyed by their own date columns', () => {
        const { text } = build({ metrics: ['sales.net_revenue'], dateRange: RANGE });
        expect(text).toMatchSnapshot();

        // The property that matters is structural, not cosmetic: there is no code
        // path that puts credit_note and invoice in the same FROM clause, which is
        // what caused the VAT-period incident documented in taxReportRoutes.js.
        const invoiceCte = text.slice(text.indexOf('src_invoice_header AS'), text.indexOf('src_credit_note_header AS'));
        expect(invoiceCte).not.toContain('credit_note');
        expect(text).toContain("FROM credit_note cn");
        expect(text).toContain('cn.refund_date');
        expect(text).toContain('i.invoice_date');
    });

    test('multi-source stitching joins on IS NOT DISTINCT FROM so a NULL key is not dropped', () => {
        const { text } = build({
            metrics: ['sales.net_revenue'],
            dimensions: ['customer'],
            dateRange: RANGE,
        });
        expect(text).toContain('IS NOT DISTINCT FROM');
        expect(text).not.toMatch(/ON\s+s\d\.dim_0\s*=/);
    });

    test('a period comparison is one query with a bucket column, not two round trips', () => {
        const { text, values } = build({
            metrics: ['sales.net_revenue'],
            dimensions: ['date'],
            grain: 'month',
            dateRange: RANGE,
            compare: 'previous_period',
        });
        expect(text).toMatchSnapshot();
        expect(text).toMatch(/CASE WHEN .* THEN 0 ELSE 1 END AS bucket/);
        expect(values.slice(0, 4)).toEqual(['2026-08-01', '2026-08-31', '2026-07-01', '2026-07-31']);
    });

    test('a trusted metric is filtered and its coverage measured, in the same CTE', () => {
        const { text } = build({
            metrics: ['margin.gross_profit', 'margin.gross_margin_pct'],
            dateRange: RANGE,
        });
        expect(text).toMatchSnapshot();
        expect(text).toContain('FILTER (WHERE (il.cost_at_sale IS NOT NULL AND il.cost_at_sale > 0))');
        // Coverage columns are emitted once per (source, rule), not once per metric.
        expect(text.match(/AS cov_costed_line_num\b/g)).toHaveLength(1);
        expect(text).toContain('cov_costed_line_den');
    });

    test('a ratio is computed after aggregation, never averaged across rows', () => {
        const { text } = build({
            metrics: ['margin.gross_margin_pct'],
            dimensions: ['date'],
            grain: 'month',
            dateRange: RANGE,
        });
        // The division appears in the final SELECT, over already-summed columns.
        const finalSelect = text.slice(text.lastIndexOf('\nSELECT'));
        expect(finalSelect).toMatch(/CASE WHEN COALESCE\(m_\d, 0\) = 0 THEN NULL::numeric/);
        expect(text).not.toMatch(/AVG\s*\(/i);
    });

    test('a snapshot-only query mentions no date parameter it would not use', () => {
        // pg rejects a statement handed a parameter its text never references.
        const { text, values } = build({
            metrics: ['inventory.stock_value', 'ar.balance'],
            dateRange: RANGE,
        });
        expect(values).toEqual([500]);
        for (let i = 1; i <= values.length; i += 1) expect(text).toContain(`$${i}`);
        expect(text).not.toContain(`$${values.length + 1}`);
    });
});

describe('analytics query builder — refusals', () => {
    const expectStatus = (body, status, matcher) => {
        expect.assertions(2);
        try {
            build(body);
        } catch (err) {
            expect(err).toBeInstanceOf(AnalyticsRequestError);
            expect(err.status === status && matcher.test(err.message)).toBe(true);
        }
    };

    test('a composite whose refund component carries no part detail is refused, not partially answered', () => {
        // Silently dropping the refund term would answer with a plausible wrong number.
        expectStatus(
            { metrics: ['sales.net_revenue'], dimensions: ['brand'], dateRange: RANGE },
            400,
            /cannot be broken down by 'brand'/
        );
    });

    test('a point-in-time figure cannot be broken down by month', () => {
        expectStatus(
            { metrics: ['inventory.stock_value'], dimensions: ['date'], grain: 'month', dateRange: RANGE },
            400,
            /point-in-time/
        );
    });

    test('a point-in-time figure cannot be compared against an earlier period', () => {
        expectStatus(
            { metrics: ['ar.balance'], dateRange: RANGE, compare: 'previous_period' },
            400,
            /position as of now/
        );
    });

    test('a metric the caller may not see is a 403 naming that metric', () => {
        expect.assertions(2);
        try {
            build({ metrics: ['finance.operating_expenses'], dateRange: RANGE }, viewerReq);
        } catch (err) {
            expect(err.status).toBe(403);
            expect(err.details.metric).toBe('finance.operating_expenses');
        }
    });

    test('a comparison across a category breakdown is refused in Phase 0', () => {
        expectStatus(
            { metrics: ['sales.gross_revenue'], dimensions: ['customer'], dateRange: RANGE, compare: 'previous_period' },
            400,
            /not on a breakdown by category/
        );
    });
});

describe('analytics query builder — injection safety', () => {
    // The invariant: no byte of the generated text originates from the request.
    const HOSTILE = [
        "'; DROP TABLE invoice;--",
        '__proto__',
        'constructor',
        'constructor.prototype',
        'sales.gross_revenue"; DELETE FROM part; --',
        '1 OR 1=1',
        'ѕales.gross_revenue',          // Cyrillic homoglyph
        '../../etc/passwd',
        'date_trunc(\'month\', now())',
    ];

    test.each(HOSTILE)('a hostile metric id yields a 400, never SQL carrying it: %s', (hostile) => {
        expect(() => build({ metrics: [hostile], dateRange: RANGE })).toThrow(AnalyticsRequestError);
    });

    test.each(HOSTILE)('a hostile dimension id yields a 400: %s', (hostile) => {
        expect(() => build({ metrics: ['sales.gross_revenue'], dimensions: [hostile], dateRange: RANGE }))
            .toThrow(AnalyticsRequestError);
    });

    test.each(HOSTILE)('a hostile grain yields a 400: %s', (hostile) => {
        expect(() => build({ metrics: ['sales.gross_revenue'], grain: hostile, dateRange: RANGE }))
            .toThrow(AnalyticsRequestError);
    });

    test.each(HOSTILE)('a hostile sort key yields a 400: %s', (hostile) => {
        expect(() => build({ metrics: ['sales.gross_revenue'], sort: { by: hostile }, dateRange: RANGE }))
            .toThrow(AnalyticsRequestError);
    });

    test('a hostile sort direction degrades to a whitelisted literal', () => {
        const { text } = build({
            metrics: ['sales.gross_revenue'],
            sort: { by: 'sales.gross_revenue', dir: 'ASC; DROP TABLE invoice' },
            dateRange: RANGE,
        });
        expect(text).not.toContain('DROP');
        expect(text).toMatch(/ (ASC|DESC) NULLS LAST/);
    });

    test('hostile filter values reach the statement only as parameters', () => {
        const { text, values } = build({
            metrics: ['sales.line_revenue'],
            dimensions: ['brand'],
            filters: { brand: [1, 2] },
            dateRange: RANGE,
        });
        expect(text).toContain('= ANY($');
        expect(values).toContainEqual([1, 2]);
        // A brand filter is by id; a string is rejected rather than interpolated.
        expect(() => build({
            metrics: ['sales.line_revenue'],
            dimensions: ['brand'],
            filters: { brand: ["1); DROP TABLE part;--"] },
            dateRange: RANGE,
        })).toThrow(AnalyticsRequestError);
    });

    test('a hostile date range is rejected before any SQL is built', () => {
        expect(() => build({ metrics: ['sales.gross_revenue'], dateRange: { from: "2026-01-01'; --", to: '2026-01-31' } }))
            .toThrow(AnalyticsRequestError);
    });
});

describe('registry SQL carries no placeholders of its own', () => {
    test('every metric expression renders without a $ or an undefined column', () => {
        for (const metric of Object.values(METRICS)) {
            if (!metric.source) continue;
            const cols = SOURCES[metric.source].cols;
            for (const fn of ['expr', 'where']) {
                if (!metric[fn]) continue;
                const sql = String(metric[fn](cols));
                expect(sql).not.toContain('$');
                expect(sql).not.toContain('undefined');
            }
        }
    });

    test('every trust rule renders against every source that uses it', () => {
        for (const metric of Object.values(METRICS)) {
            if (!metric.trust) continue;
            const rule = TRUST_RULES[metric.trust];
            const cols = SOURCES[metric.source].cols;
            for (const fn of ['predicate', 'weight', 'scope']) {
                if (!rule[fn]) continue;
                const sql = String(rule[fn](cols));
                expect(sql).not.toContain('$');
                expect(sql).not.toContain('undefined');
            }
        }
    });

    test('a derived metric is at least as restricted as everything it is computed from', () => {
        // The permission check runs on what was asked for, not on what the answer
        // is made of -- and a composite hands its components back alongside the
        // total. A metric visible under analytics:view whose component required
        // analytics:financials would therefore give that component away, so the
        // registry refuses to load one.
        for (const metric of Object.values(METRICS)) {
            if (metric.kind === 'additive' || metric.kind === 'snapshot') continue;
            for (const leafId of leavesOf(metric.id)) {
                const leaf = METRICS[leafId];
                expect([metric.permission, 'analytics:view']).toContain(leaf.permission);
            }
        }
    });

    test('a metric declaring a trust rule can never be computed without its filter', () => {
        // Enforced by construction: the builder is the only thing that renders an
        // aggregate, and it always appends the rule's predicate.
        const { text } = build({ metrics: ['margin.gross_profit'], dateRange: RANGE });
        const aggregate = text.split('\n').find((line) => line.includes('cost_at_sale') && line.includes('SUM('));
        expect(aggregate).toContain('FILTER (WHERE');
        expect(aggregate).toContain('il.cost_at_sale > 0');
    });
});
