const request = require('supertest');
const express = require('express');

// Mock DB
jest.mock('../db', () => {
    const queryFn = jest.fn();
    return {
        query: queryFn
    };
});

// Mock Auth Middleware
jest.mock('../middleware/authMiddleware', () => ({
    protect: (req, res, next) => {
        req.user = req.user || { employee_id: 1, username: 'testadmin', permission_level_id: 10 };
        next();
    },
    hasPermission: () => (req, res, next) => next(),
    isAdmin: (req, res, next) => next()
}));

// Mock AI Parser service
jest.mock('../services/expenseAIParser', () => ({
    parseExpenseText: jest.fn().mockImplementation(async (text) => {
        if (!text || text.length < 3) {
            const err = new Error('Text too short for AI parsing');
            err.statusCode = 400;
            throw err;
        }
        return {
            parsed: {
                amount: 2500,
                category_id: 2,
                category_name: 'Utilities',
                payee: 'Meralco',
                payment_method_id: 1,
                payment_method_text: 'Cash',
                expense_date: '2026-07-23',
                reference_no: null,
                notes: 'electricity',
                confidence: { overall: 0.95, category: 0.98, amount: 1, date: 0.9, payment_method: 0.95 }
            },
            provider: 'google'
        };
    })
}));

const db = require('../db');
const expenseCategoryRouter = require('../routes/expenseCategoryRoutes');
const expenseRouter = require('../routes/expenseRoutes');

const app = express();
app.use(express.json());
app.use('/api', expenseCategoryRouter);
app.use('/api', expenseRouter);

describe('Expense Recording Module Routes', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('GET /api/expense-categories', () => {
        test('should return list of active expense categories', async () => {
            db.query.mockResolvedValueOnce({
                rows: [
                    { category_id: 1, category_name: 'Rent', sort_order: 1, is_active: true },
                    { category_id: 2, category_name: 'Utilities', sort_order: 2, is_active: true }
                ]
            });

            const res = await request(app).get('/api/expense-categories');
            expect(res.status).toBe(200);
            expect(res.body).toHaveLength(2);
            expect(res.body[0].category_name).toBe('Rent');
        });
    });

    describe('POST /api/expense-categories', () => {
        test('should create new category when valid', async () => {
            db.query.mockResolvedValueOnce({ rows: [] }); // check duplicate
            db.query.mockResolvedValueOnce({
                rows: [{ category_id: 10, category_name: 'Marketing', sort_order: 9, is_active: true }]
            }); // insert

            const res = await request(app)
                .post('/api/expense-categories')
                .send({ category_name: 'Marketing', description: 'Ads & flyers', sort_order: 9 });

            expect(res.status).toBe(201);
            expect(res.body.category_name).toBe('Marketing');
        });

        test('should reject duplicate category name (case-insensitive)', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ category_id: 1 }] });

            const res = await request(app)
                .post('/api/expense-categories')
                .send({ category_name: 'RENT' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/already exists/i);
        });
    });

    describe('GET /api/expenses', () => {
        test('should return paginated expense records', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ total: 1 }] }); // count
            db.query.mockResolvedValueOnce({
                rows: [{
                    expense_id: 1,
                    expense_date: '2026-07-23',
                    amount: '2500.00',
                    payee: 'Meralco',
                    category: { category_id: 2, category_name: 'Utilities' }
                }]
            }); // query

            const res = await request(app).get('/api/expenses?page=1&limit=25');
            expect(res.status).toBe(200);
            expect(res.body.data).toHaveLength(1);
            expect(res.body.pagination.totalItems).toBe(1);
        });
    });

    describe('POST /api/expenses', () => {
        test('should create a new expense record', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ category_id: 2 }] }); // check category
            db.query.mockResolvedValueOnce({ rows: [{ method_id: 1, name: 'Cash' }] }); // check payment method
            db.query.mockResolvedValueOnce({ rows: [{ expense_id: 100 }] }); // insert
            db.query.mockResolvedValueOnce({
                rows: [{
                    expense_id: 100,
                    expense_date: '2026-07-23',
                    amount: 1500,
                    payee: 'Store Landlord',
                    category: { category_id: 2, category_name: 'Utilities' }
                }]
            }); // fetch joined

            const res = await request(app)
                .post('/api/expenses')
                .send({
                    expense_date: '2026-07-23',
                    category_id: 2,
                    amount: 1500,
                    payee: 'Store Landlord',
                    payment_method_id: 1
                });

            expect(res.status).toBe(201);
            expect(res.body.expense_id).toBe(100);
        });

        test('should reject invalid amount', async () => {
            const res = await request(app)
                .post('/api/expenses')
                .send({
                    expense_date: '2026-07-23',
                    category_id: 2,
                    amount: -50
                });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/greater than 0/i);
        });
    });

    describe('PUT /api/expenses/:id/void', () => {
        test('should void active expense record with reason', async () => {
            db.query.mockResolvedValueOnce({ rows: [{ is_void: false }] }); // check existing
            db.query.mockResolvedValueOnce({ rows: [] }); // update void
            db.query.mockResolvedValueOnce({
                rows: [{ expense_id: 1, is_void: true, void_reason: 'Entered in error' }]
            }); // fetch

            const res = await request(app)
                .put('/api/expenses/1/void')
                .send({ void_reason: 'Entered in error' });

            expect(res.status).toBe(200);
            expect(res.body.is_void).toBe(true);
        });

        test('should reject voiding without valid reason', async () => {
            const res = await request(app)
                .put('/api/expenses/1/void')
                .send({ void_reason: 'no' });

            expect(res.status).toBe(400);
            expect(res.body.message).toMatch(/minimum 5 characters/i);
        });
    });

    describe('POST /api/expenses/parse', () => {
        test('should return structured parse response for natural language text', async () => {
            const res = await request(app)
                .post('/api/expenses/parse')
                .send({ text: 'paid 2500 for electricity to Meralco' });

            expect(res.status).toBe(200);
            expect(res.body.parsed.category_name).toBe('Utilities');
            expect(res.body.parsed.amount).toBe(2500);
        });
    });
});
