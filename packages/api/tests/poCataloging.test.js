const express = require('express');
const request = require('supertest');

const mockClient = { query: jest.fn(), release: jest.fn() };
const mockDbQuery = jest.fn();
const mockUserHasPermission = jest.fn(() => true);

jest.mock('../db', () => ({
    query: (...args) => mockDbQuery(...args),
    getClient: jest.fn(() => Promise.resolve(mockClient)),
}));
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { employee_id: 7, permissions: ['goods_receipt:create', 'parts:create'] };
        next();
    },
    hasPermission: () => (req, res, next) => next(),
    userHasPermission: (...args) => mockUserHasPermission(...args),
}));
jest.mock('../meilisearch', () => ({
    meiliClient: { index: jest.fn(() => ({ search: jest.fn() })) },
}));
jest.mock('../services/meiliOutboxService', () => ({
    enqueuePartUpsert: jest.fn().mockResolvedValue(undefined),
    enqueuePartDelete: jest.fn().mockResolvedValue(undefined),
}));

const { router } = require('../routes/partRoutes');

const app = express();
app.use(express.json());
app.use('/api', router);

const partPayload = {
    detail: '  motul   3100 10w-40 1l ',
    brand_id: 2,
    group_id: 3,
    reorder_point: 1,
    warning_quantity: 1,
    is_active: true,
    last_cost: 265,
    last_sale_price: 0,
    measurement_unit: 'btl',
    is_price_change_allowed: true,
    is_using_default_quantity: true,
    is_service: false,
    low_stock_warning: true,
    is_tax_inclusive_price: true,
    is_universal: false,
    part_numbers_string: '',
    tags: [],
    barcodes: [],
    applications: [],
};

const configureSuccessfulQueries = ({ linkRowCount = 1, duplicate = false } = {}) => {
    mockClient.query.mockImplementation((sql, params) => {
        const text = String(sql);
        if (text === 'BEGIN' || text === 'COMMIT' || text === 'ROLLBACK') return Promise.resolve({ rows: [], rowCount: 0 });
        if (text.includes('FROM purchase_order_line pol')) {
            return Promise.resolve({ rows: [{ po_line_id: 9, part_id: null, status: 'Ordered' }], rowCount: 1 });
        }
        if (text.includes('UPPER(TRIM(COALESCE(p.detail')) {
            return Promise.resolve({
                rows: duplicate ? [{ part_id: 88, display_name: 'ENGINE OIL (MOTUL) | MOTUL 3100 10W-40 1L' }] : [],
                rowCount: duplicate ? 1 : 0,
            });
        }
        if (text.includes('SELECT brand_code')) return Promise.resolve({ rows: [{ brand_code: 'MOT', brand_name: 'MOTUL' }] });
        if (text.includes('SELECT group_code')) return Promise.resolve({ rows: [{ group_code: 'OIL', group_name: 'ENGINE OIL' }] });
        if (text.includes('SELECT last_number')) return Promise.resolve({ rows: [] });
        if (text.includes('INSERT INTO part (detail')) {
            return Promise.resolve({
                rows: [{ part_id: 55, detail: params[0], measurement_unit: params[9], internal_sku: params[3] }],
                rowCount: 1,
            });
        }
        if (text.includes('SELECT part_number_id')) return Promise.resolve({ rows: [] });
        if (text.includes('UPDATE purchase_order_line')) return Promise.resolve({ rows: [], rowCount: linkRowCount });
        return Promise.resolve({ rows: [], rowCount: 1 });
    });
    mockDbQuery.mockResolvedValue({
        rows: [{ part_id: 55, detail: 'MOTUL 3100 10W-40 1L', measurement_unit: 'BTL', display_name: 'ENGINE OIL (MOTUL) | MOTUL 3100 10W-40 1L' }],
        rowCount: 1,
    });
};

describe('cataloging a drafted PO line', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockUserHasPermission.mockReturnValue(true);
        configureSuccessfulQueries();
    });

    test('creates and links the part in one transaction with uppercase catalog text', async () => {
        const response = await request(app)
            .post('/api/purchase-orders/4/lines/9/catalog')
            .send(partPayload);

        expect(response.status).toBe(201);
        expect(response.body.part_id).toBe(55);

        const insertCall = mockClient.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO part (detail'));
        expect(insertCall[1][0]).toBe('MOTUL 3100 10W-40 1L');
        expect(insertCall[1][9]).toBe('BTL');
        expect(mockClient.query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true);
        expect(mockClient.query.mock.calls.some(([sql]) => String(sql).includes('UPDATE purchase_order_line'))).toBe(true);
    });

    test('rolls the part creation back when the PO line cannot be linked', async () => {
        mockClient.query.mockReset();
        configureSuccessfulQueries({ linkRowCount: 0 });

        const response = await request(app)
            .post('/api/purchase-orders/4/lines/9/catalog')
            .send(partPayload);

        expect(response.status).toBe(500);
        expect(mockClient.query.mock.calls.some(([sql]) => String(sql) === 'ROLLBACK')).toBe(true);
        expect(mockClient.query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(false);
    });

    test('links an exact active catalog match instead of creating a duplicate', async () => {
        mockClient.query.mockReset();
        configureSuccessfulQueries({ duplicate: true });

        const response = await request(app)
            .post('/api/purchase-orders/4/lines/9/catalog')
            .send(partPayload);

        expect(response.status).toBe(200);
        expect(response.body).toMatchObject({ part_id: 88, catalog_resolution: 'existing' });
        expect(mockClient.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO part (detail'))).toBe(false);
        expect(mockClient.query.mock.calls.some(([sql]) => String(sql) === 'COMMIT')).toBe(true);
    });

    test('requires parts:create in addition to goods receipt access', async () => {
        mockUserHasPermission.mockReturnValue(false);

        const response = await request(app)
            .post('/api/purchase-orders/4/lines/9/catalog')
            .send(partPayload);

        expect(response.status).toBe(403);
        expect(response.body.message).toMatch(/parts:create/);
        expect(require('../db').getClient).not.toHaveBeenCalled();
    });
});
