// Phase 4 — Purchasing & Suppliers, Operations.
//
// These tests guard the decisions that would be silently wrong rather than
// loudly broken. Every one of them protects a figure that would still render as
// a plausible number if the property it asserts stopped holding.

jest.mock('../db', () => ({ query: jest.fn(), getClient: jest.fn() }));

const { parseQueryRequest } = require('../services/analytics/requestValidator');
const { buildQuery } = require('../services/analytics/queryBuilder');
const { METRICS, SOURCES, DIMENSIONS } = require('../services/analytics/registry');
const { BOARDS } = require('../services/analytics/boards');

const adminReq = { user: { employee_id: 1, permission_level_id: 10, permissions: [] } };
const RANGE = { from: '2026-08-01', to: '2026-08-31' };
const build = (body) => buildQuery(parseQueryRequest(body, adminReq));

describe('purchasing — what a receipt counts as', () => {
    test('spend never includes a draft or a voided receipt', () => {
        for (const sourceId of ['receipt_line', 'receipt_header']) {
            const metric = Object.values(METRICS).find((m) => m.source === sourceId);
            const { text } = build({ metrics: [metric.id], dateRange: RANGE });
            expect(text).toContain("gr.workflow_status = 'Posted'");
            expect(text).toContain("gr.status <> 'Voided'");
        }
    });

    test('quantities and spend are net of returns, so a line sent straight back is not a purchase', () => {
        const cols = SOURCES.receipt_line.cols;
        expect(cols.quantity).toContain('- grl.return_quantity');
        expect(cols.spend).toContain('- grl.return_quantity');
    });

    test('every money metric on receipt lines is trusted, because a zero cost is not a free good', () => {
        const money = Object.values(METRICS).filter(
            (m) => m.source === 'receipt_line' && m.format === 'currency'
        );
        expect(money.length).toBeGreaterThan(0);
        for (const m of money) expect(m.trust).toBe('costed_receipt_line');
    });

    test('cost coverage is weighted by units, not by value', () => {
        // Value-weighting is degenerate here: an uncosted line contributes zero
        // spend, so a value ratio would divide the costed spend by itself and
        // report 100% coverage on every purchasing tile in the module.
        const { text } = build({ metrics: ['purch.spend'], dateRange: RANGE });
        expect(text).toContain('cov_costed_receipt_line_num');
        expect(text).toMatch(/SUM\(GREATEST\(\(grl\.quantity - grl\.return_quantity\), 0\)\) FILTER/);
    });
});

describe('purchasing — price variance compares against the last purchase, not the range', () => {
    test('the LAG window carries no date placeholder, so the comparison is not the range', () => {
        // THE property of this source. If the window were bounded by the request
        // range, "prices rose 4%" would mean "rose against the oldest receipt that
        // happened to fall inside the window you picked", and the figure would
        // change every time a reader moved the date picker without a single price
        // having moved.
        const { text } = build({ metrics: ['purch.price_variance_value'], dateRange: RANGE });
        const from = text.indexOf('FROM (');
        const to = text.indexOf(') rp');
        const inner = text.slice(from, to);
        expect(inner).toContain('LAG(grl.landed_unit_cost) OVER (');
        expect(inner).not.toMatch(/\$\d/);
        // The range applies to the row being measured, on the outer query.
        expect(text.slice(to)).toContain('rp.receipt_date');
    });

    test('both sides of a comparison must carry a cost', () => {
        const { text } = build({ metrics: ['purch.price_variance_pct'], dateRange: RANGE });
        expect(text).toContain('grl.landed_unit_cost > 0');
        expect(text).toContain('rp.prev_unit_cost > 0');
    });

    test('the percentage is weighted by money, not an average of per-part percentages', () => {
        const m = METRICS['purch.price_variance_pct'];
        expect(m.kind).toBe('ratio');
        expect(m.numerator).toBe('purch.price_variance_value');
        expect(m.denominator).toBe('purch.prior_cost_base');
    });
});

describe('purchasing — lead time is registered and refuses to answer', () => {
    test('every purchase-order metric is gated, so none of them can report zero days', () => {
        const leadMetrics = Object.values(METRICS).filter(
            (m) => m.source === 'purchase_lead' || m.id === 'purch.avg_lead_days'
        );
        expect(leadMetrics.length).toBeGreaterThan(0);
        for (const m of leadMetrics) expect(m.readiness).toBe('purchase_order_data');
    });

    test('an outstanding order does not enter the average as an instant delivery', () => {
        const { text } = build({ metrics: ['purch.avg_lead_days'], dateRange: RANGE });
        expect(text).toContain('fr.first_receipt IS NOT NULL');
    });
});

describe('payables', () => {
    test('the aging bands are the same ones receivables uses, applied to bills', () => {
        const cols = SOURCES.supplier_bill_open.cols;
        const sql = DIMENSIONS.aging_bucket.keyLabel(cols, SOURCES.supplier_bill_open, {});
        expect(sql).toContain('(No payment terms)');
        expect(sql).toContain('sb.due_date IS NULL');
    });

    test('paid and voided bills are never counted as owed', () => {
        const { text } = build({ metrics: ['purch.ap_open_balance'], dateRange: RANGE });
        expect(text).toContain("sb.status IN ('Unpaid', 'Partially Paid')");
    });

    test('the oldest overdue bill folds by max, because adding maxima gives nothing', () => {
        expect(METRICS['purch.ap_oldest_overdue_days'].fold).toBe('max');
    });
});

describe('operations', () => {
    test('lines nobody counted are excluded, so accuracy is not diluted by work not yet done', () => {
        const { text } = build({ metrics: ['ops.count_accuracy_pct'], dateRange: RANGE });
        expect(text).toContain('ccl.counted_at IS NOT NULL');
        expect(text).toContain('ccl.counted_qty IS NOT NULL');
    });

    test('lines with no start time drop out of both halves of the timing average', () => {
        const { text } = build({ metrics: ['ops.avg_count_minutes'], dateRange: RANGE });
        const starts = text.match(/ccl\.started_at IS NOT NULL/g) || [];
        // Once for the total time, once for the line count it is divided by.
        expect(starts.length).toBe(2);
    });

    test('shortfall and overage are separate, so a net variance near zero cannot hide both', () => {
        const short = build({ metrics: ['ops.count_shortfall_units'], dateRange: RANGE }).text;
        const over = build({ metrics: ['ops.count_overage_units'], dateRange: RANGE }).text;
        expect(short).toContain('< 0');
        expect(over).toContain('> 0');
        expect(METRICS['ops.count_shortfall_units'].expr(SOURCES.count_line.cols))
            .toContain('SUM(-(');
    });

    test('nothing on the operations board is valued in money', () => {
        // `inventory_transaction.unit_cost` is NULL on every adjustment and
        // reversal, so a peso figure here could only come from pricing an old
        // movement at today's cost.
        const opsMetrics = Object.values(METRICS).filter((m) => m.id.startsWith('ops.'));
        expect(opsMetrics.length).toBeGreaterThan(0);
        for (const m of opsMetrics) expect(m.format).not.toBe('currency');
    });

    test('count adjustments are not counted as corrections; a count is the process working', () => {
        const terms = METRICS['ops.corrections'].terms.map((t) => t.metric);
        expect(terms).toEqual(['ops.manual_adjustments', 'ops.reversals']);
        expect(terms).not.toContain('ops.count_adjustments');
    });
});

describe('boards', () => {
    test('the supplier ledger is never plotted over time', () => {
        // §21.8: do not plot anything longer than its own history. Phase 3 made a
        // deliberate exception for the A/R ledger -- a collections chart is the
        // only honest way to show collections at all, and every tile on it
        // carries the era in its help text. The A/P ledger gets no such
        // exception: sixteen entries over three weeks is not a trend, so ledger
        // movement is a table broken down by movement type instead.
        for (const board of Object.values(BOARDS)) {
            for (const tile of board.tiles) {
                const overApLedger = tile.query.metrics.some(
                    (id) => METRICS[id].source === 'ap_ledger'
                );
                if (!overApLedger) continue;
                expect(tile.query.dimensions || []).not.toContain('date');
                expect(tile.query.grain).toBeFalsy();
            }
        }
    });

    test('the purchasing hero and its supplier table report the same coverage rule', () => {
        const board = BOARDS.purchasing;
        const hero = board.tiles.find((t) => t.id === 'purch.spend');
        const table = board.tiles.find((t) => t.id === 'purch.by_supplier');
        expect(hero.display.coverage.rule).toBe('costed_receipt_line');
        expect(table.display.coverage.rule).toBe('costed_receipt_line');
    });
});
