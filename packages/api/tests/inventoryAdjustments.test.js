const request = require('supertest');
const express = require('express');

jest.setTimeout(10000);

// Mock db module
jest.mock('../db', () => {
    const queryFn = jest.fn();
    return {
        query: queryFn
    };
});

// Mock meilisearch client
jest.mock('../meilisearch', () => ({
    meiliClient: {
        index: () => ({
            search: jest.fn().mockResolvedValue({
                hits: [{ part_id: 10 }],
                totalHits: 1,
                estimatedTotalHits: 1
            })
        })
    }
}));

// Mock auth middleware
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = { user_id: 1, employee_id: 1, username: 'testuser' };
        next();
    },
    hasPermission: () => (req, res, next) => next()
}));

const db = require('../db');
const inventoryRouter = require('../routes/inventoryRoutes');

const app = express();
app.use(express.json());
app.use('/api', inventoryRouter);

describe('Inventory Adjustments & Valuation Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/inventory', () => {
        test('should return inventory stock listing with calculated total value', async () => {
            const mockRows = [
                {
                    part_id: 10,
                    internal_sku: 'BP-100',
                    detail: 'Brake Pad',
                    stock_on_hand: 50,
                    wac_cost: 100.00,
                    total_value: 5000.00
                }
            ];

            db.query.mockResolvedValueOnce({ rows: mockRows });

            const res = await request(app).get('/api/inventory?search=Brake');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].stock_on_hand).toBe(50);
            expect(res.body[0].total_value).toBe(5000.00);
        });
    });

    describe('POST /api/inventory/adjust', () => {
        test('should return 400 when missing required parameters', async () => {
            const res = await request(app)
                .post('/api/inventory/adjust')
                .send({ part_id: 10 });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/required/i);
        });

        test('should post inventory adjustment successfully', async () => {
            const mockTransaction = {
                transaction_id: 500,
                part_id: 10,
                trans_type: 'Adjustment',
                quantity: -2,
                notes: 'Damaged item removed',
                employee_id: 1,
                transaction_date: '2026-07-23T00:00:00Z'
            };

            db.query.mockResolvedValueOnce({ rows: [mockTransaction] });

            const res = await request(app)
                .post('/api/inventory/adjust')
                .send({
                    part_id: 10,
                    quantity: -2,
                    notes: 'Damaged item removed',
                    employee_id: 1
                });

            expect(res.status).toBe(201);
            expect(res.body.transaction_id).toBe(500);
            expect(res.body.trans_type).toBe('Adjustment');
            expect(res.body.quantity).toBe(-2);
        });
    });

    describe('GET /api/inventory/:partId/history', () => {
        test('should fetch transaction history for a specific part', async () => {
            const mockHistory = [
                {
                    transaction_id: 500,
                    part_id: 10,
                    trans_type: 'Adjustment',
                    quantity: -2,
                    notes: 'Damaged item removed',
                    first_name: 'John',
                    last_name: 'Doe'
                }
            ];

            db.query.mockResolvedValueOnce({ rows: mockHistory });

            const res = await request(app).get('/api/inventory/10/history');

            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(1);
            expect(res.body[0].first_name).toBe('John');
        });
    });
});
