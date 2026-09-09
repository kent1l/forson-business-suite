const { validateBoardSpec } = require('../services/analytics/boards/validator');
const analytics = require('../services/analytics');
const {
    formatSlot,
    formatInsightSentence,
    titleForInsight,
    runAnalyticsAlertScan,
    runAnalyticsDigestScan,
} = require('../services/analyticsAlertService');
const db = require('../db');

describe('Phase 5: Board Spec Validator', () => {
    const validBoard = {
        id: 'test_valid_board',
        title: 'Valid Board',
        defaultPreset: 'last_30_days',
        period: 'range',
        tiles: [
            {
                id: 'tile_1',
                type: 'kpi',
                query: {
                    metrics: ['sales.net_revenue'],
                    dimensions: [],
                    grain: null,
                    compare: 'previous_period',
                },
                display: { value: 'sales.net_revenue' },
            },
        ],
    };

    test('accepts a valid board spec', () => {
        expect(() => validateBoardSpec(validBoard)).not.toThrow();
    });

    test('rejects a board referencing an unknown metric', () => {
        const board = {
            ...validBoard,
            id: 'bad_metric',
            tiles: [
                {
                    id: 'tile_1',
                    type: 'kpi',
                    query: { metrics: ['sales.non_existent_metric'] },
                },
            ],
        };
        expect(() => validateBoardSpec(board)).toThrow(/unknown metric/);
    });

    test('rejects a board referencing an unknown dimension', () => {
        const board = {
            ...validBoard,
            id: 'bad_dim',
            tiles: [
                {
                    id: 'tile_1',
                    type: 'bar',
                    query: {
                        metrics: ['sales.net_revenue'],
                        dimensions: ['invalid_dimension'],
                    },
                },
            ],
        };
        expect(() => validateBoardSpec(board)).toThrow(/unknown dimension/);
    });

    test('rejects period: "none" when a tile uses a comparable metric', () => {
        const board = {
            ...validBoard,
            id: 'bad_period_none_metric',
            period: 'none',
            tiles: [
                {
                    id: 'tile_1',
                    type: 'kpi',
                    query: { metrics: ['sales.net_revenue'] }, // net_revenue has comparable: true
                },
            ],
        };
        expect(() => validateBoardSpec(board)).toThrow(/measures a period, on board 'bad_period_none_metric', which declares none/);
    });

    test('rejects period: "none" when a tile requests compare', () => {
        const board = {
            ...validBoard,
            id: 'bad_period_none_compare',
            period: 'none',
            tiles: [
                {
                    id: 'tile_1',
                    type: 'kpi',
                    query: {
                        metrics: ['inventory.stock_value'],
                        compare: 'previous_period',
                    },
                },
            ],
        };
        expect(() => validateBoardSpec(board)).toThrow(/asks for a comparison on board 'bad_period_none_compare'/);
    });

    test('rejects topN rollup when breaking down by multiple dimensions', () => {
        const board = {
            ...validBoard,
            id: 'bad_topn',
            tiles: [
                {
                    id: 'tile_1',
                    type: 'bar',
                    query: {
                        metrics: ['sales.line_revenue'],
                        dimensions: ['brand', 'customer'],
                        topN: { n: 5, by: 'sales.line_revenue' },
                    },
                },
            ],
        };
        expect(() => validateBoardSpec(board)).toThrow(/a rollup needs exactly one non-date dimension/);
    });

    test('rejects a drilldown targeting a non-filterable dimension', () => {
        const board = {
            ...validBoard,
            id: 'bad_drilldown',
            tiles: [
                {
                    id: 'tile_1',
                    type: 'bar',
                    query: {
                        metrics: ['sales.net_revenue'],
                        dimensions: ['date'],
                        grain: 'month',
                    },
                    drilldown: {
                        kind: 'filter',
                        dimension: 'date', // date is filterable: false
                    },
                },
            ],
        };
        expect(() => validateBoardSpec(board)).toThrow(/cannot be filtered on/);
    });

    test('rejects a heatmap when rows or columns are missing from query dimensions', () => {
        const board = {
            ...validBoard,
            id: 'bad_heatmap',
            tiles: [
                {
                    id: 'tile_1',
                    type: 'heatmap',
                    query: {
                        metrics: ['sales.line_revenue'],
                        dimensions: ['brand'],
                    },
                    display: {
                        rows: 'brand',
                        columns: 'customer',
                    },
                },
            ],
        };
        expect(() => validateBoardSpec(board)).toThrow(/heatmap tile 'tile_1' puts 'customer' on its columns axis but does not break down by it/);
    });
});

describe('Phase 5: Alert and Digest Formatting', () => {
    test('formatSlot formats currency, percent, days, and integers according to registry', () => {
        expect(formatSlot({ metric: 'sales.net_revenue', value: 1500000 })).toBe('₱1.50M');
        expect(formatSlot({ metric: 'sales.net_revenue', value: 2500 })).toBe('₱2.5k');
        expect(formatSlot({ metric: 'margin.gross_margin_pct', value: 33.333 })).toBe('33.3%');
        expect(formatSlot({ metric: 'ar.dso', value: 14.2 })).toBe('14.2 days');
        expect(formatSlot({ metric: 'inventory.dead_stock_parts', value: 120 })).toBe('120');
        expect(formatSlot({ value: null })).toBe('No data');
    });

    test('formatInsightSentence substitutes all slots correctly', () => {
        const template = '{value} of stock ({share}) across {parts} parts is dead.';
        const values = {
            value: { metric: 'inventory.dead_stock_value', value: 1250000 },
            share: { metric: 'inventory.dead_stock_share', value: 45.5 },
            parts: { metric: 'inventory.dead_stock_parts', value: 320 },
        };
        const text = formatInsightSentence(template, values);
        expect(text).toBe('₱1.25M of stock (45.5%) across 320 parts is dead.');
    });

    test('titleForInsight formats human-readable notice/alert title', () => {
        expect(titleForInsight({ id: 'insight.dead_stock', severity: 'warning' })).toBe('Dead Stock Notice');
        expect(titleForInsight({ id: 'insight.cost_coverage', severity: 'critical' })).toBe('Cost Coverage Alert');
    });
});

describe('Phase 5: Custom Boards and Saved Views DB Integration', () => {
    let testEmployeeId = null;
    const testBoardId = `test_custom_board_${Date.now()}`;

    beforeAll(async () => {
        const emp = await db.query('SELECT employee_id FROM employee ORDER BY employee_id LIMIT 1');
        testEmployeeId = emp.rows[0]?.employee_id || 1;
    });

    afterAll(async () => {
        await db.query('DELETE FROM analytics_saved_view WHERE board_id = $1 OR board_id = $2', [testBoardId, 'overview']);
        await db.query('DELETE FROM analytics_board WHERE board_id = $1', [testBoardId]);
    });

    test('refuses creating a custom board whose ID collides with a built-in board', async () => {
        const req = { user: { employee_id: testEmployeeId, permission_level_id: 10 } };
        await expect(analytics.createBoard({
            id: 'overview',
            title: 'Colliding Overview',
            defaultPreset: 'last_30_days',
            tiles: [{ id: 't1', type: 'kpi', query: { metrics: ['sales.net_revenue'] } }],
        }, req)).rejects.toThrow(/already reserved for a built-in board/);
    });

    test('creates a valid custom board in DB and retrieves it', async () => {
        const req = { user: { employee_id: testEmployeeId, permission_level_id: 10 } };
        const created = await analytics.createBoard({
            id: testBoardId,
            title: 'My Custom Board',
            description: 'Custom board description',
            defaultPreset: 'last_30_days',
            period: 'range',
            tiles: [
                {
                    id: 'custom_kpi',
                    type: 'kpi',
                    query: {
                        metrics: ['sales.net_revenue', 'sales.gross_revenue'],
                        dimensions: [],
                        compare: 'previous_period',
                    },
                    display: { value: 'sales.net_revenue' },
                },
            ],
        }, req);

        expect(created.id).toBe(testBoardId);
        expect(created.title).toBe('My Custom Board');
        expect(created.isCustom).toBe(true);

        const loaded = await analytics.getBoard(testBoardId, req);
        expect(loaded.id).toBe(testBoardId);
        expect(loaded.tiles.length).toBe(1);
        expect(loaded.tiles[0].id).toBe('custom_kpi');

        const allBoards = await analytics.listBoards(req);
        expect(allBoards.some((b) => b.id === testBoardId)).toBe(true);
    });

    test('prevents modifying or deleting built-in boards', async () => {
        const req = { user: { employee_id: testEmployeeId, permission_level_id: 10 } };
        await expect(analytics.updateBoard('overview', { title: 'New Overview' }, req)).rejects.toThrow(/Built-in boards cannot be modified/);
        await expect(analytics.deleteBoard('overview', req)).rejects.toThrow(/Built-in boards cannot be deleted/);
    });

    test('creates and lists saved views, enforcing default switching', async () => {
        const req = { user: { employee_id: testEmployeeId, permission_level_id: 10 } };

        const view1 = await analytics.createSavedView(req, {
            boardId: 'overview',
            name: 'View One',
            state: { preset: 'last_90_days', compare: true, filters: { brand: [1] } },
            isDefault: true,
        });

        expect(view1.name).toBe('View One');
        expect(view1.isDefault).toBe(true);

        // Creating a second view as default should unset isDefault on view1
        const view2 = await analytics.createSavedView(req, {
            boardId: 'overview',
            name: 'View Two',
            state: { preset: 'this_month', compare: false, filters: {} },
            isDefault: true,
        });

        expect(view2.name).toBe('View Two');
        expect(view2.isDefault).toBe(true);

        const views = await analytics.listSavedViews(req, 'overview');
        const v1 = views.find((v) => v.viewId === view1.viewId);
        const v2 = views.find((v) => v.viewId === view2.viewId);

        expect(v1.isDefault).toBe(false);
        expect(v2.isDefault).toBe(true);

        // Delete view2
        await analytics.deleteSavedView(req, view2.viewId);
        const updatedViews = await analytics.listSavedViews(req, 'overview');
        expect(updatedViews.some((v) => v.viewId === view2.viewId)).toBe(false);
    });

    test('rejects duplicate saved view name on same board for same user', async () => {
        const req = { user: { employee_id: testEmployeeId, permission_level_id: 10 } };
        await expect(analytics.createSavedView(req, {
            boardId: 'overview',
            name: 'View One', // Already created
            state: { preset: 'last_30_days' },
        })).rejects.toThrow(/already exists on this board/);
    });

    test('deletes the custom board and cleans up', async () => {
        const req = { user: { employee_id: testEmployeeId, permission_level_id: 10 } };
        const res = await analytics.deleteBoard(testBoardId, req);
        expect(res.success).toBe(true);

        await expect(analytics.getBoard(testBoardId, req)).rejects.toThrow(/Unknown board/);
    });

    test('runs alert scan and digest scan without crashing', async () => {
        const alertResult = await runAnalyticsAlertScan();
        expect(alertResult).toHaveProperty('fired');

        const digestResult = await runAnalyticsDigestScan();
        expect(digestResult.success).toBe(true);
    });
});
