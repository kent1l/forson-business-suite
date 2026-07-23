const request = require('supertest');
const express = require('express');

jest.setTimeout(10000);

// Mock db module
jest.mock('../db', () => {
    const queryFn = jest.fn();
    const client = {
        query: jest.fn(),
        release: jest.fn()
    };
    return {
        query: queryFn,
        getClient: jest.fn().mockResolvedValue(client)
    };
});

// Mock auth middleware
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { user_id: 1, employee_id: 1, username: 'testuser' };
        next();
    },
    hasPermission: () => (req, res, next) => next()
}));

// Mock document number generator
jest.mock('../helpers/documentNumberGenerator', () => ({
    getNextDocumentNumber: jest.fn().mockResolvedValue('GRN-202607-0001')
}));

const db = require('../db');
const goodsReceiptRouter = require('../routes/goodsReceiptRoutes');

const app = express();
app.use(express.json());
app.use('/api', goodsReceiptRouter);

describe('Goods Receipt Inventory & Pricing Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/goods-receipts', () => {
        test('should fetch unpaginated goods receipts list by default', async () => {
            const mockRows = [
                {
                    grn_id: 1,
                    grn_number: 'GRN-202607-0001',
                    receipt_date: '2026-07-23T00:00:00Z',
                    supplier_name: 'Test Supplier',
                    employee_name: 'Admin User'
                }
            ];

            db.query.mockResolvedValueOnce({ rows: mockRows });

            const res = await request(app).get('/api/goods-receipts');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].grn_number).toBe('GRN-202607-0001');
        });

        test('should fetch paginated goods receipts list when paginated=true', async () => {
            const mockRows = [
                {
                    grn_id: 1,
                    grn_number: 'GRN-202607-0001',
                    receipt_date: '2026-07-23T00:00:00Z',
                    supplier_name: 'Test Supplier',
                    employee_name: 'Admin User'
                }
            ];

            db.query
                .mockResolvedValueOnce({ rows: [{ total: 1 }] })
                .mockResolvedValueOnce({ rows: mockRows });

            const res = await request(app).get('/api/goods-receipts?paginated=true&page=1&pageSize=10');

            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.data[0].grn_number).toBe('GRN-202607-0001');
        });

        test('should reject invalid sort parameters', async () => {
            const res = await request(app).get('/api/goods-receipts?sortBy=invalid_column');
            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/Invalid sortBy/i);
        });
    });

    describe('GET /api/goods-receipts/:id/lines', () => {
        test('should fetch lines for a valid GRN ID', async () => {
            const mockLines = [
                {
                    grn_line_id: 1,
                    part_id: 10,
                    quantity: 5,
                    cost_price: 150.00,
                    sale_price: 200.00,
                    display_name: 'Brake Pad | BP-100',
                    internal_sku: 'BP-100'
                }
            ];

            db.query.mockResolvedValueOnce({ rows: mockLines });

            const res = await request(app).get('/api/goods-receipts/1/lines');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].quantity).toBe(5);
        });
    });

    describe('POST /api/goods-receipts', () => {
        test('should return 400 when missing required body fields', async () => {
            const res = await request(app)
                .post('/api/goods-receipts')
                .send({ supplier_id: 1 });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/Missing required fields/i);
        });

        test('should post Goods Receipt, insert StockIn transactions, and update PO status', async () => {
            const client = await db.getClient();
            client.query
                .mockResolvedValueOnce({}) // BEGIN
                .mockResolvedValueOnce({ rows: [{ grn_id: 101 }] }) // INSERT goods_receipt
                .mockResolvedValueOnce({}) // INSERT goods_receipt_line
                .mockResolvedValueOnce({}) // INSERT inventory_transaction (StockIn)
                .mockResolvedValueOnce({}) // UPDATE purchase_order_line
                .mockResolvedValueOnce({ rows: [{ total_ordered: 10, total_received: 10 }] }) // SELECT PO sums
                .mockResolvedValueOnce({}) // UPDATE purchase_order status
                .mockResolvedValueOnce({}); // COMMIT

            const res = await request(app)
                .post('/api/goods-receipts')
                .send({
                    supplier_id: 1,
                    received_by: 2,
                    po_id: 5,
                    lines: [
                        { part_id: 10, quantity: 10, cost_price: 100, sale_price: 150 }
                    ]
                });

            expect(res.status).toBe(201);
            expect(res.body.grn_id).toBe(101);
            expect(client.query).toHaveBeenCalledWith('BEGIN');
            expect(client.query).toHaveBeenCalledWith('COMMIT');
        });
    });
});
