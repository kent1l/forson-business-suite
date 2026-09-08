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

    // topN is the newest request surface, and the only one that puts a caller's
    // NUMBER inside a window-function stage rather than a WHERE clause.
    test.each(HOSTILE)('a hostile topN ranking metric yields a 400: %s', (hostile) => {
        expect(() => build({
            metrics: ['sales.line_revenue'],
            dimensions: ['brand'],
            dateRange: RANGE,
            topN: { n: 5, by: hostile },
        })).toThrow(AnalyticsRequestError);
    });

    test.each([
        '5; DROP TABLE part;--',
        '5 OR 1=1',
        5.5,
        Infinity,
        NaN,
        -1,
        null,
    ])('a topN size that is not a whole number in range is refused: %p', (hostile) => {
        expect(() => build({
            metrics: ['sales.line_revenue'],
            dimensions: ['brand'],
            dateRange: RANGE,
            topN: { n: hostile },
        })).toThrow(AnalyticsRequestError);
    });

    test('anything that does numify is coerced to a real integer before it is bound', () => {
        // Not a hole: a JSON body cannot carry a function, and whatever the caller
        // sent becomes a genuine JS number here or is refused. It reaches the
        // statement as a bound parameter either way, never as text.
        const { text, values } = build({
            metrics: ['sales.line_revenue'],
            dimensions: ['brand'],
            dateRange: RANGE,
            topN: { n: '6' },
        });
        expect(values).toContain(6);
        expect(values).not.toContain('6');
        expect(text).toMatch(/rn > \$\d+/);
    });

    test('a valid topN size still reaches the statement only as a parameter', () => {
        const { text, values } = build({
            metrics: ['sales.line_revenue'],
            dimensions: ['brand'],
            dateRange: RANGE,
            topN: { n: 7 },
        });
        expect(text).not.toMatch(/\b7\b/);
        expect(values).toContain(7);
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

// ---------------------------------------------------------------------------
// Phase 1: the top-N rollup, the two time dimensions, and the integer-division
// regression the first ratio over two counts uncovered.
// ---------------------------------------------------------------------------

describe('analytics query builder — top-N with an Other rollup', () => {
    // Deliberately not the assertion-counting helper the older blocks use: some
    // of these refusals are worth checking twice in one test, and a fixed count
    // makes that impossible.
    const refusalFor = (body) => {
        try {
            build(body);
        } catch (err) {
            return err;
        }
        throw new Error(`Expected ${JSON.stringify(body)} to be refused, but it built.`);
    };
    const expectStatus = (body, status, matcher) => {
        const err = refusalFor(body);
        expect(err).toBeInstanceOf(AnalyticsRequestError);
        expect(err.status).toBe(status);
        expect(err.message).toMatch(matcher);
    };

    const BRANDS = {
        metrics: ['sales.line_revenue'],
        dimensions: ['brand'],
        dateRange: RANGE,
        topN: { n: 8, by: 'sales.line_revenue' },
    };

    test('the fold happens in SQL, over leaf columns, and is flagged and counted', () => {
        const { text } = build(BRANDS);
        expect(text).toMatchSnapshot();

        expect(text).toContain('ranked AS (');
        expect(text).toContain('rolled AS (');
        expect(text).toMatch(/ROW_NUMBER\(\) OVER \(PARTITION BY j\.bucket ORDER BY m_0 DESC NULLS LAST/);
        // The tail is identified by a flag and sized by a count, so the frontend
        // never has to infer either from the label.
        expect(text).toContain('AS is_other');
        expect(text).toContain('COUNT(*) AS rollup_count');
        // Leaves are summed; nothing derived is folded, because summing a tail of
        // margin percentages would be meaningless.
        expect(text).toContain('SUM(m_0) AS m_0');
    });

    test('n is a parameter, never spliced into the text', () => {
        const { text, values } = build(BRANDS);
        expect(text).not.toMatch(/rn > 8\b/);
        expect(text).toMatch(/rn > \$\d+/);
        expect(values).toContain(8);
    });

    test("the 'Other' row sorts last whatever the reader sorted by", () => {
        const { text } = build({ ...BRANDS, sort: { by: 'sales.line_revenue', dir: 'ASC' } });
        // Without this the fold would lead an ascending sort, and a summary of
        // what is NOT listed would sit above the things that are.
        expect(text).toMatch(/ORDER BY bucket ASC, is_other ASC,/);
    });

    test('the row limit is raised above n so the fold cannot be cut off the bottom', () => {
        // A tile setting both limit: 8 and topN: { n: 8 } would otherwise lose the
        // very row the rollup exists to produce.
        const spec = parseQueryRequest({ ...BRANDS, limit: 8 }, adminReq);
        expect(spec.limit).toBe(9);
    });

    test('a rollup needs exactly one non-date breakdown', () => {
        expectStatus(
            { ...BRANDS, dimensions: ['brand', 'customer'] },
            400,
            /exactly one category breakdown/
        );
        expectStatus(
            {
                metrics: ['sales.gross_revenue'],
                dimensions: ['date'],
                grain: 'month',
                dateRange: RANGE,
                topN: { n: 5 },
            },
            400,
            /exactly one category breakdown/
        );
    });

    test('a rollup can only be ranked by a metric the query asks for', () => {
        expectStatus(
            { ...BRANDS, topN: { n: 8, by: 'margin.gross_profit' } },
            400,
            /Cannot rank a top-N by/
        );
    });

    test('n is bounded', () => {
        expectStatus({ ...BRANDS, topN: { n: 0 } }, 400, /whole number between 1 and/);
        expectStatus({ ...BRANDS, topN: { n: 5000 } }, 400, /whole number between 1 and/);
    });

    test('a query with no topN is unchanged — no ranking stage at all', () => {
        const { text } = build({ metrics: ['sales.line_revenue'], dimensions: ['brand'], dateRange: RANGE });
        expect(text).not.toContain('ranked AS (');
        expect(text).not.toContain('is_other');
    });
});

describe('analytics query builder — the hour and weekday dimensions', () => {
    test('both fold the whole range onto one grid, in Manila local time', () => {
        const { text } = build({
            metrics: ['sales.gross_revenue'],
            dimensions: ['weekday', 'hour_of_day'],
            dateRange: RANGE,
        });
        expect(text).toMatchSnapshot();
        expect(text).toContain("EXTRACT(ISODOW FROM i.invoice_date AT TIME ZONE 'Asia/Manila')::int");
        expect(text).toContain("EXTRACT(HOUR FROM i.invoice_date AT TIME ZONE 'Asia/Manila')::int");
        // Not a grain: there is no date_trunc, so the hours of every day in the
        // range land in the same 24 buckets rather than in consecutive ones.
        expect(text).not.toContain('date_trunc');
    });

    test('a source with no timestamp refuses them by name', () => {
        expect.assertions(2);
        try {
            build({
                metrics: ['inventory.stock_value'],
                dimensions: ['hour_of_day'],
                dateRange: RANGE,
            });
        } catch (err) {
            expect(err.status).toBe(400);
            // Driven by the dimension's needsDateColumn flag, not by naming 'date'.
            expect(err.message).toMatch(/has no date, so it cannot be broken down by hour of day/);
        }
    });
});

describe('analytics query builder — ratios are real numbers', () => {
    test('a ratio over two integer counts is cast, not integer-divided', () => {
        // Lines per invoice was the first ratio whose numerator and denominator
        // are both counts. Without the cast Postgres returned 2238 / 1259 = 1.
        const { text } = build({ metrics: ['sales.lines_per_invoice'], dateRange: RANGE });
        expect(text).toMatch(/ELSE \(m_\d\)::numeric \* /);
    });

    test('every ratio in the registry carries the cast', () => {
        for (const metric of Object.values(METRICS)) {
            if (metric.kind !== 'ratio') continue;
            if (!metric.grains.includes('none')) continue;
            const { text } = build({ metrics: [metric.id], dateRange: RANGE });
            expect(text).toMatch(/::numeric \* /);
        }
    });
});
