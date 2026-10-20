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
jest.mock('../services/paperlessService', () => ({ syncReceiptRecordedTag: jest.fn().mockResolvedValue(undefined) }));
const { syncReceiptRecordedTag } = require('../services/paperlessService');
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

        test('keeps history available while the physical-receipt migration is pending', async () => {
            const mockRows = [{ grn_id: 1, grn_number: 'GRN-202607-0001' }];
            db.query
                .mockRejectedValueOnce({ code: '42703', message: 'column gr.physical_receipt_no does not exist' })
                .mockResolvedValueOnce({ rows: [{ total: 1 }] })
                .mockResolvedValueOnce({ rows: mockRows });

            const res = await request(app).get('/api/goods-receipts?paginated=true&page=1&pageSize=10');

            expect(res.status).toBe(200);
            expect(res.body.data).toEqual(mockRows);
            expect(db.query.mock.calls[1][0]).not.toContain('gr.physical_receipt_no');
        });

        test('should allow sorting by created_at and query created_at column', async () => {
            const mockRows = [
                {
                    grn_id: 1,
                    grn_number: 'GRN-202607-0001',
                    receipt_date: '2026-07-23T00:00:00Z',
                    created_at: '2026-07-24T10:00:00Z',
                    supplier_name: 'Test Supplier',
                    employee_name: 'Admin User'
                }
            ];

            db.query.mockResolvedValueOnce({ rows: mockRows });

            const res = await request(app).get('/api/goods-receipts?sortBy=created_at&sortOrder=asc');

            expect(res.status).toBe(200);
            expect(res.body[0].created_at).toBe('2026-07-24T10:00:00Z');
            expect(db.query.mock.calls[0][0]).toContain('created_at');
            expect(db.query.mock.calls[0][0]).toContain('ORDER BY created_at asc');
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

    describe('GET /api/goods-receipts/:id', () => {
        test('loads legacy backfill details when the physical-receipt migration is pending', async () => {
            db.query
                .mockRejectedValueOnce({ code: '42703', message: 'column gr.physical_receipt_no does not exist' })
                .mockResolvedValueOnce({ rows: [{ grn_id: 386, supplier_invoice_no: 'DR-386', physical_receipt_no: 'DR-386' }] })
                .mockResolvedValueOnce({ rows: [] });

            const res = await request(app).get('/api/goods-receipts/386');

            expect(res.status).toBe(200);
            expect(res.body.physical_receipt_no).toBe('DR-386');
            expect(db.query.mock.calls[1][0]).not.toContain('gr.physical_receipt_no');
        });
    });

    describe('physical receipt number helpers', () => {
        test('header correction preserves the receipt exactly as entered', async () => {
            const client = await db.getClient();
            const raw = '  si / 00042  ';
            client.query
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ rows: [{ grn_id: 9, status: 'Active' }] })
                .mockResolvedValueOnce({ rows: [{ grn_id: 9, physical_receipt_no: raw }] })
                .mockResolvedValueOnce({});
            const res = await request(app).patch('/api/goods-receipts/9/physical-receipt-no')
                .send({ physical_receipt_no: raw });
            expect(res.status).toBe(200);
            expect(res.body.physical_receipt_no).toBe(raw);
            expect(client.query).toHaveBeenCalledWith(expect.stringContaining('SET physical_receipt_no = $1'), [raw, '9']);
        });

        test('reports a normalized supplier-scoped physical receipt conflict', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ grn_id: 9, grn_number: 'GRN-9', workflow_status: 'Posted' }] });

            const res = await request(app)
                .get('/api/goods-receipts/check-physical-receipt?supplier_id=7&physical_receipt_no=dr%200012');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({ is_taken: true, grn_id: 9, grn_number: 'GRN-9', workflow_status: 'Posted' });
            expect(db.query).toHaveBeenCalledWith(expect.stringContaining('goods_receipt_match_key(physical_receipt_no) = $2'), [7, 'DR12', null]);
        });

        test('rejects an availability lookup without supplier or receipt number', async () => {
            const res = await request(app).get('/api/goods-receipts/check-physical-receipt?supplier_id=7');
            expect(res.status).toBe(400);
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
            client.query.mockImplementation(async (sql) => {
                const q = String(sql);
                if (q.includes('INSERT INTO goods_receipt (')) return { rows: [{ grn_id: 101 }] };
                if (q.includes('total_ordered')) return { rows: [{ total_ordered: 10, total_received: 10 }] };
                if (q.includes('payment_terms_days')) return { rows: [{ payment_terms_days: null }] };
                if (q.includes('INSERT INTO supplier_bill')) return { rows: [{ bill_id: 555 }] };
                if (q.includes('append_ap_ledger_entry')) return { rows: [{ ledger_id: 1 }] };
                return { rows: [] };
            });

            const res = await request(app)
                .post('/api/goods-receipts')
                .send({
                    supplier_id: 1,
                    received_by: 2,
                    po_id: 5,
                    physical_receipt_no: '  dr / 00042  ',
                    lines: [
                        { part_id: 10, quantity: 10, cost_price: 100, sale_price: 150 }
                    ]
                });

            expect(res.status).toBe(201);
            expect(res.body.grn_id).toBe(101);
            expect(client.query).toHaveBeenCalledWith('BEGIN');
            expect(client.query).toHaveBeenCalledWith('COMMIT');
            expect(syncReceiptRecordedTag).toHaveBeenCalledWith('  dr / 00042  ', true, 1, client);
            const inserted = client.query.mock.calls.find(c => String(c[0]).includes('INSERT INTO goods_receipt ('));
            expect(inserted[1][7]).toBe('  dr / 00042  ');
            expect(inserted[1][8]).toBe('  dr / 00042  ');
            const commitIndex = client.query.mock.calls.findIndex(c => c[0] === 'COMMIT');
            expect(client.query.mock.invocationCallOrder[commitIndex]).toBeLessThan(syncReceiptRecordedTag.mock.invocationCallOrder[0]);
        });
    });
});
