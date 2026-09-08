// The insights panel is the highest-risk-per-line part of this module, because a
// sentence is trusted more than a number is. These tests hold the properties
// that make it safe to ship: nothing is generated, every insight can be checked,
// missing data produces silence rather than a confident claim, and a rule cannot
// leak a metric the reader is not allowed to see.

jest.mock('../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

const { evaluateInsights, namedConcentration } = require('../services/analytics/insights');
const { INSIGHT_RULES } = require('../services/analytics/registry/insights');
const { METRICS } = require('../services/analytics/registry');

const RANGE = { preset: 'last_30_days' };
const req = { user: { employee_id: 1, permission_level_id: 10, permissions: [] } };

const READY = { expense_data: true, payroll_data: true, ar_ledger_data: true, line_discount_data: true };

/**
 * Answers every query in a batch with one canned result, so a rule's condition
 * can be driven directly. Real SQL is covered by the db-test; what matters here
 * is what a rule does with the answer.
 */
const fakeBatch = (totals, { rows = [], coverage = {} } = {}) => async (requests) =>
    requests.map((r) => ({
        key: r.key,
        result: { rows, totals, coverage, meta: {} },
        error: null,
    }));

const totalsOf = (values, compare = null) => ({ values, ...(compare ? { compare } : {}) });

const run = (opts, deps) => evaluateInsights(
    { boardId: 'overview', dateRange: RANGE, compare: true, ...opts },
    req,
    { canSee: () => true, readiness: READY, settings: {}, ...deps }
);

describe('analytics insights — the rules', () => {
    test('dead stock fires above its threshold and cites what it was worked out from', async () => {
        const { insights } = await run({}, {
            runBatch: fakeBatch(totalsOf({
                'inventory.dead_stock_value': 1979005.59,
                'inventory.dead_stock_share': 75.9,
                'inventory.dead_stock_parts': 2011,
            })),
        });
        const dead = insights.find((i) => i.id === 'insight.dead_stock');
        expect(dead).toBeDefined();
        expect(dead.cites).toContain('inventory.dead_stock_value');
        expect(dead.values.share.value).toBe(75.9);
        // A template, not a sentence: the server never renders the prose.
        expect(dead.template).toMatch(/\{value\}/);
    });

    test('it stays silent below its threshold', async () => {
        const { insights } = await run({}, {
            runBatch: fakeBatch(totalsOf({
                'inventory.dead_stock_value': 100,
                'inventory.dead_stock_share': 5,
                'inventory.dead_stock_parts': 3,
            })),
        });
        expect(insights.find((i) => i.id === 'insight.dead_stock')).toBeUndefined();
    });

    test('a null metric is not treated as a low value', async () => {
        // The trap this whole module exists to avoid: `null < 80` is TRUE in
        // JavaScript, so a period with no sales at all would otherwise announce
        // that cost coverage had collapsed.
        const { insights } = await run({}, {
            runBatch: fakeBatch(totalsOf({
                'quality.cost_coverage_pct': null,
                'quality.uncosted_line_count': null,
                'quality.uncosted_revenue': null,
                'inventory.dead_stock_share': null,
                'inventory.dead_stock_value': null,
                'inventory.dead_stock_parts': null,
                'inventory.reorder_parts': null,
                'inventory.uncosted_stocked_parts': null,
            })),
        });
        expect(insights).toEqual([]);
    });

    test('an insight whose sentence would have a hole in it is dropped', async () => {
        // The condition is met, but one of the values the template needs came
        // back null. A claim with a dash in the middle of it is worse than none.
        const { insights } = await run({}, {
            runBatch: fakeBatch(totalsOf({
                'inventory.dead_stock_share': 80,
                'inventory.dead_stock_value': null,
                'inventory.dead_stock_parts': 2011,
            })),
        });
        expect(insights.find((i) => i.id === 'insight.dead_stock')).toBeUndefined();
    });

    test('a period movement needs a comparable period, not merely a missing one', async () => {
        const withoutCompare = await run({}, {
            runBatch: fakeBatch(totalsOf(
                { 'sales.net_revenue': 500000 },
                { available: false, values: {}, delta: {}, deltaPct: {} }
            )),
        });
        expect(withoutCompare.insights.find((i) => i.id === 'insight.period_movement')).toBeUndefined();

        const withCompare = await run({}, {
            runBatch: fakeBatch(totalsOf(
                { 'sales.net_revenue': 500000 },
                { available: true, values: { 'sales.net_revenue': 700000 }, delta: {}, deltaPct: { 'sales.net_revenue': -28.5 } }
            )),
        });
        const moved = withCompare.insights.find((i) => i.id === 'insight.period_movement');
        expect(moved).toBeDefined();
        expect(moved.values.direction.value).toBe('down');
        expect(moved.values.move.value).toBeCloseTo(28.5);
    });

    test('a movement against a period that barely exists is not reported', async () => {
        // The database holds twelve months, so on "last 12 months" the period
        // before it is nearly empty and the arithmetic says revenue is up
        // 10,025%. True, and a confident falsehood about the business.
        const { insights } = await run({}, {
            runBatch: fakeBatch(totalsOf(
                { 'sales.net_revenue': 11187467 },
                {
                    available: true,
                    values: { 'sales.net_revenue': 110490 },
                    delta: {},
                    deltaPct: { 'sales.net_revenue': 10025.3 },
                }
            )),
        });
        expect(insights.find((i) => i.id === 'insight.period_movement')).toBeUndefined();
    });

    test('a real movement against a real baseline still reports', async () => {
        const { insights } = await run({}, {
            runBatch: fakeBatch(totalsOf(
                { 'sales.net_revenue': 763004 },
                {
                    available: true,
                    values: { 'sales.net_revenue': 970916 },
                    delta: {},
                    deltaPct: { 'sales.net_revenue': -21.4 },
                }
            )),
        });
        const moved = insights.find((i) => i.id === 'insight.period_movement');
        expect(moved).toBeDefined();
        expect(moved.values.direction.value).toBe('down');
    });

    test('a refund rate that doubles from almost nothing is not a spike', async () => {
        const { insights } = await run({}, {
            runBatch: fakeBatch(totalsOf(
                { 'sales.refund_rate': 0.02, 'sales.refunds': 40 },
                { available: true, values: { 'sales.refund_rate': 0.01 }, delta: {}, deltaPct: {} }
            )),
        });
        expect(insights.find((i) => i.id === 'insight.refund_spike')).toBeUndefined();
    });

    test('insights come back most severe first', async () => {
        const { insights } = await run({}, {
            runBatch: fakeBatch(totalsOf({
                'inventory.reorder_parts': 118,
                'inventory.reorder_revenue_90d': 822078,
                'inventory.dead_stock_value': 1979005,
                'inventory.dead_stock_share': 75.9,
                'inventory.dead_stock_parts': 2011,
                'inventory.uncosted_stocked_parts': 1842,
                'inventory.stocked_parts': 2635,
            })),
        });
        const severities = insights.map((i) => i.severity);
        expect(severities[0]).toBe('critical');
        expect([...severities].sort((a, b) => ({ critical: 0, warning: 1, info: 2 }[a] - { critical: 0, warning: 1, info: 2 }[b])))
            .toEqual(severities);
    });
});

describe('analytics insights — what a reader is never shown', () => {
    test('a rule citing a metric the user may not see is dropped entirely', async () => {
        const runBatch = jest.fn(fakeBatch(totalsOf({ 'inventory.dead_stock_share': 80 })));
        const { insights, evaluated } = await run({}, {
            runBatch,
            canSee: (id) => !id.startsWith('inventory.'),
        });
        expect(insights.find((i) => i.id === 'insight.dead_stock')).toBeUndefined();
        // Dropped before the query, not filtered out of the answer.
        for (const call of runBatch.mock.calls) {
            for (const q of call[0]) {
                expect(q.body.metrics.some((m) => m.startsWith('inventory.'))).toBe(false);
            }
        }
        expect(evaluated).toBeLessThan(Object.keys(INSIGHT_RULES).length);
    });

    test('a rule needing a setting nobody has filled in stays dark', async () => {
        const dark = await run({}, {
            runBatch: fakeBatch(totalsOf({ 'sales.gross_revenue': 1000 })),
            settings: {},
        });
        expect(dark.insights.find((i) => i.id === 'insight.customer_concentration')).toBeUndefined();
    });

    test('a query that fails takes its own insight down, not the panel', async () => {
        const { insights } = await run({}, {
            runBatch: async (requests) => requests.map((r, i) => (i === 0
                ? { key: r.key, result: null, error: new Error('boom') }
                : { key: r.key, result: { rows: [], totals: totalsOf({ 'inventory.dead_stock_share': 80, 'inventory.dead_stock_value': 1, 'inventory.dead_stock_parts': 1 }), coverage: {} }, error: null })),
        });
        expect(Array.isArray(insights)).toBe(true);
    });
});

describe('analytics insights — named-account concentration', () => {
    const rows = [
        { key: [1], label: ['Walk-in Customer'], values: { 'sales.gross_revenue': 8000 }, rollup: false },
        { key: [4], label: ['IAN DUENAS'], values: { 'sales.gross_revenue': 1200 }, rollup: false },
        { key: [32], label: ['JDE'], values: { 'sales.gross_revenue': 400 }, rollup: false },
        { key: [null], label: ['Other'], values: { 'sales.gross_revenue': 400 }, rollup: true },
    ];
    const totals = totalsOf({ 'sales.gross_revenue': 10000 });

    test('the counter is removed from both the ranking and the denominator', async () => {
        const named = namedConcentration(rows, totals, 1);
        // 1200 of the 2000 that was not walk-in, not 1200 of 10000.
        expect(named.label).toBe('IAN DUENAS');
        expect(named.namedTotal).toBe(2000);
        expect(named.sharePct).toBeCloseTo(60);
    });

    test("the folded 'Other' row is never ranked as a customer", async () => {
        const named = namedConcentration(
            [...rows.slice(0, 1), { key: [null], label: ['Other'], values: { 'sales.gross_revenue': 1900 }, rollup: true }],
            totals,
            1
        );
        // Only walk-in and the fold: there is no named account to name.
        expect(named).toBeNull();
    });

    test('without the setting there is no answer at all', () => {
        expect(namedConcentration(rows, totals, null)).toBeNull();
    });
});

describe('analytics insights — the registry itself', () => {
    test('every rule cites only metrics its own query asked for', () => {
        for (const rule of Object.values(INSIGHT_RULES)) {
            for (const id of rule.cites) {
                expect(METRICS[id]).toBeDefined();
                expect(rule.query.metrics).toContain(id);
            }
        }
    });

    test('every template placeholder is supplied by the rule', () => {
        // A rule that renders "{parts} parts" literally would be a visible bug in
        // production; this catches it at test time.
        for (const rule of Object.values(INSIGHT_RULES)) {
            const names = [...rule.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
            expect(names.length).toBeGreaterThan(0);
            const stub = {
                v: () => 1, prev: () => 1, d: () => 1,
                rows: [], totals: totalsOf({}), coverage: {}, settings: {},
                t: rule.thresholds || {},
                named: { label: 'x', value: 1, namedTotal: 2, sharePct: 50 },
            };
            const supplied = Object.keys(rule.values(stub));
            for (const name of names) expect(supplied).toContain(name);
        }
    });

    test('no rule declares a threshold it never reads', () => {
        for (const rule of Object.values(INSIGHT_RULES)) {
            const source = `${rule.when.toString()}${rule.values.toString()}`;
            for (const key of Object.keys(rule.thresholds || {})) {
                expect(source).toContain(key);
            }
        }
    });
});
